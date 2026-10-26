import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, Receipt } from '../components/icons';
import { Icon } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { getGuest, guestBills, deleteGuest } from '../lib/db';
import { money, fmtDay } from '../lib/format';
import { GuestFormModal } from './Guests';
import { StatCard } from './Dashboard';
import { Button, Card, CardHeader, Empty, Field, Input, Loading, Modal, StatusBadge, Table, Td, useToast, useConfirm, errMsg } from '../components/ui';
import { Chip, useLive } from '../modules/kit';
import { adjustPoints, loyaltyOf, tierFor } from '../modules/billOps';
import { waLink } from '../modules/guests/messaging';

export default function GuestDetail() {
  const { id } = useParams();
  const { user, isAdmin } = useAuth();
  const { settings, mods } = useData();
  const confirm = useConfirm();
  const nav = useNavigate();
  const toast = useToast();
  const [guest, setGuest] = useState(null);
  const [bills, setBills] = useState(null);
  const [edit, setEdit] = useState(false);
  const [adjust, setAdjust] = useState(false);
  const tx = useLive('loyaltyTx', { where: [['guestId', '==', id]] });
  const fb = useLive('feedback', { where: [['guestId', '==', id]] });

  const load = useCallback(() => {
    getGuest(id).then((g) => { if (!g) { nav('/guests'); return; } setGuest(g); }).catch((e) => toast(errMsg(e), 'error'));
    guestBills(id).then(setBills).catch(() => setBills([]));
  }, [id, nav, toast]);
  useEffect(() => { load(); }, [load]);

  async function remove() {
    if (!(await confirm(`Delete ${guest.name}? This cannot be undone.`, { title: 'Delete guest', confirmLabel: 'Delete guest' }))) return;
    try { await deleteGuest(user, id); toast('Guest deleted'); nav('/guests'); } catch (e) { toast(errMsg(e), 'error'); }
  }

  if (!guest) return <Loading />;
  const live = (bills || []).filter((b) => b.paymentStatus !== 'CANCELLED');
  const L = loyaltyOf(settings);
  const spend = guest.lifetimeSpend ?? live.reduce((s, b) => s + b.grandTotal, 0);
  const avgRating = (fb || []).length ? ((fb || []).reduce((a, f) => a + Number(f.rating || 0), 0) / fb.length).toFixed(1) : null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/guests" className="mb-1 inline-flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface"><ArrowLeft className="h-3.5 w-3.5" />Guests</Link>
          <div className="mb-1 flex items-center gap-space-xs text-label-sm uppercase tracking-wider text-on-surface-variant"><span>Guests</span><span>/</span><span className="font-semibold text-secondary">Guest profile</span></div>
          <h1 className="flex flex-wrap items-center gap-2 font-headline text-headline-lg tracking-tight text-on-surface">
            {guest.name}
            {guest.vip && <Chip tone="warn">VIP</Chip>}
            {L.enabled && <Chip tone="info">{tierFor(spend, settings)}</Chip>}
            {guest.blacklisted && <Chip tone="error">Blacklisted</Chip>}
          </h1>
          <p className="text-sm text-slate-500">{[guest.phone, guest.email, guest.company].filter(Boolean).join(' · ') || 'No contact details'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {guest.phone && <Button variant="secondary" icon="chat" onClick={() => window.open(waLink(guest.phone, `Hello ${guest.name.split(' ')[0]}, greetings from ${settings.hotelName || 'our hotel'}!`), '_blank', 'noopener')}>WhatsApp</Button>}
          <Button variant="secondary" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit</Button>
          {isAdmin && bills?.length === 0 && <Button variant="danger-ghost" onClick={remove}><Trash2 className="h-4 w-4" />Delete</Button>}
        </div>
      </div>

      {guest.blacklisted && (
        <div className="mb-4 flex items-center gap-2 rounded-xl bg-error-container p-3 text-body-md text-on-error-container"><Icon name="block" size={18} />Blacklisted{guest.blacklistReason ? `: ${guest.blacklistReason}` : ''}</div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Stays" value={live.length} />
        <StatCard label="Total billed" value={money(live.reduce((s, b) => s + b.grandTotal, 0))} />
        <StatCard label={L.enabled ? 'Loyalty points' : 'Total paid'} value={L.enabled ? (guest.points || 0).toLocaleString('en-IN') : money(live.reduce((s, b) => s + b.paidAmount, 0))} tone="green" />
        <StatCard label="Outstanding" value={money(live.reduce((s, b) => s + b.balanceAmount, 0))} tone="amber" />
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Billing History" />
            {!bills ? <Loading /> : bills.length === 0 ? <Empty icon={Receipt} title="No bills yet" /> : (
              <Table head={['Invoice', 'Date', 'Room', { label: 'Amount', right: true }, 'Status']}>
                {bills.map((b) => (
                  <tr key={b.id} onClick={() => nav(`/bills/${b.id}`)} className="cursor-pointer hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">{b.invoiceNumber}</Td>
                    <Td>{fmtDay(b.billDate, true)}</Td>
                    <Td>{b.roomNumber}</Td>
                    <Td right>{money(b.grandTotal)}</Td>
                    <Td><StatusBadge status={b.paymentStatus} /></Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
          {mods?.feedback && (fb || []).length > 0 && (
            <Card>
              <CardHeader title={`Feedback · ${avgRating}★`} />
              <div className="divide-y divide-surface-container px-4 pb-3">
                {fb.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((f) => (
                  <div key={f.id} className="py-2 text-body-md">
                    <div className="flex justify-between"><span className="text-warn">{'★'.repeat(Number(f.rating || 0))}<span className="text-outline-variant">{'★'.repeat(5 - Number(f.rating || 0))}</span></span><span className="text-label-md text-on-surface-variant">{fmtDay(f.date, true)} · Room {f.roomNumber || '—'}</span></div>
                    {f.comment && <p className="mt-0.5 text-on-surface">{f.comment}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}
          {mods?.loyalty && L.enabled && (
            <Card>
              <CardHeader title="Points history" actions={isAdmin && <Button size="sm" variant="secondary" icon="tune" onClick={() => setAdjust(true)}>Adjust points</Button>} />
              {(tx || []).length === 0 ? <p className="px-4 pb-4 text-body-md text-on-surface-variant">No points yet. Guests earn {L.earnPoints} point{L.earnPoints === 1 ? '' : 's'} for every {money(L.earnPer)} on fully paid bills.</p> : (
                <Table head={['Date', 'What', { label: 'Points', right: true }]}>
                  {tx.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((t) => (
                    <tr key={t.id}><Td>{fmtDay(t.date, true)}</Td><Td>{t.type === 'earn' ? `Stay ${t.invoiceNumber || ''}` : t.type === 'redeem' ? `Redeemed ${t.invoiceNumber || ''}` : t.note || t.type}</Td><Td right className={t.points < 0 ? 'text-error' : 'text-on-ok-container'}>{t.points > 0 ? '+' : ''}{t.points}</Td></tr>
                  ))}
                </Table>
              )}
            </Card>
          )}
        </div>
        <Card className="space-y-2 p-4 text-sm">
          <Info k="Phone" v={guest.phone} />
          <Info k="Email" v={guest.email} />
          <Info k="Address" v={guest.address} />
          <Info k="GSTIN" v={guest.gstin} />
          <Info k="Birthday" v={guest.birthday && fmtDay(guest.birthday, true)} />
          <Info k="Anniversary" v={guest.anniversary && fmtDay(guest.anniversary, true)} />
          <Info k="Nationality" v={guest.nationality} />
          <Info k="ID" v={[guest.idType, guest.idNumber].filter(Boolean).join(' · ')} />
          {guest.idImage && <img src={guest.idImage} alt="ID document" className="max-h-40 rounded-lg ring-1 ring-outline-variant/40" />}
          <div><div className="text-xs text-slate-500">Preferences</div><div className="mt-1 flex flex-wrap gap-1">{(guest.preferences || []).length ? guest.preferences.map((p) => <Chip key={p} tone="info">{p}</Chip>) : '—'}</div></div>
          {guest.referralCode && <Info k="Referral code" v={guest.referralCode} />}
          {guest.marketingOptOut && <Info k="Marketing" v="Opted out of campaigns" />}
          <Info k="Notes" v={guest.notes} />
        </Card>
      </div>
      <GuestFormModal open={edit} onClose={() => setEdit(false)} guest={guest} onSaved={load} />
      {adjust && <AdjustModal guest={guest} onClose={() => { setAdjust(false); load(); }} />}
    </div>
  );
}

function AdjustModal({ guest, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [pts, setPts] = useState('');
  const [note, setNote] = useState('');
  async function save() {
    const n = Math.round(Number(pts));
    if (!n) return toast('Enter points to add (or a minus number to remove).', 'error');
    try { await adjustPoints(user, guest, n, note.trim() || (n > 0 ? 'Bonus points' : 'Adjustment')); toast(`${n > 0 ? '+' : ''}${n} points`); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title={`Adjust points · ${guest.name}`} icon="loyalty" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Points" hint={`Now ${guest.points || 0}`}><Input type="number" value={pts} onChange={(e) => setPts(e.target.value)} autoFocus /></Field>
        <Field label="Reason"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Birthday bonus" /></Field>
      </div>
    </Modal>
  );
}

function Info({ k, v }) {
  return <div><div className="text-xs text-slate-500">{k}</div><div className="whitespace-pre-line text-slate-800">{v || '—'}</div></div>;
}
