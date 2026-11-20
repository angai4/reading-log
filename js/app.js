/*
 * app.js - the user interface: screens, forms, buttons and backup.
 *
 * How it fits together:
 *   1. All data is loaded from IndexedDB into `state` (it's small).
 *   2. Each screen has a render function that turns `state` into HTML.
 *   3. Buttons carry a data-action="..." attribute; one click listener
 *      looks the action up in `actions` and runs it.
 *   4. After any change we save to IndexedDB, reload and re-render, so
 *      everything (progress %, Days, wheel rules, stats) is always fresh.
 */

import * as db from './db.js';
import * as calc from './calc.js';
import { Wheel, textOn } from './wheel.js';
import { chartHTML, attachChartTooltips } from './chart.js';
import { confetti, toast, prefersReducedMotion } from './effects.js';
import { sampleData } from './sample.js';

/* ------------------------------------------------------------------ */
/* Constants and state                                                 */
/* ------------------------------------------------------------------ */

/** Colours handed out to new books (also used for their wheel slices). */
const BOOK_COLOURS = ['#FF6B6B', '#FFC93C', '#1FB5A8', '#8E6CEF', '#4D9DE0', '#F78FB3', '#FF9F43', '#6BCB77', '#C77DFF', '#FFD166', '#4ECDC4', '#FF8FA3'];
/** Rule slots alternate between these two deep purples. */
const RULE_COLOURS = ['#3B3664', '#5A4FA0'];

const SCREEN_TITLES = { log: 'Reading log', wheel: 'The wheel', books: 'My books', stats: 'Stats' };

const state = {
  books: [],
  sessions: [],
  notes: [],
  rules: [...calc.RULE_IDS], // which rule slots are on the wheel
  lastBackup: null,
  progress: new Map(),
  tab: 'log',
  bookFilter: 'wheel',
  chartMode: 'days',
};

let wheel = null; // the Wheel instance
let wheelSlots = []; // what's currently drawn on it

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Escape user-entered text before putting it into HTML. */
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const plural = (n, word, many = `${word}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? word : many}`;
const bookById = (id) => state.books.find((b) => b.id === Number(id));
const progressOf = (book) => state.progress.get(book.id) || { currentPage: 0, pct: 0, pagesRead: 0, sessionCount: 0 };
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);

/** The least-used colour, so neighbouring books tend to differ. */
function nextColour() {
  const counts = BOOK_COLOURS.map((c) => state.books.filter((b) => b.colour === c).length);
  return BOOK_COLOURS[counts.indexOf(Math.min(...counts))];
}

/* ------------------------------------------------------------------ */
/* Loading data                                                        */
/* ------------------------------------------------------------------ */

async function load() {
  const data = await db.exportAll();
  state.books = data.books;
  state.sessions = data.sessions;
  state.notes = data.notes;
  const rules = data.settings.find((s) => s.key === 'rules');
  state.rules = rules && Array.isArray(rules.value) ? rules.value.filter((id) => calc.RULE_IDS.includes(id)) : [...calc.RULE_IDS];
  state.lastBackup = data.settings.find((s) => s.key === 'lastBackup')?.value || null;
  state.progress = calc.progressMap(state.books, state.sessions);
}

