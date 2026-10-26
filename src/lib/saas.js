// Subscriptions for running StayBill as a service: plans (which modules a hotel
// gets), each hotel's plan and status, payments that extend the paid period,
// sign-up requests from new hotels, and automatic pausing of overdue hotels.
import { addDoc, collection, doc, getDocs, runTransaction, serverTimestamp, setDoc, updateDoc } from '../backend/firestore';
import { db } from '../firebase';
import { actor } from './db';
import { addDays, today } from './dates';

export const DEFAULT_PLANS = [
  { id: 'starter', name: 'Starter', monthly: 999, yearly: 9990, maxRooms: 15, trialDays: 14, order: 1, modules: ['bookings', 'roomboard', 'housekeeping', 'feedback', 'website'], blurb: 'Billing, bookings and housekeeping for small lodges.' },
  { id: 'pro', name: 'Professional', monthly: 2499, yearly: 24990, maxRooms: 50, trialDays: 14, order: 2, modules: ['bookings', 'roomboard', 'nightaudit', 'channels', 'website', 'pos', 'kitchen', 'menu', 'housekeeping', 'maintenance', 'lostfound', 'inventory', 'purchases', 'suppliers', 'attendance', 'shifts', 'feedback', 'loyalty', 'expenses', 'creditnotes'], blurb: 'Restaurant, stock and staff for busy hotels.' },
  { id: 'enterprise', name: 'Enterprise', monthly: 4999, yearly: 49990, maxRooms: 0, trialDays: 30, order: 3, modules: null, blurb: 'Everything: payroll, accounts, GST, campaigns and analytics.' },
];

export async function listPlans() {
  const snap = await getDocs(collection(db, 'plans'));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return rows.length ? rows.sort((a, b) => (a.order ?? 9) - (b.order ?? 9)) : null;
}
export async function seedPlans(user) {
  await Promise.all(DEFAULT_PLANS.map(({ id, ...p }) => setDoc(doc(db, 'plans', id), { ...p, active: true, createdAt: serverTimestamp(), createdBy: actor(user) })));
}
export async function savePlan(user, id, data) {
  const ref = id ? doc(db, 'plans', id) : doc(collection(db, 'plans'));
  await setDoc(ref, { ...data, updatedAt: serverTimestamp(), updatedBy: actor(user) }, { merge: true });
  return ref.id;
}

/** Where a hotel stands today: trial, active, past_due (in grace) or paused. */
export function subState(h, graceDays = 7, t = today()) {
  if (!h.planId) return { status: 'none', label: 'No plan', due: null };
  const until = h.subStatus === 'trial' ? h.trialEndsOn : h.paidUntil;
  if (h.subStatus === 'paused') return { status: 'paused', label: 'Paused', due: until };
  if (!until || until >= t) return { status: h.subStatus === 'trial' ? 'trial' : 'active', label: h.subStatus === 'trial' ? 'Trial' : 'Active', due: until };
  if (addDays(until, graceDays) >= t) return { status: 'past_due', label: 'Overdue', due: until };
  return { status: 'expired', label: 'Expired', due: until };
}

export async function assignPlan(user, hotel, plan, { cycle = 'monthly', trial = true } = {}) {
  const patch = {
    planId: plan.id, planName: plan.name, planModules: plan.modules || null, maxRooms: plan.maxRooms || 0, billingCycle: cycle,
    price: cycle === 'yearly' ? plan.yearly : plan.monthly,
    ...(trial ? { subStatus: 'trial', trialEndsOn: addDays(today(), plan.trialDays || 14) } : { subStatus: hotel.subStatus === 'paused' ? 'paused' : (hotel.subStatus || 'active') }),
    updatedAt: serverTimestamp(), updatedBy: actor(user),
  };
  await updateDoc(doc(db, 'hotels', hotel.id), patch);
}

/** Records a subscription payment and moves the paid-until date forward. */
export async function recordSubPayment(user, hotel, { amount, months, method, ref, date }) {
  // A payment made before the current period ends extends it; a late one starts today.
  const covered = hotel.subStatus === 'trial' ? hotel.trialEndsOn : hotel.paidUntil;
  const from = covered && covered > today() ? covered : today();
  const d = new Date(`${from}T00:00:00`); d.setMonth(d.getMonth() + Number(months || 1));
  const to = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const number = await runTransaction(db, async (tx) => {
    const c = doc(db, 'meta', 'subCounter');
    const s = await tx.get(c);
    const n = s.exists() ? s.data().next : 1;
    tx.set(c, { next: n + 1 });
    return `SUB-${String(n).padStart(4, '0')}`;
  });
  await addDoc(collection(db, 'subscriptionPayments'), {
    number, hotelId: hotel.id, hotelName: hotel.name, planName: hotel.planName || '', amount: Number(amount) || 0, months: Number(months) || 1,
    from, to, method, ref: (ref || '').trim(), date: date || today(), createdAt: serverTimestamp(), createdBy: actor(user),
  });
  await updateDoc(doc(db, 'hotels', hotel.id), { subStatus: 'active', paidUntil: to, status: hotel.pausedForBilling ? 'active' : (hotel.status || 'active'), pausedForBilling: false, updatedAt: serverTimestamp() });
  return { number, from, to };
}

/** Pauses hotels whose payment is overdue beyond the grace period. Returns the names paused. */
export async function pauseOverdue(user, hotels, graceDays = 7) {
  const late = hotels.filter((h) => subState(h, graceDays).status === 'expired' && h.status !== 'suspended');
  await Promise.all(late.map((h) => updateDoc(doc(db, 'hotels', h.id), { subStatus: 'paused', status: 'suspended', pausedForBilling: true, pausedOn: today(), updatedAt: serverTimestamp(), updatedBy: actor(user) })));
  return late.map((h) => h.name);
}

export async function listSubPayments() {
  const snap = await getDocs(collection(db, 'subscriptionPayments'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.number < b.number ? 1 : -1));
}
export async function listSignups() {
  const snap = await getDocs(collection(db, 'signupRequests'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.date < b.date ? 1 : -1));
}
export async function sendSignup(data) {
  return addDoc(collection(db, 'signupRequests'), { ...data, status: 'New', date: today(), createdAt: serverTimestamp() });
}
export const closeSignup = (user, id, status, extra = {}) => updateDoc(doc(db, 'signupRequests', id), { status, ...extra, handledBy: actor(user), handledAt: serverTimestamp() });
