// Lost & found register: what was found, where, where it is stored, and who
// it was returned to.
import { useState } from 'react';
import { Button } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { Chip, DataTable, ModulePage, RecordModal, Stats, fmtShort, nextNumber, today, useLive } from '../kit';

const STATUS = ['Stored', 'Guest contacted', 'Returned', 'Handed to police', 'Disposed / donated'];
const FIELDS = [
  { key: 'item', label: 'Item', required: true, half: true, autoFocus: true, placeholder: 'e.g. Black phone charger' },
  { key: 'roomNumber', label: 'Found in room', type: 'room', half: true, placeholder: 'Not in a room' },
  { key: 'place', label: 'Found at (if not a room)', half: true, show: (v) => !v.roomNumber },
  { key: 'foundOn', label: 'Found on', type: 'date', required: true, half: true },
  { key: 'foundBy', label: 'Found by', type: 'staff', half: true },
  { key: 'guestName', label: 'Probably belongs to', half: true },
  { key: 'storedAt', label: 'Stored at', half: true, placeholder: 'e.g. Front desk locker 2' },
  { key: 'value', label: 'Valuable?', type: 'select', options: ['No', 'Yes – keep in safe'], half: true, placeholder: false },
  { key: 'status', label: 'Status', type: 'select', options: STATUS, half: true, placeholder: false },
  { key: 'returnedTo', label: 'Returned / handed to', half: true, show: (v) => ['Returned', 'Handed to police'].includes(v.status) },
  { key: 'returnedOn', label: 'On', type: 'date', half: true, show: (v) => ['Returned', 'Handed to police', 'Disposed / donated'].includes(v.status) },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'photo', label: 'Photo', type: 'image' },
];
export default function LostFound() {
  const { user } = useAuth();
  const rows = useLive('lostFound');
  const [edit, setEdit] = useState(null);
  const sorted = (rows || []).slice().sort((a, b) => (a.foundOn < b.foundOn ? 1 : -1));
  const held = sorted.filter((x) => ['Stored', 'Guest contacted'].includes(x.status));
  return (
    <ModulePage crumb={['Operations', 'Lost & found']} title="Lost & found" subtitle="Items found in rooms and around the hotel"
      actions={<Button icon="add" onClick={() => setEdit({ foundOn: today(), status: 'Stored', value: 'No', foundBy: user.uid })}>Log an item</Button>}>
      <Stats items={[
        { label: 'Being held', value: held.length, icon: 'inventory', sub: `${held.filter((x) => x.value?.startsWith('Yes')).length} valuables in the safe` },
        { label: 'Returned', value: sorted.filter((x) => x.status === 'Returned').length, icon: 'assignment_turned_in', tone: 'ok' },
        { label: 'Held over 90 days', value: held.filter((x) => x.foundOn && (Date.now() - new Date(`${x.foundOn}T00:00:00`).getTime()) / 86400000 > 90).length, icon: 'schedule', sub: 'Consider donating or disposing' },
      ]} />
      <DataTable rows={rows ? sorted : null} onRow={(x) => setEdit(x)} search={(x) => `${x.number} ${x.item} ${x.roomNumber} ${x.guestName} ${x.description}`}
        filters={[{ id: 'held', label: 'Being held', test: (x) => ['Stored', 'Guest contacted'].includes(x.status) }, { id: 'closed', label: 'Closed', test: (x) => !['Stored', 'Guest contacted'].includes(x.status) }, { id: 'all', label: 'All' }]}
        empty="Nothing logged."
        columns={[
          { key: 'n', label: 'No.', render: (x) => <b>{x.number}</b> },
          { key: 'item', label: 'Item', render: (x) => <>{x.item}{x.value?.startsWith('Yes') && <Chip tone="warn" className="ml-1">Valuable</Chip>}<div className="text-label-sm text-on-surface-variant">{x.storedAt || ''}</div></> },
          { key: 'where', label: 'Found', render: (x) => <>{x.roomNumber ? `Room ${x.roomNumber}` : x.place || '—'}<div className="text-label-sm text-on-surface-variant">{fmtShort(x.foundOn)}</div></> },
          { key: 'guest', label: 'Belongs to', render: (x) => x.guestName || '—' },
          { key: 's', label: 'Status', render: (x) => <Chip tone={x.status === 'Returned' ? 'ok' : ['Stored', 'Guest contacted'].includes(x.status) ? 'warn' : 'muted'}>{x.status}{x.returnedTo ? ` · ${x.returnedTo}` : ''}</Chip> },
        ]} />
      <RecordModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `${edit.number} · ${edit.item}` : 'Log a found item'} icon="search_check" wide collection="lostFound" label="LOST_FOUND" fields={FIELDS} initial={edit}
        transform={async (v) => ({ ...v, ...(v.id ? {} : { number: await nextNumber('lostfound', 'LF') }) })} />
    </ModulePage>
  );
}
