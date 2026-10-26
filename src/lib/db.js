// Data-access layer. Every Firestore read/write in the app goes through here.
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  query, where, orderBy, limit, runTransaction, serverTimestamp, writeBatch, Timestamp, arrayUnion,
} from '../backend/firestore';
import { initializeApp, deleteApp } from '../backend/app';
import {
  getAuth, createUserWithEmailAndPassword, signOut, updateProfile, changePassword, isLocalBackend,
} from '../backend/auth';
import { auth, db, firebaseConfig } from '../firebase';
import { computeBill, PAYMENT_STATUS, statusFor, round2, DEFAULT_ROOM_TYPES, formatInvoiceNumber } from './billing';
import { today } from './dates';
import { hcol, hdoc, getHotelId } from './scope';

export const actor = (u) => ({ uid: u?.uid || null, name: u?.name || u?.email || 'Unknown' });

// ---------- Audit (PRD §49) ----------
export function auditPayload(user, action, entity, entityId, details = {}) {
  return {
    action, entity, entityId: entityId || null, details,
    user: actor(user), createdAt: serverTimestamp(),
  };
}
export async function logAudit(user, action, entity, entityId, details) {
  try {
    if (!getHotelId()) return; // site-level actions are recorded on the hotel they affect
    await addDoc(hcol('auditLogs'), auditPayload(user, action, entity, entityId, details));
  } catch (e) {
    console.warn('Audit log failed', e);
  }
}
export async function listAudit({ entityId, max = 200 } = {}) {
  const q = entityId
    ? query(hcol('auditLogs'), where('entityId', '==', entityId))
    : query(hcol('auditLogs'), orderBy('createdAt', 'desc'), limit(max));
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

// ---------- Setup / bootstrap ----------
/** The site is set up once its administrator account exists. */
export async function isSetupComplete() {
  const s = await getDoc(doc(db, 'meta', 'platform'));
  return s.exists();
}

export const DEFAULT_SETTINGS = {
  hotelName: 'My Hotel', logo: '', address: '', city: '', state: '', country: 'India',
  phone: '', email: '', website: '', gstin: '',
  currency: 'INR', invoicePrefix: 'INV', invoiceStartNumber: 1001,
  invoiceFooter: 'Thank you for staying with us.',
  emailGuests: true, emailOnCreate: true, emailOnPaid: true,
  permissions: {
    receptionistCanEditBills: true,
    receptionistCanCancelBills: false,
    receptionistCanViewReports: false,
    receptionistCanManageRooms: false,
  },
};

// ---------- Usernames ----------
export const LOGIN_DOMAIN = 'staybill.app';
export function normalizeUsername(u) {
  return String(u || '').trim().toLowerCase();
}
export function usernameProblem(u) {
  const n = normalizeUsername(u);
  if (n.length < 3) return 'Username must be at least 3 characters.';
  if (n.length > 30) return 'Username can be at most 30 characters.';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(n)) return 'Use letters, numbers, dots, dashes or underscores (no spaces).';
  return '';
}
/** Sign-in identity behind a username (Firebase Auth needs an email-shaped id). */
export const loginEmail = (username) => (String(username).includes('@') ? String(username).trim().toLowerCase() : `${normalizeUsername(username)}@${LOGIN_DOMAIN}`);
export const passwordProblem = (p) => (String(p || '').length < 6 ? 'Password must be at least 6 characters.' : '');

/** First run: create the site administrator (username + password). */
export async function bootstrapAdmin({ name, username, password }) {
  const cred = await createUserWithEmailAndPassword(auth, loginEmail(username), password);
  await updateProfile(cred.user, { displayName: name });
  const b = writeBatch(db);
  b.set(doc(db, 'users', cred.user.uid), {
    name, username: normalizeUsername(username), role: 'admin', hotelId: null, status: 'active', createdAt: serverTimestamp(),
  });
  b.set(doc(db, 'meta', 'platform'), { completedAt: serverTimestamp(), by: cred.user.uid });
  await b.commit();
  return cred.user.uid;
}

