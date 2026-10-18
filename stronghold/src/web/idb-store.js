// Records kept in this browser's IndexedDB. One command's changes go into one readwrite
// transaction with strict durability, so they are written together or not at all (REQ_000_040).
import { STORE_NAMES } from '../core/memory-store.js';

const DB_NAME = 'stronghold';
const DB_VERSION = 1;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('The browser could not save the records.'));
    tx.onabort = () => reject(tx.error || new Error('The browser stopped saving the records.'));
  });
}

export class IndexedDBStore {
  static async open() {
    if (!globalThis.indexedDB) throw new Error('This browser does not offer IndexedDB storage, so Stronghold cannot keep records here.');
    const openReq = indexedDB.open(DB_NAME, DB_VERSION);
    openReq.onupgradeneeded = () => {
      const db = openReq.result;
      for (const name of STORE_NAMES) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
    };
    const db = await new Promise((resolve, reject) => {
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => reject(openReq.error);
      openReq.onblocked = () => reject(new Error('Close other Stronghold tabs that use an older version, then reload this page.'));
    });
    const store = new IndexedDBStore(db);
    try {
      store.persisted = Boolean(navigator.storage && navigator.storage.persisted && (await navigator.storage.persisted()));
    } catch {
      store.persisted = false;
    }
    return store;
  }

  constructor(db) {
    this.db = db;
    this.persisted = false;
    db.onversionchange = () => db.close();
  }

  async protect() {
    if (!this.persisted) this.persisted = await requestPersistence();
    return this.persisted;
  }

  describe() {
    return {
      kind: 'indexeddb',
      label: 'This browser on this computer (IndexedDB)',
      persisted: this.persisted,
    };
  }

  async load() {
    const tx = this.db.transaction(STORE_NAMES, 'readonly');
    const results = await Promise.all(STORE_NAMES.map((name) => request(tx.objectStore(name).getAll())));
    return Object.fromEntries(STORE_NAMES.map((name, i) => [name, results[i]]));
  }

  async read(store, id) {
    const tx = this.db.transaction([store], 'readonly');
    const value = await request(tx.objectStore(store).get(id));
    return value === undefined ? null : value;
  }

  async commit(changes) {
    const names = [...new Set(changes.map((c) => c.store))];
    const tx = this.db.transaction(names, 'readwrite', { durability: 'strict' });
    const finished = done(tx);
    for (const { store, id, value } of changes) {
      if (value === null) tx.objectStore(store).delete(id);
      else tx.objectStore(store).put(value);
    }
    await finished;
  }

  async replaceAll(data) {
    const tx = this.db.transaction(STORE_NAMES, 'readwrite', { durability: 'strict' });
    const finished = done(tx);
    for (const name of STORE_NAMES) {
      const os = tx.objectStore(name);
      os.clear();
      for (const record of data[name] || []) os.put(record);
    }
    await finished;
  }
}

// Asks the browser not to clear these records when it runs low on space. Called once there are
// records to protect, because some browsers ask the user.
export async function requestPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
