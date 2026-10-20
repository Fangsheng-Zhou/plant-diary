// Small IndexedDB wrapper for on-device storage.
//   keys   : unlocked space keys (non-extractable CryptoKeys)
//   cache  : last known encrypted rows, so the app opens instantly and offline
//   blobs  : encrypted photo files already downloaded
//   outbox : changes made offline, waiting to upload
// If IndexedDB is unavailable, it falls back to memory for this session.

const DB_NAME = 'plant-diary';
const DB_VERSION = 1;
let dbPromise = null;
let memory = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(e);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ['keys', 'cache', 'blobs']) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
      if (!db.objectStoreNames.contains('outbox')) {
        db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    console.warn('IndexedDB unavailable, using memory only', err);
    memory = { keys: new Map(), cache: new Map(), blobs: new Map(), outbox: new Map(), seq: 1 };
    return null;
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return openDb().then((db) => {
    if (!db) {
      const r = fn(null);
      return r ? r.result : undefined;
    }
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  });
}

export const local = {
  async get(store, key) {
    return run(store, 'readonly', (s) => (s ? s.get(key) : { result: memory[store].get(key) }));
  },
  async set(store, key, value) {
    return run(store, 'readwrite', (s) => {
      if (s) return s.put(value, key);
      memory[store].set(key, value);
      return null;
    });
  },
  async del(store, key) {
    return run(store, 'readwrite', (s) => {
      if (s) return s.delete(key);
      memory[store].delete(key);
      return null;
    });
  },
  async clear(store) {
    return run(store, 'readwrite', (s) => {
      if (s) return s.clear();
      memory[store].clear();
      return null;
    });
  },
  async keys(store) {
    return run(store, 'readonly', (s) => (s ? s.getAllKeys() : { result: [...memory[store].keys()] }));
  },
  // Outbox (ordered queue)
  async enqueue(item) {
    return run('outbox', 'readwrite', (s) => {
      if (s) return s.add(item);
      const seq = memory.seq++;
      memory.outbox.set(seq, { ...item, seq });
      return { result: seq };
    });
  },
  async queue() {
    const items = await run('outbox', 'readonly', (s) => (s ? s.getAll() : { result: [...memory.outbox.values()] }));
    return (items || []).sort((a, b) => a.seq - b.seq);
  },
  async dequeue(seq) {
    return run('outbox', 'readwrite', (s) => {
      if (s) return s.delete(seq);
      memory.outbox.delete(seq);
      return null;
    });
  },
};
