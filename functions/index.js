// StayBill Cloud Functions
//  - sendGuestEmail: sends the guest email queued at hotels/{hotelId}/mail/{id}
//    (booking confirmation when a bill is created; "paid in full" with the
//    invoice PDF) through Gmail, using an app password stored as a secret.
//  - setUserPassword: lets an owner set a new password for their employee,
//    or the administrator for anyone.
//  - syncLoginStatus: switching a login off in StayBill also disables it in
//    Firebase Authentication.
//  - icalFeed / icalImport: calendar sync with Booking.com, Airbnb, MakeMyTrip…
//  - dailyAutomations: pre-arrival, post-stay, birthday, anniversary and
//    win-back emails, and pausing hotels whose subscription is overdue.
//  - unsubscribe: the link at the bottom of campaign emails.
const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret, defineString } = require('firebase-functions/params');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const {
  decide, buildEmail, buildReservationEmail, buildThankYouEmail, buildMessageEmail, dueAutomations, buildIcs, parseIcs, unsubToken, BILL_KINDS,
} = require('./lib');
const { invoicePdf } = require('./pdf');

admin.initializeApp();
const REGION = defineString('STAYBILL_REGION', { default: 'asia-south1' });
setGlobalOptions({ region: REGION, maxInstances: 5 });

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_APP_PASSWORD = defineSecret('GMAIL_APP_PASSWORD');
// Signs unsubscribe links. Any long random string: firebase functions:secrets:set UNSUB_SECRET
const UNSUB_SECRET = defineSecret('UNSUB_SECRET');
const fnBase = () => `https://${REGION.value()}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net`;
const { FieldValue } = admin.firestore;

let transport;
function mailer() {
  if (!transport) {
    transport = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: GMAIL_USER.value(), pass: GMAIL_APP_PASSWORD.value() },
    });
  }
  return transport;
}

exports.sendGuestEmail = onDocumentCreated(
  { document: 'hotels/{hotelId}/mail/{mailId}', secrets: [GMAIL_USER, GMAIL_APP_PASSWORD, UNSUB_SECRET], retry: false },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const mail = snap.data();
    const { hotelId } = event.params;
    const db = admin.firestore();
    const isBill = BILL_KINDS.includes(mail.kind);
    const [billS, bookingS, guestS, setS, hotelS] = await Promise.all([
      isBill && mail.billId ? db.doc(`hotels/${hotelId}/bills/${mail.billId}`).get() : null,
      mail.kind === 'reservation' && mail.bookingId ? db.doc(`hotels/${hotelId}/bookings/${mail.bookingId}`).get() : null,
      !isBill && mail.guestId ? db.doc(`hotels/${hotelId}/guests/${mail.guestId}`).get() : null,
      db.doc(`hotels/${hotelId}/settings/hotel`).get(),
      db.doc(`hotels/${hotelId}`).get(),
    ]);
    const data = (x) => (x && x.exists ? x.data() : null);
    const bill = data(billS); const booking = data(bookingS); const guest = data(guestS);
    const settings = data(setS) || {};
    const verdict = decide({ mail, bill, booking, guest, settings, hotel: data(hotelS) || {} });
    if (!verdict.send) {
      await snap.ref.update({ status: 'skipped', reason: verdict.reason, processedAt: FieldValue.serverTimestamp() });
      return;
    }
    try {
      let content;
      const attachments = [];
      if (mail.kind === 'reservation') content = buildReservationEmail(booking, settings);
      else if (mail.kind === 'thankyou') content = buildThankYouEmail(bill, settings, mail);
      else if (mail.kind === 'campaign' || mail.kind === 'auto') {
        const unsubscribeUrl = mail.guestId ? `${fnBase()}/unsubscribe?h=${hotelId}&g=${mail.guestId}&t=${unsubToken(UNSUB_SECRET.value(), hotelId, mail.guestId)}` : '';
        content = buildMessageEmail({ ...mail, unsubscribeUrl }, settings);
      } else {
        content = buildEmail(mail.kind, bill, settings);
        if (mail.kind === 'paid') {
          const pays = await db.collection(`hotels/${hotelId}/payments`).where('billId', '==', mail.billId).get();
          const payments = pays.docs.map((d) => d.data()).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
          attachments.push({ filename: `${bill.invoiceNumber}.pdf`, content: await invoicePdf(bill, settings, payments), contentType: 'application/pdf' });
        }
      }
      const from = `"${String(settings.hotelName || 'StayBill').replace(/"/g, '')}" <${GMAIL_USER.value()}>`;
      const info = await mailer().sendMail({
        from, to: verdict.to, replyTo: settings.email || undefined, subject: content.subject, html: content.html, text: content.text, attachments,
      });
      await snap.ref.update({ status: 'sent', to: verdict.to, sentAt: FieldValue.serverTimestamp(), messageId: info.messageId || '' });
    } catch (e) {
      logger.error('Guest email failed', { hotelId, mailId: snap.id, error: e.message });
      await snap.ref.update({ status: 'error', to: verdict.to, error: String(e.message || e).slice(0, 300), processedAt: FieldValue.serverTimestamp() });
    }
  },
);

