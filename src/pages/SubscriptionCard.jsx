// The hotel owner's view of their StayBill subscription: plan, status,
// what is included, a Pay button (the plan's payment link) and past invoices.
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from '../backend/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { subState } from '../lib/saas';
import { MODULES } from '../modules/registry';
import { money } from '../lib/format';
import { Icon } from '../components/icons';
import { Button, Card, cx } from '../components/ui';
import { Chip, fmtDate } from '../modules/kit';
import { subInvoicePdf } from './subInvoice';

export default function SubscriptionCard() {
  const { hotel, hotelId } = useAuth();
  const [plan, setPlan] = useState(undefined);
  const [pays, setPays] = useState([]);
  const [site, setSite] = useState({});
  useEffect(() => {
    if (!hotel?.planId) { setPlan(null); return; }
    getDoc(doc(db, 'plans', hotel.planId)).then((s) => setPlan(s.exists() ? { id: s.id, ...s.data() } : null)).catch(() => setPlan(null));
    getDocs(query(collection(db, 'subscriptionPayments'), where('hotelId', '==', hotelId))).then((s) => setPays(s.docs.map((d) => d.data()).sort((a, b) => (a.number < b.number ? 1 : -1)))).catch(() => setPays([]));
    getDoc(doc(db, 'meta', 'billing')).then((s) => setSite(s.exists() ? s.data() : {})).catch(() => {});
  }, [hotel?.planId, hotelId]);
  if (!hotel?.planId) return <Card className="p-5 text-body-md text-on-surface-variant">This hotel is not on a subscription plan. Every module is available.</Card>;
  const st = subState(hotel, Number(site.graceDays ?? 7));
  const tone = { trial: 'info', active: 'ok', past_due: 'warn', expired: 'error', paused: 'error' }[st.status];
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">Your plan</div>
            <div className="flex items-center gap-2 font-headline text-headline-md">{hotel.planName}<Chip tone={tone}>{st.label}</Chip></div>
            <div className="text-body-md text-on-surface-variant">{money(hotel.price || 0)} per {hotel.billingCycle === 'yearly' ? 'year' : 'month'} · {st.status === 'trial' ? 'trial ends' : 'paid until'} {st.due ? fmtDate(st.due) : '—'}</div>
          </div>
          {plan?.paymentLink && <Button icon="payments" onClick={() => window.open(plan.paymentLink, '_blank', 'noopener')}>Pay {money(hotel.price || 0)}</Button>}
        </div>
        {['past_due', 'expired'].includes(st.status) && <p className="mt-3 rounded-lg bg-warn-container p-3 text-body-md text-on-warn-container">Your payment is overdue. StayBill pauses {site.graceDays ?? 7} days after the due date — please pay to keep going.</p>}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {MODULES.filter((m) => !m.core).map((m) => { const on = !hotel.planModules || hotel.planModules.includes(m.id); return <span key={m.id} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-label-md', on ? 'bg-ok-container text-on-ok-container' : 'bg-surface-container text-outline line-through')}><Icon name={on ? 'check' : 'lock'} size={12} />{m.label}</span>; })}
        </div>
        <p className="mt-2 text-label-md text-on-surface-variant">To change plan, contact {site.brand || 'the site administrator'}{site.email ? ` at ${site.email}` : ''}.</p>
      </Card>
      <Card className="p-5">
        <div className="mb-2 font-headline text-headline-sm">Invoices</div>
        {pays.length === 0 ? <p className="text-body-md text-on-surface-variant">No payments yet.</p> : pays.map((p) => (
          <div key={p.number} className="flex items-center justify-between border-b border-surface-container py-2 text-body-md last:border-0">
            <span><b>{p.number}</b> · {fmtDate(p.date)} · {fmtDate(p.from)} – {fmtDate(p.to)}</span>
            <span className="flex items-center gap-2">{money(p.amount)}<Button size="sm" variant="ghost" icon="picture_as_pdf" aria-label="Invoice PDF" onClick={() => subInvoicePdf(p, site)} /></span>
          </div>
        ))}
      </Card>
    </div>
  );
}
