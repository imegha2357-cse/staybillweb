// Firestore-compatible API (the subset StayBill uses) on top of the artifact
// database. The hosted build aliases `firebase/firestore` to this file, so
// src/lib/db.js and the contexts run unchanged.
import { getStore, newId } from './store';

// ---------- Values ----------
export class Timestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds; }
  static now() { return Timestamp.fromMillis(Date.now()); }
  static fromMillis(ms) { return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6); }
  static fromDate(d) { return Timestamp.fromMillis(d.getTime()); }
  toMillis() { return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6); }
  toDate() { return new Date(this.toMillis()); }
}
const SERVER_TS = Object.freeze({ __staybill: 'serverTimestamp' });
export const serverTimestamp = () => SERVER_TS;
export const arrayUnion = (...values) => ({ __staybill: 'arrayUnion', values });
export const increment = (n) => ({ __staybill: 'increment', n });

const isSentinel = (v) => v && typeof v === 'object' && typeof v.__staybill === 'string';
function hasSentinel(v) {
  if (isSentinel(v)) return v !== SERVER_TS;
  if (Array.isArray(v)) return v.some(hasSentinel);
  if (v && typeof v === 'object') return Object.values(v).some(hasSentinel);
  return false;
}
const tsPlain = (ms) => ({ seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 });

/** Turn Firestore-style values into plain JSON. Timestamps become
 *  {seconds, nanoseconds}; top-level timestamps also get a sortable
 *  `<field>__ms` number (artifact queries order by top-level scalars). */
function resolve(val, old, now, top = false) {
  if (val === SERVER_TS) return tsPlain(now);
  if (val instanceof Timestamp) return { seconds: val.seconds, nanoseconds: val.nanoseconds };
  if (val instanceof Date) return tsPlain(val.getTime());
  if (isSentinel(val)) {
    if (val.__staybill === 'arrayUnion') return [...new Set([...(Array.isArray(old) ? old : []), ...val.values])];
    if (val.__staybill === 'increment') return (Number(old) || 0) + val.n;
  }
  if (Array.isArray(val)) return val.map((x) => resolve(x, undefined, now));
  if (val && typeof val === 'object') {
    const out = {};
    Object.entries(val).forEach(([k, v]) => {
      if (v === undefined) return;
      const r = resolve(v, old?.[k], now);
      out[k] = r;
      if (top && r && typeof r === 'object' && typeof r.seconds === 'number' && typeof r.nanoseconds === 'number' && Object.keys(r).length === 2) {
        out[`${k}__ms`] = r.seconds * 1000 + Math.floor(r.nanoseconds / 1e6);
      }
    });
    return out;
  }
  return val;
}
const prepare = (data, old) => resolve(data, old, Date.now(), true);

// ---------- Refs and queries ----------
export const initializeFirestore = () => ({ hosted: true });
export const getFirestore = () => ({ hosted: true });
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});

export function collection(parent, ...parts) {
  const base = parent?.type === 'doc' ? [parent.path, ...parts] : parts;
  return { type: 'col', path: base.join('/') };
}
export function doc(parent, ...parts) {
  if (parent?.type === 'col') {
    const id = parts.length ? parts.join('/') : newId();
    return { type: 'doc', path: `${parent.path}/${id}`, id: id.split('/').pop() };
  }
  const path = parts.join('/');
  return { type: 'doc', path, id: path.split('/').pop() };
}
export const where = (field, op, value) => ({ k: 'where', field, op, value });
export const orderBy = (field, dir = 'asc') => ({ k: 'orderBy', field, dir });
export const limit = (n) => ({ k: 'limit', n });
export const query = (col, ...constraints) => ({ type: 'query', path: col.path, constraints });

// Timestamp fields are ordered by their numeric shadow field.
const TS_FIELDS = new Set(['createdAt', 'updatedAt', 'cancelledAt', 'lastPaymentAt', 'completedAt']);
function buildQuery(store, q) {
  let r = store.collection(q.path);
  (q.constraints || []).forEach((c) => {
    if (c.k === 'where') r = r.where(c.field, c.op, c.value);
    else if (c.k === 'orderBy') r = r.orderBy(TS_FIELDS.has(c.field) ? `${c.field}__ms` : c.field, c.dir);
    else if (c.k === 'limit') r = r.limit(c.n);
  });
  return r;
}