exports.setUserPassword = onCall(async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Please sign in.');
  const { uid, password } = req.data || {};
  if (typeof uid !== 'string' || !uid) throw new HttpsError('invalid-argument', 'Missing login.');
  if (typeof password !== 'string' || password.length < 6) throw new HttpsError('invalid-argument', 'Password must be at least 6 characters.');
  const db = admin.firestore();
  const [meS, targetS] = await Promise.all([db.doc(`users/${req.auth.uid}`).get(), db.doc(`users/${uid}`).get()]);
  if (!meS.exists || meS.data().status !== 'active') throw new HttpsError('permission-denied', 'Your login is not active.');
  if (!targetS.exists) throw new HttpsError('not-found', 'That login no longer exists.');
  const me = meS.data();
  const t = targetS.data();
  const allowed = me.role === 'admin' || (me.role === 'owner' && t.role === 'employee' && t.hotelId && t.hotelId === me.hotelId);
  if (!allowed) throw new HttpsError('permission-denied', 'You can only set passwords for your own hotel’s employees.');
  await admin.auth().updateUser(uid, { password });
  await admin.auth().revokeRefreshTokens(uid);
  if (t.hotelId) {
    await db.collection(`hotels/${t.hotelId}/auditLogs`).add({
      action: 'PASSWORD_RESET', entity: 'user', entityId: uid, details: { username: t.username || '' },
      user: { uid: req.auth.uid, name: me.name || '' }, createdAt: FieldValue.serverTimestamp(),
    });
  }
  return { ok: true };
});

exports.syncLoginStatus = onDocumentUpdated('users/{uid}', async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!after || before?.status === after.status) return;
  try {
    await admin.auth().updateUser(event.params.uid, { disabled: after.status !== 'active' });
    if (after.status !== 'active') await admin.auth().revokeRefreshTokens(event.params.uid);
  } catch (e) {
    logger.warn('Could not sync login status', { uid: event.params.uid, error: e.message });
  }
});

// ---------- Calendar sync ----------
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** GET /icalFeed?h=hotel&room=101&k=key — the room's busy dates, for a travel site to import. */
exports.icalFeed = onRequest({ cors: false }, async (req, res) => {
  const { h, room, k } = req.query;
  if (!h || !room || !k) { res.status(400).send('Missing parameters'); return; }
  const db = admin.firestore();
  const ch = await db.collection(`hotels/${h}/channels`).where('feedKey', '==', String(k)).limit(1).get();
  if (ch.empty) { res.status(404).send('Unknown calendar'); return; }
  const channelId = ch.docs[0].id;
  const from = addDays(istToday(), -1);
  const [bills, bookings] = await Promise.all([
    db.collection(`hotels/${h}/bills`).where('checkOut', '>=', from).get(),
    db.collection(`hotels/${h}/bookings`).where('checkOut', '>=', from).get(),
  ]);
  const events = [];
  bills.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => b.roomNumber === room && b.paymentStatus !== 'CANCELLED')
    .forEach((b) => events.push({ uid: `bill-${b.id}@staybill`, start: b.checkIn, end: b.checkOut, summary: 'Not available' }));
  bookings.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => b.roomNumber === room && ['Confirmed', 'Requested'].includes(b.status) && b.channelId !== channelId)
    .forEach((b) => events.push({ uid: `booking-${b.id}@staybill`, start: b.checkIn, end: b.checkOut, summary: 'Not available' }));
  res.set('Content-Type', 'text/calendar; charset=utf-8').set('Cache-Control', 'public, max-age=300').send(buildIcs(`Room ${room}`, events));
});

