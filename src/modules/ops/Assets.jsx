// Asset register: furniture, appliances and equipment with location, cost,
// vendor and warranty, plus one-click preventive maintenance scheduling.
import { useState } from 'react';
import { Button, useToast, errMsg } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { addDays } from '../../lib/dates';
import { Chip, DataTable, ModulePage, RecordModal, Stats, fmtShort, money, num, saveRecord, today, useLive } from '../kit';

const CATS = ['Air conditioner', 'Television', 'Refrigerator / minibar', 'Geyser', 'Furniture', 'Mattress', 'Kitchen equipment', 'Laundry equipment', 'Generator / UPS', 'Lift', 'CCTV / security', 'Computer / printer', 'Vehicle', 'Other'];
const FIELDS = [
  { key: 'name', label: 'Asset', required: true, half: true, autoFocus: true, placeholder: 'e.g. Daikin 1.5 ton split AC' },
  { key: 'category', label: 'Category', type: 'select', options: CATS, half: true },
  { key: 'roomNumber', label: 'Room', type: 'room', half: true, placeholder: 'Not in a room' },
  { key: 'location', label: 'Location', half: true, placeholder: 'e.g. Restaurant, store room', show: (v) => !v.roomNumber },
  { key: 'serialNo', label: 'Serial / model no.', half: true },
  { key: 'vendor', label: 'Bought from', half: true },
  { key: 'purchaseDate', label: 'Purchase date', type: 'date', half: true },
  { key: 'cost', label: 'Cost', type: 'money', half: true },
  { key: 'warrantyUntil', label: 'Warranty until', type: 'date', half: true },
  { key: 'condition', label: 'Condition', type: 'select', options: ['Good', 'Fair', 'Needs repair', 'Retired'], half: true, placeholder: false },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'photo', label: 'Photo / bill', type: 'image' },
];
export default function Assets() {
  const { user } = useAuth();
  const toast = useToast();
  const rows = useLive('assets');
  const [edit, setEdit] = useState(null);
  const t = today();
  const soon = addDays(t, 60);
  const list = (rows || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  async function schedule(a) {
    try {
      await saveRecord(user, 'pmTasks', null, { task: `Service: ${a.name}`, area: a.roomNumber ? `Room ${a.roomNumber}` : a.location || '', everyDays: a.category === 'Air conditioner' ? 90 : 180, lastDone: t, vendor: a.vendor || '', assetName: a.name }, 'PM_CREATED');
      toast(`Servicing scheduled for ${a.name} (see Maintenance → Preventive schedule)`);
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <ModulePage crumb={['Operations', 'Assets']} title="Assets" subtitle="What the hotel owns, where it is and when its warranty ends"
      actions={<Button icon="add" onClick={() => setEdit({ condition: 'Good' })}>Add asset</Button>}>
      <Stats items={[
        { label: 'Assets', value: list.filter((a) => a.condition !== 'Retired').length, icon: 'chair' },
        { label: 'Total value', value: money(list.filter((a) => a.condition !== 'Retired').reduce((x, a) => x + num(a.cost), 0)), icon: 'account_balance_wallet', sub: 'At purchase cost' },
        { label: 'Warranty ending in 60 days', value: list.filter((a) => a.warrantyUntil && a.warrantyUntil >= t && a.warrantyUntil <= soon).length, icon: 'verified_user', tone: 'error' },
        { label: 'Need repair', value: list.filter((a) => a.condition === 'Needs repair').length, icon: 'build' },
      ]} />
      <DataTable rows={rows ? list : null} onRow={(a) => setEdit(a)} search={(a) => `${a.name} ${a.category} ${a.roomNumber} ${a.location} ${a.serialNo} ${a.vendor}`}
        filters={[{ id: 'all', label: 'All', test: (a) => a.condition !== 'Retired' }, { id: 'warranty', label: 'Warranty ending', test: (a) => a.warrantyUntil && a.warrantyUntil >= t && a.warrantyUntil <= soon }, { id: 'repair', label: 'Needs repair', test: (a) => a.condition === 'Needs repair' }, { id: 'retired', label: 'Retired', test: (a) => a.condition === 'Retired' }]}
        empty="Add ACs, TVs, furniture and equipment to track them."
        columns={[
          { key: 'name', label: 'Asset', render: (a) => <><b>{a.name}</b><div className="text-label-sm text-on-surface-variant">{a.category}{a.serialNo ? ` · ${a.serialNo}` : ''}</div></> },
          { key: 'where', label: 'Where', render: (a) => (a.roomNumber ? `Room ${a.roomNumber}` : a.location || '—') },
          { key: 'cost', label: 'Cost', right: true, render: (a) => (a.cost ? money(a.cost) : '—') },
          { key: 'w', label: 'Warranty', render: (a) => (!a.warrantyUntil ? '—' : <Chip tone={a.warrantyUntil < t ? 'muted' : a.warrantyUntil <= soon ? 'warn' : 'ok'}>{a.warrantyUntil < t ? 'Expired' : `Until ${fmtShort(a.warrantyUntil)}`}</Chip>) },
          { key: 'c', label: 'Condition', render: (a) => <Chip tone={a.condition === 'Good' ? 'ok' : a.condition === 'Needs repair' ? 'error' : 'muted'}>{a.condition}</Chip> },
        ]}
        actions={(a) => <Button size="sm" variant="ghost" icon="event_repeat" onClick={() => schedule(a)}>Schedule service</Button>} />
      <RecordModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? edit.name : 'Add asset'} icon="chair" wide collection="assets" label="ASSET" fields={FIELDS} initial={edit} />
    </ModulePage>
  );
}
