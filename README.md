# Reading Log 📚🎡

A personal reading log with a spinning wheel to choose what to read next.
Plain HTML, CSS and JavaScript: no frameworks, no build step. Data is saved
in your browser (IndexedDB) and the app works offline once installed.

## Run it on your computer

You need a small local web server (opening `index.html` directly won't work,
because browsers block some features for files opened from disk).

```bash
cd reading_log
python3 -m http.server 8000
```

Then open <http://localhost:8000> in your browser. Press `Ctrl+C` in the
terminal to stop the server.

## Files

| File | What it does |
|---|---|
| `index.html` | The page: top bar, four screens, tab bar, pop-up sheet |
| `css/styles.css` | All styling; colours are variables at the top (light and dark) |
| `js/app.js` | Screens, forms, buttons, backup and import |
| `js/calc.js` | The maths: progress, Days, streaks, stats and the wheel rules |
| `js/wheel.js` | Drawing and spinning the wheel |
| `js/chart.js` | The pages-over-time bar chart |
| `js/db.js` | Saving to and loading from IndexedDB |
| `js/effects.js` | Confetti and pop-up messages |
| `js/sample.js` | Made-up demo data for trying the app out |
| `sw.js` | Service worker: keeps a copy of the app for offline use |
| `manifest.webmanifest` | Lets phones install the app to the home screen |
| `icons/` | App icons |

## How the rules work

- **Pages read** counts both ends: pages 128-161 is 34 pages.
- **Current page** is the highest end page logged for a book.
- **Days** are numbered only on days you read; a multi-day entry
  (e.g. 27-31 October) is one Day, but counts towards the streak for every date.
- **Wheel rules** always show every tied book. *Highest %* ignores books at 0%.
  *Least Read Last Week* covers today and the 6 days before, with multi-day
  entries spread evenly across their dates. Putting a book (back) on the wheel
  resets its date added to today.

## Making changes

After changing any file, bump `VERSION` in `sw.js` (e.g. `'v1'` to `'v2'`).
Installed copies pick up the new version the next time they're opened online
(you may need to close and reopen the app twice).

## Backups

Your data lives only in the browser on the device you use. Use
**Stats → Export everything (JSON)** now and then, and keep the file safe.
**Restore from a JSON backup** puts it back (on the same or another device).
