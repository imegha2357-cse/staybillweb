// Public sign-up: /signup — a hotel asks to join this StayBill site. The
// administrator approves it in Plans & billing, which creates the hotel and
// the owner's login.
import { useEffect, useState } from 'react';
import { listPlans, sendSignup } from '../../lib/saas';
import { usernameProblem } from '../../lib/db';
import { money } from '../../lib/format';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Textarea, cx } from '../../components/ui';
import { PublicShell } from './PublicBooking';

export default function Signup() {
  const [plans, setPlans] = useState(null);
  const [v, setV] = useState({ hotelName: '', city: '', rooms: '', ownerName: '', phone: '', email: '', username: '', planId: '', message: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => { listPlans().then((p) => { const list = (p || []).filter((x) => x.active !== false); setPlans(list); setV((o) => ({ ...o, planId: o.planId || list[0]?.id || '' })); }).catch(() => setPlans([])); }, []);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  async function send() {
    setErr('');
    if (!v.hotelName.trim() || !v.ownerName.trim()) return setErr('Enter the hotel name and your name.');
    if (!/^[0-9+\-\s]{8,15}$/.test(v.phone.trim())) return setErr('Enter a phone number we can call.');
    if (!/^\S+@\S+\.\S+$/.test(v.email.trim())) return setErr('Enter a valid email.');
    const u = usernameProblem(v.username); if (u) return setErr(u);
    setBusy(true);
    try { await sendSignup({ ...v, hotelName: v.hotelName.trim(), ownerName: v.ownerName.trim(), username: v.username.trim().toLowerCase(), rooms: Number(v.rooms) || 0 }); setDone(true); } catch (e) { setErr('Sorry, that did not go through. Please try again.'); }
    setBusy(false);
  }
  const shell = (c) => <PublicShell hotel={{ name: 'StayBill', city: 'Hotel billing and management' }}>{c}</PublicShell>;
  if (done) return shell(<div className="mx-auto max-w-md rounded-2xl bg-surface-container-lowest p-6 text-center shadow-sm"><span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ok-container text-on-ok-container"><Icon name="check" size={30} /></span><h1 className="mt-3 font-headline text-headline-md">Thanks, {v.ownerName.split(' ')[0]}!</h1><p className="mt-1 text-body-md text-on-surface-variant">We will set up {v.hotelName} and send your login to {v.email} within one working day. Your free trial starts then.</p></div>);
  return shell(
    <div className="space-y-5">
      <div><h1 className="font-headline text-headline-lg">Start your free trial</h1><p className="text-body-md text-on-surface-variant">Billing, bookings, restaurant, housekeeping, staff and accounts in one place.</p></div>
      {plans && plans.length > 0 && (
        <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Plan">
          {plans.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={v.planId === p.id} onClick={() => setV({ ...v, planId: p.id })} className={cx('rounded-2xl bg-surface-container-lowest p-4 text-left shadow-sm ring-2', v.planId === p.id ? 'ring-secondary' : 'ring-transparent')}>
              <div className="font-headline text-headline-sm">{p.name}</div>
              <div className="font-headline text-headline-md">{money(p.monthly)}<span className="text-body-md text-on-surface-variant"> / month</span></div>
              <div className="text-label-md text-on-surface-variant">{p.trialDays} days free · {p.maxRooms ? `up to ${p.maxRooms} rooms` : 'any size'}</div>
              <p className="mt-1 text-body-md">{p.blurb}</p>
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-sm sm:grid-cols-2">
        <Field label="Hotel name" required><Input value={v.hotelName} onChange={set('hotelName')} /></Field>
        <Field label="City"><Input value={v.city} onChange={set('city')} /></Field>
        <Field label="Number of rooms"><Input type="number" min="1" value={v.rooms} onChange={set('rooms')} /></Field>
        <Field label="Your name" required><Input value={v.ownerName} onChange={set('ownerName')} autoComplete="name" /></Field>
        <Field label="Mobile" required><Input type="tel" value={v.phone} onChange={set('phone')} autoComplete="tel" /></Field>
        <Field label="Email" required><Input type="email" value={v.email} onChange={set('email')} autoComplete="email" /></Field>
        <Field label="Username you would like" hint="Letters, numbers, dot, dash or underscore."><Input value={v.username} onChange={set('username')} autoCapitalize="none" /></Field>
        <Field label="Anything we should know?" className="sm:col-span-2"><Textarea rows={2} value={v.message} onChange={set('message')} /></Field>
        {err && <p className="text-body-md text-error sm:col-span-2" role="alert">{err}</p>}
        <div className="sm:col-span-2"><Button size="lg" icon="send" loading={busy} onClick={send}>Request my account</Button></div>
      </div>
    </div>,
  );
}
