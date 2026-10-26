// WhatsApp messages to guests.
// Two ways to send, chosen in Settings → WhatsApp:
//  - "link": opens WhatsApp (app or web) with the message typed in; staff press send. Free, works now.
//  - "api":  queues the message at hotels/{hotelId}/whatsapp; the sendWhatsApp Cloud Function sends it
//            through the WhatsApp Business Cloud API (Meta account + approved templates needed).
// Every message is logged, so the bill shows what was sent.
import { addDoc, getDocs, limit, orderBy, query, serverTimestamp, where } from '../backend/firestore';
import { hcol } from './scope';
import { actor } from './db';
import { money } from './format';

export const WA_KINDS = [
  { id: 'booking', label: 'Bill created', auto: true, when: 'When a bill is created at check-in',
    text: 'Hello {first}, welcome to {hotel}! 🏨\nRoom {room} · {checkin} to {checkout} ({nights} night{s}).\nBill {invoice}: total {total}, paid {paid}, due {due}.\nNeed anything? Call {phone}.' },
  { id: 'paid', label: 'Paid in full', auto: true, when: 'When the bill is fully paid',
    text: 'Thank you {first}! We have received {total} for bill {invoice}. Your stay is fully paid. 🙏\n— {hotel}' },
  { id: 'reminder', label: 'Payment reminder', auto: false, when: 'Sent from the bill when money is still due',
    text: 'Hello {first}, a gentle reminder from {hotel}: {due} is still due on bill {invoice} (room {room}). You can pay by UPI, card or cash at the desk. Thank you!' },
  { id: 'reservation', label: 'Booking confirmed', auto: true, when: 'When a booking is confirmed',
    text: 'Hello {first}, your booking {invoice} at {hotel} is confirmed ✅\n{roomType} · {checkin} to {checkout} ({nights} night{s}).\nSee you soon! Call {phone} for directions or changes.' },
  { id: 'thankyou', label: 'After check-out', auto: true, when: 'When the guest checks out',
    text: 'Thank you for staying at {hotel}, {first}! 😊 How was your stay? Tell us in 30 seconds: {feedback}' },
];
export const waKind = (id) => WA_KINDS.find((k) => k.id === id);
export const waSettings = (settings = {}) => {
  const w = settings.whatsapp || {};
  return { mode: w.mode || 'link', auto: { booking: true, paid: true, reservation: true, thankyou: true, ...(w.auto || {}) }, templates: w.templates || {}, api: w.api || {} };
};

const digits = (p) => String(p || '').replace(/\D/g, '');
/** Indian 10-digit numbers get +91; anything else is used as typed (with country code). */
export const waNumber = (phone) => { const d = digits(phone); return d.length === 10 ? `91${d}` : d.replace(/^0+/, ''); };
export const validWaNumber = (phone) => waNumber(phone).length >= 11 && waNumber(phone).length <= 15;
export const waUrl = (phone, text) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text || '')}`;

const dmy = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
/** Fields for a bill. */
export function billVars(bill, settings = {}, extra = {}) {
  return {
    first: String(bill.guestName || 'Guest').split(' ')[0], name: bill.guestName || '', hotel: settings.hotelName || 'our hotel', phone: settings.phone || 'the front desk',
    invoice: bill.invoiceNumber || '', room: bill.roomNumber || '', roomType: bill.roomType || '', checkin: dmy(bill.checkIn), checkout: dmy(bill.checkOut),
    nights: bill.nights || 1, s: Number(bill.nights) === 1 ? '' : 's',
    total: money(bill.grandTotal || 0), paid: money(bill.paidAmount || 0), due: money(bill.balanceAmount || 0), ...extra,
  };
}
/** Fields for a booking (before check-in). */
export function bookingVars(b, settings = {}) {
  const nights = Math.max(1, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 864e5) || 1);
  return {
    first: String(b.guestName || 'Guest').split(' ')[0], name: b.guestName || '', hotel: settings.hotelName || 'our hotel', phone: settings.phone || 'the front desk',
    invoice: b.number || '', room: b.roomNumber || '', roomType: `${b.roomType || 'Room'}${Number(b.rooms) > 1 ? ` × ${b.rooms}` : ''}`,
    checkin: dmy(b.checkIn), checkout: dmy(b.checkOut), nights, s: nights === 1 ? '' : 's', total: money(nights * Number(b.rate || 0) * Math.max(1, Number(b.rooms) || 1)), paid: money(b.advance || 0), due: '',
  };
}
export const fillWa = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : ''));
export const waText = (settings, kind, vars) => fillWa(waSettings(settings).templates[kind] || waKind(kind)?.text || '', vars);

/**
 * Sends one message. In "link" mode this opens WhatsApp — call it straight from a click,
 * before any await, or the browser may block the new tab.
 */
export function sendWhatsApp(user, settings, { phone, kind, vars, billId = null, bookingId = null, guestName = '', manual = true }) {
  const w = waSettings(settings);
  if (!validWaNumber(phone)) throw new Error('This guest has no valid mobile number. Add it with the country code if it is not an Indian number.');
  const body = waText(settings, kind, vars);
  if (w.mode !== 'api') window.open(waUrl(phone, body), '_blank', 'noopener');
  return addDoc(hcol('whatsapp'), {
    to: waNumber(phone), kind, body, vars, billId, bookingId, guestName, manual, mode: w.mode,
    status: w.mode === 'api' ? 'queued' : 'opened', createdAt: serverTimestamp(), requestedBy: actor(user),
  }).catch((e) => { console.warn('WhatsApp log failed', e); });
}

/** Automatic messages (Business API mode only — the free mode always needs a click). Never throws. */
export async function autoWhatsApp(user, settings, { kind, phone, vars, billId = null, bookingId = null, guestName = '' }) {
  try {
    const w = waSettings(settings);
    if (w.mode !== 'api' || !w.auto[kind] || !validWaNumber(phone)) return null;
    return await sendWhatsApp(user, settings, { phone, kind, vars, billId, bookingId, guestName, manual: false });
  } catch (e) { console.warn('Could not queue WhatsApp', e); return null; }
}

export async function waForBill(billId) {
  const s = await getDocs(query(hcol('whatsapp'), where('billId', '==', billId)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}
export async function recentWhatsApp(n = 40) {
  const s = await getDocs(query(hcol('whatsapp'), orderBy('createdAt', 'desc'), limit(n)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
