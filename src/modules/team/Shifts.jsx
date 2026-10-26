// Shifts & leave: a weekly roster built from shift templates, leave requests
// from staff, owner approval (which marks attendance), and leave balances.
import { useMemo, useState } from 'react';
import { writeBatch, serverTimestamp } from '../../backend/firestore';
import { db } from '../../firebase';
import { hdoc } from '../../lib/scope';
import { actor, saveSettings } from '../../lib/db';
import { addDays } from '../../lib/dates';
import { downloadCsv } from '../../lib/csv';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Button, Field, Input, Modal, Select, Textarea, cx, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Panel, Stats, fmtShort, num, saveRecord, today, useLive } from '../kit';
import { LEAVE_TYPES, attKey, useTeam } from './common';

export const DEFAULT_SHIFTS = [
  { name: 'Morning', start: '07:00', end: '15:00' },
  { name: 'Evening', start: '15:00', end: '23:00' },
  { name: 'Night', start: '23:00', end: '07:00' },
  { name: 'General', start: '09:00', end: '18:00' },
];
export const DEFAULT_LEAVE = { 'Casual leave': 12, 'Sick leave': 12, 'Earned leave': 15 };
const COLORS = ['bg-primary-container text-on-primary', 'bg-secondary-container text-on-secondary-container', 'bg-surface-container-highest text-on-surface', 'bg-ok-container text-on-ok-container', 'bg-warn-container text-on-warn-container'];

const monday = (d) => { const x = new Date(`${d}T00:00:00`); const k = (x.getDay() + 6) % 7; return addDays(d, -k); };
const dayName = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });
export const leaveDays = (from, to) => { if (!from || !to || to < from) return 0; let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) n += 1; return n; };

