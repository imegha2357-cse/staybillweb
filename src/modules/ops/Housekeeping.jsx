// Housekeeping: cleaning tasks (created automatically at check-out, or for
// daily service), room checklists with photo proof, room-ready sign-off and
// linen sent to / back from the laundry.
import { useEffect, useMemo, useState } from 'react';
import { increment, updateDoc } from '../../backend/firestore';
import { hdoc } from '../../lib/scope';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Modal, Select, Textarea, cx, useToast, errMsg } from '../../components/ui';
import { celebrate } from '../../motion/hotel';
import {
  Chip, DataTable, ImageField, ModulePage, RecordModal, Stats, fmtShort, num, saveRecord, staffName, today, useInHouse, useLive, useStaff,
} from '../kit';
import { DEFAULT_CHECKLIST } from '../billOps';
import { setRoomStatus } from '../front/RoomBoard';
import { addMove } from '../stock/Inventory';

const TYPES = ['Check-out clean', 'Daily service', 'Deep clean', 'Turndown', 'Inspection', 'Other'];
const TONE = { Open: 'warn', 'In progress': 'info', Done: 'ok', Inspected: 'ok' };
const NEW_FIELDS = [
  { key: 'roomNumber', label: 'Room', type: 'room', required: true, half: true },
  { key: 'type', label: 'Task', type: 'select', options: TYPES, required: true, half: true, placeholder: false },
  { key: 'assignedTo', label: 'Assign to', type: 'staff', half: true },
  { key: 'priority', label: 'Priority', type: 'select', options: ['Normal', 'High', 'Low'], half: true, placeholder: false },
  { key: 'date', label: 'Date', type: 'date', half: true },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

function TaskModal({ task, onClose }) {
  const { user, isAdmin } = useAuth();
  const { rooms } = useData();
  const staff = useStaff();
  const toast = useToast();
  const [v, setV] = useState(task);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(task), [task]);
  const done = (v.checklist || []).filter((c) => c.done).length;
  const total = (v.checklist || []).length;
  async function save(status) {
    setBusy(true);
    try {
      const patch = { checklist: v.checklist || [], photo: v.photo || '', notes: v.notes || '', assignedTo: v.assignedTo || '', ...(status ? { status } : {}) };
      if (status === 'In progress') patch.startedAt = Date.now();
      if (status === 'Done') { patch.doneAt = Date.now(); patch.doneBy = user.name; }
      if (status === 'Inspected') { patch.inspectedBy = user.name; patch.inspectedAt = Date.now(); }
      await saveRecord(user, 'hkTasks', v.id, patch, status ? `HK_${status.toUpperCase().replace(' ', '_')}` : null);
      const room = rooms.find((r) => r.roomNumber === v.roomNumber);
      if (room && status === 'Done' && room.hkStatus !== 'out_of_order') await setRoomStatus(user, room, 'clean');
      if (room && status === 'Inspected' && room.hkStatus !== 'out_of_order') await setRoomStatus(user, room, 'inspected');
      if (status === 'Done') celebrate(`Room ${v.roomNumber} is ready`, 'Housekeeping');
      toast(status ? `Room ${v.roomNumber}: ${status}` : 'Saved');
      onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title={`Room ${v.roomNumber} · ${v.type}`} icon="cleaning_services"
      footer={<>
        <Button variant="secondary" onClick={() => save()} loading={busy}>Save</Button>
        {v.status === 'Open' && <Button variant="secondary" icon="play_arrow" onClick={() => save('In progress')} loading={busy}>Start</Button>}
        {['Open', 'In progress'].includes(v.status) && <Button icon="check" onClick={() => save('Done')} loading={busy} disabled={total > 0 && done < total && !isAdmin}>Room ready</Button>}
        {v.status === 'Done' && isAdmin && <Button icon="verified" onClick={() => save('Inspected')} loading={busy}>Inspected</Button>}
      </>}>
      <div className="space-y-space-md pb-space-sm">
        <div className="flex flex-wrap items-center gap-2"><Chip tone={TONE[v.status]}>{v.status}</Chip>{v.priority === 'High' && <Chip tone="error">High priority</Chip>}<span className="text-label-md text-on-surface-variant">{fmtShort(v.date)}{v.notes ? ` · ${v.notes}` : ''}</span></div>
        <Field label="Assigned to"><Select value={v.assignedTo || ''} onChange={(e) => setV({ ...v, assignedTo: e.target.value })}><option value="">Not assigned</option>{staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <div>
          <div className="mb-1 flex items-center justify-between text-label-sm uppercase tracking-wider text-on-surface-variant"><span>Checklist</span><span>{done}/{total}</span></div>
          <div className="space-y-1">
            {(v.checklist || []).map((c, i) => (
              <label key={i} className={cx('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-body-md', c.done ? 'bg-ok-container text-on-ok-container' : 'bg-surface-container-low')}>
                <input type="checkbox" checked={!!c.done} onChange={() => setV({ ...v, checklist: v.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} />{c.text}
              </label>
            ))}
          </div>
          {total > 0 && done < total && !isAdmin && <p className="mt-1 text-label-md text-on-surface-variant">Tick every item to mark the room ready.</p>}
        </div>
        <div><span className="mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant">Photo of the finished room</span><ImageField value={v.photo} onChange={(x) => setV({ ...v, photo: x })} /></div>
        <Field label="Notes / damage / items found"><Textarea rows={2} value={v.notes || ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Linen() {
  const { user } = useAuth();
  const toast = useToast();
  const items = useLive('stockItems', { where: [['category', '==', 'Linen']] });
  const [move, setMove] = useState(null);
  const [qty, setQty] = useState('');
  async function save() {
    const n = num(qty);
    if (!(n > 0)) return toast('Enter how many.', 'error');
    try {
      const it = move.item;
      if (move.kind === 'out') { await addMove(user, it, 'Sent to laundry', -n, 'laundry'); await updateDoc(hdoc('stockItems', it.id), { atLaundry: increment(n) }); }
      if (move.kind === 'in') { await addMove(user, it, 'Back from laundry', n, 'laundry'); await updateDoc(hdoc('stockItems', it.id), { atLaundry: increment(-n) }); }
      if (move.kind === 'damaged') { await addMove(user, it, 'Damaged / discarded', -n, 'linen'); }
      toast('Linen updated'); setMove(null); setQty('');
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <>
      <DataTable rows={items} dense empty="Add linen (bed sheets, towels, pillow covers) in Inventory with the category Linen to track it here."
        columns={[
          { key: 'name', label: 'Linen', render: (i) => <b>{i.name}</b> },
          { key: 'qty', label: 'In store', right: true, render: (i) => `${num(i.qty)} ${i.unit || ''}` },
          { key: 'lau', label: 'At laundry', right: true, render: (i) => num(i.atLaundry) },
          { key: 'par', label: 'Par level', right: true, render: (i) => num(i.reorderLevel) || '—' },
        ]}
        actions={(i) => <>
          <Button size="sm" variant="secondary" onClick={() => setMove({ item: i, kind: 'out' })}>To laundry</Button>
          <Button size="sm" variant="secondary" onClick={() => setMove({ item: i, kind: 'in' })}>Back</Button>
          <Button size="sm" variant="ghost" onClick={() => setMove({ item: i, kind: 'damaged' })}>Damaged</Button>
        </>} />
      {move && (
        <Modal open onClose={() => setMove(null)} title={`${move.item.name}: ${move.kind === 'out' ? 'send to laundry' : move.kind === 'in' ? 'back from laundry' : 'damaged'}`} icon="local_laundry_service"
          footer={<><Button variant="secondary" onClick={() => setMove(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
          <Field label="How many"><Input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        </Modal>
      )}
    </>
  );
}

export default function Housekeeping() {
  const { user, isEmployee } = useAuth();
  const { rooms } = useData();
  const staff = useStaff();
  const toast = useToast();
  const tasks = useLive('hkTasks');
  const inHouse = useInHouse();
  const [tab, setTab] = useState('tasks');
  const [open, setOpen] = useState(null);
  const [add, setAdd] = useState(false);
  const t = today();
  const rows = useMemo(() => (tasks || []).slice().sort((a, b) => (a.status === b.status ? (a.priority === 'High' ? -1 : 1) : ['Open', 'In progress', 'Done', 'Inspected'].indexOf(a.status) - ['Open', 'In progress', 'Done', 'Inspected'].indexOf(b.status))), [tasks]);
  async function dailyService() {
    try {
      const have = new Set(rows.filter((x) => x.date === t && x.type === 'Daily service').map((x) => x.roomNumber));
      const list = inHouse.filter((b) => b.checkOut > t && !have.has(b.roomNumber));
      for (const b of list) {
        // eslint-disable-next-line no-await-in-loop
        await saveRecord(user, 'hkTasks', null, { roomNumber: b.roomNumber, type: 'Daily service', status: 'Open', priority: 'Normal', date: t, checklist: ['Make bed', 'Replace towels', 'Clean bathroom', 'Restock water and toiletries', 'Empty bins'].map((x) => ({ text: x, done: false })), notes: `Guest: ${b.guestName}` });
      }
      toast(list.length ? `${list.length} daily-service task${list.length === 1 ? '' : 's'} created` : 'Every occupied room already has a task today');
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  const dirty = rooms.filter((r) => r.hkStatus === 'dirty').length;
  return (
    <ModulePage crumb={['Operations', 'Housekeeping']} title="Housekeeping" subtitle="Cleaning tasks, room checklists and linen"
      actions={<><Button variant="secondary" icon="event_repeat" onClick={dailyService}>Daily service for occupied rooms</Button><Button icon="add" onClick={() => setAdd(true)}>New task</Button></>}
      tabs={[{ id: 'tasks', label: 'Tasks', icon: 'checklist' }, { id: 'linen', label: 'Linen', icon: 'local_laundry_service' }]} tab={tab} onTab={setTab}>
      <Stats items={[
        { label: 'Open tasks', value: rows.filter((x) => ['Open', 'In progress'].includes(x.status)).length, icon: 'pending_actions', sub: `${rows.filter((x) => x.status === 'In progress').length} in progress` },
        { label: 'Rooms to clean', value: dirty, icon: 'mop', tone: dirty ? 'error' : undefined, sub: 'Marked vacant dirty' },
        { label: 'Done today', value: rows.filter((x) => x.status !== 'Open' && x.status !== 'In progress' && x.date === t).length, icon: 'task_alt', tone: 'ok', sub: 'Rooms made ready' },
        { label: 'Ready to sell', value: rooms.filter((r) => ['clean', 'inspected', undefined].includes(r.hkStatus) && r.status !== 'inactive').length, icon: 'verified', sub: `${rooms.filter((r) => r.hkStatus === 'inspected').length} inspected` },
      ]} />
      {tab === 'tasks' ? (
        <DataTable rows={tasks ? rows : null} onRow={(x) => setOpen(x)} search={(x) => `${x.roomNumber} ${x.type} ${staffName(staff, x.assignedTo)} ${x.notes}`}
          initialFilter={isEmployee ? 'mine' : 'open'}
          filters={[
            { id: 'open', label: 'To do', test: (x) => ['Open', 'In progress'].includes(x.status) },
            { id: 'mine', label: 'My tasks', test: (x) => x.assignedTo === user.uid && ['Open', 'In progress'].includes(x.status) },
            { id: 'done', label: 'Done', test: (x) => ['Done', 'Inspected'].includes(x.status) },
            { id: 'all', label: 'All' },
          ]}
          empty="No tasks. Checking a guest out creates a cleaning task automatically."
          columns={[
            { key: 'room', label: 'Room', render: (x) => <b className="font-headline text-headline-sm">{x.roomNumber}</b> },
            { key: 'type', label: 'Task', render: (x) => <>{x.type}<div className="text-label-sm text-on-surface-variant">{fmtShort(x.date)}{x.notes ? ` · ${x.notes}` : ''}</div></> },
            { key: 'who', label: 'Assigned', render: (x) => staffName(staff, x.assignedTo) || <span className="text-on-surface-variant">Anyone</span> },
            { key: 'chk', label: 'Checklist', render: (x) => `${(x.checklist || []).filter((c) => c.done).length}/${(x.checklist || []).length}` },
            { key: 'status', label: 'Status', render: (x) => <span className="flex items-center gap-1"><Chip tone={TONE[x.status]}>{x.status}</Chip>{x.priority === 'High' && <Icon name="priority_high" size={16} className="text-error" />}{x.photo && <Icon name="photo_camera" size={16} className="text-on-surface-variant" />}</span> },
          ]} />
      ) : <Linen />}
      {open && <TaskModal task={open} onClose={() => setOpen(null)} />}
      <RecordModal open={add} onClose={() => setAdd(false)} title="New housekeeping task" icon="cleaning_services" collection="hkTasks" label="HK_TASK" fields={NEW_FIELDS}
        initial={{ type: 'Daily service', priority: 'Normal', date: t }}
        transform={(v) => ({ ...v, status: 'Open', checklist: (v.type === 'Check-out clean' || v.type === 'Deep clean' ? DEFAULT_CHECKLIST : ['Make bed', 'Replace towels', 'Clean bathroom', 'Empty bins']).map((x) => ({ text: x, done: false })) })} />
    </ModulePage>
  );
}
