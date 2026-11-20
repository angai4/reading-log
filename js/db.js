/*
 * db.js - a small promise-based wrapper around IndexedDB.
 *
 * IndexedDB is the database built into every modern browser. Its raw API is
 * event-based and verbose, so this file hides it behind a few simple async
 * functions. All data stays on the device; nothing is sent anywhere.
 *
 * Object stores (think "tables"):
 *   books     - one record per book            (key: id, auto-numbered)
 *   sessions  - one record per log entry       (key: id, auto-numbered)
 *   notes     - one note per calendar date     (key: date, 'YYYY-MM-DD')
 *   settings  - app settings, e.g. wheel rules (key: key)
 */

const DB_NAME = 'reading-log';
const DB_VERSION = 1;
export const STORES = ['books', 'sessions', 'notes', 'settings'];

let dbPromise = null;

/** Open (and if needed create or upgrade) the database. Called lazily. */
function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    // Runs only the first time, or when DB_VERSION goes up.
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('books')) {
        db.createObjectStore('books', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
        sessions.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** Turn a single IDBRequest into a promise. */
function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Resolve when a transaction has fully committed to disk. */
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

/** Get every record in a store. */
export async function getAll(storeName) {
  const db = await openDB();
  return promisify(db.transaction(storeName).objectStore(storeName).getAll());
}

/** Get one record by its key (or undefined). */
export async function get(storeName, key) {
  const db = await openDB();
  return promisify(db.transaction(storeName).objectStore(storeName).get(key));
}

/**
 * Insert or update a record. Returns its key.
 * For auto-numbered stores, leave `id` out to create a new record.
 */
export async function put(storeName, record) {
  const db = await openDB();
  const copy = { ...record };
  if (copy.id === undefined || copy.id === null) delete copy.id;
  const tx = db.transaction(storeName, 'readwrite');
  const key = await promisify(tx.objectStore(storeName).put(copy));
  await done(tx);
  return key;
}

/** Delete one record by key. */
export async function remove(storeName, key) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(key);
  await done(tx);
}

/** Delete several records from one store in a single transaction. */
export async function removeMany(storeName, keys) {
  const db = await openDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  keys.forEach((key) => store.delete(key));
  await done(tx);
}

/**
 * Wipe every store and write the given data in one transaction.
 * Used by "Import backup", "Load sample data" and "Erase all data".
 * Because it is a single transaction, a failure leaves the old data intact.
 * @param {{books?:[], sessions?:[], notes?:[], settings?:[]}} data
 */
export async function replaceAll(data) {
  const db = await openDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) {
    const store = tx.objectStore(name);
    store.clear();
    (data[name] || []).forEach((record) => store.put(record));
  }
  await done(tx);
}

/** Read everything at once (for exports and for loading app state). */
export async function exportAll() {
  const [books, sessions, notes, settings] = await Promise.all(STORES.map(getAll));
  return { books, sessions, notes, settings };
}

/**
 * Ask the browser not to clear our data when the device is low on space.
 * Browsers may say no; that's fine, it's just a request.
 */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (!already) await navigator.storage.persist();
    }
  } catch {
    /* not supported: ignore */
  }
}
