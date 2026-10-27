import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, BedDouble, Pencil, Trash2 } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { createRoom, updateRoom, deleteRoom, createRoomType, updateRoomType, deleteRoomType } from '../lib/db';
import { money, currencySymbol } from '../lib/format';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Table, Tabs, Td, useToast, useConfirm, errMsg, cx } from '../components/ui';
import { KeyRack, RoomTile } from '../motion/hotel';
import { useOccupancy } from '../lib/useOccupancy';

function RoomModal({ open, onClose, room, onNeedTypes }) {
  const { user, hotel } = useAuth();
  const { roomTypes, activeTaxes, rooms } = useData();
  const toast = useToast();
  const [f, setF] = useState({});
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = roomTypes[0];
    setF(room ? { taxMode: 'default', taxIds: [], ...room } : { roomNumber: '', roomType: t?.name || '', rate: t?.defaultRate ?? '', taxMode: 'default', taxIds: [], status: 'active' });
    setErr({});
  }, [open, room, roomTypes]);

  const onType = (name) => {
    const t = roomTypes.find((x) => x.name === name);
    setF((p) => ({ ...p, roomType: name, rate: !room && t ? t.defaultRate : p.rate }));
  };

  async function save() {
    const e = {};
    if (!String(f.roomNumber || '').trim()) e.roomNumber = 'Room number is required.';
    if (!f.roomType) e.roomType = 'Select a room type.';
    if (f.rate === '' || Number(f.rate) < 0 || isNaN(Number(f.rate))) e.rate = 'Rate cannot be negative.';
    if (f.taxMode === 'custom' && !f.taxIds?.length) e.tax = 'Select at least one tax, or choose "No tax".';
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const data = { roomNumber: String(f.roomNumber).trim(), roomType: f.roomType, rate: Number(f.rate), taxMode: f.taxMode, taxIds: f.taxMode === 'custom' ? f.taxIds : [], status: f.status };
    try {
      if (!room && hotel?.maxRooms && rooms.length >= hotel.maxRooms) throw new Error(`Your ${hotel.planName || 'current'} plan allows ${hotel.maxRooms} rooms. Ask the administrator to upgrade.`);
      if (room) await updateRoom(user, room.id, data); else await createRoom(user, data);
      toast(room ? 'Room updated' : `Room ${data.roomNumber} added`);
      onClose();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }

  const toggleTax = (id) => setF((p) => ({ ...p, taxIds: p.taxIds.includes(id) ? p.taxIds.filter((x) => x !== id) : [...p.taxIds, id] }));

  return (
    <Modal open={open} onClose={onClose} title={room ? `Edit room ${room.roomNumber}` : 'Add room'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save room</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Room number" required error={err.roomNumber}><Input value={f.roomNumber || ''} onChange={(e) => setF({ ...f, roomNumber: e.target.value })} autoFocus invalid={!!err.roomNumber} /></Field>
          <Field label="Room type" required error={err.roomType}>
            <Select value={f.roomType || ''} onChange={(e) => onType(e.target.value)}>
              {!f.roomType && <option value="">{roomTypes.length ? 'Choose a type' : 'No room types yet'}</option>}
              {roomTypes.map((t) => <option key={t.id}>{t.name}</option>)}
            </Select>
            {roomTypes.length === 0 && onNeedTypes && (
              <button type="button" onClick={onNeedTypes} className="mt-1 text-label-md font-medium text-secondary hover:underline">Add room types first →</button>
            )}
          </Field>
          <Field label={`Standard rate (${currencySymbol()}/night)`} required error={err.rate}><Input type="number" min="0" step="0.01" value={f.rate ?? ''} onChange={(e) => setF({ ...f, rate: e.target.value })} invalid={!!err.rate} /></Field>
          <Field label="Status">
            <Select value={f.status || 'active'} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </Field>
        </div>
        <Field label="Tax configuration" error={err.tax}>
          <Select value={f.taxMode || 'default'} onChange={(e) => setF({ ...f, taxMode: e.target.value })}>
            <option value="default">All active taxes (default)</option>
            <option value="custom">Specific taxes</option>
            <option value="none">No tax</option>
          </Select>
        </Field>
        {f.taxMode === 'custom' && (
          <div className="flex flex-wrap gap-2">
            {activeTaxes.map((t) => (
              <button key={t.id} type="button" onClick={() => toggleTax(t.id)} className={cx('rounded-lg border px-3 py-1.5 text-sm', f.taxIds?.includes(t.id) ? 'border-transparent bg-primary-container text-on-primary' : 'border-slate-200 text-slate-500')}>{t.name} {t.rate}%</button>
            ))}
          </div>
        )}
        <p className="text-xs text-slate-500">Inactive rooms are hidden when creating new bills. The rate can still be changed on an individual bill.</p>
      </div>
    </Modal>
  );
}

function RoomTypes() {
  const { user, isAdmin } = useAuth();
  const confirm = useConfirm();
  const { roomTypes, rooms } = useData();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!edit.name?.trim()) return toast('Name is required', 'error');
    if (Number(edit.defaultRate) < 0 || edit.defaultRate === '') return toast('Default rate cannot be negative', 'error');
    setBusy(true);
    try {
      const data = { name: edit.name.trim(), defaultRate: Number(edit.defaultRate) };
      if (edit.id) await updateRoomType(user, edit.id, data); else await createRoomType(user, { ...data, order: roomTypes.length });
      toast('Room type saved');
      setEdit(null);
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  async function remove(t) {
    if (rooms.some((r) => r.roomType === t.name)) return toast(`Rooms still use "${t.name}".`, 'error');
    if (!(await confirm(`Delete room type "${t.name}"?`, { title: 'Delete room type', confirmLabel: 'Delete' }))) return;
    try { await deleteRoomType(user, t.id); toast('Room type deleted'); } catch (e) { toast(errMsg(e), 'error'); }
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">Each type has a default rate used when adding rooms.</p>
        {isAdmin && <Button size="sm" onClick={() => setEdit({ name: '', defaultRate: '' })}><Plus className="h-4 w-4" />Add type</Button>}
      </div>
      <Table head={['Room type', { label: 'Default rate', right: true }, 'Rooms', '']}>
        {roomTypes.map((t) => (
          <tr key={t.id}>
            <Td className="font-medium text-slate-900">{t.name}</Td>
            <Td right>{money(t.defaultRate)}</Td>
            <Td>{rooms.filter((r) => r.roomType === t.name).length}</Td>
            <Td className="text-right">
              {isAdmin && <>
                <button onClick={() => setEdit(t)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(t)} className="rounded p-1.5 text-slate-400 hover:bg-error-container hover:text-error" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
              </>}
            </Td>
          </tr>
        ))}
      </Table>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit room type' : 'Add room type'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus /></Field>
            <Field label={`Default rate (${currencySymbol()})`}><Input type="number" min="0" value={edit.defaultRate} onChange={(e) => setEdit({ ...edit, defaultRate: e.target.value })} /></Field>
            {edit.id && <p className="col-span-2 text-xs text-slate-500">Renaming does not change existing rooms' type labels.</p>}
          </div>
        )}
      </Modal>
    </Card>
  );
}

