import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Users } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { createGuest, updateGuest, searchGuests, listGuests, findGuestByPhone, guestBills } from '../lib/db';
import { money, fmtDay } from '../lib/format';
import { initials } from '../components/Layout';
import { Icon } from '../components/icons';
import { Hi } from '../motion/hotel';
import { Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, Textarea, Toggle, useToast, errMsg, cx } from '../components/ui';
import { ImageField } from '../modules/kit';

export const GUEST_PREFS = ['Non-smoking', 'High floor', 'Quiet room', 'Twin beds', 'King bed', 'Extra pillows', 'Vegetarian', 'Jain food', 'Early check-in', 'Late check-out', 'Airport pickup', 'Newspaper'];

/** Guest card that flips to show stay history (motion pick 18). Stats load on first flip. */
function GuestCard({ g, term, onOpen }) {
  const [stats, setStats] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const asked = useRef(false);
  const load = () => {
    if (asked.current) return;
    asked.current = true;
    guestBills(g.id).then((bills) => {
      const live = bills.filter((b) => b.paymentStatus !== 'CANCELLED');
      const last = [...live].sort((a, b) => (a.checkIn < b.checkIn ? 1 : -1))[0];
      setStats({ stays: live.length, spent: live.reduce((s, b) => s + b.grandTotal, 0), due: live.reduce((s, b) => s + b.balanceAmount, 0), last });
    }).catch(() => setStats({ stays: 0, spent: 0, due: 0 }));
  };
  return (
    <div className={cx('hm hm-gcard', flipped && 'flipped')} onMouseEnter={load} onFocus={load}>
      <div className="hm-gcard-in">
        <div className="hm-gcard-face bg-surface-container-lowest shadow-sm ring-1 ring-outline-variant/30">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-container font-headline text-label-lg font-semibold text-on-primary">{initials(g.name)}</span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 truncate font-headline text-headline-sm text-on-surface"><Hi text={g.name} term={term} />{g.vip && <span className="rounded-full bg-warn-container px-1.5 text-label-sm text-on-warn-container">VIP</span>}{g.blacklisted && <span className="rounded-full bg-error-container px-1.5 text-label-sm text-on-error-container">Blocked</span>}</div>
              <div className="truncate text-label-md text-on-surface-variant">{g.phone ? <Hi text={g.phone} term={term} /> : 'No phone'}</div>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 text-label-md text-on-surface-variant">
            <span className="truncate">{g.email || (g.gstin ? `GSTIN ${g.gstin}` : 'Guest')}</span>
            <button type="button" onClick={() => { load(); setFlipped(true); }} className="shrink-0 rounded-md px-1.5 py-0.5 text-secondary hover:bg-surface-container-low sm:hidden">History</button>
            <span className="hidden shrink-0 items-center gap-1 text-label-sm sm:flex"><Icon name="flip" size={14} />Hover for history</span>
          </div>
        </div>
        <div className="hm-gcard-face back">
          <div className="flex items-center justify-between text-label-sm uppercase tracking-wider opacity-80"><span>Stay history</span>{flipped && <button type="button" onClick={() => setFlipped(false)} className="rounded px-1 normal-case tracking-normal hover:bg-white/10">Back</button>}</div>
          {!stats ? <div className="text-body-md opacity-80">Loading…</div> : (
            <div className="grid grid-cols-3 gap-2">
              <div><div className="font-headline text-headline-md">{stats.stays}</div><div className="text-label-sm opacity-80">stay{stats.stays === 1 ? '' : 's'}</div></div>
              <div><div className="truncate font-headline text-headline-sm">{money(stats.spent)}</div><div className="text-label-sm opacity-80">billed</div></div>
              <div><div className="font-headline text-headline-sm">{stats.last ? stats.last.roomNumber : '—'}</div><div className="text-label-sm opacity-80">last room</div></div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-label-md">
            <span className="truncate opacity-85">{stats?.last ? `Last stay ${fmtDay(stats.last.checkIn)}` : ''}{stats?.due > 0 ? ` · ${money(stats.due)} due` : ''}</span>
            <button type="button" onClick={onOpen} className="shrink-0 rounded-md bg-white/15 px-2 py-1 font-semibold hover:bg-white/25">Open</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GuestFormModal({ open, onClose, guest, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({});
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setF({ name: '', phone: '', email: '', address: '', gstin: '', notes: '', ...(guest || {}) }); setErr({}); }
  }, [open, guest]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    const e = {};
    if (!f.name?.trim()) e.name = 'Guest name cannot be empty.';
    if (f.phone && !/^[0-9+\-\s]{6,15}$/.test(f.phone)) e.phone = 'Enter a valid phone number.';
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) e.email = 'Enter a valid email.';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (f.phone && !guest?.id) {
        const dup = await findGuestByPhone(f.phone);
        if (dup) { setErr({ phone: `Already saved as ${dup.name}.` }); setBusy(false); return; }
      }
      const id = guest?.id ? (await updateGuest(user, guest.id, f), guest.id) : await createGuest(user, f);
      toast(guest?.id ? 'Guest updated' : 'Guest added');
      onSaved?.(id);
      onClose();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={onClose} title={guest?.id ? 'Edit guest' : 'Add guest'} wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save guest</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Guest name" required error={err.name}><Input value={f.name || ''} onChange={set('name')} autoFocus invalid={!!err.name} /></Field>
        <Field label="Phone number" error={err.phone}><Input type="tel" value={f.phone || ''} onChange={set('phone')} invalid={!!err.phone} /></Field>
        <Field label="Email" error={err.email}><Input type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="GSTIN (if applicable)"><Input className="uppercase" value={f.gstin || ''} onChange={set('gstin')} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={f.address || ''} onChange={set('address')} /></Field>
        <div className="mt-1 text-label-sm font-semibold uppercase tracking-wider text-secondary sm:col-span-2">Guest profile</div>
        <Field label="Birthday"><Input type="date" value={f.birthday || ''} onChange={set('birthday')} /></Field>
        <Field label="Anniversary"><Input type="date" value={f.anniversary || ''} onChange={set('anniversary')} /></Field>
        <Field label="Company"><Input value={f.company || ''} onChange={set('company')} /></Field>
        <Field label="Nationality"><Input value={f.nationality || ''} onChange={set('nationality')} placeholder="Indian" /></Field>
        <Field label="ID type">
          <Select value={f.idType || ''} onChange={set('idType')}>
            <option value="">—</option>{['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'PAN', 'Other'].map((t) => <option key={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="ID number"><Input value={f.idNumber || ''} onChange={set('idNumber')} /></Field>
        <div className="sm:col-span-2"><div className="mb-1 text-label-sm uppercase tracking-wider text-on-surface-variant">ID photo</div><ImageField value={f.idImage || ''} onChange={(v) => setF({ ...f, idImage: v })} /></div>
        <div className="sm:col-span-2" role="group" aria-label="Preferences">
          <div className="mb-1 text-label-sm uppercase tracking-wider text-on-surface-variant">Preferences</div>
          <div className="flex flex-wrap gap-1.5">
            {GUEST_PREFS.map((o) => {
              const on = (f.preferences || []).includes(o);
              return <button type="button" key={o} onClick={() => setF({ ...f, preferences: on ? f.preferences.filter((x) => x !== o) : [...(f.preferences || []), o] })}
                className={cx('rounded-full px-3 py-1 text-label-md ring-1', on ? 'bg-primary-container text-on-primary ring-transparent' : 'text-on-surface-variant ring-outline-variant hover:bg-surface-container-low')}>{o}</button>;
            })}
          </div>
        </div>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
        <div className="space-y-2 sm:col-span-2">
          <Toggle label="VIP guest" description="Shown with a VIP badge at check-in and in the guest list." checked={!!f.vip} onChange={(v) => setF({ ...f, vip: v })} />
          <Toggle label="Do not send marketing" description="Leaves this guest out of campaigns and automatic messages." checked={!!f.marketingOptOut} onChange={(v) => setF({ ...f, marketingOptOut: v })} />
          <Toggle label="Blacklisted" description="Warns the front desk when this guest is picked on a bill or booking." checked={!!f.blacklisted} onChange={(v) => setF({ ...f, blacklisted: v })} />
          {f.blacklisted && <Input value={f.blacklistReason || ''} onChange={set('blacklistReason')} placeholder="Reason (staff only)" />}
        </div>
      </div>
    </Modal>
  );
}

export default function Guests() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const toast = useToast();
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(params.get('new') === '1');
  const [view, setView] = useState('cards');

  useEffect(() => {
    const t = setTimeout(() => {
      (term.trim() ? searchGuests(term, 50) : listGuests(100)).then(setRows).catch((e) => { toast(errMsg(e), 'error'); setRows([]); });
    }, 250);
    return () => clearTimeout(t);
  }, [term, toast]);

  return (
    <div>
      <PageHeader crumbs={['Front Desk', 'Guest Directory']} title="Guests" subtitle="Guest details and billing history" actions={<Button onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add Guest</Button>} />
      <Card className="mb-4 p-3 sm:p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="hm-search pl-9" placeholder="Search by name or phone…" value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        <div className="mt-space-sm flex gap-1" role="radiogroup" aria-label="View">
          {[['cards', 'Cards', 'grid_view'], ['table', 'Table', 'table_rows']].map(([v, l, i]) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => setView(v)}
              className={cx('flex items-center gap-1 rounded-lg px-space-sm py-1 text-label-md', view === v ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-low')}><Icon name={i} size={14} />{l}</button>
          ))}
        </div>
      </Card>
      {view === 'cards' && rows && rows.length > 0 ? (
        <div className="grid gap-space-md sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((g) => <GuestCard key={g.id} g={g} term={term} onOpen={() => nav(`/guests/${g.id}`)} />)}
        </div>
      ) : (
      <Card>
        {!rows ? <Loading /> : rows.length === 0 ? <Empty icon={Users} title={term ? 'No guests found' : 'No guests yet'}>Guests are also saved automatically when you create a bill.</Empty> : (
          <Table head={['Name', 'Phone', 'Email', 'GSTIN']}>
            {rows.map((g) => (
              <tr key={g.id} onClick={() => nav(`/guests/${g.id}`)} className="cursor-pointer hover:bg-slate-50">
                <Td className="font-medium text-slate-900">{g.name}</Td>
                <Td>{g.phone || '—'}</Td>
                <Td>{g.email || '—'}</Td>
                <Td>{g.gstin || '—'}</Td>
              </tr>
            ))}
          </Table>
        )}
        {rows && !term && rows.length >= 100 && <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Showing the first 100 guests alphabetically — use search to find others.</p>}
      </Card>
      )}
      <GuestFormModal open={open} onClose={() => { setOpen(false); if (params.get('new')) setParams({}); }} onSaved={(id) => nav(`/guests/${id}`)} />
    </div>
  );
}
