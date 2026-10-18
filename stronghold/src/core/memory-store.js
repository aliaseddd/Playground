// A store that keeps records in memory only. Used by the tests; the browser uses IndexedDBStore.
// Both implement the same interface:
//   load()             -> { [storeName]: record[] }
//   read(store, id)    -> one record, or null
//   commit(changes)    -> applies [{ store, id, value }] all together (value null deletes)
//   replaceAll(data)   -> clears every store and writes `data` (restore from backup)

export const STORE_NAMES = ['meta', 'users', 'people', 'visits', 'destinations', 'watchlist', 'holds', 'audit'];

export class MemoryStore {
  constructor() {
    this.stores = Object.fromEntries(STORE_NAMES.map((name) => [name, new Map()]));
    this.failNextCommit = null;
  }

  describe() {
    return { kind: 'memory', label: 'Memory only (records are lost when the page closes)' };
  }

  async load() {
    return Object.fromEntries(
      STORE_NAMES.map((name) => [name, [...this.stores[name].values()].map((v) => structuredClone(v))]),
    );
  }

  async read(store, id) {
    const v = this.stores[store].get(id);
    return v ? structuredClone(v) : null;
  }

  async commit(changes) {
    if (this.failNextCommit) {
      const error = this.failNextCommit;
      this.failNextCommit = null;
      throw error;
    }
    for (const { store, id, value } of changes) {
      if (value === null) this.stores[store].delete(id);
      else this.stores[store].set(id, structuredClone(value));
    }
  }

  async replaceAll(data) {
    for (const name of STORE_NAMES) {
      this.stores[name].clear();
      for (const record of data[name] || []) this.stores[name].set(record.id, structuredClone(record));
    }
  }
}