/** Reload everything from the database and redraw the current screen. */
async function refresh() {
  await load();
  render();
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function showTab(tab) {
  if (!SCREEN_TITLES[tab]) tab = 'log';
  state.tab = tab;
  $$('.screen').forEach((s) => (s.hidden = s.id !== `screen-${tab}`));
  $$('.tab').forEach((t) => t.setAttribute('aria-current', t.dataset.tab === tab ? 'page' : 'false'));
  $('#screen-title').textContent = SCREEN_TITLES[tab];
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  render();
  window.scrollTo(0, 0);
}

function render() {
  ({ log: renderLog, wheel: renderWheel, books: renderBooks, stats: renderStats })[state.tab]();
}

/* ------------------------------------------------------------------ */
/* Screen: Reading log                                                 */
/* ------------------------------------------------------------------ */

function renderLog() {
  const el = $('#log-content');
  const today = calc.todayISO();

  if (!state.books.length) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty-emoji">📚</div>
        <h2>Welcome to your reading log!</h2>
        <p>Start by adding the books you're reading. They'll go on your wheel.</p>
        <button class="btn btn-primary btn-wide" data-action="book-new">＋ Add a book</button>
        <button class="btn btn-soft btn-wide" data-action="load-sample">✨ Try with sample data</button>
      </div>`;
    return;
  }

  const days = calc.buildDays(state.sessions, state.notes, state.books);
  const numbered = days.filter((d) => d.number);
  const todayDay = numbered.find((d) => !d.multi && d.start === today);
  const dayNumber = todayDay ? todayDay.number : numbered.length + 1;
  const { current } = calc.streaks(state.sessions, today);
  const todayPages = todayDay ? todayDay.total : 0;

  let html = `
    <div class="today-strip">
      <span class="pill pill-sun">📅 Today is Day ${dayNumber}</span>
      <span class="pill pill-coral">🔥 ${plural(current, 'day')} streak</span>
      <span class="pill pill-teal">📖 ${plural(todayPages, 'page')} today</span>
    </div>
    <div class="log-actions">
      <button class="btn btn-primary btn-big" data-action="log-new">＋ Log reading</button>
      <button class="btn btn-soft" data-action="note-new">📝 Note</button>
    </div>`;

  if (!days.length) {
    html += `<div class="empty"><div class="empty-emoji">✏️</div><p>No reading logged yet. Tap <strong>Log reading</strong> to add your first session.</p></div>`;
  }

  html += days.map(dayCard).join('');
  el.innerHTML = html;
}

/** One Day in the diary. */
function dayCard(day) {
  const heading = day.number
    ? `<span class="day-num">Day ${day.number}</span>`
    : `<span class="day-num day-num-note">Note</span>`;
  const sessions = day.sessions
    .map((s) => {
      const book = bookById(s.bookId);
      const title = book ? book.title : 'Deleted book';
      const colour = book ? book.colour : '#999';
      const chapters = Number(s.chapters) ? `${plural(Number(s.chapters), 'chapter')}, ` : '';
      return `
        <li>
          <button class="session-row" data-action="session-edit" data-id="${s.id}">
            <span class="dot" style="--c:${colour}"></span>
            <span class="session-text">
              <strong>${esc(title)}</strong>
              <small>${chapters}pages ${s.startPage}-${s.endPage}</small>
            </span>
            <span class="session-pages">${calc.pagesInSession(s)}</span>
          </button>
        </li>`;
    })
    .join('');
  const notes = day.notes
    .map((n) => `<button class="day-note" data-action="note-edit" data-date="${n.date}">📝 ${day.multi ? `<em>${esc(calc.formatDate(n.date))}:</em> ` : ''}${esc(n.text)}</button>`)
    .join('');
  const total = day.number ? `<span class="day-total">${plural(day.total, 'page')}</span>` : '';

  return `
    <article class="card day-card">
      <header class="day-head">
        ${heading}
        <span class="day-date">${esc(calc.formatRange(day.start, day.end))}</span>
        ${total}
      </header>
      ${sessions ? `<ul class="session-list">${sessions}</ul>` : ''}
      ${notes}
    </article>`;
}

/* ------------------------------------------------------------------ */
/* Screen: Books                                                       */
/* ------------------------------------------------------------------ */

function renderBooks() {
  const el = $('#books-content');
  const filters = ['wheel', 'want', 'finished', 'abandoned', 'all'];
  const count = (f) => (f === 'all' ? state.books.length : state.books.filter((b) => b.status === f).length);
  const label = (f) => (f === 'all' ? 'All' : calc.STATUS_LABELS[f]);

  let list = state.bookFilter === 'all' ? [...state.books] : state.books.filter((b) => b.status === state.bookFilter);
  const byTitle = (a, b) => a.title.localeCompare(b.title, 'en-GB', { sensitivity: 'base' });
  if (state.bookFilter === 'wheel') list.sort((a, b) => calc.addedDate(a).localeCompare(calc.addedDate(b)) || byTitle(a, b));
  else if (state.bookFilter === 'finished') list.sort((a, b) => (b.dateFinished || '').localeCompare(a.dateFinished || '') || byTitle(a, b));
  else list.sort(byTitle);

  el.innerHTML = `
    <button class="btn btn-primary btn-wide" data-action="book-new">＋ Add a book</button>
    <div class="filter-row" role="tablist" aria-label="Filter books">
      ${filters
        .map(
          (f) => `<button class="chip ${state.bookFilter === f ? 'chip-on' : ''}" role="tab" aria-selected="${state.bookFilter === f}" data-action="filter" data-filter="${f}">${label(f)} <span class="chip-count">${count(f)}</span></button>`
        )
        .join('')}
    </div>
    ${list.length ? list.map(bookCard).join('') : `<div class="empty"><div class="empty-emoji">📭</div><p>No books here yet.</p></div>`}`;
}

function bookCard(book) {
  const p = progressOf(book);
  const pct = calc.pctLabel(p.pct);
  const meta = [book.author, book.genre].filter(Boolean).map(esc).join(' · ');
  const extra = [];
  if (state.bookFilter === 'all') extra.push(calc.STATUS_LABELS[book.status]);
  if (book.status === 'wheel') extra.push(`on the wheel since ${calc.formatDate(calc.addedDate(book))}`);
  if (book.status === 'finished' && book.dateFinished) extra.push(`finished ${calc.formatDate(book.dateFinished)}`);
  return `
    <button class="card book-card" data-action="book-edit" data-id="${book.id}" style="--c:${book.colour}">
      <span class="book-spine"></span>
      <span class="book-main">
        <span class="book-title">${esc(book.title)}</span>
        ${meta ? `<span class="book-meta">${meta}</span>` : ''}
        <span class="progress" aria-hidden="true"><span style="width:${Math.floor(p.pct * 100)}%"></span></span>
        <span class="book-meta">Page ${p.currentPage} of ${book.totalPages}${extra.length ? ' · ' + esc(extra.join(' · ')) : ''}</span>
        ${book.rating ? `<span class="book-stars" aria-label="${book.rating} out of 5">${stars(book.rating)}</span>` : ''}
      </span>
      <span class="book-pct">${pct}</span>
    </button>`;
}

/* ------------------------------------------------------------------ */
/* Screen: Wheel                                                       */
/* ------------------------------------------------------------------ */

/** Build the list of slots: books and enabled rules, spread out evenly. */
function buildSlots() {
  const books = calc.wheelBooks(state.books).map((book) => ({
    type: 'book',
    book,
    label: book.title,
    colour: book.colour,
    textColour: textOn(book.colour),
  }));
  const rules = calc.RULES.filter((r) => state.rules.includes(r.id)).map((rule, i) => ({
    type: 'rule',
    rule,
    label: `${rule.emoji} ${rule.name}`,
    colour: RULE_COLOURS[i % 2],
    textColour: '#FFFFFF',
  }));
  // Interleave so rule slots don't all bunch up together.
  const slots = [];
  const longer = Math.max(books.length, rules.length);
  for (let i = 0; i < longer; i++) {
    if (books[i]) slots.push(books[i]);
    if (rules[i]) slots.push(rules[i]);
  }
  return slots;
}

function renderWheel() {
  wheelSlots = buildSlots();
  wheel.setSlots(wheelSlots);
  const onWheel = calc.wheelBooks(state.books);
  $('#spin-btn').disabled = !wheelSlots.length;
  $('#wheel-empty').hidden = wheelSlots.length > 0;
  $('.wheel-wrap').classList.toggle('is-empty', !wheelSlots.length);

  const results = calc.evaluateRules(state.books, state.sessions, state.progress);
  const enabledRules = calc.RULES.filter((r) => state.rules.includes(r.id));

  // 1. Where each rule currently points.
  const ruleRows = enabledRules
    .map((rule) => {
      const result = results.get(rule.id);
      let body;
      if (rule.id === 'pick') body = onWheel.length ? `Free choice from ${plural(onWheel.length, 'book')}` : esc(result.empty);
      else if (!result.picks.length) body = `<span class="muted">${esc(result.empty)}</span>`;
      else
        body = result.picks
          .map((p) => `<span class="rule-pick"><span class="dot" style="--c:${p.book.colour}"></span><strong>${esc(p.book.title)}</strong> <small>${esc(p.detail)}</small></span>`)
          .join('');
      const tie = rule.id !== 'pick' && result.picks.length > 1 ? '<span class="tie-badge">tie</span>' : '';
      return `<li class="rule-row"><span class="rule-name">${rule.emoji} ${rule.name} ${tie}</span><span class="rule-result">${body}</span></li>`;
    })
    .join('');

  // 2. Books on the wheel, with a remove button each.
  const bookRows = onWheel
    .map((b) => {
      const p = progressOf(b);
      return `
        <li class="wheel-book">
          <span class="dot" style="--c:${b.colour}"></span>
          <span class="wheel-book-text"><strong>${esc(b.title)}</strong><small>${calc.pctLabel(p.pct)} · added ${calc.formatDate(calc.addedDate(b))}</small></span>
          <button class="btn-icon" data-action="wheel-remove" data-id="${b.id}" aria-label="Take ${esc(b.title)} off the wheel">✕</button>
        </li>`;
    })
    .join('');

  // 3. Rule slot switches.
  const ruleSwitches = calc.RULES.map(
    (r) => `
      <label class="switch-row">
        <span><strong>${r.emoji} ${r.name}</strong><small>${r.explain}</small></span>
        <input type="checkbox" class="switch" data-rule="${r.id}" ${state.rules.includes(r.id) ? 'checked' : ''}>
      </label>`
  ).join('');

  $('#wheel-info').innerHTML = `
    <section class="card">
      <h2>Where the rules point</h2>
      ${enabledRules.length ? `<ul class="rule-list">${ruleRows}</ul>` : '<p class="muted">No rule slots on the wheel.</p>'}
    </section>
    <section class="card">
      <h2>Books on the wheel <span class="muted">(${onWheel.length})</span></h2>
      ${onWheel.length ? `<ul class="wheel-book-list">${bookRows}</ul>` : '<p class="muted">The wheel is empty.</p>'}
      <button class="btn btn-soft btn-wide" data-action="wheel-add">＋ Put a book on the wheel</button>
    </section>
    <section class="card">
      <h2>Rule slots</h2>
      ${ruleSwitches}
    </section>`;
}

/** Spin, then show what the wheel landed on. */
async function spinWheel() {
  if (wheel.spinning || !wheelSlots.length) return;
  const button = $('#spin-btn');
  button.disabled = true;
  button.classList.add('spinning');
  const index = await wheel.spin(prefersReducedMotion());
  button.disabled = false;
  button.classList.remove('spinning');
  if (index >= 0) showSpinResult(wheelSlots[index]);
}

function showSpinResult(slot) {
  if (navigator.vibrate) navigator.vibrate(30);
  const again = `<button class="btn btn-soft" data-action="spin-again">🔄 Spin again</button>`;
  const close = `<button class="btn btn-ghost" data-action="close-sheet">Close</button>`;

  if (slot.type === 'book') {
    const p = progressOf(slot.book);
    openSheet(`
      <div class="result">
        <p class="result-kicker">The wheel says…</p>
        <div class="result-book" style="--c:${slot.book.colour}">
          <span class="result-title">${esc(slot.book.title)}</span>
          <small>${esc(slot.book.author || '')}${slot.book.author ? ' · ' : ''}${calc.pctLabel(p.pct)} read</small>
        </div>
        <button class="btn btn-primary btn-wide" data-action="log-new" data-book="${slot.book.id}">📖 Log a session</button>
        <div class="row-buttons">${again}${close}</div>
      </div>`);
    return;
  }

  // A rule slot: work out the book(s) it points to right now.
  const rule = slot.rule;
  const result = calc.evaluateRules(state.books, state.sessions, state.progress).get(rule.id);
  let body;
  if (rule.id === 'pick') {
    body = `<p>Your choice! Tap the book you fancy.</p>${optionList(result.picks)}`;
  } else if (!result.picks.length) {
    body = `<p class="muted">${esc(result.empty)}.</p>`;
  } else if (result.picks.length === 1) {
    const pick = result.picks[0];
    body = `
      <div class="result-book" style="--c:${pick.book.colour}">
        <span class="result-title">${esc(pick.book.title)}</span>
        <small>${esc(pick.detail)}</small>
      </div>
      <button class="btn btn-primary btn-wide" data-action="log-new" data-book="${pick.book.id}">📖 Log a session</button>`;
  } else {
    body = `
      <p><strong>It's a tie!</strong> Pick one, or let a tie-breaker decide.</p>
      ${optionList(result.picks)}
      <button class="btn btn-primary btn-wide" data-action="tiebreak">🎲 Tie-breaker spin</button>`;
  }
  openSheet(`
    <div class="result">
      <p class="result-kicker">You landed on</p>
      <h2 class="result-rule">${rule.emoji} ${rule.name}</h2>
      ${body}
      <div class="row-buttons">${again}${close}</div>
    </div>`);
}

/** A list of tappable books (for ties and "I Pick"). */
function optionList(picks) {
  return `<div class="option-list">${picks
    .map(
      (p) => `
      <button class="option" data-action="log-new" data-book="${p.book.id}" style="--c:${p.book.colour};--t:${textOn(p.book.colour)}">
        <span class="dot"></span><span><strong>${esc(p.book.title)}</strong><small>${esc(p.detail)}</small></span><span class="option-go">Log ›</span>
      </button>`
    )
    .join('')}</div>`;
}

/** Flash through the tied books and stop on a random one. */
function tieBreak(button) {
  const options = $$('#sheet .option');
  if (options.length < 2) return;
  button.disabled = true;
  const winner = Math.floor(Math.random() * options.length);
  const steps = options.length * 4 + winner; // whole laps, then land on the winner
  const reduce = prefersReducedMotion();
  let i = 0;
  const step = () => {
    options.forEach((o) => o.classList.remove('lit'));
    options[i % options.length].classList.add('lit');
    if (i < steps && !reduce) {
      i++;
      setTimeout(step, 60 + (i / steps) ** 2 * 260); // slows down towards the end
    } else {
      options.forEach((o) => o.classList.remove('lit'));
      options[winner].classList.add('winner');
      button.textContent = '🎉 Tie-breaker picked this one!';
      if (navigator.vibrate) navigator.vibrate(30);
    }
  };
  step();
}

/* ------------------------------------------------------------------ */
/* Screen: Stats                                                       */
/* ------------------------------------------------------------------ */

function renderStats() {
  const s = calc.summaryStats(state.books, state.sessions);
  const series = state.chartMode === 'weeks' ? calc.weeklySeries(state.sessions) : calc.dailySeries(state.sessions);
  const fmt = (n) => Math.round(n).toLocaleString('en-GB');
  const tile = (emoji, value, label, sub = '') =>
    `<div class="tile"><span class="tile-emoji">${emoji}</span><span class="tile-value">${value}</span><span class="tile-label">${label}</span>${sub ? `<span class="tile-sub">${sub}</span>` : ''}</div>`;

  $('#stats-content').innerHTML = `
    <div class="tiles">
      ${tile('📖', fmt(s.totalPages), 'pages read', s.firstDate ? `since ${calc.formatDate(s.firstDate)}` : '')}
      ${tile('🔥', s.currentStreak, 'day streak', `best: ${plural(s.bestStreak, 'day')}`)}
      ${tile('⚡', fmt(s.perReadingDay), 'pages per reading day', `${plural(s.readingDays, 'day')} with reading`)}
      ${tile('📆', fmt(s.perCalendarDay), 'pages per day', 'counting every day since you started')}
      ${tile('🏆', s.booksFinished, s.booksFinished === 1 ? 'book finished' : 'books finished', `${s.finishedThisYear} this year`)}
      ${tile('🎡', calc.wheelBooks(state.books).length, 'books on the wheel')}
    </div>

    <section class="card">
      <div class="card-head">
        <h2>Pages ${state.chartMode === 'weeks' ? 'per week' : 'per day'}</h2>
        <div class="segmented" role="group" aria-label="Chart range">
          <button data-action="chart-mode" data-mode="days" aria-pressed="${state.chartMode === 'days'}">30 days</button>
          <button data-action="chart-mode" data-mode="weeks" aria-pressed="${state.chartMode === 'weeks'}">12 weeks</button>
        </div>
      </div>
      ${chartHTML(series, state.chartMode)}
    </section>

    <section class="card">
      <h2>Backup</h2>
      <p class="muted">Your data lives only in this browser on this device. Export a backup now and then, and keep it somewhere safe.
      ${state.lastBackup ? `Last JSON backup: <strong>${calc.formatDate(state.lastBackup, { year: true })}</strong>.` : '<strong>No backup yet.</strong>'}</p>
      <button class="btn btn-primary btn-wide" data-action="export-json">⬇️ Export everything (JSON)</button>
      <div class="row-buttons three">
        <button class="btn btn-soft" data-action="export-csv" data-kind="books">Books CSV</button>
        <button class="btn btn-soft" data-action="export-csv" data-kind="sessions">Sessions CSV</button>
        <button class="btn btn-soft" data-action="export-csv" data-kind="notes">Notes CSV</button>
      </div>
      <button class="btn btn-soft btn-wide" data-action="import-json">⬆️ Restore from a JSON backup</button>
      <button class="btn btn-danger-ghost btn-wide" data-action="erase-all">Erase all data</button>
    </section>`;

  attachChartTooltips($('#stats-content'));
}

/* ------------------------------------------------------------------ */
/* Bottom sheet (one <dialog> reused for every form and pop-up)        */
/* ------------------------------------------------------------------ */

function openSheet(html) {
  const sheet = $('#sheet');
  $('#sheet-body').innerHTML = html;
  if (!sheet.open) sheet.showModal();
  sheet.scrollTop = 0;
}

function closeSheet() {
  const sheet = $('#sheet');
  if (sheet.open) sheet.close();
}

/** Reusable star-rating input. Tapping the current rating clears it. */
function starsInput(name, value, bookId = '') {
  return `
    <div class="stars" data-stars ${bookId ? `data-book-id="${bookId}"` : ''}>
      <input type="hidden" name="${name}" value="${value}">
      ${[1, 2, 3, 4, 5]
        .map((n) => `<button type="button" class="star ${n <= value ? 'on' : ''}" data-star="${n}" aria-label="${n} out of 5">★</button>`)
        .join('')}
    </div>`;
}

async function onStarTap(button) {
  const group = button.closest('[data-stars]');
  const input = $('input', group);
  const tapped = Number(button.dataset.star);
  const value = Number(input.value) === tapped ? 0 : tapped;
  input.value = value;
  $$('.star', group).forEach((s) => s.classList.toggle('on', Number(s.dataset.star) <= value));
  // On the celebration screen the rating saves straight away.
  if (group.dataset.bookId) {
    const book = bookById(group.dataset.bookId);
    if (book) {
      await db.put('books', { ...book, rating: value });
      await load();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Form: log a reading session                                         */
/* ------------------------------------------------------------------ */

function openLogForm({ session = null, bookId = null } = {}) {
  const editing = Boolean(session);
  const today = calc.todayISO();
  const s = session || { startDate: today, endDate: today, chapters: 1, bookId: bookId ? Number(bookId) : null };
  const multi = calc.sessionEnd(s) !== s.startDate;

  // Books you can log: those on the wheel first, then want-to-read.
  const choices = [
    ...calc.wheelBooks(state.books),
    ...state.books.filter((b) => b.status === 'want').sort((a, b) => a.title.localeCompare(b.title)),
  ];
  const current = s.bookId && bookById(s.bookId);
  if (current && !choices.includes(current)) choices.unshift(current);

  if (!choices.length) {
    openSheet(`
      <div class="result">
        <h2>No books to log yet</h2>
        <p>Add a book first, then you can log your reading.</p>
        <button class="btn btn-primary btn-wide" data-action="book-new">＋ Add a book</button>
        <button class="btn btn-ghost btn-wide" data-action="close-sheet">Cancel</button>
      </div>`);
    return;
  }

  const chips = choices
    .map((b) => {
      const p = progressOf(b);
      return `
        <label class="book-chip" style="--c:${b.colour};--t:${textOn(b.colour)}">
          <input type="radio" name="bookId" value="${b.id}" ${s.bookId === b.id ? 'checked' : ''} required>
          <span>${esc(b.title)} <small>${calc.pctLabel(p.pct)}</small></span>
        </label>`;
    })
    .join('');

  openSheet(`
    <form id="log-form" class="form" novalidate>
      <h2>${editing ? 'Edit session' : 'Log reading'}</h2>

      <fieldset>
        <legend>Book</legend>
        <div class="book-chips">${chips}</div>
      </fieldset>

      <div class="field">
        <span class="label">When</span>
        <div class="date-row">
          <input type="date" name="startDate" value="${s.startDate}" required aria-label="${multi ? 'From' : 'Date'}">
          <span class="date-to" ${multi ? '' : 'hidden'}>to</span>
          <input type="date" name="endDate" value="${calc.sessionEnd(s)}" ${multi ? '' : 'hidden'} aria-label="To">
        </div>
        <div class="quick-dates">
          <button type="button" class="chip" data-quick-date="0">Today</button>
          <button type="button" class="chip" data-quick-date="-1">Yesterday</button>
          <label class="chip chip-check"><input type="checkbox" name="multi" ${multi ? 'checked' : ''}> Several days</label>
        </div>
      </div>

      <div class="two-col">
        <label class="field"><span class="label">Start page</span>
          <input type="number" name="startPage" inputmode="numeric" pattern="[0-9]*" min="1" value="${s.startPage ?? ''}" required></label>
        <label class="field"><span class="label">End page</span>
          <input type="number" name="endPage" inputmode="numeric" pattern="[0-9]*" min="1" value="${s.endPage ?? ''}" required></label>
      </div>

      <div class="field stepper-field">
        <span class="label">Chapters</span>
        <div class="stepper">
          <button type="button" data-step="-1" aria-label="One fewer chapter">−</button>
          <input type="number" name="chapters" inputmode="numeric" min="0" value="${s.chapters ?? 1}" aria-label="Chapters">
          <button type="button" data-step="1" aria-label="One more chapter">+</button>
        </div>
      </div>

      <p class="preview" id="log-preview" aria-live="polite"></p>

      <div class="form-actions">
        ${editing ? `<button type="button" class="btn btn-danger-ghost" data-action="session-delete" data-id="${s.id}">Delete</button>` : ''}
        <button type="button" class="btn btn-ghost" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);

  const form = $('#log-form');
  const f = form.elements;
  let startTouched = editing; // don't overwrite a start page the user typed

  /** Fill in the start page from where the chosen book was left off. */
  const prefillStart = () => {
    if (startTouched) return;
    const book = bookById(form.querySelector('input[name=bookId]:checked')?.value);
    if (!book) return;
    const p = progressOf(book);
    f.startPage.value = p.currentPage < book.totalPages ? p.currentPage + 1 : '';
    f.endPage.focus({ preventScroll: true });
  };

  /** Live preview: pages read and where it takes the book. */
  const updatePreview = () => {
    const preview = $('#log-preview');
    const book = bookById(form.querySelector('input[name=bookId]:checked')?.value);
    const start = Number(f.startPage.value);
    const end = Number(f.endPage.value);
    preview.className = 'preview';
    if (!book) return (preview.textContent = 'Pick a book above.');
    if (!f.startPage.value || !f.endPage.value) {
      const p = progressOf(book);
      return (preview.textContent = p.currentPage ? `Last read up to page ${p.currentPage} of ${book.totalPages}.` : `${book.totalPages} pages in total.`);
    }
    const problem = validateSession(book, start, end);
    if (problem) {
      preview.classList.add('preview-error');
      return (preview.textContent = problem);
    }
    const pages = end - start + 1;
    if (end >= book.totalPages) {
      preview.classList.add('preview-finish');
      preview.textContent = `${plural(pages, 'page')} · 🎉 that finishes the book!`;
    } else {
      preview.textContent = `${plural(pages, 'page')} · takes you to ${calc.pctLabel(end / book.totalPages)}`;
    }
  };

  form.addEventListener('change', (e) => {
    if (e.target.name === 'bookId') prefillStart();
    if (e.target.name === 'multi') {
      const on = e.target.checked;
      f.endDate.hidden = !on;
      $('.date-to', form).hidden = !on;
      f.startDate.setAttribute('aria-label', on ? 'From' : 'Date');
      // Sensible default range: yesterday to today.
      if (on && f.startDate.value === f.endDate.value) {
        f.endDate.value = f.startDate.value;
        f.startDate.value = calc.addDays(f.startDate.value, -1);
      }
      if (!on) f.endDate.value = f.startDate.value;
    }
    if (e.target.name === 'startDate' && !f.multi.checked) f.endDate.value = f.startDate.value;
    updatePreview();
  });
  form.addEventListener('input', (e) => {
    if (e.target.name === 'startPage') startTouched = true;
    updatePreview();
  });
  form.addEventListener('click', (e) => {
    const stepBtn = e.target.closest('[data-step]');
    if (stepBtn) f.chapters.value = Math.max(0, (Number(f.chapters.value) || 0) + Number(stepBtn.dataset.step));
    const quick = e.target.closest('[data-quick-date]');
    if (quick) {
      f.multi.checked = false;
      f.endDate.hidden = true;
      $('.date-to', form).hidden = true;
      f.startDate.value = f.endDate.value = calc.addDays(today, Number(quick.dataset.quickDate));
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSession(form, s);
  });

  if (!editing) prefillStart();
  updatePreview();
}

/** Returns an error message, or '' if the page range is fine. */
function validateSession(book, start, end) {
  if (!Number.isInteger(start) || start < 1) return 'Start page must be 1 or more.';
  if (!Number.isInteger(end) || end < 1) return 'End page must be 1 or more.';
  if (end < start) return 'End page must be the same as or after the start page.';
  if (end > book.totalPages) return `This book only has ${book.totalPages} pages.`;
  return '';
}

async function saveSession(form, original) {
  const f = form.elements;
  const book = bookById(form.querySelector('input[name=bookId]:checked')?.value);
  const preview = $('#log-preview');
  const fail = (msg) => {
    preview.className = 'preview preview-error';
    preview.textContent = msg;
  };
  if (!book) return fail('Pick a book first.');

  const startPage = Number(f.startPage.value);
  const endPage = Number(f.endPage.value);
  const problem = validateSession(book, startPage, endPage);
  if (problem) return fail(problem);

  const startDate = f.startDate.value;
  const endDate = f.multi.checked ? f.endDate.value : startDate;
  if (!startDate || !endDate) return fail('Please choose a date.');
  if (endDate < startDate) return fail('The end date must be on or after the start date.');

  const session = {
    id: original.id,
    bookId: book.id,
    startDate,
    endDate,
    chapters: Math.max(0, Number(f.chapters.value) || 0),
    startPage,
    endPage,
  };
  await db.put('sessions', session);
  db.requestPersistence();

  // Reached the last page? Mark it finished and take it off the wheel.
  let finished = false;
  if (endPage >= book.totalPages && book.status !== 'finished') {
    await db.put('books', { ...book, status: 'finished', dateFinished: endDate });
    finished = true;
  }

  closeSheet();
  await refresh();
  if (finished) celebrate(book.id);
  else toast(`Logged ${plural(endPage - startPage + 1, 'page')} of ${book.title}`);
}

/** Confetti and a "well done" card when a book is finished. */
function celebrate(bookId) {
  const book = bookById(bookId);
  if (!book) return;
  const sessions = state.sessions.filter((s) => s.bookId === book.id);
  const first = sessions.map((s) => s.startDate).sort()[0];
  const days = first ? calc.daysBetween(first, book.dateFinished) + 1 : 0;
  openSheet(`
    <div class="result celebrate">
      <div class="celebrate-emoji">🎉</div>
      <h2>You finished<br><span class="result-title">${esc(book.title)}</span>!</h2>
      <p>${plural(Number(book.totalPages), 'page')}${days ? ` in ${plural(days, 'day')}` : ''}. It's off the wheel and on your finished shelf.</p>
      <p class="label">How would you rate it?</p>
      ${starsInput('rating', book.rating || 0, book.id)}
      <button class="btn btn-primary btn-wide" data-action="close-sheet">Brilliant!</button>
    </div>`);
  confetti(); // after the sheet, so the confetti appears on top of it
}

/* ------------------------------------------------------------------ */
/* Form: day note                                                      */
/* ------------------------------------------------------------------ */

function openNoteForm(date = null) {
  const existing = date ? state.notes.find((n) => n.date === date) : null;
  const noteDate = date || calc.todayISO();
  openSheet(`
    <form id="note-form" class="form" novalidate>
      <h2>${existing ? 'Edit note' : 'Note for a day'}</h2>
      <label class="field"><span class="label">Date</span>
        <input type="date" name="date" value="${noteDate}" required></label>
      <label class="field"><span class="label">Note</span>
        <textarea name="text" rows="3" placeholder="e.g. Reading at work, spun for My Not So Perfect Life">${esc(existing?.text || '')}</textarea></label>
      <div class="form-actions">
        ${existing ? `<button type="button" class="btn btn-danger-ghost" data-action="note-delete" data-date="${existing.date}">Delete</button>` : ''}
        <button type="button" class="btn btn-ghost" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>`);

  const form = $('#note-form');
  // If there's already a note on the chosen date, load it for editing.
  form.elements.date.addEventListener('change', () => {
    const other = state.notes.find((n) => n.date === form.elements.date.value);
    if (other && !existing) form.elements.text.value = other.text;
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newDate = form.elements.date.value;
    const text = form.elements.text.value.trim();
    if (!newDate) return;
    if (existing && existing.date !== newDate) await db.remove('notes', existing.date);
    if (text) await db.put('notes', { date: newDate, text });
    else await db.remove('notes', newDate);
    closeSheet();
    await refresh();
    toast(text ? 'Note saved' : 'Note removed');
  });
  form.elements.text.focus();
}

/* ------------------------------------------------------------------ */
/* Form: add / edit a book                                             */
/* ------------------------------------------------------------------ */

function openBookForm(book = null) {
  const editing = Boolean(book);
  const today = calc.todayISO();
  const b = book || { title: '', author: '', totalPages: '', genre: '', status: 'wheel', dateAdded: today, dateFinished: '', rating: 0, notes: '' };
  const genres = [...new Set(state.books.map((x) => x.genre).filter(Boolean))].sort();
  const p = editing ? progressOf(b) : null;

  const historyHTML = editing
    ? state.sessions
        .filter((s) => s.bookId === b.id)
        .sort((x, y) => y.startDate.localeCompare(x.startDate))
        .map((s) => `<li>${esc(calc.formatRange(s.startDate, calc.sessionEnd(s)))}: pages ${s.startPage}-${s.endPage} <span class="muted">(${calc.pagesInSession(s)})</span></li>`)
        .join('')
    : '';

  openSheet(`
    <form id="book-form" class="form" novalidate>
      <h2>${editing ? 'Edit book' : 'Add a book'}</h2>
      ${editing ? `<p class="muted">Page ${p.currentPage} of ${b.totalPages} · ${calc.pctLabel(p.pct)} · ${plural(p.sessionCount, 'session')}</p>` : ''}

      <label class="field"><span class="label">Title *</span>
        <input type="text" name="title" value="${esc(b.title)}" required autocomplete="off"></label>
      <label class="field"><span class="label">Author</span>
        <input type="text" name="author" value="${esc(b.author)}" autocomplete="off"></label>
      <div class="two-col">
        <label class="field"><span class="label">Total pages *</span>
          <input type="number" name="totalPages" inputmode="numeric" pattern="[0-9]*" min="1" value="${b.totalPages}" required></label>
        <label class="field"><span class="label">Genre</span>
          <input type="text" name="genre" value="${esc(b.genre)}" list="genre-list" autocomplete="off"></label>
      </div>
      <datalist id="genre-list">${genres.map((g) => `<option value="${esc(g)}">`).join('')}</datalist>

      <label class="field"><span class="label">Status</span>
        <select name="status">
          ${Object.entries(calc.STATUS_LABELS)
            .map(([value, label]) => `<option value="${value}" ${b.status === value ? 'selected' : ''}>${label}</option>`)
            .join('')}
        </select></label>
      <div class="two-col">
        <label class="field"><span class="label">Added to wheel</span>
          <input type="date" name="dateAdded" value="${b.dateAdded || ''}"></label>
        <label class="field"><span class="label">Date finished</span>
          <input type="date" name="dateFinished" value="${b.dateFinished || ''}"></label>
      </div>

      <div class="field"><span class="label">Rating</span>${starsInput('rating', Number(b.rating) || 0)}</div>
      <label class="field"><span class="label">Notes</span>
        <textarea name="notes" rows="3">${esc(b.notes)}</textarea></label>

      <p class="preview preview-error" id="book-error" hidden></p>

      <div class="form-actions">
        ${editing ? `<button type="button" class="btn btn-danger-ghost" data-action="book-delete" data-id="${b.id}">Delete</button>` : ''}
        <button type="button" class="btn btn-ghost" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>

      ${historyHTML ? `<details class="history"><summary>Reading history</summary><ul>${historyHTML}</ul></details>` : ''}
    </form>`);

  const form = $('#book-form');
  const f = form.elements;

  // Changing the status fills in the matching date for you (you can edit it).
  f.status.addEventListener('change', () => {
    if (f.status.value === 'wheel' && b.status !== 'wheel') f.dateAdded.value = today;
    if (f.status.value === 'finished' && !f.dateFinished.value) f.dateFinished.value = today;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const error = $('#book-error');
    const title = f.title.value.trim();
    const totalPages = Number(f.totalPages.value);
    if (!title) {
      error.hidden = false;
      error.textContent = 'Please give the book a title.';
      return f.title.focus();
    }
    if (!Number.isInteger(totalPages) || totalPages < 1) {
      error.hidden = false;
      error.textContent = 'Total pages must be a whole number above 0.';
      return f.totalPages.focus();
    }
    const record = {
      ...b,
      title,
      author: f.author.value.trim(),
      totalPages,
      genre: f.genre.value.trim(),
      status: f.status.value,
      dateAdded: f.dateAdded.value || (f.status.value === 'wheel' ? today : ''),
      dateFinished: f.dateFinished.value,
      rating: Number(f.rating.value) || 0,
      notes: f.notes.value.trim(),
      colour: b.colour || nextColour(),
      createdAt: b.createdAt || Date.now(),
    };
    await db.put('books', record);
    db.requestPersistence();
    closeSheet();
    await refresh();
    toast(editing ? 'Book saved' : `Added ${title}`);
  });

  if (!editing) f.title.focus();
}

/* ------------------------------------------------------------------ */
/* Backup: export and import                                           */
/* ------------------------------------------------------------------ */

/** Trigger a file download in the browser. */
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function exportJSON() {
  const data = await db.exportAll();
  const today = calc.todayISO();
  const backup = { app: 'reading-log', version: 1, exportedAt: new Date().toISOString(), ...data };
  download(`reading-log-backup-${today}.json`, JSON.stringify(backup, null, 2), 'application/json');
  await db.put('settings', { key: 'lastBackup', value: today });
  await refresh();
  toast('Backup downloaded');
}

/** Make one CSV cell safe: quote it if it contains commas, quotes or new lines. */
const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'); // BOM so Excel reads emoji/accents

function exportCSV(kind) {
  const today = calc.todayISO();
  let rows;
  if (kind === 'books') {
    rows = [['id', 'title', 'author', 'total_pages', 'genre', 'status', 'date_added', 'date_finished', 'rating', 'current_page', 'percent_complete', 'notes']];
    state.books.forEach((b) => {
      const p = progressOf(b);
      rows.push([b.id, b.title, b.author, b.totalPages, b.genre, calc.STATUS_LABELS[b.status], b.dateAdded, b.dateFinished, b.rating || '', p.currentPage, Math.floor(p.pct * 100), b.notes]);
    });
  } else if (kind === 'sessions') {
    // Include the Day number for each session.
    const dayOf = new Map();
    calc.buildDays(state.sessions, state.notes, state.books).forEach((d) => d.sessions.forEach((s) => dayOf.set(s.id, d.number)));
    rows = [['day', 'start_date', 'end_date', 'book', 'author', 'chapters', 'start_page', 'end_page', 'pages_read']];
    [...state.sessions]
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id - b.id)
      .forEach((s) => {
        const b = bookById(s.bookId);
        rows.push([dayOf.get(s.id), s.startDate, calc.sessionEnd(s), b?.title || '', b?.author || '', s.chapters, s.startPage, s.endPage, calc.pagesInSession(s)]);
      });
  } else {
    rows = [['date', 'note']];
    [...state.notes].sort((a, b) => a.date.localeCompare(b.date)).forEach((n) => rows.push([n.date, n.text]));
  }
  download(`reading-log-${kind}-${today}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
  toast(`${kind[0].toUpperCase() + kind.slice(1)} CSV downloaded`);
}

/** Check and tidy an imported backup so bad data can't break the app. */
function cleanBackup(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.books) || !Array.isArray(data.sessions)) {
    throw new Error("This doesn't look like a Reading Log backup file.");
  }
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const int = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : NaN);
  const statuses = Object.keys(calc.STATUS_LABELS);

  const books = data.books
    .filter((b) => b && int(b.id) > 0 && typeof b.title === 'string' && int(b.totalPages) > 0)
    .map((b) => ({
      id: int(b.id),
      title: b.title,
      author: String(b.author || ''),
      totalPages: int(b.totalPages),
      genre: String(b.genre || ''),
      status: statuses.includes(b.status) ? b.status : 'want',
      dateAdded: isDate(b.dateAdded) ? b.dateAdded : '',
      dateFinished: isDate(b.dateFinished) ? b.dateFinished : '',
      rating: Math.min(5, Math.max(0, int(b.rating) || 0)),
      notes: String(b.notes || ''),
      colour: /^#[0-9a-f]{6}$/i.test(b.colour) ? b.colour : BOOK_COLOURS[int(b.id) % BOOK_COLOURS.length],
      createdAt: Number(b.createdAt) || Date.now(),
    }));
  const bookIds = new Set(books.map((b) => b.id));

  const sessions = data.sessions
    .filter((s) => s && int(s.id) > 0 && bookIds.has(int(s.bookId)) && isDate(s.startDate) && int(s.startPage) > 0 && int(s.endPage) >= int(s.startPage))
    .map((s) => ({
      id: int(s.id),
      bookId: int(s.bookId),
      startDate: s.startDate,
      endDate: isDate(s.endDate) && s.endDate >= s.startDate ? s.endDate : s.startDate,
      chapters: Math.max(0, int(s.chapters) || 0),
      startPage: int(s.startPage),
      endPage: int(s.endPage),
    }));

  const notes = (Array.isArray(data.notes) ? data.notes : []).filter((n) => n && isDate(n.date) && typeof n.text === 'string').map((n) => ({ date: n.date, text: n.text }));
  const settings = (Array.isArray(data.settings) ? data.settings : []).filter((s) => s && typeof s.key === 'string');
  const skipped = data.books.length - books.length + (data.sessions.length - sessions.length);
  return { books, sessions, notes, settings, skipped };
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener('change', async () => {
    input.remove();
    const file = input.files[0];
    if (!file) return;
    try {
      const cleaned = cleanBackup(JSON.parse(await file.text()));
      const ok = confirm(
        `Replace everything in the app with this backup?\n\n` +
          `Now: ${plural(state.books.length, 'book')}, ${plural(state.sessions.length, 'session')}\n` +
          `Backup: ${plural(cleaned.books.length, 'book')}, ${plural(cleaned.sessions.length, 'session')}` +
          (cleaned.skipped ? `\n(${cleaned.skipped} broken entries will be skipped)` : '')
      );
      if (!ok) return;
      await db.replaceAll(cleaned);
      await refresh();
      toast('Backup restored');
    } catch (err) {
      alert(`Couldn't import that file.\n\n${err.message}`);
    }
  });
  input.click();
}

