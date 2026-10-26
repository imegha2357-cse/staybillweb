// Pure helpers for the StayBill email function (no Firebase here, so they can be tested).
const SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SGD: 'S$', LKR: 'Rs ', NPR: 'Rs ' };
const money = (n, cur = 'INR', { pdf = false } = {}) => {
  const sym = pdf && cur === 'INR' ? 'Rs. ' : (SYMBOLS[cur] || `${cur} `);
  const v = Number(n || 0);
  return sym + v.toLocaleString(cur === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (iso) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const BILL_KINDS = ['booking', 'paid', 'thankyou'];
const DIRECT_KINDS = ['campaign', 'auto'];
const KINDS = [...BILL_KINDS, 'reservation', ...DIRECT_KINDS];

/**
 * Decides whether a queued email should go out.
 * bill-based kinds read the address from the bill; "reservation" from the
 * booking; campaign / automatic messages carry their own address and are
 * skipped for guests who opted out of marketing.
 * Returns { send: true, to } or { send: false, reason }.
 */
function decide({ mail, bill, booking, guest, settings = {}, hotel = {} }) {
  if (!mail || mail.status !== 'queued') return { send: false, reason: 'already handled' };
  if (!KINDS.includes(mail.kind)) return { send: false, reason: 'unknown email type' };
  if (hotel.status === 'suspended' || hotel.subStatus === 'paused') return { send: false, reason: 'hotel paused' };
  if (!mail.manual && settings.emailGuests === false) return { send: false, reason: 'turned off' };
  let to = '';
  if (BILL_KINDS.includes(mail.kind)) {
    if (!bill) return { send: false, reason: 'bill not found' };
    if (!mail.manual && mail.kind === 'booking' && settings.emailOnCreate === false) return { send: false, reason: 'turned off' };
    if (!mail.manual && mail.kind === 'paid' && settings.emailOnPaid === false) return { send: false, reason: 'turned off' };
    if (bill.paymentStatus === 'CANCELLED') return { send: false, reason: 'bill cancelled' };
    if (mail.kind === 'paid' && bill.paymentStatus !== 'PAID') return { send: false, reason: 'not fully paid' };
    to = String(bill.guest?.email || '').trim();
  } else if (mail.kind === 'reservation') {
    if (!booking) return { send: false, reason: 'booking not found' };
    if (['Cancelled', 'No-show'].includes(booking.status)) return { send: false, reason: 'booking cancelled' };
    to = String(booking.email || '').trim();
  } else {
    if (guest && (guest.marketingOptOut || guest.blacklisted)) return { send: false, reason: 'guest opted out' };
    if (!mail.subject || !mail.body) return { send: false, reason: 'empty message' };
    to = String(mail.to || '').trim();
  }
  if (!EMAIL_RE.test(to)) return { send: false, reason: 'no guest email' };
  return { send: true, to };
}

const ACCENT = '#0F5E66';
function shell(settings, label, inner, footerExtra = '') {
  const hotel = settings.hotelName || 'Our hotel';
  return `<!doctype html><html><body style="margin:0;background:#f5fafa;font-family:Arial,Helvetica,sans-serif;color:#0b1c30">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5fafa;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:${ACCENT};padding:22px 28px;color:#ffffff"><div style="font-size:20px;font-weight:bold">${esc(hotel)}</div>
<div style="font-size:13px;opacity:.85">${esc([settings.address, settings.city].filter(Boolean).join(', '))}</div></td></tr>
<tr><td style="padding:24px 28px">${label ? `<p style="margin:0 0 10px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#F2785C;font-weight:bold">${esc(label)}</p>` : ''}${inner}</td></tr>
<tr><td style="padding:14px 28px;background:#f0f5f5;font-size:11px;color:#7a8a8e">${esc(hotel)}${settings.phone ? ` · ${esc(settings.phone)}` : ''} · Sent by StayBill${footerExtra}</td></tr>
</table></td></tr></table></body></html>`;
}
/** Plain text → safe HTML paragraphs with clickable links. */
function textToHtml(t) {
  return esc(t).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">${p.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:${ACCENT}">$1</a>')}</p>`).join('');
}
const button = (href, label) => `<p style="margin:18px 0"><a href="${esc(href)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">${esc(label)}</a></p>`;

/** Reservation confirmation for a booking (before check-in). */
function buildReservationEmail(b, settings = {}) {
  const cur = settings.currency || 'INR';
  const hotel = settings.hotelName || 'Our hotel';
  const first = String(b.guestName || 'Guest').split(' ')[0];
  const nights = Math.max(1, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 864e5) || 1);
  const rooms = Math.max(1, Number(b.rooms) || 1);
  const total = nights * rooms * Number(b.rate || 0);
  const subject = `Reservation confirmed: ${b.number || ''} at ${hotel}`.replace('  ', ' ');
  const rows = [['Reservation', b.number || ''], ['Room type', `${b.roomType || 'Room'}${rooms > 1 ? ` × ${rooms}` : ''}`], ['Check-in', day(b.checkIn)], ['Check-out', day(b.checkOut)], ['Nights', String(nights)], ['Guests', `${b.adults || 1} adult${Number(b.adults) === 1 || !b.adults ? '' : 's'}${b.children ? `, ${b.children} child${b.children > 1 ? 'ren' : ''}` : ''}`], ['Estimated room charges', money(total, cur)], ...(b.advance ? [['Advance received', money(b.advance, cur)]] : [])];
  const inner = `<p style="margin:0 0 18px;font-size:15px;line-height:1.5">Dear ${esc(first)}, your reservation at ${esc(hotel)} is confirmed. We look forward to welcoming you.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows.map(([k, v]) => `<tr><td style="color:#5b6b70;padding:5px 0;border-bottom:1px solid #f0f5f5">${esc(k)}</td><td align="right" style="padding:5px 0;border-bottom:1px solid #f0f5f5;font-weight:bold">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:18px 0 0;font-size:13px;color:#5b6b70">Taxes are added at check-out. ${settings.phone ? `To change or cancel, call ${esc(settings.phone)}.` : ''}</p>`;
  const text = [`${hotel}`, '', `Dear ${first}, your reservation is confirmed.`, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', settings.phone ? `To change or cancel, call ${settings.phone}.` : ''].join('\n');
  return { subject, html: shell(settings, 'Reservation confirmed', inner), text };
}

/** Thank-you after check-out, with the feedback link. */
function buildThankYouEmail(bill, settings = {}, mail = {}) {
  const hotel = settings.hotelName || 'Our hotel';
  const first = String(bill.guestName || 'Guest').split(' ')[0];
  const subject = `Thank you for staying at ${hotel}`;
  const inner = `<p style="margin:0 0 14px;font-size:15px;line-height:1.55">Dear ${esc(first)}, thank you for staying with us${bill.roomNumber ? ` in room ${esc(bill.roomNumber)}` : ''}. We hope you had a wonderful time.</p>
<p style="margin:0 0 6px;font-size:15px;line-height:1.55">How was your stay? It takes 30 seconds and helps us improve.</p>${mail.feedbackUrl ? button(mail.feedbackUrl, 'Rate your stay') : ''}
<p style="margin:14px 0 0;font-size:13px;color:#5b6b70">Invoice ${esc(bill.invoiceNumber || '')}. ${esc(settings.invoiceFooter || '')}</p>`;
  const text = [`Dear ${first},`, '', `Thank you for staying at ${hotel}.`, mail.feedbackUrl ? `Tell us how it went: ${mail.feedbackUrl}` : '', '', settings.invoiceFooter || ''].join('\n');
  return { subject, html: shell(settings, 'Thank you', inner), text };
}

/** Campaign or automatic message: the hotel's own words, with an unsubscribe link. */
function buildMessageEmail(mail, settings = {}) {
  const unsub = mail.unsubscribeUrl ? ` · <a href="${esc(mail.unsubscribeUrl)}" style="color:#7a8a8e">Unsubscribe</a>` : '';
  const html = shell(settings, '', textToHtml(mail.body), unsub);
  const text = `${mail.body}${mail.unsubscribeUrl ? `\n\nUnsubscribe: ${mail.unsubscribeUrl}` : ''}`;
  return { subject: mail.subject, html, text };
}

/** Subject, HTML and plain-text body for a guest email. */
function buildEmail(kind, bill, settings = {}) {
  const cur = settings.currency || 'INR';
  const hotel = settings.hotelName || 'Our hotel';
  const first = String(bill.guestName || bill.guest?.name || 'Guest').split(' ')[0];
  const nights = bill.nights || 0;
  const rows = [
    [`${bill.roomType ? `${bill.roomType} ` : ''}Room ${bill.roomNumber} × ${nights} night${nights === 1 ? '' : 's'}`, bill.roomAmount],
    ...(bill.items || []).map((it) => [`${it.description || 'Item'}${Number(it.quantity) !== 1 ? ` × ${it.quantity}` : ''}`, it.amount]),
    ...(bill.discountAmount ? [['Discount', -bill.discountAmount]] : []),
    ...((bill.taxes || []).map((t) => [`${t.name} @ ${t.rate}%`, t.amount])),
  ];
  const paidFull = kind === 'paid';
  const subject = paidFull
    ? `Payment received: ${bill.invoiceNumber} from ${hotel}`
    : `Your stay at ${hotel}: booking confirmation ${bill.invoiceNumber}`;
  const intro = paidFull
    ? `Thank you, ${first}. We have received full payment for your stay. Your invoice is attached as a PDF.`
    : `Thank you for choosing ${hotel}, ${first}. Here are the details of your stay and bill.`;
  const status = bill.paymentStatus === 'PAID' ? 'Paid in full' : bill.paymentStatus === 'PARTIALLY_PAID' ? 'Partly paid' : 'Payment pending';
  const accent = '#0F5E66';
  const html = `<!doctype html><html><body style="margin:0;background:#f5fafa;font-family:Arial,Helvetica,sans-serif;color:#0b1c30">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5fafa;padding:24px 0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:${accent};padding:22px 28px;color:#ffffff">
  <div style="font-size:20px;font-weight:bold">${esc(hotel)}</div>
  <div style="font-size:13px;opacity:.85">${esc([settings.address, settings.city].filter(Boolean).join(', '))}</div>
</td></tr>
<tr><td style="padding:24px 28px">
  <p style="margin:0 0 6px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#F2785C;font-weight:bold">${paidFull ? 'Payment received' : 'Booking confirmation'}</p>
  <p style="margin:0 0 18px;font-size:15px;line-height:1.5">${esc(intro)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin-bottom:16px">
    <tr><td style="color:#5b6b70;padding:3px 0">Invoice</td><td align="right" style="font-weight:bold">${esc(bill.invoiceNumber)}</td></tr>
    <tr><td style="color:#5b6b70;padding:3px 0">Room</td><td align="right">${esc(bill.roomNumber)}${bill.roomType ? ` (${esc(bill.roomType)})` : ''}</td></tr>
    <tr><td style="color:#5b6b70;padding:3px 0">Check-in</td><td align="right">${esc(day(bill.checkIn))}</td></tr>
    <tr><td style="color:#5b6b70;padding:3px 0">Check-out</td><td align="right">${esc(day(bill.checkOut))}</td></tr>
    <tr><td style="color:#5b6b70;padding:3px 0">Nights</td><td align="right">${nights}</td></tr>
  </table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #e3eeee">
    ${rows.map(([l, a]) => `<tr><td style="padding:7px 0;border-bottom:1px solid #f0f5f5">${esc(l)}</td><td align="right" style="padding:7px 0;border-bottom:1px solid #f0f5f5">${a < 0 ? '-' : ''}${esc(money(Math.abs(a || 0), cur))}</td></tr>`).join('')}
    <tr><td style="padding:10px 0;font-weight:bold;font-size:16px">Total</td><td align="right" style="padding:10px 0;font-weight:bold;font-size:16px">${esc(money(bill.grandTotal, cur))}</td></tr>
    <tr><td style="padding:3px 0;color:#5b6b70">Paid</td><td align="right">${esc(money(bill.paidAmount, cur))}</td></tr>
    <tr><td style="padding:3px 0;color:#5b6b70">Balance</td><td align="right" style="font-weight:bold;color:${bill.balanceAmount > 0 ? '#ba1a1a' : '#14532d'}">${esc(money(bill.balanceAmount, cur))}</td></tr>
  </table>
  <p style="margin:18px 0 0;display:inline-block;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:bold;background:${bill.paymentStatus === 'PAID' ? '#dcf3e4;color:#14532d' : '#fdefc8;color:#7a4b00'}">${status}</p>
  <p style="margin:22px 0 0;font-size:13px;color:#5b6b70;line-height:1.5">${esc(settings.invoiceFooter || 'Thank you for staying with us.')}${settings.phone ? `<br>Questions? Call ${esc(settings.phone)}` : ''}${settings.email ? ` or reply to this email.` : ''}</p>
</td></tr>
<tr><td style="padding:14px 28px;background:#f0f5f5;font-size:11px;color:#7a8a8e">${esc(hotel)}${settings.gstin ? ` · GSTIN ${esc(settings.gstin)}` : ''} · Sent by StayBill</td></tr>
</table></td></tr></table></body></html>`;
  const text = [
    `${hotel}`, '', intro, '',
    `Invoice: ${bill.invoiceNumber}`, `Room: ${bill.roomNumber}${bill.roomType ? ` (${bill.roomType})` : ''}`,
    `Check-in: ${day(bill.checkIn)}  Check-out: ${day(bill.checkOut)}  Nights: ${nights}`, '',
    ...rows.map(([l, a]) => `${l}: ${a < 0 ? '-' : ''}${money(Math.abs(a || 0), cur)}`),
    `Total: ${money(bill.grandTotal, cur)}`, `Paid: ${money(bill.paidAmount, cur)}`, `Balance: ${money(bill.balanceAmount, cur)}`, '',
    settings.invoiceFooter || 'Thank you for staying with us.',
  ].join('\n');
  return { subject, html, text };
}


// ---------- Automatic messages ----------
const crypto = require('crypto');
function fill(tpl, guest = {}, settings = {}, extra = {}) {
  const v = { name: guest.name || 'Guest', first: String(guest.name || 'Guest').split(' ')[0], hotel: settings.hotelName || 'our hotel', phone: settings.phone || '', points: guest.points || 0, code: guest.referralCode || '', ...extra };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m));
}
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const DEFAULT_AUTO = {
  preArrival: { subject: 'See you tomorrow at {hotel}', body: 'Hello {first},\n\nWe look forward to welcoming you tomorrow. Call us at {phone} if you need directions or an airport pickup.\n\n{hotel}' },
  postStay: { subject: 'Thank you for staying with us', body: 'Hello {first},\n\nThank you for choosing {hotel}. We would love to hear how your stay was: {feedback}' },
  birthday: { subject: 'Happy birthday, {first}!', body: 'Dear {first},\n\nEveryone at {hotel} wishes you a very happy birthday.' },
  anniversary: { subject: 'Happy anniversary from {hotel}', body: 'Dear {first},\n\nWarm wishes on your anniversary from all of us at {hotel}.' },
  winback: { subject: 'We miss you at {hotel}', body: 'Hello {first},\n\nIt has been a while! You have {points} loyalty points waiting.' },
};
/**
 * Messages due today for one hotel. Pure: give it the data, it returns
 * [{ automation, to, guestId, subject, body, key }] — key makes each message unique so it is sent once.
 */
