// Suppliers: directory with GSTIN and payment terms, what is owed to each
// (from received purchase orders), payments made, and price history per item.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { downloadCsv } from '../../lib/csv';
import { Button, Field, Input, Modal, Select, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Panel, RecordModal, Stats, fmtShort, money, num, round2, saveRecord, today, useLive } from '../kit';

const FIELDS = [
  { key: 'name', label: 'Supplier name', required: true, half: true, autoFocus: true },
  { key: 'category', label: 'Supplies', type: 'select', options: ['Groceries & vegetables', 'Meat & dairy', 'Beverages', 'Toiletries & amenities', 'Linen & laundry', 'Cleaning', 'Maintenance', 'Stationery', 'Services', 'Other'], half: true },
  { key: 'contact', label: 'Contact person', half: true },
  { key: 'phone', label: 'Phone', type: 'tel', half: true },
  { key: 'email', label: 'Email', type: 'email', half: true },
  { key: 'gstin', label: 'GSTIN', half: true, upper: true, check: (v) => (v && !/^[0-9]{2}[A-Z0-9]{13}$/i.test(v.trim()) ? 'GSTIN is 15 characters, e.g. 33AAAAA0000A1Z5.' : '') },
  { key: 'terms', label: 'Payment terms (days)', type: 'number', half: true, hint: '0 = pay on delivery' },
  { key: 'upi', label: 'UPI / bank details', half: true },
  { key: 'address', label: 'Address', type: 'textarea' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
];

/** Amount owed to each supplier: received purchase orders minus payments. */
export function payables(pos = [], pays = []) {
  const m = {};
  pos.filter((p) => p.status === 'Received').forEach((p) => {
    m[p.supplierId] = m[p.supplierId] || { billed: 0, paid: 0, oldest: null };
    m[p.supplierId].billed += num(p.total);
    if (!m[p.supplierId].oldest || p.receivedOn < m[p.supplierId].oldest) m[p.supplierId].oldest = p.receivedOn;
  });
  pays.forEach((p) => { m[p.supplierId] = m[p.supplierId] || { billed: 0, paid: 0 }; m[p.supplierId].paid += num(p.amount); });
  Object.values(m).forEach((x) => { x.due = round2(Math.max(0, x.billed - x.paid)); });
  return m;
}

export function PayModal({ supplier, due, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ amount: String(due || ''), method: 'Bank Transfer', ref: '', date: today() });
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!(num(v.amount) > 0)) return toast('Enter the amount paid.', 'error');
    setBusy(true);
    try {
      await saveRecord(user, 'supplierPayments', null, { supplierId: supplier.id, supplierName: supplier.name, amount: num(v.amount), method: v.method, ref: v.ref.trim(), date: v.date }, 'SUPPLIER_PAID');
      toast(`${money(v.amount)} paid to ${supplier.name}`); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title={`Pay ${supplier.name}`} icon="payments"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Record payment</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <p className="text-body-md text-on-surface-variant sm:col-span-2">Outstanding: <b className="text-on-surface">{money(due)}</b></p>
        <Field label="Amount"><Input type="number" min="0" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} autoFocus /></Field>
        <Field label="Paid on"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Method"><Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>{['Bank Transfer', 'UPI', 'Cash', 'Cheque', 'Card'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Reference"><Input value={v.ref} onChange={(e) => setV({ ...v, ref: e.target.value })} placeholder="UTR / cheque no." /></Field>
      </div>
    </Modal>
  );
}

