// Resolves the document store used by the hosted build:
//  - on claude.ai: the artifact's `db` capability (persistent, shared, realtime)
//  - anywhere else (local preview, tests): a browser-storage store with the
//    same interface, so the hosted build also runs standalone.
import { claudeUse, IN_CLAUDE } from '../platform';

let storePromise = null;
export function getStore() {
  if (!storePromise) {
    storePromise = claudeUse('db').then((db) => {
      if (db) return db;
      if (IN_CLAUDE) {
        storePromise = null; // try again next time (the viewer may sign in)
        const e = new Error('Sign in to claude.ai to open StayBill.'); e.code = 'signed-out';
        throw e;
      }
      return localStore();
    });
  }
  return storePromise;
}

export function newId() {
  const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const r = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto.getRandomValues(new Uint8Array(20)) : Array.from({ length: 20 }, () => Math.floor(Math.random() * 256));
  for (let i = 0; i < 20; i += 1) s += a[r[i] % a.length];
  return s;
}

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function deepMerge(base, patch) {
  const out = { ...(base || {}) };
  Object.entries(patch || {}).forEach(([k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  });
  return out;
}

function cmp(a, b) {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  return a < b ? -1 : 1;
}
function matches(v, op, x) {
  switch (op) {
    case '==': return v === x;
    case '!=': return v !== undefined && v !== x;
    case '<': return v !== undefined && v < x;
    case '<=': return v !== undefined && v <= x;
    case '>': return v !== undefined && v > x;
    case '>=': return v !== undefined && v >= x;
    case 'in': return x.includes(v);
    case 'not-in': return v !== undefined && !x.includes(v);
    case 'array-contains': return Array.isArray(v) && v.includes(x);
    default: return false;
  }
}

/** Browser-storage implementation of the artifact db interface. */
function localStore() {
  const KEY = 'staybill-local-db-v1';
  let data = {};
  try { data = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { data = {}; }
  const listeners = new Set();
  const notify = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  const persist = () => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
    notify();
  };
  try {
    window.addEventListener('storage', (e) => {
      if (e.key !== KEY) return;
      try { data = JSON.parse(e.newValue || '{}'); } catch { data = {}; }
      notify();
    });
  } catch { /* ignore */ }

  const snap = (path) => {
    const d = data[path];
    return { id: path.split('/').pop(), exists: d !== undefined, data: () => clone(d), metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  function query(path, filters = [], ob = null, lim = null) {
    const depth = path.split('/').length + 1;
    const run = () => {
      let rows = Object.keys(data).filter((p) => p.startsWith(`${path}/`) && p.split('/').length === depth).map(snap);
      filters.forEach(([f, op, x]) => { rows = rows.filter((r) => matches(r.data()[f], op, x)); });
      if (ob) rows.sort((a, b) => cmp(a.data()[ob[0]], b.data()[ob[0]]) * (ob[1] === 'desc' && a.data()[ob[0]] !== undefined && b.data()[ob[0]] !== undefined ? -1 : 1));
      else rows.sort((a, b) => cmp(a.id, b.id));
      if (lim) rows = rows.slice(0, lim);
      return { docs: rows, size: rows.length, empty: rows.length === 0, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      where: (f, op, x) => query(path, [...filters, [f, op, x]], ob, lim),
      orderBy: (f, dir = 'asc') => query(path, filters, [f, dir], lim),
      limit: (n) => query(path, filters, ob, n),
      get: async () => { await tick(); return run(); },
      onSnapshot: (next) => {
        const fn = () => next(run());
        listeners.add(fn);
        setTimeout(fn, 0);
        return () => listeners.delete(fn);
      },
    };
  }
  function docRef(path) {
    return {
      id: path.split('/').pop(),
      path,
      get: async () => { await tick(); return snap(path); },
      set: async (d) => { await tick(); data[path] = clone(d); persist(); },
      update: async (d) => {
        await tick();
        if (data[path] === undefined) { const e = new Error('Document does not exist.'); e.code = 'invalid_argument'; throw e; }
        data[path] = deepMerge(data[path], clone(d));
        persist();
      },
      delete: async () => { await tick(); delete data[path]; persist(); },
      acquire: async () => ({ acquired: true }),
      onSnapshot: (next) => {
        const fn = () => next(snap(path));
        listeners.add(fn);
        setTimeout(fn, 0);
        return () => listeners.delete(fn);
      },
      collection: (sub) => colRef(`${path}/${sub}`),
    };
  }
  function colRef(path) {
    return {
      ...query(path),
      path,
      doc: (id) => docRef(`${path}/${id || newId()}`),
      add: async (d) => { const r = docRef(`${path}/${newId()}`); await r.set(d); return r; },
    };
  }
  return { doc: docRef, collection: colRef, isLocal: true };
}
