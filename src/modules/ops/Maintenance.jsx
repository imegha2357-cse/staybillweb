// Maintenance: repair tickets per room or area (AC, plumbing, electrical…),
// putting rooms out of order until fixed, and a preventive schedule
// (AC service, pest control, fire safety…) with due dates.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addDays } from '../../lib/dates';
import { Button, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, RecordModal, Stats, fmtShort, money, nextNumber, num, saveRecord, staffName, today, useLive, useStaff } from '../kit';
import { setRoomStatus } from '../front/RoomBoard';

const CATS = ['AC', 'Plumbing', 'Electrical', 'TV / Wi-Fi', 'Furniture', 'Lock / key card', 'Hot water', 'Pest control', 'Painting', 'Other'];
const STATUSES = ['Open', 'Assigned', 'In progress', 'Waiting for parts', 'Resolved'];
const TONE = { Open: 'error', Assigned: 'warn', 'In progress': 'info', 'Waiting for parts': 'warn', Resolved: 'ok' };
const TICKET = [
  { key: 'roomNumber', label: 'Room', type: 'room', half: true, placeholder: 'Common area / not a room' },
  { key: 'area', label: 'Area (if not a room)', half: true, placeholder: 'e.g. Lobby, kitchen, lift', show: (v) => !v.roomNumber },
  { key: 'category', label: 'Problem', type: 'select', options: CATS, required: true, half: true },
  { key: 'priority', label: 'Priority', type: 'select', options: ['Urgent', 'High', 'Normal', 'Low'], half: true, placeholder: false },
  { key: 'description', label: 'What is wrong', type: 'textarea', required: true },
  { key: 'outOfOrder', label: 'Room is out of order until fixed', type: 'toggle', show: (v) => !!v.roomNumber },
  { key: 'assignedTo', label: 'Assigned to (staff)', type: 'staff', half: true },
  { key: 'vendor', label: 'Outside technician / vendor', half: true },
  { key: 'status', label: 'Status', type: 'select', options: STATUSES, half: true, placeholder: false },
  { key: 'cost', label: 'Repair cost', type: 'money', half: true },
  { key: 'resolution', label: 'What was done', type: 'textarea', show: (v) => v.status === 'Resolved' },
  { key: 'photo', label: 'Photo', type: 'image' },
];
const PM = [
  { key: 'task', label: 'Task', required: true, placeholder: 'e.g. AC servicing – all rooms', autoFocus: true },
  { key: 'area', label: 'Rooms / area', half: true },
  { key: 'everyDays', label: 'Repeat every (days)', type: 'number', min: 1, required: true, half: true },
  { key: 'lastDone', label: 'Last done', type: 'date', half: true },
  { key: 'vendor', label: 'Vendor', half: true },
  { key: 'assetName', label: 'Asset', half: true },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

export default function Maintenance() {
  const { user } = useAuth();
  const { rooms } = useData();
  const staff = useStaff();
  const toast = useToast();
  const tickets = useLive('tickets');
  const pm = useLive('pmTasks');
  const [tab, setTab] = useState('tickets');
  const [edit, setEdit] = useState(null);
  const [pmEdit, setPmEdit] = useState(null);
  const t = today();
  const rows = useMemo(() => (tickets || []).slice().sort((a, b) => (a.number < b.number ? 1 : -1)), [tickets]);
  const pmRows = useMemo(() => (pm || []).map((p) => ({ ...p, nextDue: p.lastDone ? addDays(p.lastDone, num(p.everyDays)) : t })).sort((a, b) => (a.nextDue < b.nextDue ? -1 : 1)), [pm, t]);
  async function afterSave(id, data, prev) {
    const room = rooms.find((r) => r.roomNumber === data.roomNumber);
    if (!room) return;
    if (data.outOfOrder && data.status !== 'Resolved' && room.hkStatus !== 'out_of_order') await setRoomStatus(user, room, 'out_of_order', { oooReason: `${data.category}: ${data.description}`.slice(0, 120) });
    if (data.status === 'Resolved' && room.hkStatus === 'out_of_order' && (prev?.outOfOrder || data.outOfOrder)) await setRoomStatus(user, room, 'dirty', { oooReason: '' });
  }
  async function pmDone(p) {
    try { await saveRecord(user, 'pmTasks', p.id, { lastDone: t }, 'PM_DONE'); toast(`${p.task}: done. Next due ${fmtShort(addDays(t, num(p.everyDays)))}`); } catch (e) { toast(errMsg(e), 'error'); }
  }
  const openT = rows.filter((x) => x.status !== 'Resolved');
  return (
    <ModulePage crumb={['Operations', 'Maintenance']} title="Maintenance" subtitle="Repairs, out-of-order rooms and preventive maintenance"
      actions={tab === 'tickets' ? <Button icon="add" onClick={() => setEdit({ priority: 'Normal', status: 'Open' })}>Report a problem</Button> : <Button icon="add" onClick={() => setPmEdit({ everyDays: 90 })}>Add schedule</Button>}
      tabs={[{ id: 'tickets', label: 'Repair tickets', icon: 'build', count: openT.length }, { id: 'pm', label: 'Preventive schedule', icon: 'event_repeat', count: pmRows.filter((p) => p.nextDue <= t).length }]} tab={tab} onTab={setTab}>
      <Stats items={[
        { label: 'Open tickets', value: openT.length, icon: 'build', tone: openT.some((x) => x.priority === 'Urgent') ? 'error' : undefined, sub: `${openT.filter((x) => x.priority === 'Urgent').length} urgent` },
        { label: 'Rooms out of order', value: rooms.filter((r) => r.hkStatus === 'out_of_order').length, icon: 'block', sub: rooms.filter((r) => r.hkStatus === 'out_of_order').map((r) => r.roomNumber).join(', ') || 'None' },
        { label: 'Repair spend this month', value: money(rows.filter((x) => (x.resolvedOn || '').slice(0, 7) === t.slice(0, 7)).reduce((a, x) => a + num(x.cost), 0)), icon: 'payments' },
        { label: 'Maintenance due', value: pmRows.filter((p) => p.nextDue <= addDays(t, 7)).length, icon: 'event_repeat', sub: 'Overdue or due this week' },
      ]} />
      {tab === 'tickets' ? (
        <DataTable rows={tickets ? rows : null} onRow={(x) => setEdit(x)} search={(x) => `${x.number} ${x.roomNumber} ${x.area} ${x.category} ${x.description} ${x.vendor}`}
          filters={[{ id: 'open', label: 'Open', test: (x) => x.status !== 'Resolved' }, { id: 'mine', label: 'Mine', test: (x) => x.assignedTo === user.uid && x.status !== 'Resolved' }, { id: 'resolved', label: 'Resolved', test: (x) => x.status === 'Resolved' }, { id: 'all', label: 'All' }]}
          empty="No repair tickets."
          columns={[
            { key: 'n', label: 'Ticket', render: (x) => <><b>{x.number}</b><div className="text-label-sm text-on-surface-variant">{fmtShort(x.reportedOn)}</div></> },
            { key: 'where', label: 'Where', render: (x) => (x.roomNumber ? <span className="flex items-center gap-1">Room {x.roomNumber}{x.outOfOrder && x.status !== 'Resolved' && <Chip tone="error">OOO</Chip>}</span> : x.area || '—') },
            { key: 'what', label: 'Problem', render: (x) => <><b>{x.category}</b><div className="max-w-xs truncate text-label-md text-on-surface-variant">{x.description}</div></> },
            { key: 'who', label: 'Assigned', render: (x) => staffName(staff, x.assignedTo) || x.vendor || '—' },
            { key: 'p', label: 'Priority', render: (x) => <Chip tone={x.priority === 'Urgent' ? 'error' : x.priority === 'High' ? 'warn' : 'muted'}>{x.priority}</Chip> },
            { key: 's', label: 'Status', render: (x) => <Chip tone={TONE[x.status]}>{x.status}</Chip> },
          ]} />
      ) : (
        <DataTable rows={pm ? pmRows : null} onRow={(p) => setPmEdit(p)} empty="Add recurring jobs like AC servicing every 90 days, pest control every 30 days, fire extinguisher checks every year."
          columns={[
            { key: 'task', label: 'Task', render: (p) => <><b>{p.task}</b><div className="text-label-sm text-on-surface-variant">{p.area || ''}{p.vendor ? ` · ${p.vendor}` : ''}</div></> },
            { key: 'every', label: 'Every', render: (p) => `${p.everyDays} days` },
            { key: 'last', label: 'Last done', render: (p) => (p.lastDone ? fmtShort(p.lastDone) : 'Never') },
            { key: 'next', label: 'Next due', render: (p) => <Chip tone={p.nextDue < t ? 'error' : p.nextDue <= addDays(t, 7) ? 'warn' : 'ok'}>{p.nextDue < t ? `Overdue · ${fmtShort(p.nextDue)}` : fmtShort(p.nextDue)}</Chip> },
          ]}
          actions={(p) => <Button size="sm" variant="secondary" icon="check" onClick={() => pmDone(p)}>Done today</Button>} />
      )}
      <RecordModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `${edit.number} · ${edit.category}` : 'Report a problem'} icon="build" wide collection="tickets" label="TICKET" fields={TICKET} initial={edit}
        transform={async (v) => ({ ...v, ...(v.id ? {} : { number: await nextNumber('ticket', 'MT'), reportedOn: t, reportedBy: user.name }), ...(v.status === 'Resolved' && !v.resolvedOn ? { resolvedOn: t } : {}) })}
        onSaved={(id, data) => afterSave(id, data, edit).catch(() => {})} />
      <RecordModal open={!!pmEdit} onClose={() => setPmEdit(null)} title={pmEdit?.id ? pmEdit.task : 'Preventive maintenance'} icon="event_repeat" collection="pmTasks" label="PM" fields={PM} initial={pmEdit} />
    </ModulePage>
  );
}