function SupplierDetail({ s, pos, pays, owed, onClose, onPay, onEdit }) {
  const mine = pos.filter((p) => p.supplierId === s.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const paid = pays.filter((p) => p.supplierId === s.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const prices = {};
  mine.filter((p) => p.status === 'Received').forEach((p) => (p.lines || []).forEach((l) => { (prices[l.name] = prices[l.name] || []).push({ date: p.receivedOn || p.date, rate: num(l.rate) }); }));
  return (
    <Modal open onClose={onClose} title={s.name} icon="local_shipping" wide
      footer={<><Button variant="secondary" onClick={onEdit}>Edit details</Button><Button onClick={onPay} disabled={!owed?.due}>Pay {money(owed?.due || 0)}</Button></>}>
      <div className="space-y-space-md pb-space-sm text-body-md">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg bg-surface-container-low p-3"><div className="text-label-sm text-on-surface-variant">Bought</div><b>{money(owed?.billed || 0)}</b></div>
          <div className="rounded-lg bg-surface-container-low p-3"><div className="text-label-sm text-on-surface-variant">Paid</div><b>{money(owed?.paid || 0)}</b></div>
          <div className="rounded-lg bg-surface-container-low p-3"><div className="text-label-sm text-on-surface-variant">Owed</div><b className={owed?.due ? 'text-error' : ''}>{money(owed?.due || 0)}</b></div>
        </div>
        <div className="text-on-surface-variant">{[s.contact, s.phone, s.email, s.gstin && `GSTIN ${s.gstin}`, s.terms ? `${s.terms}-day terms` : 'Pay on delivery'].filter(Boolean).join(' · ')}</div>
        <Panel title="Price history" icon="trending_up">
          {Object.keys(prices).length === 0 ? <p className="text-on-surface-variant">No received orders yet.</p> : Object.entries(prices).map(([name, list]) => {
            const sorted = list.sort((a, b) => (a.date < b.date ? -1 : 1));
            const first = sorted[0].rate; const last = sorted[sorted.length - 1].rate;
            return <div key={name} className="flex justify-between border-b border-surface-container py-1 last:border-0"><span>{name}</span><span className="tabular-nums">{sorted.map((x) => money(x.rate)).join(' → ')} {sorted.length > 1 && <Chip tone={last > first ? 'error' : 'ok'}>{last > first ? '+' : ''}{Math.round(((last - first) / (first || 1)) * 100)}%</Chip>}</span></div>;
          })}
        </Panel>
        <div className="grid gap-space-md sm:grid-cols-2">
          <Panel title="Orders" icon="shopping_cart">{mine.length === 0 ? <p className="text-on-surface-variant">None.</p> : mine.slice(0, 12).map((p) => <div key={p.id} className="flex justify-between py-0.5"><span>{p.number} · {fmtShort(p.date)} · {p.status}</span><span>{money(p.total)}</span></div>)}</Panel>
          <Panel title="Payments" icon="payments">{paid.length === 0 ? <p className="text-on-surface-variant">None.</p> : paid.slice(0, 12).map((p) => <div key={p.id} className="flex justify-between py-0.5"><span>{fmtShort(p.date)} · {p.method}{p.ref ? ` · ${p.ref}` : ''}</span><span>{money(p.amount)}</span></div>)}</Panel>
        </div>
      </div>
    </Modal>
  );
}

export default function Suppliers() {
  const suppliers = useLive('suppliers');
  const pos = useLive('purchaseOrders') || [];
  const pays = useLive('supplierPayments') || [];
  const [edit, setEdit] = useState(null);
  const [open, setOpen] = useState(null);
  const [pay, setPay] = useState(null);
  const owed = useMemo(() => payables(pos, pays), [pos, pays]);
  const total = Object.values(owed).reduce((a, x) => a + x.due, 0);
  const month = today().slice(0, 7);
  const rows = (suppliers || []).slice().sort((a, b) => (owed[b.id]?.due || 0) - (owed[a.id]?.due || 0) || a.name.localeCompare(b.name));
  return (
    <ModulePage crumb={['Stock', 'Suppliers']} title="Suppliers" subtitle="Who you buy from, and what you owe them"
      actions={<><Button variant="secondary" icon="file_download" onClick={() => downloadCsv(`payables-${today()}.csv`, ['Supplier', 'GSTIN', 'Bought', 'Paid', 'Owed', 'Oldest unpaid'], rows.map((s) => [s.name, s.gstin, owed[s.id]?.billed || 0, owed[s.id]?.paid || 0, owed[s.id]?.due || 0, owed[s.id]?.oldest || '']))}>Payables CSV</Button><Button icon="add" onClick={() => setEdit({ terms: 0 })}>Add supplier</Button></>}>
      <Stats items={[
        { label: 'Suppliers', value: rows.length, icon: 'local_shipping' },
        { label: 'Total owed', value: money(total), icon: 'account_balance_wallet', tone: total ? 'error' : undefined, sub: `${Object.values(owed).filter((x) => x.due > 0).length} suppliers` },
        { label: 'Paid this month', value: money(pays.filter((p) => (p.date || '').startsWith(month)).reduce((a, p) => a + num(p.amount), 0)), icon: 'payments' },
        { label: 'Bought this month', value: money(pos.filter((p) => p.status === 'Received' && (p.receivedOn || '').startsWith(month)).reduce((a, p) => a + num(p.total), 0)), icon: 'shopping_cart' },
      ]} />
      <DataTable rows={suppliers ? rows : null} onRow={(s) => setOpen(s)} search={(s) => `${s.name} ${s.contact} ${s.phone} ${s.gstin} ${s.category}`}
        filters={[{ id: 'all', label: 'All' }, { id: 'owed', label: 'Owed money', test: (s) => owed[s.id]?.due > 0 }]}
        empty="Add the vendors you buy groceries, amenities, linen and services from."
        columns={[
          { key: 'name', label: 'Supplier', render: (s) => <><b>{s.name}</b><div className="text-label-sm text-on-surface-variant">{s.category || ''}{s.gstin ? ` · ${s.gstin}` : ''}</div></> },
          { key: 'c', label: 'Contact', render: (s) => <>{s.contact || ''}<div className="text-label-sm text-on-surface-variant">{s.phone || s.email || ''}</div></> },
          { key: 't', label: 'Terms', render: (s) => (num(s.terms) ? `${s.terms} days` : 'On delivery') },
          { key: 'owed', label: 'Owed', right: true, render: (s) => (owed[s.id]?.due ? <b className="text-error">{money(owed[s.id].due)}</b> : '—') },
        ]}
        actions={(s) => (owed[s.id]?.due ? <Button size="sm" variant="secondary" icon="payments" onClick={() => setPay(s)}>Pay</Button> : null)} />
      <RecordModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? edit.name : 'Add supplier'} icon="local_shipping" wide collection="suppliers" label="SUPPLIER" fields={FIELDS} initial={edit}
        transform={(v) => ({ ...v, gstin: (v.gstin || '').trim().toUpperCase() })} />
      {open && <SupplierDetail s={open} pos={pos} pays={pays} owed={owed[open.id]} onClose={() => setOpen(null)} onPay={() => { setPay(open); setOpen(null); }} onEdit={() => { setEdit(open); setOpen(null); }} />}
      {pay && <PayModal supplier={pay} due={owed[pay.id]?.due || 0} onClose={() => setPay(null)} />}
    </ModulePage>
  );
}
