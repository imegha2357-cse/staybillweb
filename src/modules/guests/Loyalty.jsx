// Loyalty: points on fully paid bills, tiers by lifetime spend, redemption on
// bills (in the bill form), referral codes and bonus points.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveSettings } from '../../lib/db';
import { downloadCsv } from '../../lib/csv';
import { Button, Field, Input, Modal, Select, Toggle, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Stats, fmtDate, money, num, saveRecord, today, useLive } from '../kit';
import { LOYALTY_DEFAULTS, adjustPoints, loyaltyOf, tierFor, token } from '../billOps';

export const referralCode = (name) => `${(name || 'GUEST').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase().padEnd(4, 'X')}${token().slice(0, 4).toUpperCase()}`;

function SettingsModal({ onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [v, setV] = useState(loyaltyOf(settings));
  async function save() {
    try {
      await saveSettings(user, { loyalty: { enabled: !!v.enabled, earnPer: num(v.earnPer) || 100, earnPoints: num(v.earnPoints) || 1, redeemValue: num(v.redeemValue) || 1, minRedeem: num(v.minRedeem), referralBonus: num(v.referralBonus), tiers: v.tiers.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), min: num(t.min) })).sort((a, b) => a.min - b.min) } }, 'LOYALTY_SETTINGS');
      toast('Loyalty programme saved'); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} wide title="Loyalty programme" icon="loyalty" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <Toggle label="Loyalty programme on" description="Guests earn points when a bill is fully paid and can redeem them on later bills." checked={!!v.enabled} onChange={(x) => setV({ ...v, enabled: x })} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Points earned"><Input type="number" min="1" value={v.earnPoints} onChange={(e) => setV({ ...v, earnPoints: e.target.value })} /></Field>
          <Field label="for every (₹ spent)"><Input type="number" min="1" value={v.earnPer} onChange={(e) => setV({ ...v, earnPer: e.target.value })} /></Field>
          <Field label="1 point is worth (₹)"><Input type="number" min="0" step="0.01" value={v.redeemValue} onChange={(e) => setV({ ...v, redeemValue: e.target.value })} /></Field>
          <Field label="Minimum points to redeem"><Input type="number" min="0" value={v.minRedeem} onChange={(e) => setV({ ...v, minRedeem: e.target.value })} /></Field>
          <Field label="Referral bonus (points each)"><Input type="number" min="0" value={v.referralBonus} onChange={(e) => setV({ ...v, referralBonus: e.target.value })} /></Field>
        </div>
        <div className="text-label-lg font-semibold">Tiers by lifetime spend</div>
        {v.tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_160px_32px] gap-2">
            <Input value={t.name} onChange={(e) => setV({ ...v, tiers: v.tiers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label="Tier name" />
            <Input type="number" min="0" value={t.min} onChange={(e) => setV({ ...v, tiers: v.tiers.map((x, j) => (j === i ? { ...x, min: e.target.value } : x)) })} aria-label="From spend" />
            <Button size="sm" variant="ghost" icon="close" aria-label="Remove tier" onClick={() => setV({ ...v, tiers: v.tiers.filter((_, j) => j !== i) })} />
          </div>
        ))}
        <Button size="sm" variant="secondary" icon="add" onClick={() => setV({ ...v, tiers: [...v.tiers, { name: '', min: 0 }] })}>Add tier</Button>
        <p className="text-label-md text-on-surface-variant">Example: {v.earnPoints} point per {money(v.earnPer)} → a {money(10000)} stay earns {Math.floor(10000 / (num(v.earnPer) || 100)) * (num(v.earnPoints) || 1)} points worth {money(Math.floor(10000 / (num(v.earnPer) || 100)) * (num(v.earnPoints) || 1) * num(v.redeemValue))}.</p>
      </div>
    </Modal>
  );
}