/* ------------------------------------------------------------------ */
/* Actions: every data-action="..." button lands here                  */
/* ------------------------------------------------------------------ */

const actions = {
  tab: (el) => showTab(el.dataset.tab),
  'close-sheet': () => closeSheet(),

  'log-new': (el) => openLogForm({ bookId: el.dataset.book }),
  'session-edit': (el) => openLogForm({ session: state.sessions.find((s) => s.id === Number(el.dataset.id)) }),
  'session-delete': async (el) => {
    if (!confirm('Delete this reading session?')) return;
    await db.remove('sessions', Number(el.dataset.id));
    closeSheet();
    await refresh();
    toast('Session deleted');
  },

  'note-new': () => openNoteForm(),
  'note-edit': (el) => openNoteForm(el.dataset.date),
  'note-delete': async (el) => {
    await db.remove('notes', el.dataset.date);
    closeSheet();
    await refresh();
    toast('Note removed');
  },

  'book-new': () => openBookForm(),
  'book-edit': (el) => openBookForm(bookById(el.dataset.id)),
  'book-delete': async (el) => {
    const book = bookById(el.dataset.id);
    const sessionIds = state.sessions.filter((s) => s.bookId === book.id).map((s) => s.id);
    const extra = sessionIds.length ? ` and its ${plural(sessionIds.length, 'reading session')}` : '';
    if (!confirm(`Delete ‘${book.title}’${extra}? This can't be undone.`)) return;
    await db.removeMany('sessions', sessionIds);
    await db.remove('books', book.id);
    closeSheet();
    await refresh();
    toast('Book deleted');
  },
  filter: (el) => {
    state.bookFilter = el.dataset.filter;
    renderBooks();
  },

  spin: () => spinWheel(),
  'spin-again': () => {
    closeSheet();
    if (state.tab !== 'wheel') showTab('wheel');
    setTimeout(spinWheel, 250);
  },
  tiebreak: (el) => tieBreak(el),
  'wheel-remove': (el) => {
    const book = bookById(el.dataset.id);
    openSheet(`
      <div class="result">
        <h2>Take ‘${esc(book.title)}’ off the wheel?</h2>
        <p class="muted">Its reading history is kept either way.</p>
        <button class="btn btn-soft btn-wide" data-action="wheel-remove-to" data-id="${book.id}" data-status="want">Move to Want to read</button>
        <button class="btn btn-soft btn-wide" data-action="wheel-remove-to" data-id="${book.id}" data-status="abandoned">Mark as Abandoned</button>
        <button class="btn btn-ghost btn-wide" data-action="close-sheet">Cancel</button>
      </div>`);
  },
  'wheel-remove-to': async (el) => {
    const book = bookById(el.dataset.id);
    await db.put('books', { ...book, status: el.dataset.status });
    closeSheet();
    await refresh();
    toast(`${book.title} is off the wheel`);
  },
  'wheel-add': () => {
    const candidates = state.books
      .filter((b) => b.status === 'want' || b.status === 'abandoned')
      .sort((a, b) => a.title.localeCompare(b.title));
    openSheet(`
      <div class="result">
        <h2>Put a book on the wheel</h2>
        ${
          candidates.length
            ? `<div class="option-list">${candidates
                .map(
                  (b) => `<button class="option" data-action="wheel-add-book" data-id="${b.id}" style="--c:${b.colour}">
                    <span class="dot"></span><span><strong>${esc(b.title)}</strong><small>${calc.STATUS_LABELS[b.status]} · ${calc.pctLabel(progressOf(b).pct)}</small></span><span class="option-go">Add ›</span></button>`
                )
                .join('')}</div>`
            : '<p class="muted">No want-to-read or abandoned books. Add a new one:</p>'
        }
        <button class="btn btn-primary btn-wide" data-action="book-new">＋ Add a new book</button>
        <button class="btn btn-ghost btn-wide" data-action="close-sheet">Cancel</button>
      </div>`);
  },
  'wheel-add-book': async (el) => {
    const book = bookById(el.dataset.id);
    // Going (back) on the wheel resets the "date added" to today.
    await db.put('books', { ...book, status: 'wheel', dateAdded: calc.todayISO() });
    closeSheet();
    await refresh();
    toast(`${book.title} is on the wheel`);
  },

  'chart-mode': (el) => {
    state.chartMode = el.dataset.mode;
    renderStats();
  },
  'export-json': () => exportJSON(),
  'export-csv': (el) => exportCSV(el.dataset.kind),
  'import-json': () => importJSON(),
  'erase-all': async () => {
    if (!confirm('Erase ALL books, sessions and notes from this device?')) return;
    if (!confirm('Are you sure? Export a backup first if you might want this data again.')) return;
    await db.replaceAll({});
    await refresh();
    toast('All data erased');
  },
  'load-sample': async () => {
    await db.replaceAll(sampleData());
    await refresh();
    toast('Sample data loaded. Erase it from Stats when you are done.');
  },
};

