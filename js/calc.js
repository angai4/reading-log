/*
 * calc.js - all the reading maths, as pure functions.
 *
 * Nothing in here touches the page or the database: every function takes
 * plain data in and returns plain data out. That keeps the rules for
 * progress, Days, streaks and the wheel in one place and easy to check.
 *
 * Data shapes used throughout:
 *   book    { id, title, author, totalPages, genre, status, dateAdded,
 *             dateFinished, rating, notes, colour, createdAt }
 *           status is one of 'wheel' | 'want' | 'finished' | 'abandoned'
 *   session { id, bookId, startDate, endDate, chapters, startPage, endPage }
 *           endDate equals startDate for a normal single-day entry
 *   note    { date, text }
 * Dates are always stored as local 'YYYY-MM-DD' strings.
 */

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const STATUS_LABELS = {
  wheel: 'On the wheel',
  want: 'Want to read',
  finished: 'Finished',
  abandoned: 'Abandoned',
};

/** The rule slots that can appear on the wheel, in display order. */
export const RULES = [
  { id: 'lowest', name: 'Lowest %', emoji: '🐢', explain: 'The book on the wheel with the lowest % complete' },
  { id: 'highest', name: 'Highest %', emoji: '🚀', explain: 'The started book on the wheel with the highest % complete' },
  { id: 'biggest', name: 'Biggest Book', emoji: '🐘', explain: 'The book on the wheel with the most total pages' },
  { id: 'leastWeek', name: 'Least Read Last Week', emoji: '💤', explain: 'Fewest pages read in the last 7 days' },
  { id: 'longest', name: 'Longest on the Wheel', emoji: '⏳', explain: 'The book added to the wheel earliest' },
  { id: 'pick', name: 'I Pick', emoji: '🎯', explain: 'Free choice: read whatever you fancy' },
];
export const RULE_IDS = RULES.map((r) => r.id);
export const ruleById = (id) => RULES.find((r) => r.id === id);

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* Dates are converted to "day numbers" (days since 1 Jan 1970, UTC)   */
/* for arithmetic, which avoids daylight-saving surprises.             */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');

