// Username/password sign-in for the built-in store (claude.ai and demo builds),
// shaped like the Firebase Auth functions StayBill uses.
//
// Logins live in the shared store at logins/{username} as a random salt and a
// PBKDF2-SHA-256 hash (the password itself is never stored). The session is
// remembered per browser. On claude.ai the viewer must also be signed in to
// their Claude account, which the artifact checks before the page can reach
// the store.
//
// Note: in this build StayBill enforces roles in the app. For strict,
// server-side enforcement between hotels use the Firebase version, where the
// Firestore security rules apply.
import { getStore, newId } from './store';

const SESSION = 'staybill-session-v2';
const ITER = 120000;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(password, saltHex, iterations = ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
function randomHex(n = 16) {
  const a = new Uint8Array(n); crypto.getRandomValues(a); return hex(a);
}
const uname = (email) => String(email || '').trim().toLowerCase().split('@')[0];
function authError(code, message) { const e = new Error(message); e.code = code; return e; }

async function loginDoc(username) {
  const s = await getStore();
  return s.doc(`logins/${username}`);
}
async function readLogin(username) {
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) return null;
  const ref = await loginDoc(username);
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}
async function writePassword(username, password, uid) {
  const salt = randomHex();
  const hash = await pbkdf2(password, salt);
  const ref = await loginDoc(username);
  const cur = await ref.get();
  const body = { uid: uid || cur.data()?.uid, salt, hash, iterations: ITER, updatedAt: Date.now() };
  if (cur.exists) await ref.update(body); else await ref.set({ ...body, createdAt: Date.now() });
}

// ---------- session state ----------
const main = { name: '[DEFAULT]', user: undefined, listeners: new Set() };
function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION) || 'null'); } catch { return null; }
}
function setUser(a, u) {
  a.user = u;
  if (a === main) {
    try { if (u) localStorage.setItem(SESSION, JSON.stringify(u)); else localStorage.removeItem(SESSION); } catch { /* ignore */ }
  }
  a.listeners.forEach((l) => l(u));
}
let booted = false;
function boot() {
  if (booted) return; booted = true;
  const s = readSession();
  // Re-check the stored session against the login record (it may have been removed or reset).
  if (!s?.uid) { setTimeout(() => setUser(main, null), 0); return; }
  readLogin(s.username).then((rec) => {
    setUser(main, rec && rec.uid === s.uid && (!s.v || s.v === rec.updatedAt) ? s : null);
  }).catch(() => setUser(main, s));
}

const auths = new Map();
function authFor(app) {
  if (!app || app.name === '[DEFAULT]') return main;
  if (!auths.has(app.name)) auths.set(app.name, { name: app.name, user: null, listeners: new Set() });
  return auths.get(app.name);
}
const facade = (a) => ({ get currentUser() { return a.user || null; }, __a: a });

export function getAuth(app) { const a = authFor(app); if (a === main) boot(); return facade(a); }
export function onAuthStateChanged(auth, cb) {
  const a = auth?.__a || main;
  a.listeners.add(cb);
  if (a.user !== undefined) setTimeout(() => cb(a.user), 0); else boot();
  return () => a.listeners.delete(cb);
}

export async function signInWithEmailAndPassword(auth, email, password) {
  const username = uname(email);
  const rec = await readLogin(username);
  if (!rec || (await pbkdf2(password, rec.salt, rec.iterations || ITER)) !== rec.hash) {
    throw authError('auth/invalid-credential', 'Incorrect username or password.');
  }
  const u = { uid: rec.uid, username, email: `${username}@staybill.app`, displayName: '', v: rec.updatedAt };
  setUser(auth?.__a || main, u);
  return { user: u };
}
export async function createUserWithEmailAndPassword(auth, email, password) {
  const username = uname(email);
  if (await readLogin(username)) throw authError('auth/email-already-in-use', 'That username is already taken.');
  if (String(password).length < 6) throw authError('auth/weak-password', 'Password must be at least 6 characters.');
  const uid = `u-${newId()}`;
  await writePassword(username, password, uid);
  const rec = await readLogin(username);
  const u = { uid, username, email: `${username}@staybill.app`, displayName: '', v: rec?.updatedAt };
  setUser(auth?.__a || main, u);
  return { user: u };
}
export async function signOut(auth) { setUser(auth?.__a || main, null); }
export async function updateProfile(u, p) {
  Object.assign(u || {}, p);
  if (u && main.user?.uid === u.uid) setUser(main, { ...main.user, ...p });
}
export async function updatePassword(u, password) {
  if (!u?.username) throw authError('auth/requires-recent-login', 'Please sign in again.');
  await writePassword(u.username, password);
  const rec = await readLogin(u.username);
  if (main.user?.uid === u.uid) setUser(main, { ...main.user, v: rec?.updatedAt });
}
export async function sendPasswordResetEmail() {
  throw authError('auth/unsupported', 'Ask your hotel owner or the site administrator to set a new password for you.');
}

/** The signed-in person changes their own password. */
export async function changeOwnPassword(current, next) {
  const u = main.user;
  if (!u) throw new Error('Please sign in again.');
  const rec = await readLogin(u.username);
  if (!rec || (await pbkdf2(current, rec.salt, rec.iterations || ITER)) !== rec.hash) throw new Error('Your current password is not correct.');
  await updatePassword(u, next);
}
/** An owner or the administrator sets someone else's password. */
export async function adminSetPassword(username, password) {
  if (!(await readLogin(username))) throw new Error('That login no longer exists.');
  await writePassword(username, password);
}