/* ------------------------------------------------------------------ */
/* Start-up                                                            */
/* ------------------------------------------------------------------ */

function bindEvents() {
  // One listener handles every button with a data-action.
  document.addEventListener('click', (e) => {
    const star = e.target.closest('[data-star]');
    if (star) return onStarTap(star);
    const el = e.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) {
      e.preventDefault();
      actions[el.dataset.action](el);
    }
  });

  // Rule slot switches on the wheel screen.
  document.addEventListener('change', async (e) => {
    const rule = e.target.dataset?.rule;
    if (!rule) return;
    const on = new Set(state.rules);
    if (e.target.checked) on.add(rule);
    else on.delete(rule);
    await db.put('settings', { key: 'rules', value: calc.RULE_IDS.filter((id) => on.has(id)) });
    await refresh();
  });

  // Tap the dimmed background to close a sheet.
  const sheet = $('#sheet');
  // (Checks the tap position, so taps on the sheet's own padding don't count.)
  sheet.addEventListener('click', (e) => {
    if (e.target !== sheet) return;
    const box = sheet.getBoundingClientRect();
    const inside = e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
    if (!inside) closeSheet();
  });
  // Clear old content once closed, unless another sheet has opened since.
  sheet.addEventListener('close', () => {
    if (!sheet.open) $('#sheet-body').innerHTML = '';
  });

  // Back/forward between tabs.
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

  // Coming back to the app (e.g. the next morning): refresh "today".
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !$('#sheet').open) render();
  });

  // Redraw the wheel if the phone switches between light and dark mode.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => wheel.draw());
}

async function init() {
  wheel = new Wheel($('#wheel-canvas'), $('#wheel-pointer'));
  bindEvents();
  try {
    await load();
  } catch (err) {
    document.body.insertAdjacentHTML('afterbegin', `<p class="fatal">Sorry, this browser couldn't open its storage (${esc(err.message)}). Private browsing can cause this.</p>`);
    return;
  }
  showTab(location.hash.slice(1) || 'log');

  // Register the service worker so the app works offline.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered:', err));
  }
}

init();
