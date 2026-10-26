// Inventory: stock items with reorder levels, every movement (received,
// issued, kitchen use, minibar, wastage, laundry), minibar charging to a
// room bill, low-stock alerts and stock-taking with a variance report.
import { useMemo, useState } from 'react';
import { addDoc, increment, serverTimestamp, updateDoc } from '../../backend/firestore';
import { hcol, hdoc } from '../../lib/scope';
import { actor } from '../../lib/db';
import { downloadCsv } from '../../lib/csv';
import { useAuth } from '../../context/AuthContext';
import { Button, Field, Input, Modal, Select, Textarea, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, RecordModal, Stats, fmtShort, money, num, round2, today, useLive } from '../kit';
import { chargeToBill } from '../billOps';

export const STOCK_CATS = ['Kitchen', 'Bar / minibar', 'Toiletries & amenities', 'Linen', 'Cleaning', 'Stationery', 'Maintenance spares', 'Other'];
export const UNITS = ['pcs', 'kg', 'g', 'litre', 'ml', 'pack', 'box', 'bottle', 'dozen', 'set', 'roll'];
const FIELDS = [
  { key: 'name', label: 'Item', required: true, half: true, autoFocus: true },
  { key: 'category', label: 'Category', type: 'select', options: STOCK_CATS, required: true, half: true },
  { key: 'unit', label: 'Unit', type: 'select', options: UNITS, required: true, half: true },
  { key: 'qty', label: 'Opening stock', type: 'number', step: 'any', half: true, show: (v) => !v.id },
  { key: 'reorderLevel', label: 'Reorder when below', type: 'number', step: 'any', half: true },
  { key: 'reorderQty', label: 'Usual order quantity', type: 'number', step: 'any', half: true },
  { key: 'costPrice', label: 'Cost price per unit', type: 'money', half: true },
  { key: 'gst', label: 'GST % on purchase', type: 'number', step: '0.5', half: true },
  { key: 'minibar', label: 'Sold from the minibar', type: 'toggle' },
  { key: 'sellPrice', label: 'Minibar selling price', type: 'money', half: true, show: (v) => !!v.minibar },
  { key: 'location', label: 'Store location', half: true },
  { key: 'supplierName', label: 'Usual supplier', half: true },
];
const IN_TYPES = ['Purchase received', 'Back from laundry', 'Returned to store', 'Adjustment (+)'];

/** Records a stock movement and updates the item's quantity. qty: +in / -out */
export async function addMove(user, item, type, qty, ref = '', note = '') {
  await updateDoc(hdoc('stockItems', item.id), { qty: increment(round2(qty)), updatedAt: serverTimestamp() });
  await addDoc(hcol('stockMoves'), { itemId: item.id, itemName: item.name, unit: item.unit || '', type, qty: round2(qty), ref, note, value: round2(Math.abs(qty) * num(item.costPrice)), date: today(), createdAt: serverTimestamp(), createdBy: actor(user) });
}