function dueAutomations({ today, settings = {}, bookings = [], bills = [], guests = [], feedbackUrl = () => '' }) {
  const auto = settings.automations || {};
  const on = (id) => auto[id] && auto[id].on;
  const tpl = (id) => ({ ...DEFAULT_AUTO[id], ...(auto[id] || {}) });
  const byId = Object.fromEntries(guests.map((g) => [g.id, g]));
  const ok = (g) => !g || (!g.marketingOptOut && !g.blacklisted);
  const out = [];
  const push = (id, guest, to, extra, key) => {
    if (!EMAIL_RE.test(String(to || '').trim()) || !ok(guest)) return;
    const t = tpl(id);
    out.push({ automation: id, to: String(to).trim(), guestId: guest?.id || null, subject: fill(t.subject, guest || {}, settings, extra), body: fill(t.body, guest || {}, settings, extra), key: `${id}:${key}` });
  };
  if (on('preArrival')) {
    const tomorrow = addDays(today, 1);
    bookings.filter((b) => b.status === 'Confirmed' && b.checkIn === tomorrow).forEach((b) => push('preArrival', { name: b.guestName, ...(byId[b.guestId] || {}) }, b.email, {}, `${b.id}`));
  }
  if (on('postStay')) {
    const yesterday = addDays(today, -1);
    bills.filter((b) => b.paymentStatus !== 'CANCELLED' && (b.checkedOutOn || b.checkOut) === yesterday).forEach((b) => push('postStay', { ...(byId[b.guestId] || {}), name: b.guestName }, b.guest?.email, { feedback: feedbackUrl(b) }, b.id));
  }
  const md = today.slice(5);
  if (on('birthday')) guests.filter((g) => g.birthday && g.birthday.slice(5) === md).forEach((g) => push('birthday', g, g.email, {}, `${g.id}:${today.slice(0, 4)}`));
  if (on('anniversary')) guests.filter((g) => g.anniversary && g.anniversary.slice(5) === md).forEach((g) => push('anniversary', g, g.email, {}, `${g.id}:${today.slice(0, 4)}`));
  if (on('winback')) { const d = addDays(today, -180); guests.filter((g) => g.lastStay === d).forEach((g) => push('winback', g, g.email, {}, `${g.id}:${d}`)); }
  return out;
}
/** Token for a guest's unsubscribe link. */
function unsubToken(secret, hotelId, guestId) {
  return crypto.createHmac('sha256', String(secret)).update(`${hotelId}/${guestId}`).digest('hex').slice(0, 24);
}

