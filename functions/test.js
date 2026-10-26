const test = require('node:test');
const assert = require('node:assert');
const { decide, buildEmail } = require('./lib');
const { invoicePdf } = require('./pdf');

const bill = {
  invoiceNumber: 'INV-1001', guestName: 'Asha Rao', guest: { name: 'Asha Rao', email: 'asha@example.com' }, roomNumber: '204', roomType: 'Deluxe',
  checkIn: '2026-10-22', checkOut: '2026-10-25', nights: 3, roomRate: 2500, roomAmount: 7500, items: [{ description: 'Food', quantity: 2, rate: 425, amount: 850 }],
  subtotal: 8350, discountAmount: 0, taxes: [{ name: 'CGST', rate: 2.5, amount: 208.75 }, { name: 'SGST', rate: 2.5, amount: 208.75 }],
  taxAmount: 417.5, grandTotal: 8767.5, paidAmount: 8767.5, balanceAmount: 0, paymentStatus: 'PAID', billDate: '2026-10-25', paymentMethods: ['UPI'],
};
const settings = { hotelName: 'Sea Breeze <Residency>', currency: 'INR', email: 'desk@seabreeze.example', phone: '+91 44 1234', invoiceFooter: 'See you again!' };

test('sends booking and paid emails to the guest on the bill', () => {
  assert.deepStrictEqual(decide({ mail: { status: 'queued', kind: 'paid' }, bill, settings }), { send: true, to: 'asha@example.com' });
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'booking' }, bill: { ...bill, paymentStatus: 'PENDING' }, settings }).send, true);
});
test('skips when it should not send', () => {
  assert.strictEqual(decide({ mail: { status: 'sent', kind: 'paid' }, bill, settings }).reason, 'already handled');
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'paid' }, bill: { ...bill, paymentStatus: 'PARTIALLY_PAID' }, settings }).reason, 'not fully paid');
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'paid' }, bill: { ...bill, guest: { email: 'nope' } }, settings }).reason, 'no guest email');
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'booking' }, bill, settings: { emailGuests: false } }).reason, 'turned off');
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'booking', manual: true }, bill, settings: { emailGuests: false } }).send, true);
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'booking' }, bill, settings, hotel: { status: 'suspended' } }).reason, 'hotel paused');
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'booking' }, bill: { ...bill, paymentStatus: 'CANCELLED' }, settings }).reason, 'bill cancelled');
});
test('email content is escaped and complete', () => {
  const e = buildEmail('paid', bill, settings);
  assert.match(e.subject, /Payment received: INV-1001/);
  assert.ok(e.html.includes('Sea Breeze &lt;Residency&gt;'));
  assert.ok(!e.html.includes('<Residency>'));
  assert.ok(e.html.includes('₹8,767.5'));
  assert.match(e.text, /Balance: ₹0/);
  const b = buildEmail('booking', { ...bill, paymentStatus: 'PENDING', paidAmount: 0, balanceAmount: 8767.5 }, settings);
  assert.match(b.subject, /booking confirmation INV-1001/);
  assert.ok(b.html.includes('Payment pending'));
});
test('invoice PDF is produced', async () => {
  const pdf = await invoicePdf(bill, settings, [{ method: 'UPI', amount: 8767.5, date: '2026-10-25', referenceNumber: '8921' }]);
  assert.ok(pdf.length > 1500);
  assert.strictEqual(pdf.slice(0, 5).toString(), '%PDF-');
  require('fs').writeFileSync(process.env.PDF_OUT || '/dev/null', pdf);
});

