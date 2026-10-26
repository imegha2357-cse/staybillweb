// Operations on bills used by several modules: charge to room (restaurant,
// minibar), check-out (housekeeping task, room status, booking, thank-you),
// and loyalty points.
import { addDoc, doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, increment } from '../backend/firestore';
import { db } from '../firebase';
import { getHotelId, hcol, hdoc } from '../lib/scope';
import { actor, auditPayload, queueGuestEmail } from '../lib/db';
import { computeBill, round2, statusFor, PAYMENT_STATUS } from '../lib/billing';
import { today } from '../lib/dates';

/**
 * Adds lines to a guest's bill (e.g. a restaurant order or minibar items).
 * lines: [{ description, quantity, rate }] (rates before the bill's taxes).
 */
export async function chargeToBill(user, billId, lines, { source = 'charge', ref = '' } = {}) {
  return runTransaction(db, async (tx) => {
    const r = hdoc('bills', billId);
    const s = await tx.get(r);
    if (!s.exists()) throw new Error('That bill no longer exists.');
    const b = s.data();
    if (b.paymentStatus === PAYMENT_STATUS.CANCELLED) throw new Error('That bill is cancelled.');
    if (b.paymentStatus === PAYMENT_STATUS.PAID) throw new Error(`${b.invoiceNumber} is already settled. Take payment for this order separately.`);
    if (b.checkedOutAt) throw new Error(`Room ${b.roomNumber} has checked out. Take payment for this order separately.`);
    const items = [...(b.items || []), ...lines.map((l) => ({ description: l.description, quantity: Number(l.quantity) || 1, rate: round2(l.rate) }))];
    const c = computeBill({
      nights: b.nights, roomRate: b.roomRate, items,
      discountType: b.discountType || 'none', discountValue: b.discountValue || 0,
      taxes: (b.taxes || []).map((t) => ({ id: t.id, name: t.name, rate: t.rate })), paidAmount: b.paidAmount,
    });
    tx.update(r, {
      items: c.items, additionalTotal: c.additionalTotal, subtotal: c.subtotal, discountAmount: c.discountAmount,
      taxableAmount: c.taxableAmount, taxes: c.taxes, taxAmount: c.taxAmount, grandTotal: c.grandTotal,
      balanceAmount: round2(Math.max(c.grandTotal - b.paidAmount, 0)), paymentStatus: statusFor(c.grandTotal, b.paidAmount),
      updatedAt: serverTimestamp(), updatedBy: actor(user),
    });
    tx.set(doc(hcol('auditLogs')), auditPayload(user, 'CHARGED_TO_ROOM', 'bills', billId, {
      invoiceNumber: b.invoiceNumber, source, ref, amount: round2(lines.reduce((a, l) => a + (Number(l.quantity) || 1) * Number(l.rate || 0), 0)),
    }));
    return { invoiceNumber: b.invoiceNumber, roomNumber: b.roomNumber };
  });
}

/**
 * Checks a guest out: stamps the bill, marks the room dirty, opens a
 * housekeeping task, closes the booking, and (optionally) emails a thank-you
 * with the feedback link.
 */