// ---------- iCalendar (travel-site calendar sync) ----------
const icsDate = (iso) => iso.replace(/-/g, '');
const icsEsc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
/** events: [{uid, start, end, summary}] (dates YYYY-MM-DD, end = check-out day) */
function buildIcs(name, events, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//StayBill//Availability//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(name)}`];
  events.forEach((e) => lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(e.start)}`, `DTEND;VALUE=DATE:${icsDate(e.end)}`, `SUMMARY:${icsEsc(e.summary || 'Not available')}`, 'END:VEVENT'));
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
/** Reads VEVENTs from an .ics file: [{uid, start, end, summary}] */
function parseIcs(text) {
  const unfolded = String(text || '').replace(/\r?\n[ \t]/g, '');
  const out = [];
  unfolded.split(/BEGIN:VEVENT/).slice(1).forEach((block) => {
    const body = block.split(/END:VEVENT/)[0];
    const get = (k) => { const m = body.match(new RegExp(`^${k}(?:;[^:\\r\\n]*)?:(.*)$`, 'm')); return m ? m[1].trim() : ''; };
    const d = (v) => (v ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : '');
    const start = d(get('DTSTART')); const end = d(get('DTEND')) || start;
    if (start) out.push({ uid: get('UID') || `${start}-${end}`, start, end: end > start ? end : addDays(start, 1), summary: get('SUMMARY').replace(/\\([,;\\])/g, '$1').replace(/\\n/g, ' ') });
  });
  return out;
}

module.exports = {
  decide, buildEmail, buildReservationEmail, buildThankYouEmail, buildMessageEmail, textToHtml, fill, dueAutomations, buildIcs, parseIcs, unsubToken,
  money, day, EMAIL_RE, KINDS, BILL_KINDS, DIRECT_KINDS,
};