async function importChannel(db, hotelId, chDoc) {
  const ch = chDoc.data();
  const rooms = await db.collection(`hotels/${hotelId}/rooms`).get();
  const typeOf = Object.fromEntries(rooms.docs.map((d) => [d.data().roomNumber, d.data().roomType]));
  let added = 0; let cancelled = 0;
  for (const imp of ch.icalImports || []) { // eslint-disable-line no-restricted-syntax
    if (!imp.url) continue; // eslint-disable-line no-continue
    let events = [];
    try {
      const r = await fetch(imp.url, { headers: { 'User-Agent': 'StayBill calendar sync' } }); // eslint-disable-line no-await-in-loop
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      events = parseIcs(await r.text()); // eslint-disable-line no-await-in-loop
    } catch (e) { logger.warn('iCal fetch failed', { hotelId, channel: ch.name, room: imp.roomNumber, error: e.message }); continue; } // eslint-disable-line no-continue
    const today = istToday();
    const seen = new Set();
    const batch = db.batch();
    events.filter((e) => e.end >= today).forEach((e) => {
      const id = `ical_${chDoc.id}_${imp.roomNumber}_${crypto.createHash('sha1').update(e.uid).digest('hex').slice(0, 16)}`;
      seen.add(id);
      batch.set(db.doc(`hotels/${hotelId}/bookings/${id}`), {
        number: `${(ch.name || 'OTA').slice(0, 3).toUpperCase()}-${id.slice(-6).toUpperCase()}`, source: ch.name || 'OTA', channelId: chDoc.id, externalUid: e.uid, imported: true,
        guestName: e.summary && !/not available|closed|blocked|reserved/i.test(e.summary) ? e.summary : `${ch.name || 'OTA'} guest`, roomNumber: imp.roomNumber, roomType: typeOf[imp.roomNumber] || '',
        checkIn: e.start, checkOut: e.end, rooms: 1, adults: 2, status: 'Confirmed', updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      added += 1;
    });
    const mine = await db.collection(`hotels/${hotelId}/bookings`).where('channelId', '==', chDoc.id).get(); // eslint-disable-line no-await-in-loop
    mine.docs.filter((d) => d.data().imported && d.data().roomNumber === imp.roomNumber && d.data().status === 'Confirmed' && d.data().checkIn >= today && !seen.has(d.id))
      .forEach((d) => { batch.update(d.ref, { status: 'Cancelled', cancelReason: 'Removed from the travel site calendar', updatedAt: FieldValue.serverTimestamp() }); cancelled += 1; });
    await batch.commit(); // eslint-disable-line no-await-in-loop
  }
  await chDoc.ref.update({ lastSyncAt: FieldValue.serverTimestamp(), lastSyncResult: `${added} bookings, ${cancelled} cancelled` });
}

/** Every 30 minutes: pull each channel's calendars into Bookings. */
exports.icalImport = onSchedule({ schedule: 'every 30 minutes', timeZone: 'Asia/Kolkata' }, async () => {
  const db = admin.firestore();
  const hotels = await db.collection('hotels').get();
  for (const h of hotels.docs) { // eslint-disable-line no-restricted-syntax
    if (h.data().status === 'suspended') continue; // eslint-disable-line no-continue
    const chans = await db.collection(`hotels/${h.id}/channels`).get(); // eslint-disable-line no-await-in-loop
    for (const c of chans.docs.filter((d) => (d.data().icalImports || []).length && d.data().active !== false)) { // eslint-disable-line no-restricted-syntax
      await importChannel(db, h.id, c).catch((e) => logger.error('iCal import failed', { hotel: h.id, channel: c.id, error: e.message })); // eslint-disable-line no-await-in-loop
    }
  }
});

// ---------- Daily jobs ----------
/** 9 am India time: automatic guest emails, then pause hotels past their subscription grace period. */
exports.dailyAutomations = onSchedule({ schedule: '0 9 * * *', timeZone: 'Asia/Kolkata' }, async () => {
  const db = admin.firestore();
  const today = istToday();
  const hotels = await db.collection('hotels').get();
  const billingS = await db.doc('meta/billing').get();
  const grace = Number((billingS.exists && billingS.data().graceDays) ?? 7);
  for (const h of hotels.docs) { // eslint-disable-line no-restricted-syntax
    const hotel = h.data();
    // Subscription: pause when the paid period (or trial) ended more than `grace` days ago.
    const until = hotel.subStatus === 'trial' ? hotel.trialEndsOn : hotel.paidUntil;
    if (hotel.planId && until && hotel.subStatus !== 'paused' && addDays(until, grace) < today && hotel.status !== 'suspended') {
      await h.ref.update({ subStatus: 'paused', status: 'suspended', pausedForBilling: true, pausedOn: today }); // eslint-disable-line no-await-in-loop
      logger.info('Paused for billing', { hotel: h.id });
      continue; // eslint-disable-line no-continue
    }
    if (hotel.status === 'suspended') continue; // eslint-disable-line no-continue
    const setS = await db.doc(`hotels/${h.id}/settings/hotel`).get(); // eslint-disable-line no-await-in-loop
    const settings = setS.exists ? setS.data() : {};
    const auto = settings.automations || {};
    if (!Object.values(auto).some((a) => a && a.on)) continue; // eslint-disable-line no-continue
    const [bookings, bills, guests] = await Promise.all([ // eslint-disable-line no-await-in-loop
      db.collection(`hotels/${h.id}/bookings`).where('checkIn', '==', addDays(today, 1)).get(),
      db.collection(`hotels/${h.id}/bills`).where('checkedOutOn', '==', addDays(today, -1)).get(),
      db.collection(`hotels/${h.id}/guests`).get(),
    ]);
    const base = settings.publicUrl || '';
    const due = dueAutomations({
      today, settings,
      bookings: bookings.docs.map((d) => ({ id: d.id, ...d.data() })),
      bills: bills.docs.map((d) => ({ id: d.id, ...d.data() })).filter((b) => !b.thankYouQueued),
      guests: guests.docs.map((d) => ({ id: d.id, ...d.data() })),
      feedbackUrl: (b) => (base && b.feedbackToken ? `${base}/feedback/${h.id}/${b.id}/${b.feedbackToken}` : ''),
    });
    for (const m of due) { // eslint-disable-line no-restricted-syntax
      // The key makes each message a fixed document, so re-running the job never sends twice.
      const ref = db.doc(`hotels/${h.id}/mail/auto_${crypto.createHash('sha1').update(m.key).digest('hex').slice(0, 20)}`);
      await db.runTransaction(async (tx) => { // eslint-disable-line no-await-in-loop
        if ((await tx.get(ref)).exists) return;
        tx.create(ref, { kind: 'auto', automation: m.automation, status: 'queued', to: m.to, guestId: m.guestId, subject: m.subject, body: m.body, date: today, createdAt: FieldValue.serverTimestamp(), requestedBy: { uid: null, name: 'Automatic' } });
      });
    }
    if (due.length) logger.info('Automatic emails queued', { hotel: h.id, count: due.length });
  }
});

/** GET /unsubscribe?h=&g=&t= — guest stops marketing emails. */
exports.unsubscribe = onRequest({ secrets: [UNSUB_SECRET] }, async (req, res) => {
  const { h, g, t } = req.query;
  const page = (msg) => res.set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial,sans-serif;display:grid;place-items:center;min-height:90vh;color:#0b1c30"><div style="max-width:420px;text-align:center"><h1 style="font-size:22px">${msg}</h1></div></body>`);
  if (!h || !g || !t || t !== unsubToken(UNSUB_SECRET.value(), h, g)) { res.status(400); page('This link is not valid.'); return; }
  await admin.firestore().doc(`hotels/${h}/guests/${g}`).update({ marketingOptOut: true, optOutAt: FieldValue.serverTimestamp() }).catch(() => {});
  page('You will not receive offers from this hotel any more. Booking emails will still arrive.');
});
