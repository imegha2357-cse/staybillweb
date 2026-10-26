// Messages to guests: WhatsApp / SMS links, templates with {name} fields,
// guest segments, and queueing campaign emails for the Cloud Function.
import { addDoc, serverTimestamp } from '../../backend/firestore';
import { hcol } from '../../lib/scope';
import { actor } from '../../lib/db';
import { today, addDays } from '../../lib/dates';

const intl = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length === 10 ? `91${d}` : d; };
export const waLink = (phone, text) => `https://wa.me/${intl(phone)}?text=${encodeURIComponent(text || '')}`;
export const smsLink = (phone, text) => `sms:+${intl(phone)}?body=${encodeURIComponent(text || '')}`;

/** Replaces {name}, {first}, {hotel}, {points}, {code} … in a message. */
export function fill(tpl, guest = {}, settings = {}, extra = {}) {
  const v = {
    name: guest.name || 'Guest', first: (guest.name || 'Guest').split(' ')[0], hotel: settings.hotelName || 'our hotel',
    phone: settings.phone || '', points: guest.points || 0, code: guest.referralCode || '', ...extra,
  };
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined ? String(v[k]) : m));
}

const md = (d) => (d || '').slice(5, 10);
const inNextDays = (date, n) => { if (!date) return false; const t = today(); for (let i = 0; i <= n; i += 1) if (md(addDays(t, i)) === md(date)) return true; return false; };

export const SEGMENTS = [
  { id: 'all', label: 'All guests', test: () => true },
  { id: 'vip', label: 'VIP guests', test: (g) => !!g.vip },
  { id: 'birthday', label: 'Birthdays in the next 30 days', test: (g) => inNextDays(g.birthday, 30) },
  { id: 'anniversary', label: 'Anniversaries in the next 30 days', test: (g) => inNextDays(g.anniversary, 30) },
  { id: 'recent', label: 'Stayed in the last 30 days', test: (g) => g.lastStay && g.lastStay >= addDays(today(), -30) },
  { id: 'lapsed', label: 'Not stayed for 6 months', test: (g) => g.lastStay && g.lastStay < addDays(today(), -180) },
  { id: 'repeat', label: 'Repeat guests (2+ stays)', test: (g) => (g.stays || 0) >= 2 },
  { id: 'points', label: 'Have loyalty points', test: (g) => (g.points || 0) > 0 },
  { id: 'corporate', label: 'Corporate (has GSTIN or company)', test: (g) => !!(g.gstin || g.company) },
];

/** Guests a campaign can reach on a channel (skips opted-out and blacklisted guests). */
export function audience(guests, segmentId, channel) {
  const seg = SEGMENTS.find((s) => s.id === segmentId) || SEGMENTS[0];
  return guests.filter((g) => !g.marketingOptOut && !g.blacklisted && seg.test(g) && (channel === 'email' ? /\S+@\S+\.\S+/.test(g.email || '') : String(g.phone || '').replace(/\D/g, '').length >= 10));
}

/** Puts one campaign email in the mail queue; the Cloud Function sends it. */
export function queueCampaignEmail(user, campaign, guest, settings) {
  return addDoc(hcol('mail'), {
    kind: 'campaign', status: 'queued', to: guest.email, toName: guest.name, guestId: guest.id, campaignId: campaign.id,
    subject: fill(campaign.subject, guest, settings), body: fill(campaign.body, guest, settings),
    hotelName: settings.hotelName || '', createdAt: serverTimestamp(), createdBy: actor(user), date: today(),
  });
}

export const AUTOMATIONS = [
  { id: 'preArrival', label: 'Before arrival', when: '1 day before check-in (confirmed bookings)', subject: 'See you tomorrow at {hotel}', body: 'Hello {first},\n\nWe look forward to welcoming you tomorrow. Check-in is from 12 noon. Call us at {phone} if you need directions or an airport pickup.\n\nWarm regards,\n{hotel}' },
  { id: 'postStay', label: 'After the stay', when: 'The day after check-out, with the feedback link', subject: 'Thank you for staying with us', body: 'Hello {first},\n\nThank you for choosing {hotel}. We would love to hear how your stay was: {feedback}\n\nHope to see you again soon!' },
  { id: 'birthday', label: 'Birthday wishes', when: 'On the guest’s birthday', subject: 'Happy birthday, {first}!', body: 'Dear {first},\n\nEveryone at {hotel} wishes you a very happy birthday. Celebrate with us — mention this message for a special treat on your next stay.' },
  { id: 'anniversary', label: 'Anniversary wishes', when: 'On the guest’s anniversary', subject: 'Happy anniversary from {hotel}', body: 'Dear {first},\n\nWarm wishes on your anniversary from all of us at {hotel}. A romantic getaway is waiting whenever you are ready.' },
  { id: 'winback', label: 'Win-back', when: '180 days after the last stay', subject: 'We miss you at {hotel}', body: 'Hello {first},\n\nIt has been a while! You have {points} loyalty points waiting. Book directly with us for our best rate.' },
];