/** Minibar: choose items consumed in a room and add them to the guest's bill. */
export function MinibarModal({ bill, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const items = (useLive('stockItems') || []).filter((i) => i.minibar);
  const [q, setQ] = useState({});
  const [busy, setBusy] = useState(false);
  const total = items.reduce((a, i) => a + num(q[i.id]) * num(i.sellPrice), 0);
  async function save() {
    const used = items.filter((i) => num(q[i.id]) > 0);
    if (!used.length) return toast('Enter what was used.', 'error');
    setBusy(true);
    try {
      await chargeToBill(user, bill.id, used.map((i) => ({ description: `Minibar: ${i.name}`, quantity: num(q[i.id]), rate: num(i.sellPrice) })), { source: 'minibar', ref: `Room ${bill.roomNumber}` });
      for (const i of used) await addMove(user, i, 'Minibar', -num(q[i.id]), bill.invoiceNumber, `Room ${bill.roomNumber}`); // eslint-disable-line no-await-in-loop
      toast(`Minibar ${money(total)} added to ${bill.invoiceNumber}`);
      onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title={`Minibar · Room ${bill.roomNumber}`} icon="local_bar"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!total}>Add {money(total)} to bill</Button></>}>
      {items.length === 0 ? <p className="pb-space-sm text-body-md text-on-surface-variant">No minibar items yet. In Inventory, edit an item and switch on "Sold from the minibar".</p> : (
        <div className="space-y-1.5 pb-space-sm">
          {items.map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-3">
              <span>{i.name} <span className="text-label-md text-on-surface-variant">{money(i.sellPrice)}</span></span>
              <Input type="number" min="0" className="w-20" value={q[i.id] || ''} onChange={(e) => setQ({ ...q, [i.id]: e.target.value })} aria-label={`${i.name} used`} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function MoveModal({ item, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [type, setType] = useState('Issue to department');
  const [qty, setQty] = useState('');
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const types = ['Issue to department', 'Wastage / spoilage', 'Purchase received', 'Returned to store', 'Adjustment (+)', 'Adjustment (-)'];
  async function save() {
    const n = num(qty);
    if (!(n > 0)) return toast('Enter a quantity.', 'error');
    const sign = IN_TYPES.includes(type) ? 1 : -1;
    if (sign < 0 && n > num(item.qty) + 0.0001) return toast(`Only ${num(item.qty)} ${item.unit} in stock.`, 'error');
    setBusy(true);
    try { await addMove(user, item, type, sign * n, ref.trim(), note.trim()); toast(`${item.name}: ${sign > 0 ? '+' : '-'}${n} ${item.unit}`); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title={`${item.name} · ${num(item.qty)} ${item.unit} in stock`} icon="swap_vert"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Movement"><Select value={type} onChange={(e) => setType(e.target.value)}>{types.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label={`Quantity (${item.unit})`}><Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus /></Field>
        <Field label={type.startsWith('Issue') ? 'Issued to' : 'Reference'} className="sm:col-span-2"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={type.startsWith('Issue') ? 'e.g. Housekeeping, Room 204, Kitchen' : 'e.g. bill number'} /></Field>
        <Field label="Note" className="sm:col-span-2"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function StockTake({ items }) {
  const { user } = useAuth();
  const toast = useToast();
  const [counts, setCounts] = useState({});
  const [cat, setCat] = useState('');
  const [busy, setBusy] = useState(false);
  const list = items.filter((i) => !cat || i.category === cat);
  const rows = list.map((i) => ({ ...i, counted: counts[i.id], diff: counts[i.id] === undefined || counts[i.id] === '' ? null : round2(num(counts[i.id]) - num(i.qty)) }));
  const changed = rows.filter((r) => r.diff !== null && r.diff !== 0);
  async function post() {
    setBusy(true);
    try {
      for (const r of changed) await addMove(user, r, 'Stock take', r.diff, `Stock take ${today()}`); // eslint-disable-line no-await-in-loop
      downloadCsv(`stock-take-${today()}.csv`, ['Item', 'Unit', 'System', 'Counted', 'Difference', 'Value of difference'], rows.filter((r) => r.diff !== null).map((r) => [r.name, r.unit, num(r.qty), num(r.counted), r.diff, round2(r.diff * num(r.costPrice))]));
      toast(`${changed.length} item${changed.length === 1 ? '' : 's'} adjusted. Variance report downloaded.`);
      setCounts({});
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <DataTable rows={rows} dense rowKey="id"
      toolbar={<>
        <Select className="w-52" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{STOCK_CATS.map((c) => <option key={c}>{c}</option>)}</Select>
        <Button size="sm" icon="fact_check" disabled={!rows.some((r) => r.diff !== null)} loading={busy} onClick={post}>Post counts ({changed.length} differ)</Button>
      </>}
      columns={[
        { key: 'name', label: 'Item', render: (r) => <b>{r.name}</b> },
        { key: 'sys', label: 'System', right: true, render: (r) => `${num(r.qty)} ${r.unit}` },
        { key: 'c', label: 'Counted', right: true, render: (r) => <Input type="number" min="0" step="any" className="ml-auto w-24" value={counts[r.id] ?? ''} onChange={(e) => setCounts({ ...counts, [r.id]: e.target.value })} aria-label={`${r.name} counted`} /> },
        { key: 'd', label: 'Difference', right: true, render: (r) => (r.diff === null ? '' : <Chip tone={r.diff === 0 ? 'ok' : r.diff < 0 ? 'error' : 'warn'}>{r.diff > 0 ? '+' : ''}{r.diff} · {money(r.diff * num(r.costPrice))}</Chip>) },
      ]} empty="No items." />
  );
}

export default function Inventory() {
  const items = useLive('stockItems');
  const moves = useLive('stockMoves', { order: ['createdAt', 'desc'], max: 300 });
  const [tab, setTab] = useState('items');
  const [edit, setEdit] = useState(null);
  const [move, setMove] = useState(null);
  const list = useMemo(() => (items || []).slice().sort((a, b) => (a.category || '').localeCompare(b.category || '') || a.name.localeCompare(b.name)), [items]);
  const low = list.filter((i) => num(i.reorderLevel) > 0 && num(i.qty) <= num(i.reorderLevel));
  const value = list.reduce((a, i) => a + num(i.qty) * num(i.costPrice), 0);
  const month = today().slice(0, 7);
  const waste = (moves || []).filter((m) => m.type?.startsWith('Wastage') && (m.date || '').startsWith(month)).reduce((a, m) => a + num(m.value), 0);
  return (
    <ModulePage crumb={['Stock', 'Inventory']} title="Inventory" subtitle="Stock on hand, movements and stock-taking"
      actions={<Button icon="add" onClick={() => setEdit({ unit: 'pcs', category: 'Toiletries & amenities' })}>Add item</Button>}
      tabs={[{ id: 'items', label: 'Items', icon: 'inventory_2' }, { id: 'moves', label: 'Movements', icon: 'swap_vert' }, { id: 'take', label: 'Stock take', icon: 'fact_check' }]} tab={tab} onTab={setTab}>
      <Stats items={[
        { label: 'Items', value: list.length, icon: 'inventory_2', sub: `${list.filter((i) => i.minibar).length} sold from minibars` },
        { label: 'Low stock', value: low.length, icon: 'warning', tone: low.length ? 'error' : undefined, sub: low.slice(0, 3).map((i) => i.name).join(', ') || 'All above reorder level' },
        { label: 'Stock value', value: money(value), icon: 'account_balance_wallet', sub: 'At cost price' },
        { label: 'Wastage this month', value: money(waste), icon: 'delete_sweep' },
      ]} />
      {tab === 'items' && (
        <DataTable rows={items ? list : null} onRow={(i) => setEdit(i)} search={(i) => `${i.name} ${i.category} ${i.location} ${i.supplierName}`}
          filters={[{ id: 'all', label: 'All' }, { id: 'low', label: 'Low stock', test: (i) => num(i.reorderLevel) > 0 && num(i.qty) <= num(i.reorderLevel) }, ...STOCK_CATS.filter((c) => list.some((i) => i.category === c)).map((c) => ({ id: c, label: c, test: (i) => i.category === c }))]}
          empty="Add toiletries, kitchen supplies, minibar drinks, linen and cleaning items."
          columns={[
            { key: 'name', label: 'Item', render: (i) => <><b>{i.name}</b>{i.minibar && <Chip tone="info" className="ml-1">Minibar</Chip>}<div className="text-label-sm text-on-surface-variant">{i.category}{i.location ? ` · ${i.location}` : ''}</div></> },
            { key: 'qty', label: 'In stock', right: true, render: (i) => <span className={num(i.reorderLevel) > 0 && num(i.qty) <= num(i.reorderLevel) ? 'font-bold text-error' : ''}>{round2(num(i.qty))} {i.unit}</span> },
            { key: 'r', label: 'Reorder at', right: true, render: (i) => (i.reorderLevel ? `${i.reorderLevel} ${i.unit}` : '—') },
            { key: 'c', label: 'Cost', right: true, render: (i) => (i.costPrice ? money(i.costPrice) : '—') },
            { key: 'v', label: 'Value', right: true, render: (i) => money(num(i.qty) * num(i.costPrice)) },
          ]}
          actions={(i) => <Button size="sm" variant="secondary" icon="swap_vert" onClick={() => setMove(i)}>Move</Button>} />
      )}
      {tab === 'moves' && (
        <DataTable rows={moves} dense search={(m) => `${m.itemName} ${m.type} ${m.ref} ${m.note}`}
          toolbar={<Button size="sm" variant="secondary" icon="file_download" onClick={() => downloadCsv(`stock-movements-${today()}.csv`, ['Date', 'Item', 'Movement', 'Qty', 'Unit', 'Value', 'Reference', 'By'], (moves || []).map((m) => [m.date, m.itemName, m.type, m.qty, m.unit, m.value, m.ref, m.createdBy?.name]))}>CSV</Button>}
          columns={[
            { key: 'd', label: 'Date', render: (m) => fmtShort(m.date) },
            { key: 'i', label: 'Item', render: (m) => <b>{m.itemName}</b> },
            { key: 't', label: 'Movement', render: (m) => m.type },
            { key: 'q', label: 'Qty', right: true, render: (m) => <span className={m.qty < 0 ? 'text-error' : 'text-on-ok-container'}>{m.qty > 0 ? '+' : ''}{m.qty} {m.unit}</span> },
            { key: 'r', label: 'Reference', render: (m) => [m.ref, m.note].filter(Boolean).join(' · ') || '—' },
            { key: 'b', label: 'By', render: (m) => m.createdBy?.name || '' },
          ]} empty="No movements yet." />
      )}
      {tab === 'take' && <StockTake items={list} />}
      <RecordModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? edit.name : 'Add stock item'} icon="inventory_2" wide collection="stockItems" label="STOCK_ITEM" fields={FIELDS} initial={edit} />
      {move && <MoveModal item={move} onClose={() => setMove(null)} />}
    </ModulePage>
  );
}
