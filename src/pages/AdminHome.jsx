// Administrator dashboard: every hotel on this StayBill site, their owners and
// staff logins, and this month's totals. The administrator can open any hotel
// to see it exactly as its owner does.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  createAccount, createHotel, hotelMonth, listHotels, listUsers, resetPassword, updateAccount, updateHotel,
  usernameProblem, passwordProblem,
} from '../lib/db';
import { money } from '../lib/format';
import { Icon } from '../components/icons';
import { Badge, Button, Card, Empty, Field, Input, Modal, Table, Td, Tabs, useConfirm, useToast, errMsg, cx } from '../components/ui';
import { MetricCard } from '../components/ui';
import { NightBand, Skyline } from './Welcome';
import { Starfield, Reveal } from '../motion';
import { Odometer } from '../motion/hotel';
import './welcome.css';

export function genPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(10));
  return [...r].map((x) => a[x % a.length]).join('');
}
const ROLE_LABEL = { admin: 'Administrator', owner: 'Hotel owner', employee: 'Employee' };

/** Username + password fields with "suggest a password". */
export function LoginFields({ f, setF, err = {}, passwordLabel = 'Password', needPassword = true }) {
  const [show, setShow] = useState(true);
  return (
    <>
      <Field label="Username" required error={err.username} hint="They sign in with this. Letters, numbers, dots or dashes.">
        <Input id="acct-username" autoCapitalize="none" spellCheck={false} value={f.username || ''} onChange={(e) => setF({ ...f, username: e.target.value })} invalid={!!err.username} />
      </Field>
      {needPassword && (
        <Field label={passwordLabel} required error={err.password} hint="At least 6 characters. Share it with them privately.">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input id="acct-password" type={show ? 'text' : 'password'} autoComplete="new-password" className="pr-9 font-mono" value={f.password || ''} onChange={(e) => setF({ ...f, password: e.target.value })} invalid={!!err.password} />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant" aria-label={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'visibility_off' : 'visibility'} size={16} /></button>
            </div>
            <Button type="button" variant="secondary" icon="casino" onClick={() => setF({ ...f, password: genPassword() })}>Suggest</Button>
          </div>
        </Field>
      )}
    </>
  );
}
function checkLogin(f, needPassword = true) {
  const e = {};
  const u = usernameProblem(f.username); if (u) e.username = u;
  if (needPassword) { const p = passwordProblem(f.password); if (p) e.password = p; }
  return e;
}

function HotelModal({ open, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({});
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ hotelName: '', city: '', name: '', username: '', password: genPassword() }); setErr({}); } }, [open]);
  async function save() {
    const e = {};
    if (!f.hotelName?.trim()) e.hotelName = 'Enter the hotel name.';
    if (!f.name?.trim()) e.name = 'Enter the owner’s name.';
    Object.assign(e, checkLogin(f));
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await createHotel(user, { hotelName: f.hotelName.trim(), city: f.city.trim(), owner: { name: f.name.trim(), username: f.username, password: f.password } });
      toast(`${f.hotelName.trim()} added. Owner login: ${f.username.trim().toLowerCase()}`);
      onSaved?.(); onClose();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title="Add a hotel" icon="add_business" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} icon="check">Add hotel and owner</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Hotel name" required error={err.hotelName}><Input id="hotel-name" value={f.hotelName || ''} onChange={(e) => setF({ ...f, hotelName: e.target.value })} autoFocus invalid={!!err.hotelName} placeholder="e.g. Sea Breeze Residency" /></Field>
        <Field label="City"><Input id="hotel-city" value={f.city || ''} onChange={(e) => setF({ ...f, city: e.target.value })} placeholder="e.g. Chennai" /></Field>
        <div className="sm:col-span-2 mt-1 border-t border-surface-container pt-3 text-label-sm uppercase tracking-wider text-on-surface-variant">Owner's login</div>
        <Field label="Owner's name" required error={err.name} className="sm:col-span-2"><Input id="owner-name" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!err.name} /></Field>
        <LoginFields f={f} setF={setF} err={err} />
      </div>
      <p className="pb-space-sm text-label-md text-on-surface-variant">The hotel starts with CGST/SGST 2.5% each, standard room types and invoices from INV-1001. The owner can change all of this.</p>
    </Modal>
  );
}

