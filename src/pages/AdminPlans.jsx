// Plans & billing (administrator): subscription plans and the modules each
// includes, every hotel's plan and status, payments, sign-up requests from new
// hotels, and pausing hotels whose payment is overdue.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { createHotel, getHotel, listHotels, updateHotel } from '../lib/db';
import { assignPlan, closeSignup, listPlans, listSignups, listSubPayments, pauseOverdue, recordSubPayment, savePlan, seedPlans, subState } from '../lib/saas';
import { MODULES } from '../modules/registry';
import { downloadCsv } from '../lib/csv';
import { doc, getDoc, setDoc } from '../backend/firestore';
import { db } from '../firebase';
import { Button, Field, Input, Modal, Select, Textarea, Toggle, useToast, errMsg } from '../components/ui';
import { Chip, DataTable, ModulePage, Panel, Stats, fmtDate, money, num, today } from '../modules/kit';
import { subInvoicePdf } from './subInvoice';
import { genPassword, LoginFields } from './AdminHome';
import { signupUrl } from '../modules/guests/publicLinks';

const TONE = { trial: 'info', active: 'ok', past_due: 'warn', expired: 'error', paused: 'error', none: 'muted' };
const OPTIONAL = MODULES.filter((m) => !m.core);

function PlanModal({ plan, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ name: '', monthly: '', yearly: '', maxRooms: 0, trialDays: 14, blurb: '', paymentLink: '', active: true, modules: [], all: false, ...(plan || {}), ...(plan && plan.modules === null ? { all: true, modules: [] } : {}) });
  async function save() {
    if (!v.name.trim()) return toast('Name the plan.', 'error');
    try {
      await savePlan(user, plan?.id, { name: v.name.trim(), monthly: num(v.monthly), yearly: num(v.yearly), maxRooms: num(v.maxRooms), trialDays: num(v.trialDays), blurb: v.blurb.trim(), paymentLink: v.paymentLink.trim(), active: !!v.active, modules: v.all ? null : v.modules, order: plan?.order ?? 9 });
      toast('Plan saved'); onSaved(); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} wide title={plan?.id ? `Edit ${plan.name}` : 'New plan'} icon="workspace_premium" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save plan</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-3">
        <Field label="Plan name"><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Price per month"><Input type="number" min="0" value={v.monthly} onChange={(e) => setV({ ...v, monthly: e.target.value })} /></Field>
        <Field label="Price per year"><Input type="number" min="0" value={v.yearly} onChange={(e) => setV({ ...v, yearly: e.target.value })} /></Field>
        <Field label="Room limit (0 = none)"><Input type="number" min="0" value={v.maxRooms} onChange={(e) => setV({ ...v, maxRooms: e.target.value })} /></Field>
        <Field label="Free trial days"><Input type="number" min="0" value={v.trialDays} onChange={(e) => setV({ ...v, trialDays: e.target.value })} /></Field>
        <div className="flex items-end"><Toggle label="Offered to new hotels" checked={!!v.active} onChange={(x) => setV({ ...v, active: x })} /></div>
        <Field label="Short description" className="sm:col-span-3"><Input value={v.blurb} onChange={(e) => setV({ ...v, blurb: e.target.value })} /></Field>
        <Field label="Payment link (Razorpay / UPI payment page)" className="sm:col-span-3" hint="Hotel owners see a Pay button that opens this link."><Input value={v.paymentLink} onChange={(e) => setV({ ...v, paymentLink: e.target.value })} placeholder="https://rzp.io/l/…" /></Field>
        <div className="sm:col-span-3">
          <Toggle label="Includes every module" checked={!!v.all} onChange={(x) => setV({ ...v, all: x })} />
          {!v.all && (
            <div className="mt-2 grid gap-1 sm:grid-cols-3">
              {OPTIONAL.map((m) => (
                <label key={m.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-body-md hover:bg-surface-container-low">
                  <input type="checkbox" checked={v.modules.includes(m.id)} onChange={(e) => setV({ ...v, modules: e.target.checked ? [...v.modules, m.id] : v.modules.filter((x) => x !== m.id) })} />{m.label}
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-label-md text-on-surface-variant">Billing, rooms, guests and sales reports are always included.</p>
        </div>
      </div>
    </Modal>
  );
}

function HotelPlanModal({ hotel, plans, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [planId, setPlanId] = useState(hotel.planId || plans[0]?.id || '');
  const [cycle, setCycle] = useState(hotel.billingCycle || 'monthly');
  const [trial, setTrial] = useState(!hotel.planId);
  async function save() {
    const plan = plans.find((p) => p.id === planId);
    if (!plan) return;
    try { await assignPlan(user, hotel, plan, { cycle, trial }); toast(`${hotel.name}: ${plan.name}`); onSaved(); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title={`Plan for ${hotel.name}`} icon="workspace_premium" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Plan"><Select value={planId} onChange={(e) => setPlanId(e.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Billed"><Select value={cycle} onChange={(e) => setCycle(e.target.value)}><option value="monthly">Monthly</option><option value="yearly">Yearly</option></Select></Field>
        <div className="sm:col-span-2"><Toggle label="Start a free trial" description="Otherwise the hotel stays on its current paid period." checked={trial} onChange={setTrial} /></div>
      </div>
    </Modal>
  );
}

function PayModal({ hotel, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const months = hotel.billingCycle === 'yearly' ? 12 : 1;
  const [v, setV] = useState({ amount: String(hotel.price || ''), months, method: 'UPI', ref: '', date: today() });
  async function save() {
    if (!(num(v.amount) > 0)) return toast('Enter the amount received.', 'error');
    try { const r = await recordSubPayment(user, hotel, v); toast(`${r.number}: paid until ${fmtDate(r.to)}`); onSaved(); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title={`Payment from ${hotel.name}`} icon="payments" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Record payment</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Amount"><Input type="number" min="0" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="Months covered"><Input type="number" min="1" value={v.months} onChange={(e) => setV({ ...v, months: e.target.value })} /></Field>
        <Field label="Method"><Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{['UPI', 'Razorpay', 'Bank Transfer', 'Card', 'Cash', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Reference"><Input value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} placeholder="pay_… / UTR" /></Field>
        <Field label="Received on"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ApproveModal({ req, plans, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({ username: req.username || '', password: genPassword() });
  const [planId, setPlanId] = useState(req.planId || plans[0]?.id || '');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const hid = await createHotel(user, { hotelName: req.hotelName, city: req.city || '', owner: { name: req.ownerName, username: f.username, password: f.password, phone: req.phone || '' } });
      const plan = plans.find((p) => p.id === planId);
      if (plan) await assignPlan(user, { id: hid, name: req.hotelName }, plan, { trial: true });
      await updateHotel(user, hid, { ownerEmail: req.email || '', ownerPhone: req.phone || '', rooms: num(req.rooms) });
      await closeSignup(user, req.id, 'Approved', { hotelId: hid, username: f.username.trim().toLowerCase() });
      toast(`${req.hotelName} created. Send the owner: username ${f.username.trim().toLowerCase()}, password ${f.password}`);
      onSaved(); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} wide title={`Approve ${req.hotelName}`} icon="add_business" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} icon="check">Create hotel and owner login</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <p className="rounded-lg bg-surface-container-low p-3 text-body-md sm:col-span-2">{req.ownerName} · {req.phone} · {req.email}<br />{req.city}{req.rooms ? ` · ${req.rooms} rooms` : ''}{req.message ? ` · “${req.message}”` : ''}</p>
        <Field label="Plan (starts with a free trial)" className="sm:col-span-2"><Select value={planId} onChange={(e) => setPlanId(e.target.value)}>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <LoginFields f={f} setF={setF} passwordLabel="Owner password" />
      </div>
    </Modal>
  );
}

function SiteModal({ site, onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState({ brand: 'StayBill', graceDays: 7, address: '', gstin: '', email: '', razorpayKeyId: '', ...site });
  async function save() {
    try { await setDoc(doc(db, 'meta', 'billing'), { ...v, graceDays: num(v.graceDays) }, { merge: true }); toast('Saved'); onSaved(); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title="Billing settings" icon="tune" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Your business name"><Input value={v.brand} onChange={(e) => setV({ ...v, brand: e.target.value })} /></Field>
        <Field label="Grace days before pausing"><Input type="number" min="0" value={v.graceDays} onChange={(e) => setV({ ...v, graceDays: e.target.value })} /></Field>
        <Field label="Address on invoices" className="sm:col-span-2"><Textarea rows={2} value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} /></Field>
        <Field label="Your GSTIN"><Input value={v.gstin} onChange={(e) => setV({ ...v, gstin: e.target.value.toUpperCase() })} /></Field>
        <Field label="Billing email"><Input type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></Field>
        <Field label="Razorpay key ID (for checkout, when connected)" className="sm:col-span-2" hint="Card / UPI checkout needs a small server step with your Razorpay secret. Until then, use payment links on each plan."><Input value={v.razorpayKeyId} onChange={(e) => setV({ ...v, razorpayKeyId: e.target.value })} placeholder="rzp_live_…" /></Field>
      </div>
    </Modal>
  );
}

export default function AdminPlans() {
  const { user } = useAuth();
  const toast = useToast();
  const [tab, setTab] = useState('hotels');
  const [hotels, setHotels] = useState(null);
  const [plans, setPlans] = useState(null);
  const [pays, setPays] = useState(null);
  const [signups, setSignups] = useState(null);
  const [site, setSite] = useState({});
  const [modal, setModal] = useState(null);
  const load = useCallback(async () => {
    try {
      let p = await listPlans();
      if (!p) { await seedPlans(user); p = await listPlans(); }
      const [h, sp, su, s] = await Promise.all([listHotels(), listSubPayments(), listSignups(), getDoc(doc(db, 'meta', 'billing'))]);
      setPlans(p || []); setHotels(h); setPays(sp); setSignups(su); setSite(s.exists() ? s.data() : {});
    } catch (e) { toast(errMsg(e), 'error'); }
  }, [user, toast]);
  useEffect(() => { load(); }, [load]);
  const grace = num(site.graceDays ?? 7);
  const rows = useMemo(() => (hotels || []).map((h) => ({ ...h, sub: subState(h, grace) })), [hotels, grace]);
  const mrr = rows.filter((h) => ['active', 'past_due'].includes(h.sub.status)).reduce((a, h) => a + (h.billingCycle === 'yearly' ? num(h.price) / 12 : num(h.price)), 0);
  const month = today().slice(0, 7);
  async function runPause() {
    try { const names = await pauseOverdue(user, hotels || [], grace); toast(names.length ? `Paused: ${names.join(', ')}` : 'No hotel is past its grace period'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function refresh(h) { const fresh = await getHotel(h.id); return { ...h, ...fresh }; }
  const newSignups = (signups || []).filter((s) => s.status === 'New');
  return (
    <ModulePage crumb={['Administrator', 'Plans & billing']} title="Plans & billing" subtitle="Subscriptions for every hotel on this StayBill site"
      tabs={[{ id: 'hotels', label: 'Hotels', icon: 'apartment' }, { id: 'plans', label: 'Plans', icon: 'workspace_premium' }, { id: 'payments', label: 'Payments', icon: 'receipt_long' }, { id: 'signups', label: 'Sign-ups', icon: 'person_add', count: newSignups.length || undefined }]} tab={tab} onTab={setTab}
      actions={<>
        <Button variant="secondary" icon="content_copy" onClick={() => navigator.clipboard?.writeText(signupUrl()).then(() => toast('Sign-up link copied')).catch(() => toast(signupUrl()))}>Sign-up link</Button>
        <Button variant="secondary" icon="tune" onClick={() => setModal({ kind: 'site' })}>Settings</Button>
        {tab === 'plans' && <Button icon="add" onClick={() => setModal({ kind: 'plan', plan: null })}>New plan</Button>}
        {tab === 'hotels' && <Button variant="secondary" icon="pause_circle" onClick={runPause}>Pause overdue</Button>}
      </>}>
      <Stats items={[
        { label: 'Monthly recurring', value: money(mrr), icon: 'trending_up', sub: `${rows.filter((h) => h.sub.status === 'active').length} paying hotels` },
        { label: 'In trial', value: rows.filter((h) => h.sub.status === 'trial').length, icon: 'hourglass_top' },
        { label: 'Overdue', value: rows.filter((h) => ['past_due', 'expired'].includes(h.sub.status)).length, icon: 'warning', tone: rows.some((h) => ['past_due', 'expired'].includes(h.sub.status)) ? 'error' : undefined },
        { label: 'Collected this month', value: money((pays || []).filter((p) => (p.date || '').startsWith(month)).reduce((a, p) => a + num(p.amount), 0)), icon: 'payments' },
      ]} />
      {tab === 'hotels' && (
        <DataTable rows={hotels ? rows : null} search={(h) => `${h.name} ${h.city} ${h.planName || ''}`} empty="No hotels yet."
          filters={[{ id: 'all', label: 'All' }, { id: 'due', label: 'Overdue', test: (h) => ['past_due', 'expired', 'paused'].includes(h.sub.status) }, { id: 'trial', label: 'Trial', test: (h) => h.sub.status === 'trial' }]}
          columns={[
            { key: 'n', label: 'Hotel', render: (h) => <><b>{h.name}</b><div className="text-label-sm text-on-surface-variant">{h.city || ''}{h.ownerName ? ` · ${h.ownerName}` : ''}</div></> },
            { key: 'p', label: 'Plan', render: (h) => (h.planName ? <>{h.planName}<div className="text-label-sm text-on-surface-variant">{money(h.price || 0)} / {h.billingCycle === 'yearly' ? 'year' : 'month'}</div></> : <Chip>None</Chip>) },
            { key: 's', label: 'Status', render: (h) => <Chip tone={TONE[h.sub.status]}>{h.sub.label}</Chip> },
            { key: 'd', label: 'Paid until', render: (h) => (h.sub.due ? <span className={h.sub.due < today() ? 'text-error' : ''}>{fmtDate(h.sub.due)}</span> : '—') },
          ]}
          actions={(h) => (
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" icon="workspace_premium" onClick={() => setModal({ kind: 'hotelPlan', hotel: h })}>Plan</Button>
              {h.planId && <Button size="sm" variant="secondary" icon="payments" onClick={async () => setModal({ kind: 'pay', hotel: await refresh(h) })}>Payment</Button>}
            </div>
          )} />
      )}
      {tab === 'plans' && (
        <div className="grid gap-space-md md:grid-cols-3">
          {(plans || []).map((p) => (
            <Panel key={p.id} title={p.name} icon="workspace_premium" actions={<Button size="sm" variant="ghost" icon="edit" onClick={() => setModal({ kind: 'plan', plan: p })}>Edit</Button>}>
              <div className="font-headline text-headline-md">{money(p.monthly)}<span className="text-body-md text-on-surface-variant"> / month</span></div>
              <div className="text-label-md text-on-surface-variant">{money(p.yearly)} / year · {p.trialDays} day trial · {p.maxRooms ? `up to ${p.maxRooms} rooms` : 'any number of rooms'}</div>
              <p className="mt-2 text-body-md">{p.blurb}</p>
              <div className="mt-2 flex flex-wrap gap-1">{p.modules === null ? <Chip tone="ok">Every module</Chip> : p.modules.map((id) => <Chip key={id}>{MODULES.find((m) => m.id === id)?.label || id}</Chip>)}</div>
              <div className="mt-2 text-label-md text-on-surface-variant">{rows.filter((h) => h.planId === p.id).length} hotels{p.active === false ? ' · not offered' : ''}{p.paymentLink ? ' · payment link set' : ''}</div>
            </Panel>
          ))}
        </div>
      )}
      {tab === 'payments' && (
        <DataTable rows={pays} empty="No subscription payments yet." search={(p) => `${p.number} ${p.hotelName} ${p.ref}`}
          toolbar={<Button size="sm" variant="ghost" icon="file_download" onClick={() => downloadCsv(`subscription-payments-${today()}.csv`, ['Invoice', 'Date', 'Hotel', 'Plan', 'Months', 'From', 'To', 'Amount', 'Method', 'Ref'], (pays || []).map((p) => [p.number, p.date, p.hotelName, p.planName, p.months, p.from, p.to, p.amount, p.method, p.ref]))}>CSV</Button>}
          columns={[
            { key: 'n', label: 'Invoice', render: (p) => <><b>{p.number}</b><div className="text-label-sm text-on-surface-variant">{fmtDate(p.date)}</div></> },
            { key: 'h', label: 'Hotel', render: (p) => <>{p.hotelName}<div className="text-label-sm text-on-surface-variant">{p.planName}</div></> },
            { key: 'per', label: 'Period', render: (p) => `${fmtDate(p.from)} – ${fmtDate(p.to)}` },
            { key: 'm', label: 'Paid by', render: (p) => `${p.method}${p.ref ? ` · ${p.ref}` : ''}` },
            { key: 'a', label: 'Amount', right: true, render: (p) => <b>{money(p.amount)}</b> },
          ]}
          actions={(p) => <Button size="sm" variant="ghost" icon="picture_as_pdf" aria-label="Invoice PDF" onClick={() => subInvoicePdf(p, site)} />} />
      )}
      {tab === 'signups' && (
        <DataTable rows={signups} empty="No sign-up requests. Share the sign-up link with hotels that want to join."
          filters={[{ id: 'new', label: 'New', test: (s) => s.status === 'New' }, { id: 'all', label: 'All' }]}
          columns={[
            { key: 'h', label: 'Hotel', render: (s) => <><b>{s.hotelName}</b><div className="text-label-sm text-on-surface-variant">{s.city}{s.rooms ? ` · ${s.rooms} rooms` : ''}</div></> },
            { key: 'o', label: 'Owner', render: (s) => <>{s.ownerName}<div className="text-label-sm text-on-surface-variant">{[s.phone, s.email].filter(Boolean).join(' · ')}</div></> },
            { key: 'p', label: 'Plan', render: (s) => (plans || []).find((p) => p.id === s.planId)?.name || '—' },
            { key: 'd', label: 'Received', render: (s) => fmtDate(s.date) },
            { key: 's', label: 'Status', render: (s) => <Chip tone={{ New: 'warn', Approved: 'ok', Declined: 'muted' }[s.status]}>{s.status}</Chip> },
          ]}
          actions={(s) => (s.status === 'New' ? <div className="flex justify-end gap-1"><Button size="sm" icon="check" onClick={() => setModal({ kind: 'approve', req: s })}>Approve</Button><Button size="sm" variant="ghost" onClick={async () => { await closeSignup(user, s.id, 'Declined'); load(); }}>Decline</Button></div> : null)} />
      )}
      {modal?.kind === 'plan' && <PlanModal plan={modal.plan} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.kind === 'hotelPlan' && <HotelPlanModal hotel={modal.hotel} plans={plans || []} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.kind === 'pay' && <PayModal hotel={modal.hotel} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.kind === 'approve' && <ApproveModal req={modal.req} plans={plans || []} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.kind === 'site' && <SiteModal site={site} onClose={() => setModal(null)} onSaved={load} />}
    </ModulePage>
  );
}