export default function Rooms() {
  const { user, isAdmin } = useAuth();
  const confirm = useConfirm();
  const { rooms, taxes } = useData();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('rooms');
  const [modal, setModal] = useState(params.get('new') === '1' ? { room: null } : null);
  const occ = useOccupancy();
  const live = rooms.filter((r) => r.status !== 'inactive');

  async function remove(r) {
    if (!(await confirm(`Delete room ${r.roomNumber}? Rooms used on bills cannot be deleted; mark them Inactive instead.`, { title: 'Delete room', confirmLabel: 'Delete room' }))) return;
    try { await deleteRoom(user, r.id); toast('Room deleted'); } catch (e) { toast(errMsg(e), 'error'); }
  }
  const taxLabel = (r) => {
    if (r.taxMode === 'none') return 'No tax';
    if (r.taxMode === 'custom') return (r.taxIds || []).map((id) => taxes.find((t) => t.id === id)).filter(Boolean).map((t) => `${t.name} ${t.rate}%`).join(', ') || '—';
    return 'All active taxes';
  };

  return (
    <div>
      <PageHeader crumbs={['Configuration', 'Rooms & Tariffs']} title="Rooms & Tariffs" subtitle="Rooms and nightly rates used when creating bills" actions={tab === 'rooms' && <Button onClick={() => setModal({ room: null })}><Plus className="h-4 w-4" />Add Room</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'rooms', label: `Rooms (${rooms.length})` }, { id: 'types', label: 'Room Types' }]} />
      {tab === 'rooms' && rooms.length > 0 && (
        <Card className="mb-space-md p-space-md">
          <div className="mb-space-sm flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-headline text-headline-sm text-on-surface">Front desk key rack</h2>
            <span className="text-label-md text-on-surface-variant">{occ.occupied.size} key{occ.occupied.size === 1 ? '' : 's'} out · {live.length - [...occ.occupied].filter((n) => live.some((r) => r.roomNumber === n)).length} ready tonight</span>
          </div>
          <KeyRack rooms={rooms} occupied={occ.occupied} />
          <div className="mt-space-md grid grid-cols-2 gap-space-sm sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
            {rooms.map((r) => <RoomTile key={r.id} room={r} occupied={occ.occupied.has(r.roomNumber)} guest={occ.guests.get(r.roomNumber)} onClick={() => setModal({ room: r })} />)}
          </div>
        </Card>
      )}
      {tab === 'types' ? <RoomTypes /> : (
        <Card>
          {rooms.length === 0 ? <Empty icon={BedDouble} title="No rooms yet">Add your rooms so they can be selected on bills.</Empty> : (
            <Table head={['Room', 'Type', { label: 'Rate', right: true }, 'Tax', 'Status', '']}>
              {rooms.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td className="font-medium text-slate-900">{r.roomNumber}</Td>
                  <Td>{r.roomType}</Td>
                  <Td right>{money(r.rate)}</Td>
                  <Td className="text-xs text-slate-500">{taxLabel(r)}</Td>
                  <Td>{r.status === 'inactive' ? <Badge>Inactive</Badge> : <Badge tone="green">Active</Badge>}</Td>
                  <Td className="whitespace-nowrap text-right">
                    <button onClick={() => setModal({ room: r })} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
                    {isAdmin && <button onClick={() => remove(r)} className="rounded p-1.5 text-slate-400 hover:bg-error-container hover:text-error" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
      <RoomModal open={!!modal} room={modal?.room} onClose={() => { setModal(null); if (params.get('new')) setParams({}); }} onNeedTypes={() => { setModal(null); setTab('types'); }} />
    </div>
  );
}