// ---------- Snapshots ----------
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function wrapDoc(s) {
  return { id: s.id, exists: () => !!s.exists, data: () => (s.exists ? copy(s.data()) : undefined), ref: { path: s.path } };
}
function wrapQuery(qs) {
  const docs = qs.docs.map(wrapDoc);
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
}
function friendly(e) {
  if (!e || e instanceof Error) return e;
  const err = new Error(e.code === 'invalid_argument' ? 'You do not have permission to do this, or the data is invalid.'
    : e.code === 'quota_exceeded' ? 'The hosted database is full. Export a backup and remove old records, or move to Firebase.'
      : e.message || 'Database error');
  err.code = e.code === 'invalid_argument' ? 'permission-denied' : e.code;
  return err;
}
async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.code === 'unavailable' || e?.code === 'resource_exhausted') {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
      try { return await fn(); } catch (e2) { throw friendly(e2); }
    }
    throw friendly(e);
  }
}

// ---------- Reads ----------
export async function getDoc(ref) {
  const s = await getStore();
  return wrapDoc(await withRetry(() => s.doc(ref.path).get()));
}
export async function getDocs(q) {
  const s = await getStore();
  const target = q.type === 'col' ? { path: q.path, constraints: [] } : q;
  return wrapQuery(await withRetry(() => buildQuery(s, target).get()));
}
export async function getCountFromServer(q) {
  const r = await getDocs(q);
  return { data: () => ({ count: r.size }) };
}

// ---------- Writes ----------
async function writeSet(s, path, data, merge) {
  const r = s.doc(path);
  if (merge) {
    const cur = await withRetry(() => r.get());
    if (cur.exists) return withRetry(() => r.update(prepare(data, cur.data())));
  }
  return withRetry(() => r.set(prepare(data)));
}
async function writeUpdate(s, path, data) {
  const r = s.doc(path);
  let old;
  if (hasSentinel(data)) old = (await withRetry(() => r.get())).data();
  return withRetry(() => r.update(prepare(data, old)));
}
export async function setDoc(ref, data, opts) {
  const s = await getStore();
  await writeSet(s, ref.path, data, opts?.merge);
}
export async function updateDoc(ref, data) {
  const s = await getStore();
  await writeUpdate(s, ref.path, data);
}
export async function deleteDoc(ref) {
  const s = await getStore();
  await withRetry(() => s.doc(ref.path).delete());
}
export async function addDoc(col, data) {
  const ref = doc(col);
  await setDoc(ref, data);
  return ref;
}
export function writeBatch() {
  const ops = [];
  const b = {
    set: (ref, data, opts) => { ops.push((s) => writeSet(s, ref.path, data, opts?.merge)); return b; },
    update: (ref, data) => { ops.push((s) => writeUpdate(s, ref.path, data)); return b; },
    delete: (ref) => { ops.push((s) => withRetry(() => s.doc(ref.path).delete())); return b; },
    commit: async () => {
      const s = await getStore();
      for (const op of ops) await op(s); // eslint-disable-line no-await-in-loop
    },
  };
  return b;
}

// Transactions: the artifact database has no transactions, so StayBill takes
// a short cooperative lease on one lock document. Every transactional write in
// the app (invoice numbering, payments, cancellations) goes through it, so two
// front-desk computers can never issue the same invoice number.
const HOLDER = `tab-${newId()}`;
async function lock(s) {
  const ref = s.doc('locks/transactions');
  for (let i = 0; i < 60; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await withRetry(() => ref.acquire({ holder: HOLDER, ttlMs: 8000 }));
    if (r?.acquired) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((res) => setTimeout(res, 250 + Math.random() * 250));
  }
  throw new Error('Another computer is saving a bill right now. Please try again.');
}
export async function runTransaction(_db, fn) {
  const s = await getStore();
  await lock(s);
  const ops = [];
  const tx = {
    get: (ref) => getDoc(ref),
    set: (ref, data, opts) => { ops.push(() => writeSet(s, ref.path, data, opts?.merge)); return tx; },
    update: (ref, data) => { ops.push(() => writeUpdate(s, ref.path, data)); return tx; },
    delete: (ref) => { ops.push(() => withRetry(() => s.doc(ref.path).delete())); return tx; },
  };
  const result = await fn(tx);
  for (const op of ops) await op(); // eslint-disable-line no-await-in-loop
  return result;
}

// ---------- Live listeners ----------
export function onSnapshot(target, next, onError) {
  let unsub = null;
  let cancelled = false;
  getStore().then((s) => {
    if (cancelled) return;
    const err = (e) => { if (onError) onError(friendly(e)); else console.error(e); };
    if (target.type === 'doc') unsub = s.doc(target.path).onSnapshot((snap) => next(wrapDoc(snap)), err);
    else {
      const q = target.type === 'col' ? { path: target.path, constraints: [] } : target;
      unsub = buildQuery(s, q).onSnapshot((snap) => next(wrapQuery(snap)), err);
    }
  }).catch((e) => onError?.(friendly(e)));
  return () => { cancelled = true; if (unsub) unsub(); };
}