function Roster({ team, isAdmin }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const templates = settings.shiftTemplates?.length ? settings.shiftTemplates : DEFAULT_SHIFTS;
  const [week, setWeek] = useState(monday(today()));
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const rows = useLive('shifts', { where: [['date', '>=', days[0]], ['date', '<=', days[6]]] });
  const prev = useLive('shifts', { where: [['date', '>=', addDays(week, -7)], ['date', '<=', addDays(week, -1)]] });
  const leaves = useLive('leaves', { where: [['status', '==', 'Approved']] }) || [];
  const by = Object.fromEntries((rows || []).map((s) => [`${s.date}_${s.personId}`, s]));
  const [pick, setPick] = useState(null);
  const onLeave = (pid, d) => leaves.find((l) => l.personId === pid && l.from <= d && l.to >= d);

  async function put(cells) {
    const b = writeBatch(db);
    cells.forEach(({ person, date, t }) => {
      b.set(hdoc('shifts', `${date}_${person.id}`), t === null
        ? { date, personId: person.id, name: person.name, off: true, shiftName: 'Off', start: '', end: '', updatedAt: serverTimestamp(), updatedBy: actor(user) }
        : { date, personId: person.id, name: person.name, off: false, shiftName: t.name, start: t.start, end: t.end, updatedAt: serverTimestamp(), updatedBy: actor(user) });
    });
    await b.commit();
  }
  async function choose(t) {
    try { await put([{ person: pick.person, date: pick.date, t }]); setPick(null); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function copyLast() {
    const cells = (prev || []).map((s) => { const person = team.find((p) => p.id === s.personId); return person && { person, date: addDays(s.date, 7), t: s.off ? null : { name: s.shiftName, start: s.start, end: s.end } }; }).filter(Boolean);
    if (!cells.length) return toast('Last week has no roster to copy.', 'error');
    try { await put(cells); toast(`Copied ${cells.length} shifts from last week`); } catch (e) { toast(errMsg(e), 'error'); }
  }
  function csv() {
    downloadCsv(`roster-${week}.csv`, ['Name', ...days.map((d) => `${dayName(d)} ${d.slice(5)}`)], team.map((p) => [p.name, ...days.map((d) => { const s = by[`${d}_${p.id}`]; return onLeave(p.id, d) ? 'Leave' : s ? (s.off ? 'Off' : `${s.shiftName} ${s.start}-${s.end}`) : ''; })]));
  }
  const tIndex = (name) => Math.max(0, templates.findIndex((t) => t.name === name)) % COLORS.length;
  return (
    <Panel title={`Week of ${fmtShort(week)}`} icon="view_week"
      actions={<>
        <Button size="sm" variant="ghost" icon="chevron_left" aria-label="Previous week" onClick={() => setWeek(addDays(week, -7))} />
        <Button size="sm" variant="ghost" onClick={() => setWeek(monday(today()))}>This week</Button>
        <Button size="sm" variant="ghost" icon="chevron_right" aria-label="Next week" onClick={() => setWeek(addDays(week, 7))} />
        {isAdmin && <Button size="sm" variant="secondary" icon="content_copy" onClick={copyLast}>Copy last week</Button>}
        <Button size="sm" variant="secondary" icon="file_download" onClick={csv}>CSV</Button>
      </>}>
      {team.length === 0 ? <p className="text-body-md text-on-surface-variant">No staff yet.</p> : (
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[760px] table-fixed text-body-sm">
            <thead><tr><th className="w-40 px-2 py-1 text-left text-label-sm text-on-surface-variant">Staff</th>{days.map((d) => <th key={d} className={cx('px-1 py-1 text-center text-label-sm', d === today() ? 'text-secondary' : 'text-on-surface-variant')}>{dayName(d)}<div className="font-normal">{fmtShort(d)}</div></th>)}</tr></thead>
            <tbody>
              {team.map((p) => (
                <tr key={p.id} className="border-t border-surface-container">
                  <td className="whitespace-nowrap px-2 py-1.5"><b>{p.name}</b><div className="text-label-sm text-on-surface-variant">{p.designation}</div></td>
                  {days.map((d) => {
                    const s = by[`${d}_${p.id}`]; const lv = onLeave(p.id, d);
                    return (
                      <td key={d} className="px-1 py-1">
                        <button type="button" disabled={!isAdmin || !!lv} onClick={() => setPick({ person: p, date: d })}
                          className={cx('w-full rounded-lg px-1 py-1.5 text-center text-label-sm leading-tight', lv ? 'bg-surface-container-high text-secondary' : s ? (s.off ? 'bg-surface-container text-on-surface-variant' : COLORS[tIndex(s.shiftName)]) : 'text-outline ring-1 ring-dashed ring-outline-variant', isAdmin && !lv && 'hover:opacity-80')}>
                          {lv ? 'Leave' : s ? (s.off ? 'Off' : <>{s.shiftName}<div className="opacity-80">{s.start}–{s.end}</div></>) : isAdmin ? '+' : '—'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pick && (
        <Modal open onClose={() => setPick(null)} title={`${pick.person.name} · ${dayName(pick.date)} ${fmtShort(pick.date)}`} icon="schedule">
          <div className="grid gap-2 pb-space-md sm:grid-cols-2">
            {templates.map((t) => <Button key={t.name} variant="secondary" onClick={() => choose(t)}>{t.name} · {t.start}–{t.end}</Button>)}
            <Button variant="ghost" onClick={() => choose(null)}>Week off</Button>
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function LeaveModal({ team, isAdmin, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ personId: isAdmin ? '' : user.uid, type: LEAVE_TYPES[0], from: today(), to: today(), reason: '' });
  const [busy, setBusy] = useState(false);
  const days = leaveDays(v.from, v.to);
  async function save() {
    const person = isAdmin ? team.find((p) => p.id === v.personId) : { id: user.uid, name: user.name };
    if (!person) return toast('Choose who is taking leave.', 'error');
    if (!days) return toast('The end date must be on or after the start date.', 'error');
    setBusy(true);
    try {
      await saveRecord(user, 'leaves', null, { personId: person.id, name: person.name, type: v.type, from: v.from, to: v.to, days, reason: v.reason.trim(), status: 'Pending', requestedOn: today() }, 'LEAVE_REQUESTED');
      toast(isAdmin ? 'Leave added — approve it from the list' : 'Leave request sent to the owner'); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title={isAdmin ? 'Add leave' : 'Request leave'} icon="beach_access"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{isAdmin ? 'Add' : 'Send request'}</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        {isAdmin && <Field label="Staff" className="sm:col-span-2"><Select value={v.personId} onChange={(e) => setV({ ...v, personId: e.target.value })}><option value="">Choose…</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>}
        <Field label="Type" className="sm:col-span-2"><Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{LEAVE_TYPES.map((t) => <option key={t}>{t}</option>)}</Select></Field>
        <Field label="From"><Input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: e.target.value > v.to ? e.target.value : v.to })} /></Field>
        <Field label="To" hint={`${days} day${days === 1 ? '' : 's'}`}><Input type="date" value={v.to} min={v.from} onChange={(e) => setV({ ...v, to: e.target.value })} /></Field>
        <Field label="Reason" className="sm:col-span-2"><Textarea rows={2} value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

/** Approving leave writes the attendance register for each day. */
async function decide(user, l, status) {
  const b = writeBatch(db);
  b.update(hdoc('leaves', l.id), { status, decidedBy: user.name || '', decidedOn: today(), updatedAt: serverTimestamp() });
  if (status === 'Approved') {
    for (let d = l.from; d <= l.to; d = addDays(d, 1)) {
      b.set(hdoc('attendance', attKey(d, l.personId)), { personId: l.personId, name: l.name, date: d, status: l.type === 'Unpaid leave' ? 'Absent' : 'Leave', note: l.type, in: '', out: '', hours: 0, by: 'leave', updatedAt: serverTimestamp() }, { merge: true });
    }
  }
  await b.commit();
}

function Balances({ team, leaves, policy }) {
  const year = today().slice(0, 4);
  const used = (pid, type) => leaves.filter((l) => l.personId === pid && l.type === type && l.status === 'Approved' && l.from.startsWith(year)).reduce((a, l) => a + num(l.days), 0);
  return (
    <DataTable rows={team} dense empty="No staff yet."
      columns={[
        { key: 'n', label: 'Staff', render: (p) => <b>{p.name}</b> },
        ...Object.entries(policy).map(([type, allowed]) => ({ key: type, label: type.replace(' leave', ''), right: true, render: (p) => { const u = used(p.id, type); return <span className={u > allowed ? 'text-error' : ''}>{allowed - u} <span className="text-on-surface-variant">/ {allowed}</span></span>; } })),
        { key: 'unpaid', label: 'Unpaid taken', right: true, render: (p) => used(p.id, 'Unpaid leave') || '—' },
      ]} />
  );
}

function SetupModal({ onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [t, setT] = useState(settings.shiftTemplates?.length ? settings.shiftTemplates : DEFAULT_SHIFTS);
  const [p, setP] = useState({ ...DEFAULT_LEAVE, ...(settings.leavePolicy || {}) });
  async function save() {
    try {
      await saveSettings(user, { shiftTemplates: t.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), start: x.start, end: x.end })), leavePolicy: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, num(v)])) });
      toast('Saved'); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title="Shifts & leave policy" icon="tune" wide footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-space-md pb-space-sm">
        <div className="space-y-2">
          <div className="text-label-lg font-semibold">Shift templates</div>
          {t.map((x, i) => (
            <div key={i} className="grid grid-cols-[1fr_110px_110px_32px] gap-2">
              <Input value={x.name} onChange={(e) => setT(t.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} aria-label="Shift name" />
              <Input type="time" value={x.start} onChange={(e) => setT(t.map((y, j) => (j === i ? { ...y, start: e.target.value } : y)))} aria-label="Start" />
              <Input type="time" value={x.end} onChange={(e) => setT(t.map((y, j) => (j === i ? { ...y, end: e.target.value } : y)))} aria-label="End" />
              <Button variant="ghost" size="sm" icon="close" aria-label="Remove" onClick={() => setT(t.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button size="sm" variant="secondary" icon="add" onClick={() => setT([...t, { name: '', start: '09:00', end: '17:00' }])}>Add shift</Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {Object.keys(DEFAULT_LEAVE).map((k) => <Field key={k} label={`${k} per year`}><Input type="number" min="0" value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></Field>)}
        </div>
      </div>
    </Modal>
  );
}

export default function Shifts() {
  const { user, isAdmin } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const team = useTeam({ includeOwner: false });
  const all = useLive('leaves');
  const leaves = useMemo(() => (all || []).filter((l) => isAdmin || l.personId === user?.uid).sort((a, b) => (a.from < b.from ? 1 : -1)), [all, isAdmin, user]);
  const [tab, setTab] = useState('roster');
  const [req, setReq] = useState(false);
  const [setup, setSetup] = useState(false);
  const policy = { ...DEFAULT_LEAVE, ...(settings.leavePolicy || {}) };
  const pending = leaves.filter((l) => l.status === 'Pending');
  const visibleTeam = isAdmin ? team : team.filter((p) => p.id === user?.uid);
  async function act(l, s) { try { await decide(user, l, s); toast(`${l.name}: leave ${s.toLowerCase()}`); } catch (e) { toast(errMsg(e), 'error'); } }
  return (
    <ModulePage crumb={['Team', 'Shifts & leave']} title="Shifts & leave" subtitle={isAdmin ? 'Plan the week and approve time off' : 'Your shifts and leave'}
      tabs={[{ id: 'roster', label: 'Roster', icon: 'view_week' }, { id: 'leave', label: 'Leave', icon: 'beach_access', count: pending.length || undefined }, { id: 'balance', label: 'Balances', icon: 'account_balance_wallet' }]} tab={tab} onTab={setTab}
      actions={<>{isAdmin && <Button variant="secondary" icon="tune" onClick={() => setSetup(true)}>Setup</Button>}<Button icon="add" onClick={() => setReq(true)}>{isAdmin ? 'Add leave' : 'Request leave'}</Button></>}>
      {tab === 'roster' && <Roster team={isAdmin ? team : team.length ? team : visibleTeam} isAdmin={isAdmin} />}
      {tab === 'leave' && (
        <>
          <Stats items={[
            { label: 'Waiting approval', value: pending.length, icon: 'pending_actions', tone: pending.length ? 'error' : undefined },
            { label: 'Away today', value: leaves.filter((l) => l.status === 'Approved' && l.from <= today() && l.to >= today()).length, icon: 'flight_takeoff' },
            { label: 'Approved this year', value: leaves.filter((l) => l.status === 'Approved' && l.from.startsWith(today().slice(0, 4))).reduce((a, l) => a + num(l.days), 0), icon: 'event_available', sub: 'days' },
          ]} />
          <DataTable rows={all ? leaves : null} empty="No leave requests." search={(l) => `${l.name} ${l.type} ${l.reason}`}
            filters={[{ id: 'Pending', label: 'Pending', test: (l) => l.status === 'Pending' }, { id: 'all', label: 'All' }]} initialFilter={pending.length ? 'Pending' : 'all'}
            columns={[
              { key: 'n', label: 'Staff', render: (l) => <><b>{l.name}</b><div className="text-label-sm text-on-surface-variant">{l.type}</div></> },
              { key: 'd', label: 'Dates', render: (l) => <>{fmtShort(l.from)}{l.to !== l.from ? ` – ${fmtShort(l.to)}` : ''}<div className="text-label-sm text-on-surface-variant">{l.days} day{l.days === 1 ? '' : 's'}</div></> },
              { key: 'r', label: 'Reason', render: (l) => <span className="line-clamp-2 max-w-xs">{l.reason || '—'}</span> },
              { key: 's', label: 'Status', render: (l) => <Chip tone={{ Pending: 'warn', Approved: 'ok', Rejected: 'error', Cancelled: 'muted' }[l.status]}>{l.status}</Chip> },
            ]}
            actions={(l) => (l.status === 'Pending' ? (isAdmin
              ? <div className="flex justify-end gap-1"><Button size="sm" icon="check" onClick={() => act(l, 'Approved')}>Approve</Button><Button size="sm" variant="ghost" onClick={() => act(l, 'Rejected')}>Reject</Button></div>
              : <Button size="sm" variant="ghost" onClick={() => act(l, 'Cancelled')}>Cancel</Button>) : null)} />
        </>
      )}
      {tab === 'balance' && <Balances team={visibleTeam} leaves={all || []} policy={policy} />}
      {req && <LeaveModal team={team} isAdmin={isAdmin} onClose={() => setReq(false)} />}
      {setup && <SetupModal onClose={() => setSetup(false)} />}
    </ModulePage>
  );
}