/** Default configuration for a new hotel. */
async function seedHotelData(hid, hotelName, by, extra = {}) {
  const b = writeBatch(db);
  b.set(hdoc('settings', 'hotel', hid), { ...DEFAULT_SETTINGS, ...extra, hotelName, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(hdoc('counters', 'invoice', hid), { next: DEFAULT_SETTINGS.invoiceStartNumber });
  b.set(doc(hcol('taxes', hid)), { name: 'CGST', rate: 2.5, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  b.set(doc(hcol('taxes', hid)), { name: 'SGST', rate: 2.5, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  const rates = { Standard: 1500, Deluxe: 2500, Premium: 3200, Suite: 4000, 'Family Room': 3500 };
  DEFAULT_ROOM_TYPES.forEach((t, i) =>
    b.set(doc(hcol('roomTypes', hid)), { name: t, defaultRate: rates[t], order: i, createdAt: serverTimestamp() }));
  b.set(doc(hcol('auditLogs', hid)), auditPayload(by, 'HOTEL_CREATED', 'system', null, { hotelName }));
  await b.commit();
}

// ---------- Hotels (administrator) ----------
export async function listHotels() {
  const snap = await getDocs(collection(db, 'hotels'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
export async function getHotel(hid) {
  const s = await getDoc(doc(db, 'hotels', hid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
/** Adds a hotel with default settings, and (optionally) its owner's login. */
export async function createHotel(admin, { hotelName, city = '', owner }) {
  const ref = doc(collection(db, 'hotels'));
  await setDoc(ref, { name: hotelName, city, status: 'active', createdAt: serverTimestamp(), createdBy: actor(admin) });
  await seedHotelData(ref.id, hotelName, admin, { city });
  if (owner?.username) await createAccount(admin, { ...owner, role: 'owner', hotelId: ref.id });
  return ref.id;
}
export async function updateHotel(admin, hid, data) {
  await updateDoc(doc(db, 'hotels', hid), { ...data, updatedAt: serverTimestamp(), updatedBy: actor(admin) });
  await addDoc(hcol('auditLogs', hid), auditPayload(admin, 'HOTEL_UPDATED', 'hotel', hid, data));
}
/** This month's bills for one hotel (administrator overview). */
export async function hotelMonth(hid) {
  const t = today(); const from = `${t.slice(0, 7)}-01`;
  const snap = await getDocs(query(hcol('bills', hid), where('billDate', '>=', from), where('billDate', '<=', t)));
  const live = snap.docs.map((d) => d.data()).filter((b) => b.paymentStatus !== PAYMENT_STATUS.CANCELLED);
  return {
    bills: live.length,
    revenue: round2(live.reduce((a, b) => a + (b.grandTotal || 0), 0)),
    collected: round2(live.reduce((a, b) => a + (b.paidAmount || 0), 0)),
    outstanding: round2(live.reduce((a, b) => a + (b.balanceAmount || 0), 0)),
  };
}

// ---------- Accounts (PRD §48, extended for owners and employees) ----------
export async function listUsers(hid = getHotelId()) {
  const q = hid === 'all' ? collection(db, 'users') : query(collection(db, 'users'), where('hotelId', '==', hid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
export async function getUserProfile(uid) {
  const s = await getDoc(doc(db, 'users', uid));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
/**
 * Creates a login (username + password) without signing the current person out,
 * by using a temporary secondary app instance. Owners create employees;
 * the administrator creates owners (and can create employees for any hotel).
 */
export async function createAccount(by, { name, username, password, role, hotelId, phone = '' }) {
  const uErr = usernameProblem(username); if (uErr) throw new Error(uErr);
  const pErr = passwordProblem(password); if (pErr) throw new Error(pErr);
  if (!name?.trim()) throw new Error('Enter the person’s name.');
  const uname = normalizeUsername(username);
  const secondary = initializeApp(firebaseConfig, `secondary-${Date.now()}`);
  try {
    const sAuth = getAuth(secondary);
    let cred;
    try {
      cred = await createUserWithEmailAndPassword(sAuth, loginEmail(uname), password);
    } catch (e) {
      if (e?.code === 'auth/email-already-in-use') throw new Error(`The username "${uname}" is already taken. Choose another.`);
      throw e;
    }
    await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), {
      name: name.trim(), username: uname, role, hotelId: hotelId || null, phone, status: 'active',
      createdAt: serverTimestamp(), createdBy: actor(by),
    });
    await signOut(sAuth);
    if (role === 'owner' && hotelId) {
      await updateDoc(doc(db, 'hotels', hotelId), { ownerUid: cred.user.uid, ownerName: name.trim(), ownerUsername: uname, updatedAt: serverTimestamp() });
    }
    if (hotelId) await addDoc(hcol('auditLogs', hotelId), auditPayload(by, 'USER_CREATED', 'user', cred.user.uid, { name, username: uname, role }));
    return cred.user.uid;
  } finally {
    await deleteApp(secondary);
  }
}
export async function updateAccount(by, target, data) {
  await updateDoc(doc(db, 'users', target.id || target.uid), { ...data, updatedAt: serverTimestamp(), updatedBy: actor(by) });
  if (target.hotelId) await addDoc(hcol('auditLogs', target.hotelId), auditPayload(by, 'USER_UPDATED', 'user', target.id || target.uid, data));
}
/** Sets a new password for someone else (owner → employee, administrator → anyone). */
export async function resetPassword(by, target, password) {
  const pErr = passwordProblem(password); if (pErr) throw new Error(pErr);
  if (isLocalBackend) {
    const { adminSetPassword } = await import('../hosted/auth');
    await adminSetPassword(target.username, password);
  } else {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const { app } = await import('../firebase');
    try {
      await httpsCallable(getFunctions(app), 'setUserPassword')({ uid: target.id || target.uid, password });
    } catch (e) {
      if (e?.code === 'functions/not-found' || e?.code === 'functions/internal' || e?.code === 'functions/unavailable') {
        throw new Error('Password reset needs the StayBill Cloud Functions. Deploy them (see README → Email & password functions), or ask the person to change their password after signing in.');
      }
      throw e;
    }
  }
  if (target.hotelId) await addDoc(hcol('auditLogs', target.hotelId), auditPayload(by, 'PASSWORD_RESET', 'user', target.id || target.uid, { username: target.username }));
}
/** The signed-in person changes their own password. */
export async function changeOwnPassword(current, next) {
  const pErr = passwordProblem(next); if (pErr) throw new Error(pErr);
  await changePassword(current, next);
}

// ---------- Earlier single-hotel data (claude.ai / demo versions before multi-hotel) ----------
const LEGACY = ['settings', 'counters', 'taxes', 'roomTypes', 'rooms', 'guests', 'bills', 'payments', 'auditLogs', 'gallery'];
export async function legacyHotelName() {
  try {
    const [s, done] = await Promise.all([getDoc(doc(db, 'settings', 'hotel')), getDoc(doc(db, 'meta', 'legacyImported'))]);
    return s.exists() && !done.exists() ? (s.data().hotelName || 'My Hotel') : null;
  } catch { return null; }
}
/** Copies the earlier single-hotel data into a new hotel. The originals are left in place. */
export async function importLegacyHotel(admin) {
  const s = await getDoc(doc(db, 'settings', 'hotel'));
  if (!s.exists()) return null;
  const name = s.data().hotelName || 'My Hotel';
  const ref = doc(collection(db, 'hotels'));
  await setDoc(ref, { name, city: s.data().city || '', status: 'active', createdAt: serverTimestamp(), createdBy: actor(admin), importedFromEarlierVersion: true });
  for (const c of LEGACY) {
    const snap = await getDocs(collection(db, c));
    const rows = snap.docs.map((d) => [d.id, d.data()]);
    for (let i = 0; i < rows.length; i += 400) {
      const b = writeBatch(db);
      rows.slice(i, i + 400).forEach(([id, data]) => b.set(doc(db, 'hotels', ref.id, c, id), stripShadow(data)));
      await b.commit();
    }
  }
  await setDoc(doc(db, 'meta', 'legacyImported'), { hotelId: ref.id, at: serverTimestamp() });
  return ref.id;
}
function stripShadow(d) {
  // Timestamps stored by the hosted store carry a numeric "<field>__ms" twin; rebuild them on write.
  const out = {};
  Object.entries(d || {}).forEach(([k, v]) => {
    if (k.endsWith('__ms')) return;
    out[k] = v && typeof v === 'object' && typeof v.seconds === 'number' && typeof v.nanoseconds === 'number' && Object.keys(v).length === 2
      ? Timestamp.fromMillis(v.seconds * 1000 + Math.floor(v.nanoseconds / 1e6)) : v;
  });
  return out;
}

// ---------- Guest emails ----------
/**
 * Asks the email service to send a guest email for a bill. The Cloud Function
 * builds the message from the bill itself; this only names the bill and the kind.
 * kind: 'booking' (bill created) | 'paid' (fully paid, invoice PDF attached)
 */
export async function queueGuestEmail(by, bill, kind, { manual = false, extra = {} } = {}) {
  // `to` and `invoiceNumber` are for the log only: the email function reads both from the bill itself.
  const ref = await addDoc(hcol('mail'), {
    ...extra, billId: bill.id, invoiceNumber: bill.invoiceNumber || '', to: bill.guest?.email || '', kind, status: 'queued', manual,
    createdAt: serverTimestamp(), requestedBy: actor(by),
  });
  return ref.id;
}
export async function mailForBill(billId) {
  const snap = await getDocs(query(hcol('mail'), where('billId', '==', billId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}
export async function recentMail(n = 30) {
  const snap = await getDocs(query(hcol('mail'), orderBy('createdAt', 'desc'), limit(n)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
/** Queues the right automatic email after a bill is created or paid (never throws). */
export async function autoEmail(by, settings, bill, event) {
  try {
    if (settings?.emailGuests === false || !bill?.guest?.email) return null;
    if (event === 'created') {
      if (bill.paymentStatus === PAYMENT_STATUS.PAID) return settings.emailOnPaid !== false ? await queueGuestEmail(by, bill, 'paid') : null;
      return settings.emailOnCreate !== false ? await queueGuestEmail(by, bill, 'booking') : null;
    }
    if (event === 'paid' && settings.emailOnPaid !== false) return await queueGuestEmail(by, bill, 'paid');
  } catch (e) { console.warn('Could not queue guest email', e); }
  return null;
}

// ---------- Settings (PRD §45–47) ----------
export async function saveSettings(user, data, label = 'SETTINGS_UPDATED') {
  await setDoc(hdoc('settings', 'hotel'), { ...data, updatedAt: serverTimestamp(), updatedBy: actor(user) }, { merge: true });
  await logAudit(user, label, 'settings', 'hotel', Object.fromEntries(Object.entries(data).filter(([k]) => k !== 'logo')));
}
export async function getCounter() {
  const s = await getDoc(hdoc('counters', 'invoice'));
  return s.exists() ? s.data().next : null;
}
/** Saves invoice settings and moves the counter forward if start number is higher. */
export async function saveInvoiceSettings(user, data) {
  await runTransaction(db, async (tx) => {
    const cRef = hdoc('counters', 'invoice');
    const c = await tx.get(cRef);
    const next = c.exists() ? c.data().next : data.invoiceStartNumber;
    tx.set(hdoc('settings', 'hotel'), { ...data, updatedAt: serverTimestamp(), updatedBy: actor(user) }, { merge: true });
    if (!c.exists() || data.invoiceStartNumber > next) tx.set(cRef, { next: data.invoiceStartNumber });
  });
  await logAudit(user, 'INVOICE_SETTINGS_UPDATED', 'settings', 'hotel', data);
}

// ---------- Generic master-data CRUD ----------
async function createIn(coll, user, data, auditLabel) {
  const ref = await addDoc(hcol(coll), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: actor(user) });
  await logAudit(user, auditLabel, coll, ref.id, data);
  return ref.id;
}
async function updateIn(coll, user, id, data, auditLabel) {
  await updateDoc(hdoc(coll, id), { ...data, updatedAt: serverTimestamp(), updatedBy: actor(user) });
  await logAudit(user, auditLabel, coll, id, data);
}

// Taxes
export const createTax = (u, d) => createIn('taxes', u, d, 'TAX_CREATED');
export const updateTax = (u, id, d) => updateIn('taxes', u, id, d, 'TAX_UPDATED');
export async function deleteTax(u, id) {
  await deleteDoc(hdoc('taxes', id));
  await logAudit(u, 'TAX_DELETED', 'taxes', id, {});
}

// Room types
export const createRoomType = (u, d) => createIn('roomTypes', u, d, 'ROOM_TYPE_CREATED');
export const updateRoomType = (u, id, d) => updateIn('roomTypes', u, id, d, 'ROOM_TYPE_UPDATED');
export async function deleteRoomType(u, id) {
  await deleteDoc(hdoc('roomTypes', id));
  await logAudit(u, 'ROOM_TYPE_DELETED', 'roomTypes', id, {});
}

// Rooms (PRD §13)
async function roomNumberTaken(roomNumber, exceptId) {
  const snap = await getDocs(query(hcol('rooms'), where('roomNumber', '==', roomNumber)));
  return snap.docs.some((d) => d.id !== exceptId);
}
export async function createRoom(u, d) {
  if (await roomNumberTaken(d.roomNumber)) throw new Error(`Room ${d.roomNumber} already exists.`);
  return createIn('rooms', u, d, 'ROOM_CREATED');
}
export async function updateRoom(u, id, d) {
  if (d.roomNumber && (await roomNumberTaken(d.roomNumber, id))) throw new Error(`Room ${d.roomNumber} already exists.`);
  return updateIn('rooms', u, id, d, 'ROOM_UPDATED');
}
export async function deleteRoom(u, id) {
  const used = await getDocs(query(hcol('bills'), where('roomId', '==', id), limit(1)));
  if (!used.empty) throw new Error('This room is used on existing bills. Mark it Inactive instead.');
  await deleteDoc(hdoc('rooms', id));
  await logAudit(u, 'ROOM_DELETED', 'rooms', id, {});
}

// ---------- Guests (PRD §15–16) ----------
function guestFields(g) {
  return {
    name: (g.name || '').trim(),
    nameLower: (g.name || '').trim().toLowerCase(),
    phone: (g.phone || '').replace(/\s+/g, ''),
    email: (g.email || '').trim(),
    address: (g.address || '').trim(),
    gstin: (g.gstin || '').trim().toUpperCase(),
    notes: (g.notes || '').trim(),
    ...crmFields(g),
  };
}
/** Optional CRM fields: only written when the form sends them, so bills never wipe them. */
export const CRM_KEYS = ['birthday', 'anniversary', 'company', 'nationality', 'idType', 'idNumber', 'idImage', 'preferences', 'vip', 'blacklisted', 'blacklistReason', 'marketingOptOut', 'referredBy', 'tags'];
function crmFields(g) {
  const out = {};
  CRM_KEYS.forEach((k) => {
    if (g[k] === undefined) return;
    const v = g[k];
    out[k] = typeof v === 'string' ? v.trim() : v;
  });
  return out;
}
export const createGuest = (u, g) => createIn('guests', u, guestFields(g), 'GUEST_CREATED');
export const updateGuest = (u, id, g) => updateIn('guests', u, id, guestFields(g), 'GUEST_UPDATED');
export async function deleteGuest(u, id) {
  const used = await getDocs(query(hcol('bills'), where('guestId', '==', id), limit(1)));
  if (used.size) throw new Error('This guest has bills and cannot be deleted.');
  await deleteDoc(hdoc('guests', id));
  await logAudit(u, 'GUEST_DELETED', 'guests', id, {});
}
export async function getGuest(id) {
  const s = await getDoc(hdoc('guests', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export async function listGuests(max = 100) {
  const snap = await getDocs(query(hcol('guests'), orderBy('nameLower'), limit(max)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
/** Prefix search on name or phone. */
export async function searchGuests(term, max = 10) {
  const t = term.trim();
  if (!t) return listGuests(max);
  const lower = t.toLowerCase();
  const qs = [query(hcol('guests'), where('nameLower', '>=', lower), where('nameLower', '<=', lower + ''), limit(max))];
  const digits = t.replace(/\s+/g, '');
  if (/^[0-9+]+$/.test(digits)) qs.push(query(hcol('guests'), where('phone', '>=', digits), where('phone', '<=', digits + ''), limit(max)));
  const snaps = await Promise.all(qs.map(getDocs));
  const map = new Map();
  snaps.forEach((s) => s.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() })));
  return [...map.values()];
}
export async function findGuestByPhone(phone) {
  const p = (phone || '').replace(/\s+/g, '');
  if (!p) return null;
  const s = await getDocs(query(hcol('guests'), where('phone', '==', p), limit(1)));
  return s.empty ? null : { id: s.docs[0].id, ...s.docs[0].data() };
}

// ---------- Bills (PRD §17–39, §50, §52) ----------
const billsCol = () => hcol('bills');
const rowsOf = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
const byCreatedDesc = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0) || (b.invoiceSeq || 0) - (a.invoiceSeq || 0);

const SNAP_EXTRA = ['nationality', 'passportNo', 'passportExpiry', 'visaNo', 'visaType', 'visaExpiry', 'arrivedInIndia', 'arrivedFrom', 'nextDestination', 'purpose', 'idType', 'idNumber', 'state'];
function guestSnapshot(g) {
  const f = guestFields(g);
  const extra = Object.fromEntries(SNAP_EXTRA.filter((k) => g[k]).map((k) => [k, String(g[k]).trim()]));
  return { name: f.name, phone: f.phone, email: f.email, address: f.address, gstin: f.gstin, ...extra };
}

function billFields(form, computed) {
  const gs = guestSnapshot(form.guest);
  return {
    guest: gs,
    guestName: gs.name,
    guestNameLower: gs.name.toLowerCase(),
    guestPhone: gs.phone,
    roomId: form.roomId,
    roomNumber: form.roomNumber,
    roomType: form.roomType || '',
    checkIn: form.checkIn,
    checkOut: form.checkOut,
    nights: Number(form.nights),
    roomRate: round2(form.roomRate),
    roomAmount: computed.roomAmount,
    items: computed.items,
    additionalTotal: computed.additionalTotal,
    subtotal: computed.subtotal,
    discountType: computed.discountType,
    discountValue: computed.discountValue,
    discountAmount: computed.discountAmount,
    taxableAmount: computed.taxableAmount,
    taxes: computed.taxes,
    taxAmount: computed.taxAmount,
    grandTotal: computed.grandTotal,
    notes: (form.notes || '').trim(),
    ...(form.bookingId ? { bookingId: form.bookingId } : {}),
    ...(form.source ? { source: form.source } : {}),
    ...(form.groupName ? { groupName: form.groupName } : {}),
    ...(form.loyaltyRedeemed ? { loyaltyRedeemed: Number(form.loyaltyRedeemed) } : {}),
  };
}

/**
 * Creates a finalized bill atomically: assigns the next invoice number,
 * creates the guest if new, and records an optional initial payment.
 */
async function createBillCore(user, form, computed, initialPayment) {
  const pay = round2(initialPayment?.amount || 0);
  return runTransaction(db, async (tx) => {
    const settingsRef = hdoc('settings', 'hotel');
    const counterRef = hdoc('counters', 'invoice');
    const [settingsSnap, counterSnap] = await Promise.all([tx.get(settingsRef), tx.get(counterRef)]);
    const settings = settingsSnap.exists() ? settingsSnap.data() : DEFAULT_SETTINGS;
    const seq = counterSnap.exists() ? counterSnap.data().next : settings.invoiceStartNumber || 1001;
    const invoiceNumber = formatInvoiceNumber(settings.invoicePrefix, seq);

    let guestId = form.guestId;
    if (!guestId) {
      const gRef = doc(hcol('guests'));
      guestId = gRef.id;
      tx.set(gRef, { ...guestFields(form.guest), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: actor(user) });
    }

    const billRef = doc(billsCol());
    const status = statusFor(computed.grandTotal, pay);
    tx.set(billRef, {
      ...billFields(form, computed),
      guestId,
      invoiceNumber,
      invoiceSeq: seq,
      billDate: today(),
      paidAmount: pay,
      balanceAmount: round2(Math.max(computed.grandTotal - pay, 0)),
      paymentStatus: status,
      paymentMethods: pay > 0 ? [initialPayment.method] : [],
      createdBy: actor(user),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    tx.set(counterRef, { next: seq + 1 });

    if (pay > 0) {
      const pRef = doc(hcol('payments'));
      tx.set(pRef, paymentDoc(user, { id: billRef.id, invoiceNumber, guestName: form.guest.name, guestId, roomNumber: form.roomNumber }, initialPayment, pay));
    }
    tx.set(doc(hcol('auditLogs')), auditPayload(user, 'BILL_CREATED', 'bills', billRef.id, { invoiceNumber, grandTotal: computed.grandTotal, initialPayment: pay }));
    return { id: billRef.id, invoiceNumber, invoiceSeq: seq };
  });
}

/** Edits an existing bill; invoice number and payments are preserved. */
/** Bills on a closed day (night audit) can only be changed by the owner or administrator. */
async function assertDayOpen(tx, bill, user) {
  if (user?.role === 'owner' || user?.role === 'admin') return;
  const st = await tx.get(hdoc('settings', 'hotel'));
  const closed = st.exists() ? st.data().closedThrough : '';
  if (closed && bill.billDate <= closed) throw new Error(`This bill is from a closed day (night audit up to ${closed}). Ask the owner to change it.`);
}
export async function updateBill(user, billId, form, computed) {
  return runTransaction(db, async (tx) => {
    const ref = hdoc('bills', billId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Bill not found.');
    const old = snap.data();
    await assertDayOpen(tx, old, user);
    if (old.paymentStatus === PAYMENT_STATUS.CANCELLED) throw new Error('Cancelled bills cannot be edited.');
    if (old.paymentStatus === PAYMENT_STATUS.PAID) throw new Error('Settled bills are locked. Cancel and re-issue if a correction is needed.');
    if (computed.grandTotal + 0.001 < old.paidAmount)
      throw new Error(`New total cannot be less than the amount already paid (${old.paidAmount}).`);
    let guestId = form.guestId;
    if (!guestId) {
      const gRef = doc(hcol('guests'));
      guestId = gRef.id;
      tx.set(gRef, { ...guestFields(form.guest), createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: actor(user) });
    }
    tx.update(ref, {
      ...billFields(form, computed),
      guestId,
      balanceAmount: round2(Math.max(computed.grandTotal - old.paidAmount, 0)),
      paymentStatus: statusFor(computed.grandTotal, old.paidAmount),
      updatedAt: serverTimestamp(),
      updatedBy: actor(user),
    });
    tx.set(doc(hcol('auditLogs')), auditPayload(user, 'BILL_EDITED', 'bills', billId, {
      invoiceNumber: old.invoiceNumber, previousTotal: old.grandTotal, newTotal: computed.grandTotal,
    }));
  });
}

export async function cancelBill(user, billId, reason) {
  await runTransaction(db, async (tx) => {
    const ref = hdoc('bills', billId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Bill not found.');
    const b = snap.data();
    await assertDayOpen(tx, b, user);
    if (b.paymentStatus === PAYMENT_STATUS.CANCELLED) throw new Error('Bill is already cancelled.');
    tx.update(ref, {
      paymentStatus: PAYMENT_STATUS.CANCELLED,
      statusBeforeCancel: b.paymentStatus,
      cancelReason: reason,
      cancelledBy: actor(user),
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actor(user),
    });
    tx.set(doc(hcol('auditLogs')), auditPayload(user, 'BILL_CANCELLED', 'bills', billId, { invoiceNumber: b.invoiceNumber, reason, grandTotal: b.grandTotal, paidAmount: b.paidAmount }));
  });
}

export async function getBill(id) {
  const s = await getDoc(hdoc('bills', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export async function billsInRange(from, to) {
  const snap = await getDocs(query(billsCol(), where('billDate', '>=', from), where('billDate', '<=', to), orderBy('billDate', 'desc')));
  return rowsOf(snap).sort(byCreatedDesc);
}
export async function recentBills(n = 8) {
  return rowsOf(await getDocs(query(billsCol(), orderBy('createdAt', 'desc'), limit(n))));
}
export async function guestBills(guestId) {
  return rowsOf(await getDocs(query(billsCol(), where('guestId', '==', guestId)))).sort(byCreatedDesc);
}
export async function outstandingBills() {
  const snap = await getDocs(query(billsCol(), where('paymentStatus', 'in', [PAYMENT_STATUS.PENDING, PAYMENT_STATUS.PARTIALLY_PAID])));
  return rowsOf(snap).sort(byCreatedDesc);
}
/** PRD §37: search by invoice number, guest name, phone or room number. */
export async function searchBills(term) {
  const t = term.trim();
  if (!t) return [];
  const lower = t.toLowerCase();
  const digits = t.replace(/\s+/g, '');
  const qs = [
    query(billsCol(), where('invoiceNumber', '==', t.toUpperCase())),
    query(billsCol(), where('invoiceNumber', '==', t)),
    query(billsCol(), where('roomNumber', '==', t)),
    query(billsCol(), where('guestNameLower', '>=', lower), where('guestNameLower', '<=', lower + ''), limit(50)),
  ];
  if (/^[0-9+]+$/.test(digits)) {
    qs.push(query(billsCol(), where('guestPhone', '>=', digits), where('guestPhone', '<=', digits + ''), limit(50)));
    qs.push(query(billsCol(), where('invoiceSeq', '==', Number(digits))));
  }
  const snaps = await Promise.all(qs.map(getDocs));
  const map = new Map();
  snaps.forEach((s) => s.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() })));
  return [...map.values()].sort(byCreatedDesc);
}

// ---------- Payments (PRD §27–32, §40–41) ----------
function paymentDoc(user, bill, p, amount) {
  return {
    billId: bill.id,
    invoiceNumber: bill.invoiceNumber,
    guestId: bill.guestId || null,
    guestName: bill.guestName,
    roomNumber: bill.roomNumber || '',
    amount,
    method: p.method,
    referenceNumber: (p.referenceNumber || '').trim(),
    notes: (p.notes || '').trim(),
    date: today(),
    receivedBy: actor(user),
    createdAt: serverTimestamp(),
  };
}

async function recordPaymentCore(user, billId, p) {
  const amount = round2(p.amount);
  if (!(amount > 0)) throw new Error('Enter a payment amount greater than zero.');
  return runTransaction(db, async (tx) => {
    const ref = hdoc('bills', billId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Bill not found.');
    const b = { id: snap.id, ...snap.data() };
    if (b.paymentStatus === PAYMENT_STATUS.CANCELLED) throw new Error('Cannot record payment on a cancelled bill.');
    if (amount > b.balanceAmount + 0.001) throw new Error(`Payment cannot exceed the outstanding balance (${b.balanceAmount}).`);
    const paid = round2(b.paidAmount + amount);
    tx.update(ref, {
      paidAmount: paid,
      balanceAmount: round2(Math.max(b.grandTotal - paid, 0)),
      paymentStatus: statusFor(b.grandTotal, paid),
      paymentMethods: arrayUnion(p.method),
      lastPaymentAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: actor(user),
    });
    const pRef = doc(hcol('payments'));
    tx.set(pRef, paymentDoc(user, b, p, amount));
    tx.set(doc(hcol('auditLogs')), auditPayload(user, 'PAYMENT_RECORDED', 'bills', billId, { invoiceNumber: b.invoiceNumber, amount, method: p.method }));
    return pRef.id;
  });
}
export async function paymentsForBill(billId) {
  const snap = await getDocs(query(hcol('payments'), where('billId', '==', billId)));
  return rowsOf(snap).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
}
export async function paymentsInRange(from, to) {
  const snap = await getDocs(query(hcol('payments'), where('date', '>=', from), where('date', '<=', to), orderBy('date', 'desc')));
  return rowsOf(snap).sort(byCreatedDesc);
}

// Bill creation and payments also queue the guest email (bill created / fully paid).
async function hotelSettings() {
  const s = await getDoc(hdoc('settings', 'hotel'));
  return s.exists() ? { ...DEFAULT_SETTINGS, ...s.data() } : DEFAULT_SETTINGS;
}
export async function createBill(user, form, computed, initialPayment) {
  const res = await createBillCore(user, form, computed, initialPayment);
  try {
    const [bill, settings] = await Promise.all([getBill(res.id), hotelSettings()]);
    res.emailQueued = !!(await autoEmail(user, settings, bill, 'created'));
    if (bill.paymentStatus === PAYMENT_STATUS.PAID) await (await import('../modules/billOps')).earnPoints(user, bill, settings);
  } catch { /* the bill is saved; email is best-effort */ }
  return res;
}
export async function recordPayment(user, billId, p) {
  const id = await recordPaymentCore(user, billId, p);
  try {
    const bill = await getBill(billId);
    if (bill?.paymentStatus === PAYMENT_STATUS.PAID) {
      const settings = await hotelSettings();
      await autoEmail(user, settings, bill, 'paid');
      await (await import('../modules/billOps')).earnPoints(user, bill, settings);
    }
  } catch { /* payment is saved; email is best-effort */ }
  return id;
}

// ---------- Backup & restore (PRD §61) ----------
export const BACKUP_COLLECTIONS = ['settings', 'counters', 'users', 'taxes', 'roomTypes', 'rooms', 'guests', 'bills', 'payments', 'auditLogs'];
const RESTORE_SKIP = new Set(['auditLogs', 'users']); // audit trail is append-only; logins are managed separately

function encode(v) {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(encode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)]));
  return v;
}
function decode(v) {
  if (v && typeof v === 'object' && !Array.isArray(v) && '__ts' in v) return Timestamp.fromMillis(v.__ts);
  if (Array.isArray(v)) return v.map(decode);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x)]));
  return v;
}
export async function exportBackup(user) {
  const out = { app: 'StayBill', version: 1, exportedAt: new Date().toISOString(), collections: {} };
  for (const c of BACKUP_COLLECTIONS) {
    const snap = await getDocs(c === 'users' ? query(collection(db, 'users'), where('hotelId', '==', getHotelId())) : hcol(c));
    out.collections[c] = Object.fromEntries(snap.docs.map((d) => [d.id, encode(d.data())]));
  }
  await logAudit(user, 'BACKUP_EXPORTED', 'system', null, Object.fromEntries(Object.entries(out.collections).map(([k, v]) => [k, Object.keys(v).length])));
  return out;
}
export async function restoreBackup(user, data) {
  if (data?.app !== 'StayBill' || !data.collections) throw new Error('This is not a StayBill backup file.');
  const counts = {};
  for (const [c, docs] of Object.entries(data.collections)) {
    if (!BACKUP_COLLECTIONS.includes(c) || RESTORE_SKIP.has(c)) continue;
    const entries = Object.entries(docs);
    counts[c] = entries.length;
    for (let i = 0; i < entries.length; i += 400) {
      const b = writeBatch(db);
      entries.slice(i, i + 400).forEach(([id, d]) => b.set(hdoc(c, id), decode(d)));
      await b.commit();
    }
  }
  await logAudit(user, 'BACKUP_RESTORED', 'system', null, counts);
  return counts;
}

export { computeBill };

// ---------- Welcome page gallery ----------
export async function listGallery() {
  const snap = await getDocs(hcol('gallery'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
export async function addGalleryPhoto(user, { image, caption, order }) {
  const ref = await addDoc(hcol('gallery'), { image, caption: (caption || '').trim(), order, createdAt: serverTimestamp(), createdBy: actor(user) });
  await logAudit(user, 'GALLERY_PHOTO_ADDED', 'gallery', ref.id, { caption });
  return ref.id;
}
export async function updateGalleryCaption(user, id, caption) {
  await updateDoc(hdoc('gallery', id), { caption: (caption || '').trim(), updatedAt: serverTimestamp() });
}
export async function deleteGalleryPhoto(user, id) {
  await deleteDoc(hdoc('gallery', id));
  await logAudit(user, 'GALLERY_PHOTO_DELETED', 'gallery', id, {});
}
