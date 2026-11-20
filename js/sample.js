/*
 * sample.js - made-up demo data for trying the app out.
 *
 * Dates are generated relative to today so the wheel rules, streak and
 * chart always have something interesting to show. Includes a multi-day
 * entry, a finished book, two books tied at 0% and a couple of day notes.
 */

import { todayISO, addDays } from './calc.js';

export function sampleData() {
  const T = todayISO();
  const d = (offset) => addDays(T, offset);
  const now = Date.now();

  const books = [
    { id: 1, title: "The Clockmaker's Garden", author: 'Imogen Hale', totalPages: 384, genre: 'Fiction', status: 'wheel', dateAdded: d(-40), dateFinished: '', rating: 0, notes: '', colour: '#FF6B6B', createdAt: now },
    { id: 2, title: 'Salt and Starlight', author: 'Marcus Webb', totalPages: 296, genre: 'Fantasy', status: 'wheel', dateAdded: d(-25), dateFinished: '', rating: 0, notes: '', colour: '#FFC93C', createdAt: now },
    { id: 3, title: 'A Year of Small Things', author: 'Priya Raman', totalPages: 512, genre: 'Memoir', status: 'wheel', dateAdded: d(-12), dateFinished: '', rating: 0, notes: '', colour: '#1FB5A8', createdAt: now },
    { id: 4, title: 'North of Nowhere', author: 'Tom Ashby', totalPages: 240, genre: 'Thriller', status: 'wheel', dateAdded: d(-2), dateFinished: '', rating: 0, notes: '', colour: '#8E6CEF', createdAt: now },
    { id: 5, title: 'The Last Tea Shop', author: 'Ellen Marsh', totalPages: 220, genre: 'Romance', status: 'finished', dateAdded: d(-30), dateFinished: d(-6), rating: 4, notes: 'Cosy and sweet.', colour: '#4D9DE0', createdAt: now },
    { id: 6, title: 'Quiet Rivers', author: 'Ana Ortiz', totalPages: 350, genre: 'Non-fiction', status: 'wheel', dateAdded: d(-1), dateFinished: '', rating: 0, notes: '', colour: '#F78FB3', createdAt: now },
    { id: 7, title: 'The Map of Lost Things', author: 'Jonah Reed', totalPages: 410, genre: 'Adventure', status: 'want', dateAdded: '', dateFinished: '', rating: 0, notes: '', colour: '#FF9F43', createdAt: now },
  ];

  // [bookId, startOffset, endOffset, chapters, startPage, endPage]
  const raw = [
    [5, -20, -20, 3, 1, 60],
    [5, -15, -15, 4, 61, 140],
    [1, -14, -14, 2, 1, 35],
    [2, -13, -13, 2, 1, 40],
    [1, -10, -8, 5, 36, 110], // a multi-day entry
    [2, -10, -8, 3, 41, 90], // same range, so it shares that Day
    [3, -7, -7, 1, 1, 30],
    [5, -6, -6, 4, 141, 220], // finishes the book
    [1, -5, -5, 2, 111, 150],
    [3, -4, -4, 2, 31, 62],
    [2, -3, -3, 2, 91, 127],
    [1, -1, -1, 2, 151, 180],
    [2, 0, 0, 2, 128, 161],
  ];
  const sessions = raw.map(([bookId, s, e, chapters, startPage, endPage], i) => ({
    id: i + 1,
    bookId,
    startDate: d(s),
    endDate: d(e),
    chapters,
    startPage,
    endPage,
  }));

  const notes = [
    { date: d(-10), text: 'Long weekend, logged it all in one go' },
    { date: d(-1), text: "Reading at work, spun for The Clockmaker's Garden" },
  ];

  return { books, sessions, notes, settings: [] };
}