function ReferralModal({ guests, onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [v, setV] = useState({ code: '', newId: '' });
  const L = loyaltyOf(settings);
  const referrer = guests.find((g) => (g.referralCode || '').toUpperCase() === v.code.trim().toUpperCase());
  async function save() {
    const nu = guests.find((g) => g.id === v.newId);
    if (!referrer) return toast('No guest has that referral code.', 'error');
    if (!nu || nu.id === referrer.id) return toast('Choose the new guest.', 'error');
    if (nu.referredBy) return toast(`${nu.name} was already referred.`, 'error');
    try {
      await saveRecord(user, 'guests', nu.id, { referredBy: referrer.referralCode });
      if (num(L.referralBonus)) {
        await adjustPoints(user, referrer, num(L.referralBonus), `Referred ${nu.name}`);
        await adjustPoints(user, nu, num(L.referralBonus), `Referred by ${referrer.name}`);
      }
      toast(`${referrer.name} and ${nu.name} each got ${L.referralBonus} points`); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title="Record a referral" icon="share" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Give bonus</Button></>}>
      <div className="grid gap-3 pb-space-sm">
        <Field label="Referral code" hint={referrer ? `Belongs to ${referrer.name}` : 'Ask the new guest which code they were given'}><Input className="uppercase" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} autoFocus /></Field>
        <Field label="New guest"><Select value={v.newId} onChange={(e) => setV({ ...v, newId: e.target.value })}><option value="">Choose…</option>{guests.filter((g) => !g.referredBy).sort((a, b) => a.name.localeCompare(b.name)).map((g) => <option key={g.id} value={g.id}>{g.name}{g.phone ? ` · ${g.phone}` : ''}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}

export default function Loyalty() {
  const { user, isAdmin } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const guests = useLive('guests');
  const tx = useLive('loyaltyTx');
  const [tab, setTab] = useState('members');
  const [cfg, setCfg] = useState(false);
  const [ref, setRef] = useState(false);
  const L = loyaltyOf(settings);
  const members = useMemo(() => (guests || []).map((g) => ({ ...g, tier: tierFor(g.lifetimeSpend || 0, settings) })).sort((a, b) => (b.points || 0) - (a.points || 0) || (b.lifetimeSpend || 0) - (a.lifetimeSpend || 0)), [guests, settings]);
  const outstanding = members.reduce((a, g) => a + num(g.points), 0);
  const month = today().slice(0, 7);
  const monthTx = (tx || []).filter((t) => (t.date || '').startsWith(month));
  async function giveCode(g) {
    try { const code = referralCode(g.name); await saveRecord(user, 'guests', g.id, { referralCode: code }); toast(`${g.name}: ${code}`); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <ModulePage crumb={['Guests', 'Loyalty']} title="Loyalty" subtitle={L.enabled ? `${L.earnPoints} point per ${money(L.earnPer)} · 1 point = ${money(L.redeemValue)}` : 'The programme is switched off'}
      tabs={[{ id: 'members', label: 'Members', icon: 'groups' }, { id: 'tx', label: 'Points activity', icon: 'history' }, { id: 'tiers', label: 'Tiers', icon: 'workspace_premium' }]} tab={tab} onTab={setTab}
      actions={<>{isAdmin && <Button variant="secondary" icon="tune" onClick={() => setCfg(true)}>Programme</Button>}<Button icon="share" onClick={() => setRef(true)}>Record referral</Button></>}>
      <Stats items={[
        { label: 'Members with points', value: members.filter((g) => num(g.points) > 0).length, icon: 'loyalty' },
        { label: 'Points outstanding', value: outstanding.toLocaleString('en-IN'), icon: 'toll', sub: `worth ${money(outstanding * num(L.redeemValue))}` },
        { label: 'Earned this month', value: monthTx.filter((t) => t.points > 0).reduce((a, t) => a + t.points, 0).toLocaleString('en-IN'), icon: 'add_circle' },
        { label: 'Redeemed this month', value: (-monthTx.filter((t) => t.type === 'redeem').reduce((a, t) => a + t.points, 0)).toLocaleString('en-IN'), icon: 'redeem' },
      ]} />
      {tab === 'members' && (
        <DataTable rows={guests ? members : null} search={(g) => `${g.name} ${g.phone} ${g.referralCode || ''}`} empty="Guests appear here as they stay."
          filters={[{ id: 'pts', label: 'With points', test: (g) => num(g.points) > 0 }, { id: 'all', label: 'All guests' }]} initialFilter="all"
          toolbar={<Button size="sm" variant="ghost" icon="file_download" onClick={() => downloadCsv(`loyalty-${today()}.csv`, ['Guest', 'Phone', 'Tier', 'Points', 'Lifetime spend', 'Stays', 'Referral code'], members.map((g) => [g.name, g.phone, g.tier, g.points || 0, g.lifetimeSpend || 0, g.stays || 0, g.referralCode || '']))}>CSV</Button>}
          columns={[
            { key: 'n', label: 'Guest', render: (g) => <><b>{g.name}</b><div className="text-label-sm text-on-surface-variant">{g.phone || g.email || ''}</div></> },
            { key: 't', label: 'Tier', render: (g) => <Chip tone="info">{g.tier}</Chip> },
            { key: 'p', label: 'Points', right: true, render: (g) => <b>{(g.points || 0).toLocaleString('en-IN')}</b> },
            { key: 's', label: 'Lifetime spend', right: true, render: (g) => money(g.lifetimeSpend || 0) },
            { key: 'st', label: 'Stays', right: true, render: (g) => g.stays || 0 },
            { key: 'r', label: 'Referral code', render: (g) => g.referralCode || '—' },
          ]}
          actions={(g) => (!g.referralCode ? <Button size="sm" variant="ghost" icon="qr_code" onClick={() => giveCode(g)}>Give code</Button> : null)} />
      )}
      {tab === 'tx' && (
        <DataTable rows={tx ? tx.slice().sort((a, b) => (a.date < b.date ? 1 : -1)) : null} dense empty="No points activity yet." search={(t) => `${t.guestName} ${t.invoiceNumber || ''} ${t.note || ''}`}
          columns={[
            { key: 'd', label: 'Date', render: (t) => fmtDate(t.date) },
            { key: 'g', label: 'Guest', render: (t) => t.guestName },
            { key: 'w', label: 'What', render: (t) => <><Chip tone={{ earn: 'ok', redeem: 'info', bonus: 'warn' }[t.type]}>{t.type}</Chip> <span className="text-on-surface-variant">{t.invoiceNumber || t.note || ''}</span></> },
            { key: 'p', label: 'Points', right: true, render: (t) => <span className={t.points < 0 ? 'text-error' : 'text-on-ok-container'}>{t.points > 0 ? '+' : ''}{t.points}</span> },
          ]} />
      )}
      {tab === 'tiers' && (
        <div className="grid gap-space-md sm:grid-cols-3">
          {[...(L.tiers || LOYALTY_DEFAULTS.tiers)].sort((a, b) => a.min - b.min).map((t) => (
            <div key={t.name} className="rounded-xl bg-gradient-to-br from-primary to-primary-container p-space-lg text-on-primary shadow-sm">
              <div className="text-label-md uppercase tracking-wider opacity-80">From {money(t.min)} lifetime</div>
              <div className="font-headline text-headline-lg">{t.name}</div>
              <div className="mt-2 text-body-md opacity-90">{members.filter((g) => g.tier === t.name).length} guests</div>
            </div>
          ))}
        </div>
      )}
      {cfg && <SettingsModal onClose={() => setCfg(false)} />}
      {ref && <ReferralModal guests={guests || []} onClose={() => setRef(false)} />}
    </ModulePage>
  );
}