/** Today's date (or the given Date) as a local 'YYYY-MM-DD' string. */
export function todayISO(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'YYYY-MM-DD' to a whole day number. */
export function dayNum(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** Day number back to 'YYYY-MM-DD'. */
export function isoFromDayNum(n) {
  const dt = new Date(n * 86400000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Add (or subtract) whole days to a date string. */
export function addDays(iso, days) {
  return isoFromDayNum(dayNum(iso) + days);
}

/** Number of days from a to b (b - a). */
export function daysBetween(a, b) {
  return dayNum(b) - dayNum(a);
}

/** Every date from start to end inclusive, as strings. */
export function datesInRange(start, end) {
  const out = [];
  for (let n = dayNum(start); n <= dayNum(end); n++) out.push(isoFromDayNum(n));
  return out;
}

/** A session's last date (single-day sessions may have no endDate). */
export const sessionEnd = (s) => s.endDate || s.startDate;

/** How many calendar days a session covers (1 for a normal entry). */
export const sessionDayCount = (s) => dayNum(sessionEnd(s)) - dayNum(s.startDate) + 1;

/* ------------------------------------------------------------------ */
/* Pages and progress                                                  */
/* ------------------------------------------------------------------ */

/**
 * Pages read in a session. Both ends count, so pages 128-161 is 34 pages
 * and the next session naturally starts on page 162.
 */
export function pagesInSession(s) {
  return Math.max(0, Number(s.endPage) - Number(s.startPage) + 1);
}

/**
 * Work out progress for every book.
 * Current page = the highest end page logged for that book.
 * Returns Map(bookId -> { currentPage, pct (0..1), pagesRead, sessionCount }).
 */
export function progressMap(books, sessions) {
  const map = new Map();
  books.forEach((b) => map.set(b.id, { currentPage: 0, pct: 0, pagesRead: 0, sessionCount: 0 }));
  sessions.forEach((s) => {
    const entry = map.get(s.bookId);
    if (!entry) return; // session for a deleted book: ignore
    entry.currentPage = Math.max(entry.currentPage, Number(s.endPage));
    entry.pagesRead += pagesInSession(s);
    entry.sessionCount += 1;
  });
  books.forEach((b) => {
    const entry = map.get(b.id);
    const total = Number(b.totalPages) || 0;
    entry.pct = total > 0 ? Math.min(1, entry.currentPage / total) : 0;
  });
  return map;
}

/** 0.4025 -> '40%'. Rounds down so a book never shows 100% until finished. */
export function pctLabel(pct) {
  return `${Math.floor(pct * 100)}%`;
}

/**
 * Pages read on each calendar date. A multi-day entry has its pages
 * spread evenly across its dates (100 pages over 5 days = 20 a day).
 * Optionally only counts dates between `from` and `to` (inclusive).
 * Returns Map(date -> pages) and, per book, Map(bookId -> pages).
 */
export function pagesByDate(sessions, from = null, to = null) {
  const byDate = new Map();
  const byBook = new Map();
  sessions.forEach((s) => {
    const perDay = pagesInSession(s) / sessionDayCount(s);
    datesInRange(s.startDate, sessionEnd(s)).forEach((date) => {
      if (from && date < from) return;
      if (to && date > to) return;
      byDate.set(date, (byDate.get(date) || 0) + perDay);
      byBook.set(s.bookId, (byBook.get(s.bookId) || 0) + perDay);
    });
  });
  return { byDate, byBook };
}

/* ------------------------------------------------------------------ */
/* Days (the numbered diary)                                           */
/* ------------------------------------------------------------------ */

/**
 * Group sessions into numbered Days.
 *  - Single-day entries are grouped by date.
 *  - A multi-day entry (e.g. 27-31 Oct) forms its own Day, shared with any
 *    other entries covering exactly the same range.
 *  - Days are numbered 1, 2, 3... in date order, counting only days with
 *    reading (skipped days don't use up a number).
 *  - Each note is attached to the Day covering its date; a note on a date
 *    with no reading becomes an un-numbered "note only" entry.
 * Returns the list newest first, ready to display.
 */
export function buildDays(sessions, notes, books) {
  const bookOrder = new Map(books.map((b) => [b.id, b.title.toLowerCase()]));
  const groups = new Map();

  sessions.forEach((s) => {
    const end = sessionEnd(s);
    const key = `${s.startDate}|${end}`;
    if (!groups.has(key)) {
      groups.set(key, { key, start: s.startDate, end, multi: end !== s.startDate, sessions: [], notes: [], total: 0 });
    }
    const day = groups.get(key);
    day.sessions.push(s);
    day.total += pagesInSession(s);
  });

  // Oldest first so we can number them.
  const days = [...groups.values()].sort((a, b) =>
    a.start === b.start ? a.end.localeCompare(b.end) : a.start.localeCompare(b.start)
  );
  days.forEach((day, i) => {
    day.number = i + 1;
    // Keep each Day's books in a stable, friendly order (by log order).
    day.sessions.sort((a, b) => (a.id || 0) - (b.id || 0) || (bookOrder.get(a.bookId) || '').localeCompare(bookOrder.get(b.bookId) || ''));
  });

  // Attach notes. Prefer an exact single-day match, then any range covering it.
  const noteOnly = [];
  notes.forEach((note) => {
    const exact = days.find((d) => !d.multi && d.start === note.date);
    const covering = exact || days.find((d) => d.start <= note.date && note.date <= d.end);
    if (covering) covering.notes.push(note);
    else noteOnly.push({ key: `note|${note.date}`, start: note.date, end: note.date, multi: false, sessions: [], notes: [note], total: 0, number: null });
  });

  return [...days, ...noteOnly].sort((a, b) =>
    a.start === b.start ? b.end.localeCompare(a.end) : b.start.localeCompare(a.start)
  );
}

/** Every calendar date on which some reading was logged (Set of strings). */
export function readingDates(sessions) {
  const set = new Set();
  sessions.forEach((s) => datesInRange(s.startDate, sessionEnd(s)).forEach((d) => set.add(d)));
  return set;
}

/**
 * Current and best streak of consecutive reading days.
 * The current streak stays alive until the end of today: if you haven't
 * read yet today, it counts back from yesterday.
 */
export function streaks(sessions, today = todayISO()) {
  const nums = [...readingDates(sessions)].map(dayNum).sort((a, b) => a - b);
  if (!nums.length) return { current: 0, best: 0 };
  const set = new Set(nums);

  let n = dayNum(today);
  if (!set.has(n)) n -= 1;
  let current = 0;
  while (set.has(n)) {
    current++;
    n--;
  }

  let best = 1;
  let run = 1;
  for (let i = 1; i < nums.length; i++) {
    run = nums[i] === nums[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return { current, best };
}

/* ------------------------------------------------------------------ */
/* Wheel rules                                                         */
/* ------------------------------------------------------------------ */

/** Books currently on the wheel, alphabetically. */
export function wheelBooks(books) {
  return books
    .filter((b) => b.status === 'wheel')
    .sort((a, b) => a.title.localeCompare(b.title, 'en-GB', { sensitivity: 'base' }));
}

/** The date a book went on the wheel (falls back to when it was created). */
export function addedDate(book) {
  return book.dateAdded || todayISO(new Date(book.createdAt || Date.now()));
}

/** Keep every item that shares the lowest (or highest) value: ties stay in. */
function ties(items, valueOf, mode) {
  if (!items.length) return [];
  const values = items.map(valueOf);
  const target = mode === 'min' ? Math.min(...values) : Math.max(...values);
  return items.filter((_, i) => values[i] === target);
}

/**
 * Work out which book(s) each rule slot points to right now.
 * Returns Map(ruleId -> { picks: [{ book, detail }], empty }) where `empty`
 * is a friendly message used when the rule has nothing to point at.
 */
export function evaluateRules(books, sessions, progress, today = todayISO()) {
  const onWheel = wheelBooks(books);
  const pct = (b) => progress.get(b.id)?.pct ?? 0;
  const results = new Map();
  const none = 'No books on the wheel yet';

  // Lowest %: every tied book is shown (e.g. two books at 0%).
  results.set('lowest', {
    picks: ties(onWheel, pct, 'min').map((book) => ({ book, detail: pctLabel(pct(book)) })),
    empty: none,
  });

  // Highest %: only books that have been started.
  const started = onWheel.filter((b) => pct(b) > 0);
  results.set('highest', {
    picks: ties(started, pct, 'max').map((book) => ({ book, detail: pctLabel(pct(book)) })),
    empty: onWheel.length ? 'Nothing started yet' : none,
  });

  // Biggest Book: most total pages.
  results.set('biggest', {
    picks: ties(onWheel, (b) => Number(b.totalPages) || 0, 'max').map((book) => ({
      book,
      detail: `${Number(book.totalPages).toLocaleString('en-GB')} pages`,
    })),
    empty: none,
  });

  // Least Read Last Week: today and the 6 days before it.
  const { byBook } = pagesByDate(sessions, addDays(today, -6), today);
  // Round to 2 decimals before comparing, so spread-out pages tie fairly.
  const weekPages = (b) => Math.round((byBook.get(b.id) || 0) * 100) / 100;
  results.set('leastWeek', {
    picks: ties(onWheel, weekPages, 'min').map((book) => {
      const p = Math.round(weekPages(book));
      return { book, detail: `${p} ${p === 1 ? 'page' : 'pages'} this week` };
    }),
    empty: none,
  });

  // Longest on the Wheel: earliest date added.
  results.set('longest', {
    picks: ties(onWheel, (b) => dayNum(addedDate(b)), 'min').map((book) => {
      const days = daysBetween(addedDate(book), today);
      return { book, detail: `since ${formatDate(addedDate(book), { year: true })} (${days} ${days === 1 ? 'day' : 'days'})` };
    }),
    empty: none,
  });

  // I Pick: free choice from anything on the wheel.
  results.set('pick', {
    picks: onWheel.map((book) => ({ book, detail: pctLabel(pct(book)) })),
    empty: none,
  });

  return results;
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

/** Headline numbers for the Stats screen. */
export function summaryStats(books, sessions, today = todayISO()) {
  const totalPages = sessions.reduce((sum, s) => sum + pagesInSession(s), 0);
  const dates = readingDates(sessions);
  const sortedDates = [...dates].sort();
  const firstDate = sortedDates[0] || null;
  const calendarDays = firstDate ? Math.max(1, daysBetween(firstDate, today) + 1) : 0;
  const { current, best } = streaks(sessions, today);
  const thisYear = today.slice(0, 4);
  const finished = books.filter((b) => b.status === 'finished');
  return {
    totalPages,
    readingDays: dates.size,
    perReadingDay: dates.size ? totalPages / dates.size : 0,
    perCalendarDay: calendarDays ? totalPages / calendarDays : 0,
    firstDate,
    booksFinished: finished.length,
    finishedThisYear: finished.filter((b) => (b.dateFinished || '').startsWith(thisYear)).length,
    currentStreak: current,
    bestStreak: best,
  };
}

/** Pages per day for the last `count` days, oldest first. */
export function dailySeries(sessions, today = todayISO(), count = 30) {
  const from = addDays(today, -(count - 1));
  const { byDate } = pagesByDate(sessions, from, today);
  return datesInRange(from, today).map((date) => ({ date, pages: Math.round(byDate.get(date) || 0) }));
}

/** Pages per week (weeks start on Monday) for the last `count` weeks. */
export function weeklySeries(sessions, today = todayISO(), count = 12) {
  // Day number 0 (1 Jan 1970) was a Thursday, so Monday-based index is (n + 3) % 7.
  const thisMonday = dayNum(today) - ((dayNum(today) + 3) % 7);
  const firstMonday = thisMonday - (count - 1) * 7;
  const { byDate } = pagesByDate(sessions, isoFromDayNum(firstMonday), today);
  const weeks = [];
  for (let i = 0; i < count; i++) {
    const start = firstMonday + i * 7;
    let pages = 0;
    for (let d = start; d < start + 7; d++) pages += byDate.get(isoFromDayNum(d)) || 0;
    weeks.push({ date: isoFromDayNum(start), pages: Math.round(pages) });
  }
  return weeks;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** Turn a date string into a Date at local midday (safe for display). */
function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

/**
 * '2026-11-19' -> 'Thu 19 Nov' (adds the year if it isn't this year,
 * or always when opts.year is true).
 */
export function formatDate(iso, opts = {}) {
  if (!iso) return '';
  const date = toDate(iso);
  const showYear = opts.year || iso.slice(0, 4) !== todayISO().slice(0, 4);
  return date.toLocaleDateString('en-GB', {
    weekday: opts.weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: showYear ? 'numeric' : undefined,
  });
}

/** A Day's date label: 'Thu 19 Nov', '27–31 Oct' or '30 Oct – 2 Nov'. */
export function formatRange(start, end) {
  if (start === end) return formatDate(start, { weekday: true });
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (sameMonth) {
    return `${Number(start.slice(8))}–${formatDate(end)}`;
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
}