export async function checkOutBill(user, bill, { rooms = [], settings = {} } = {}) {
  const feedbackToken = bill.feedbackToken || token();
  const thank = settings.emailThankYou !== false && !!bill.guest?.email;
  await updateDoc(hdoc('bills', bill.id), { checkedOutAt: serverTimestamp(), checkedOutBy: actor(user), checkedOutOn: today(), feedbackToken, ...(thank ? { thankYouQueued: true } : {}) });
  // A small public card the guest's feedback link reads (no other bill data is exposed).
  await setDoc(doc(db, 'publicFeedback', `${getHotelId()}_${bill.id}`), {
    hotelId: getHotelId(), billId: bill.id, token: feedbackToken, guestId: bill.guestId || null, firstName: String(bill.guestName || '').split(' ')[0],
    guestName: bill.guestName || '', roomNumber: bill.roomNumber || '', invoiceNumber: bill.invoiceNumber || '', hotelName: settings.hotelName || '', reviewUrl: settings.reviewUrl || '', done: false, createdAt: serverTimestamp(),
  }).catch(() => {});
  const room = rooms.find((r) => r.roomNumber === bill.roomNumber);
  if (room) await updateDoc(hdoc('rooms', room.id), { hkStatus: 'dirty', hkUpdatedAt: serverTimestamp(), hkUpdatedBy: actor(user) }).catch(() => {});
  await addDoc(hcol('hkTasks'), {
    roomNumber: bill.roomNumber, type: 'Check-out clean', status: 'Open', priority: 'High', date: today(),
    checklist: DEFAULT_CHECKLIST.map((t) => ({ text: t, done: false })), billId: bill.id, notes: `After ${bill.guestName}`,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: actor(user),
  }).catch(() => {});
  if (bill.bookingId) await updateDoc(hdoc('bookings', bill.bookingId), { status: 'Checked out', updatedAt: serverTimestamp() }).catch(() => {});
  await addDoc(hcol('auditLogs'), auditPayload(user, 'GUEST_CHECKED_OUT', 'bills', bill.id, { invoiceNumber: bill.invoiceNumber, roomNumber: bill.roomNumber })).catch(() => {});
  {
    const wa = await import('../lib/whatsapp');
    const { feedbackUrl: fb } = await import('./guests/publicLinks');
    await wa.autoWhatsApp(user, settings, { kind: 'thankyou', phone: bill.guest?.phone, vars: wa.billVars(bill, settings, { feedback: fb(getHotelId(), { ...bill, feedbackToken }) }), billId: bill.id, guestName: bill.guestName });
  }
  if (thank) {
    const { feedbackUrl } = await import('./guests/publicLinks');
    await queueGuestEmail(user, bill, 'thankyou', { extra: { feedbackUrl: feedbackUrl(getHotelId(), { ...bill, feedbackToken }) } }).catch(() => {});
  }
}
export const DEFAULT_CHECKLIST = ['Strip and change bed linen', 'Clean bathroom and replace towels', 'Restock toiletries', 'Check and restock minibar', 'Dust and vacuum', 'Check AC, TV, lights and remote', 'Empty bins', 'Report damage or lost items'];
export function token() {
  const a = new Uint8Array(12); crypto.getRandomValues(a);
  return [...a].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---------- Loyalty ----------
export const LOYALTY_DEFAULTS = {
  enabled: true, earnPer: 100, earnPoints: 1, redeemValue: 1, minRedeem: 50, referralBonus: 100,
  tiers: [{ name: 'Silver', min: 0 }, { name: 'Gold', min: 25000 }, { name: 'Platinum', min: 75000 }],
};
export const loyaltyOf = (settings) => ({ ...LOYALTY_DEFAULTS, ...(settings?.loyalty || {}) });
export function tierFor(lifetime, settings) {
  const tiers = [...loyaltyOf(settings).tiers].sort((a, b) => b.min - a.min);
  return tiers.find((t) => (lifetime || 0) >= t.min)?.name || tiers[tiers.length - 1]?.name || '';
}
export function pointsFor(amount, settings) {
  const L = loyaltyOf(settings);
  return L.enabled ? Math.floor((Number(amount) || 0) / (Number(L.earnPer) || 100)) * (Number(L.earnPoints) || 1) : 0;
}
/** Adds points for a fully paid bill (once per bill). */
export async function earnPoints(user, bill, settings) {
  if (!bill?.guestId || bill.loyaltyEarned || !loyaltyOf(settings).enabled) return 0;
  const pts = pointsFor(bill.grandTotal, settings);
  await updateDoc(hdoc('bills', bill.id), { loyaltyEarned: pts }).catch(() => {});
  await updateDoc(hdoc('guests', bill.guestId), { points: increment(pts), lifetimeSpend: increment(round2(bill.grandTotal)), stays: increment(1), lastStay: bill.checkIn, updatedAt: serverTimestamp() }).catch(() => {});
  if (pts) await addDoc(hcol('loyaltyTx'), { guestId: bill.guestId, guestName: bill.guestName, type: 'earn', points: pts, billId: bill.id, invoiceNumber: bill.invoiceNumber, date: today(), createdAt: serverTimestamp(), createdBy: actor(user) }).catch(() => {});
  return pts;
}
export async function redeemPoints(user, guestId, guestName, points, billRef) {
  if (!(points > 0)) return;
  await updateDoc(hdoc('guests', guestId), { points: increment(-points), updatedAt: serverTimestamp() });
  await addDoc(hcol('loyaltyTx'), { guestId, guestName, type: 'redeem', points: -points, ...billRef, date: today(), createdAt: serverTimestamp(), createdBy: actor(user) });
}
export async function adjustPoints(user, guest, points, note) {
  await updateDoc(hdoc('guests', guest.id), { points: increment(points), updatedAt: serverTimestamp() });
  await addDoc(hcol('loyaltyTx'), { guestId: guest.id, guestName: guest.name, type: points >= 0 ? 'bonus' : 'adjust', points, note, date: today(), createdAt: serverTimestamp(), createdBy: actor(user) });
}
export async function getGuest(id) {
  const s = await getDoc(hdoc('guests', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