const { buildReservationEmail, buildThankYouEmail, buildMessageEmail, dueAutomations, buildIcs, parseIcs, unsubToken } = require('./lib');
test('reservation, thank-you and campaign emails', () => {
  const booking = { number: 'BK-0007', guestName: 'Ravi Menon', email: 'ravi@example.com', checkIn: '2026-11-02', checkOut: '2026-11-05', roomType: 'Deluxe', rooms: 1, adults: 2, rate: 3000, status: 'Confirmed' };
  assert.deepStrictEqual(decide({ mail: { status: 'queued', kind: 'reservation' }, booking, settings }), { send: true, to: 'ravi@example.com' });
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'reservation' }, booking: { ...booking, status: 'Cancelled' }, settings }).reason, 'booking cancelled');
  const r = buildReservationEmail(booking, settings);
  assert.match(r.subject, /BK-0007/); assert.ok(r.html.includes('₹9,000')); assert.match(r.text, /Nights: 3/);
  const t = buildThankYouEmail(bill, settings, { feedbackUrl: 'https://x.example/feedback/h/b/tok' });
  assert.ok(t.html.includes('https://x.example/feedback/h/b/tok'));
  assert.strictEqual(decide({ mail: { status: 'queued', kind: 'thankyou' }, bill, settings }).send, true);
  const mail = { status: 'queued', kind: 'campaign', to: 'a@b.co', subject: 'Diwali offer', body: 'Hi <Asha>\n\nBook at https://hotel.example' };
  assert.strictEqual(decide({ mail, guest: { marketingOptOut: true }, settings }).reason, 'guest opted out');
  assert.strictEqual(decide({ mail, guest: {}, settings }).send, true);
  const m = buildMessageEmail({ ...mail, unsubscribeUrl: 'https://u.example/x' }, settings);
  assert.ok(m.html.includes('Hi &lt;Asha&gt;')); assert.ok(m.html.includes('<a href="https://hotel.example"')); assert.ok(m.html.includes('Unsubscribe'));
});
test('automatic messages pick the right guests once', () => {
  const settings2 = { hotelName: 'Sea Breeze', automations: { preArrival: { on: true }, birthday: { on: true }, postStay: { on: true }, winback: { on: false } } };
  const due = dueAutomations({
    today: '2026-10-26', settings: settings2,
    bookings: [{ id: 'b1', status: 'Confirmed', checkIn: '2026-10-27', guestName: 'Asha Rao', email: 'asha@example.com' }, { id: 'b2', status: 'Cancelled', checkIn: '2026-10-27', email: 'x@example.com' }],
    bills: [{ id: 'i1', checkedOutOn: '2026-10-25', guestName: 'Ravi', guest: { email: 'ravi@example.com' }, feedbackToken: 't' }],
    guests: [{ id: 'g1', name: 'Meera K', email: 'meera@example.com', birthday: '1990-10-26' }, { id: 'g2', name: 'No Mail', email: 'meera2@example.com', birthday: '1991-10-26', marketingOptOut: true }],
    feedbackUrl: (b) => `https://h.example/feedback/${b.id}`,
  });
  assert.deepStrictEqual(due.map((d) => d.automation).sort(), ['birthday', 'postStay', 'preArrival']);
  assert.match(due.find((d) => d.automation === 'birthday').subject, /Meera/);
  assert.match(due.find((d) => d.automation === 'postStay').body, /https:\/\/h.example\/feedback\/i1/);
  assert.strictEqual(new Set(due.map((d) => d.key)).size, due.length);
});
test('iCal round trip and unsubscribe tokens', () => {
  const ics = buildIcs('Room 101', [{ uid: 'x1@staybill', start: '2026-11-01', end: '2026-11-04', summary: 'Not available' }]);
  assert.match(ics, /DTSTART;VALUE=DATE:20261101/);
  const airbnb = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTEND;VALUE=DATE:20261210\r\nDTSTART;VALUE=DATE:20261207\r\nUID:abc123@airbnb.com\r\nSUMMARY:Reserved\r\nEND:VEVENT\r\nEND:VCALENDAR';
  assert.deepStrictEqual(parseIcs(airbnb), [{ uid: 'abc123@airbnb.com', start: '2026-12-07', end: '2026-12-10', summary: 'Reserved' }]);
  assert.deepStrictEqual(parseIcs(ics)[0].end, '2026-11-04');
  assert.strictEqual(unsubToken('s', 'h1', 'g1'), unsubToken('s', 'h1', 'g1'));
  assert.notStrictEqual(unsubToken('s', 'h1', 'g1'), unsubToken('s', 'h1', 'g2'));
});

const { whatsappPayload } = require('./lib');
test('WhatsApp messages: template, plain text and bad numbers', () => {
  const msg = { to: '919840022222', kind: 'paid', body: 'Thank you Asha!\nWe received ₹6,300.' };
  const t = whatsappPayload(msg, { api: { templates: { paid: { name: 'staybill_paid', lang: 'en' } } } }).body;
  assert.strictEqual(t.type, 'template');
  assert.strictEqual(t.template.name, 'staybill_paid');
  assert.strictEqual(t.template.components[0].parameters[0].text, 'Thank you Asha! · We received ₹6,300.');
  const p = whatsappPayload(msg, {}).body;
  assert.strictEqual(p.type, 'text'); assert.match(p.text.body, /\n/);
  assert.strictEqual(whatsappPayload({ ...msg, to: '98400' }, {}).error, 'invalid number');
  assert.strictEqual(whatsappPayload({ ...msg, body: ' ' }, {}).error, 'empty message');
});