function AccountModal({ open, onClose, preset, hotels, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({});
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setF({ name: '', username: '', password: genPassword(), role: 'owner', hotelId: hotels[0]?.id || '', ...preset }); setErr({}); } }, [open, preset, hotels]);
  async function save() {
    const e = checkLogin(f);
    if (!f.name?.trim()) e.name = 'Enter their name.';
    if (f.role !== 'admin' && !f.hotelId) e.hotelId = 'Choose a hotel.';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      await createAccount(user, { name: f.name.trim(), username: f.username, password: f.password, role: f.role, hotelId: f.role === 'admin' ? null : f.hotelId });
      toast(`Login created: ${f.username.trim().toLowerCase()}`);
      onSaved?.(); onClose();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title="Add a login" icon="person_add"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Create login</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <Field label="Role">
          <select id="acct-role" className="block h-10 w-full rounded-lg border-0 bg-surface-container-low px-space-md text-body-md text-on-surface" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="owner">Hotel owner</option>
            <option value="employee">Employee (front desk)</option>
            <option value="admin">Administrator (whole site)</option>
          </select>
        </Field>
        {f.role !== 'admin' && (
          <Field label="Hotel" error={err.hotelId}>
            <select id="acct-hotel" className="block h-10 w-full rounded-lg border-0 bg-surface-container-low px-space-md text-body-md text-on-surface" value={f.hotelId} onChange={(e) => setF({ ...f, hotelId: e.target.value })}>
              {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}{h.city ? ` · ${h.city}` : ''}</option>)}
            </select>
          </Field>
        )}
        <Field label="Name" required error={err.name}><Input id="acct-name" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} invalid={!!err.name} /></Field>
        <LoginFields f={f} setF={setF} err={err} />
      </div>
    </Modal>
  );
}

export function ResetPasswordModal({ target, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) setPw(genPassword()); }, [target]);
  async function save() {
    const p = passwordProblem(pw); if (p) return toast(p, 'error');
    setBusy(true);
    try { await resetPassword(user, target, pw); toast(`New password set for ${target.username}`); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open={!!target} onClose={onClose} title={`New password for ${target?.name || ''}`} icon="key"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Set password</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <p className="text-body-md text-on-surface-variant">Username <b className="font-mono text-on-surface">{target?.username}</b>. They will be signed out of other devices and use this password next time.</p>
        <LoginFields f={{ username: target?.username, password: pw }} setF={(x) => setPw(x.password)} passwordLabel="New password" />
      </div>
    </Modal>
  );
}

export default function AdminHome({ tab: initialTab = 'hotels' }) {
  const { user, setAdminHotel } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState(initialTab);
  const [hotels, setHotels] = useState(null);
  const [people, setPeople] = useState([]);
  const [stats, setStats] = useState({});
  const [hotelOpen, setHotelOpen] = useState(false);
  const [acct, setAcct] = useState(null);
  const [reset, setReset] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => setTab(initialTab), [initialTab]);

  const load = useCallback(async () => {
    try {
      const [h, p] = await Promise.all([listHotels(), listUsers('all')]);
      setHotels(h); setPeople(p);
      const entries = await Promise.all(h.map((x) => hotelMonth(x.id).then((m) => [x.id, m]).catch(() => [x.id, null])));
      setStats(Object.fromEntries(entries));
    } catch (e) { toast(errMsg(e), 'error'); setHotels([]); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => {
    const vals = Object.values(stats).filter(Boolean);
    return {
      hotels: (hotels || []).length,
      active: (hotels || []).filter((h) => h.status !== 'suspended').length,
      owners: people.filter((p) => p.role === 'owner').length,
      staff: people.filter((p) => p.role === 'employee').length,
      revenue: vals.reduce((a, m) => a + m.revenue, 0),
      collected: vals.reduce((a, m) => a + m.collected, 0),
      outstanding: vals.reduce((a, m) => a + m.outstanding, 0),
      bills: vals.reduce((a, m) => a + m.bills, 0),
    };
  }, [stats, hotels, people]);

  const openHotel = (h) => { setAdminHotel(h.id); nav('/'); };
  async function toggleHotel(h) {
    const pause = h.status !== 'suspended';
    if (pause && !(await confirm(`Pause ${h.name}? Its owner and employees will not be able to sign in until you resume it. No data is deleted.`, { title: 'Pause hotel', confirmLabel: 'Pause hotel' }))) return;
    try { await updateHotel(user, h.id, { status: pause ? 'suspended' : 'active' }); toast(pause ? `${h.name} paused` : `${h.name} resumed`); load(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function togglePerson(p) {
    const off = p.status === 'active';
    if (p.id === user.uid) return toast('You cannot switch off your own login.', 'error');
    try { await updateAccount(user, p, { status: off ? 'inactive' : 'active' }); toast(off ? `${p.name} switched off` : `${p.name} switched on`); load(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  const hotelName = (id) => hotels?.find((h) => h.id === id)?.name || '—';
  const staffOf = (id) => people.filter((p) => p.hotelId === id && p.role === 'employee').length;
  const filtered = (hotels || []).filter((h) => !q || `${h.name} ${h.city} ${h.ownerName} ${h.ownerUsername}`.toLowerCase().includes(q.toLowerCase()));
  const hour = new Date().getHours();

  return (
    <div className="flex flex-col gap-space-lg">
      <NightBand className="-mt-2 rounded-3xl shadow-sm">
        <section className="relative min-h-[300px] overflow-hidden px-space-lg pb-space-lg pt-10">
          <div className="absolute inset-0 bg-[radial-gradient(900px_400px_at_70%_0%,rgb(var(--c-w-vivid)/.35),transparent_60%),linear-gradient(180deg,rgb(var(--c-w-bg2)),rgb(var(--c-w-bg)))]" />
          <Starfield className="absolute inset-0 h-full w-full" density={0.8} />
          <div className="absolute inset-x-0 bottom-0 h-[55%] opacity-35"><Skyline /></div>
          <div className="absolute inset-x-0 bottom-0 h-[75%] bg-gradient-to-t from-w-bg via-w-bg/85 to-transparent" />
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-w-glow">Administrator · whole site</p>
            <h1 className="mt-1 font-headline text-4xl font-bold tracking-tight text-white sm:text-5xl" style={{ background: 'none', color: '#fff', WebkitTextFillColor: '#fff' }}>{hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'}, {user.name.split(' ')[0]}</h1>
            <p className="mt-1 max-w-xl text-w-mist2">Every hotel on this StayBill site, their owners and staff, and how this month is going.</p>
            <div className="mt-6 grid max-w-3xl grid-cols-2 gap-4 sm:grid-cols-4">
              {[[totals.active, 'Hotels open'], [totals.owners, 'Owners'], [totals.staff, 'Employees'], [totals.bills, 'Bills this month']].map(([n, l]) => (
                <Reveal key={l}>
                  <div className="font-headline text-3xl font-bold text-white gsx-glow-text"><Odometer value={String(n)} /></div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-w-mist3">{l}</div>
                </Reveal>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={() => setHotelOpen(true)} className="wl-btn flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white"><Icon name="add_business" size={16} />Add a hotel</button>
              <button type="button" onClick={() => setAcct({})} className="flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-medium text-w-soft ring-1 ring-white/20 hover:bg-white/10"><Icon name="person_add" size={16} />Add a login</button>
            </div>
          </div>
        </section>
      </NightBand>

      <div className="grid grid-cols-1 gap-space-md sm:grid-cols-3">
        <MetricCard label="Invoiced this month (all hotels)" value={money(totals.revenue)} icon="trending_up" tone="accent" sub={`${totals.bills} bill${totals.bills === 1 ? '' : 's'}`} />
        <MetricCard label="Collected this month" value={money(totals.collected)} icon="check_circle" sub={totals.revenue ? `${Math.round((totals.collected / totals.revenue) * 100)}% of invoiced` : 'Nothing invoiced yet'} />
        <MetricCard label="Still to collect" value={money(totals.outstanding)} icon="pending_actions" tone="error" sub="On this month's bills" />
      </div>

      <Tabs value={tab} onChange={(t) => { setTab(t); nav(t === 'hotels' ? '/' : '/people'); }} tabs={[{ id: 'hotels', label: `Hotels (${totals.hotels})` }, { id: 'people', label: `Logins (${people.length})` }]} className="!mb-0" />

      {tab === 'hotels' ? (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 px-space-md py-space-md">
            <div className="relative w-full max-w-sm">
              <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-2.5 text-outline" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hotels, cities or owners…" aria-label="Search hotels"
                className="hm-search w-full rounded-lg bg-surface-container-low py-2 pl-9 pr-3 text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-secondary" />
            </div>
            <Button icon="add_business" onClick={() => setHotelOpen(true)}>Add a hotel</Button>
          </div>
          {!hotels ? <div className="py-12 text-center text-on-surface-variant">Loading hotels…</div> : filtered.length === 0 ? (
            <Empty title={hotels.length ? 'No hotels match' : 'No hotels yet'}>{hotels.length ? 'Try another search.' : 'Add your first hotel and its owner’s login.'}</Empty>
          ) : (
            <Table head={['Hotel', 'Owner login', 'Employees', { label: 'This month', right: true }, { label: 'To collect', right: true }, 'Status', '']}>
              {filtered.map((h) => {
                const m = stats[h.id];
                const owner = people.find((p) => p.id === h.ownerUid);
                return (
                  <tr key={h.id} className="h-16 hover:bg-surface-container-low/60">
                    <Td><div className="font-semibold">{h.name}</div><div className="text-label-sm text-on-surface-variant">{h.city || '—'}{h.importedFromEarlierVersion ? ' · imported' : ''}</div></Td>
                    <Td>{owner ? <><div>{owner.name}</div><div className="font-mono text-label-sm text-on-surface-variant">{owner.username}</div></> : (
                      <button type="button" onClick={() => setAcct({ role: 'owner', hotelId: h.id })} className="flex items-center gap-1 text-label-md font-medium text-secondary hover:underline"><Icon name="person_add" size={14} />Add owner</button>
                    )}</Td>
                    <Td>{staffOf(h.id)}</Td>
                    <Td right>{m ? <><div>{money(m.revenue)}</div><div className="text-label-sm text-on-surface-variant">{m.bills} bills</div></> : '—'}</Td>
                    <Td right className={m?.outstanding ? 'font-semibold text-error' : ''}>{m ? money(m.outstanding) : '—'}</Td>
                    <Td>{h.status === 'suspended' ? <Badge tone="red">Paused</Badge> : <Badge tone="green">Open</Badge>}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" icon="login" onClick={() => openHotel(h)}>Open</Button>
                        {owner && <Button size="sm" variant="ghost" icon="key" onClick={() => setReset(owner)} title="Set a new password for the owner">Owner password</Button>}
                        <Button size="sm" variant="ghost" icon={h.status === 'suspended' ? 'play_arrow' : 'pause'} onClick={() => toggleHotel(h)}>{h.status === 'suspended' ? 'Resume' : 'Pause'}</Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between px-space-md py-space-md">
            <p className="text-body-md text-on-surface-variant">Everyone who can sign in to this StayBill site.</p>
            <Button icon="person_add" onClick={() => setAcct({})}>Add a login</Button>
          </div>
          <Table head={['Name', 'Username', 'Role', 'Hotel', 'Status', '']}>
            {people.map((p) => (
              <tr key={p.id} className="h-14 hover:bg-surface-container-low/60">
                <Td className="font-semibold">{p.name}{p.id === user.uid && <span className="ml-1 text-label-sm font-normal text-on-surface-variant">(you)</span>}</Td>
                <Td className="font-mono">{p.username || '—'}</Td>
                <Td><Badge tone={p.role === 'admin' ? 'blue' : p.role === 'owner' ? 'green' : 'slate'}>{ROLE_LABEL[p.role] || p.role}</Badge></Td>
                <Td>{p.role === 'admin' ? 'All hotels' : hotelName(p.hotelId)}</Td>
                <Td>{p.status === 'active' ? <span className={cx('text-label-md font-semibold', 'text-on-ok-container')}>Active</span> : <span className="text-label-md text-on-surface-variant">Switched off</span>}</Td>
                <Td className="whitespace-nowrap text-right">
                  <Button size="sm" variant="ghost" icon="key" onClick={() => setReset(p)}>Password</Button>
                  {p.id !== user.uid && <Button size="sm" variant="ghost" icon={p.status === 'active' ? 'block' : 'check_circle'} onClick={() => togglePerson(p)}>{p.status === 'active' ? 'Switch off' : 'Switch on'}</Button>}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      <HotelModal open={hotelOpen} onClose={() => setHotelOpen(false)} onSaved={load} />
      <AccountModal open={!!acct} preset={acct || {}} hotels={hotels || []} onClose={() => setAcct(null)} onSaved={load} />
      <ResetPasswordModal target={reset} onClose={() => setReset(null)} />
    </div>
  );
}
