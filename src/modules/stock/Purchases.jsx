// Purchases: request → owner approval → ordered → goods received (stock in) →
// supplier invoice. Receiving updates stock and the item's cost price.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Button, Field, Input, Modal, Select, Textarea, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, LinesEditor, ModulePage, Stats, fmtDate, fmtShort, linesTotals, lineTotals, money, nextNumber, num, saveRecord, today, useLive } from '../kit';
import { addMove } from './Inventory';
import { docPdf, rs } from '../docPdf';

export const PO_STATUS = { Requested: 'warn', Approved: 'info', Ordered: 'info', Received: 'ok', Rejected: 'error', Cancelled: 'muted' };

export function poPdf(po, settings, supplier) {
  const t = linesTotals(po.lines);
  return docPdf({
    settings, title: 'Purchase order', number: po.number, filename: `${po.number}.pdf`,
    left: [['Supplier', po.supplierName], ['GSTIN', supplier?.gstin], ['Contact', [supplier?.contact, supplier?.phone].filter(Boolean).join(' · ')], ['Address', supplier?.address]],
    right: [['Order date', fmtDate(po.date)], ['Deliver by', po.expected ? fmtDate(po.expected) : ''], ['Status', po.status], ['Supplier invoice', po.invoiceNo ? `${po.invoiceNo} · ${fmtDate(po.invoiceDate)}` : '']],
    head: ['#', 'Item', 'Qty', 'Rate', 'GST %', 'Amount'],
    body: po.lines.map((l, i) => [i + 1, l.name, `${l.qty} ${l.unit || ''}`, rs(l.rate), `${num(l.gst)}%`, rs(lineTotals(l).total)]),
    columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    totals: [['Taxable value', rs(t.base)], ['GST', rs(t.tax)], ['Total', rs(t.total), true]],
    notes: po.notes, sign: 'Authorised signatory',
  });
}

function POModal({ po, items, suppliers, onClose, isAdmin }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState(() => ({ supplierId: '', date: today(), expected: '', notes: '', lines: [{ qty: 1, rate: '', gst: 0 }], ...(po || {}) }));
  const [busy, setBusy] = useState(false);
  const t = linesTotals(v.lines);
  const opts = items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, rate: i.costPrice, gst: i.gst }));
  async function save() {
    const lines = v.lines.filter((l) => l.itemId && num(l.qty) > 0).map((l) => ({ itemId: l.itemId, name: l.name, unit: l.unit || '', qty: num(l.qty), rate: num(l.rate), gst: num(l.gst) }));
    if (!v.supplierId) return toast('Choose a supplier.', 'error');
    if (!lines.length) return toast('Add at least one item with a quantity.', 'error');
    setBusy(true);
    try {
      const sup = suppliers.find((s) => s.id === v.supplierId);
      const body = { supplierId: v.supplierId, supplierName: sup?.name || '', date: v.date, expected: v.expected, notes: v.notes.trim(), lines, ...linesTotals(lines) };
      if (!po?.id) {
        body.number = await nextNumber('purchaseOrder', 'PO');
        body.status = isAdmin ? 'Approved' : 'Requested';
        body.requestedBy = user.name || user.username || '';
        if (isAdmin) body.approvedBy = body.requestedBy;
      }
      await saveRecord(user, 'purchaseOrders', po?.id, body, po?.id ? 'PO_UPDATED' : 'PO_CREATED');
      toast(po?.id ? 'Purchase order saved' : isAdmin ? `${body.number} created and approved` : `${body.number} sent to the owner for approval`);
      onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} wide icon="shopping_cart" title={po?.id ? `Edit ${po.number}` : isAdmin ? 'New purchase order' : 'Request a purchase'}
      footer={<><span className="mr-auto text-label-lg">Total <b className="tabular-nums">{money(t.total)}</b></span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{po?.id ? 'Save' : isAdmin ? 'Create order' : 'Send for approval'}</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Supplier" required>
            <Select value={v.supplierId} onChange={(e) => setV({ ...v, supplierId: e.target.value })}>
              <option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Order date"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
          <Field label="Deliver by"><Input type="date" value={v.expected} onChange={(e) => setV({ ...v, expected: e.target.value })} /></Field>
        </div>
        {items.length === 0 ? <p className="rounded-lg bg-warn-container p-3 text-body-md text-on-warn-container">Add stock items in Inventory first.</p>
          : <LinesEditor lines={v.lines} onChange={(lines) => setV({ ...v, lines })} itemOptions={opts} />}
        <Field label="Notes for the supplier"><Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ReceiveModal({ po, items, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [got, setGot] = useState(() => Object.fromEntries(po.lines.map((l, i) => [i, String(l.qty)])));
  const [rate, setRate] = useState(() => Object.fromEntries(po.lines.map((l, i) => [i, String(l.rate)])));
  const [inv, setInv] = useState({ invoiceNo: '', invoiceDate: today(), receivedOn: today() });
  const [busy, setBusy] = useState(false);
  const lines = po.lines.map((l, i) => ({ ...l, ordered: l.qty, qty: num(got[i]), rate: num(rate[i]) }));
  const t = linesTotals(lines);
  async function save() {
    setBusy(true);
    try {
      for (const l of lines) { // eslint-disable-line no-restricted-syntax
        const item = items.find((x) => x.id === l.itemId);
        if (item && l.qty > 0) {
          await addMove(user, item, 'Purchase received', l.qty, po.number, po.supplierName); // eslint-disable-line no-await-in-loop
          if (l.rate && l.rate !== num(item.costPrice)) await saveRecord(user, 'stockItems', item.id, { costPrice: l.rate, supplierName: po.supplierName }); // eslint-disable-line no-await-in-loop
        }
      }
      await saveRecord(user, 'purchaseOrders', po.id, {
        status: 'Received', lines: lines.map(({ ordered, ...l }) => ({ ...l, ordered })), ...t,
        invoiceNo: inv.invoiceNo.trim(), invoiceDate: inv.invoiceDate, receivedOn: inv.receivedOn, receivedBy: user.name || '',
        short: lines.some((l) => l.qty < l.ordered),
      }, 'PO_RECEIVED');
      toast(`${po.number} received · stock updated`); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} wide icon="inventory" title={`Receive ${po.number} · ${po.supplierName}`}
      footer={<><span className="mr-auto text-label-lg">Invoice total <b className="tabular-nums">{money(t.total)}</b></span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} icon="done_all">Receive into stock</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Supplier invoice no."><Input value={inv.invoiceNo} onChange={(e) => setInv({ ...inv, invoiceNo: e.target.value })} autoFocus /></Field>
          <Field label="Invoice date"><Input type="date" value={inv.invoiceDate} onChange={(e) => setInv({ ...inv, invoiceDate: e.target.value })} /></Field>
          <Field label="Received on"><Input type="date" value={inv.receivedOn} onChange={(e) => setInv({ ...inv, receivedOn: e.target.value })} /></Field>
        </div>
        <div className="divide-y divide-surface-container rounded-lg ring-1 ring-surface-container">
          {po.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_110px] items-center gap-2 p-2">
              <div><b>{l.name}</b><div className="text-label-sm text-on-surface-variant">Ordered {l.qty} {l.unit}</div></div>
              <Input type="number" min="0" step="any" value={got[i]} onChange={(e) => setGot({ ...got, [i]: e.target.value })} aria-label={`Received ${l.name}`} />
              <Input type="number" min="0" step="0.01" value={rate[i]} onChange={(e) => setRate({ ...rate, [i]: e.target.value })} aria-label={`Rate ${l.name}`} />
            </div>
          ))}
        </div>
        <p className="text-label-md text-on-surface-variant">Change the quantity if the delivery was short, and the rate if the invoice price differs. New rates update the item’s cost price.</p>
      </div>
    </Modal>
  );
}

export default function Purchases() {
  const { user, isAdmin } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const pos = useLive('purchaseOrders');
  const items = useLive('stockItems') || [];
  const suppliers = useLive('suppliers') || [];
  const [edit, setEdit] = useState(null);
  const [recv, setRecv] = useState(null);
  const rows = useMemo(() => (pos || []).slice().sort((a, b) => (b.number || '').localeCompare(a.number || '')), [pos]);
  const low = items.filter((i) => num(i.reorderLevel) > 0 && num(i.qty) <= num(i.reorderLevel));
  const month = today().slice(0, 7);

  async function setStatus(po, status, extra = {}) {
    try { await saveRecord(user, 'purchaseOrders', po.id, { status, ...extra }, `PO_${status.toUpperCase()}`); toast(`${po.number}: ${status}`); } catch (e) { toast(errMsg(e), 'error'); }
  }
  function reorder() {
    // Group low items by their usual supplier into a draft order.
    const sup = suppliers.find((s) => low.some((i) => i.supplierName === s.name)) || suppliers[0];
    const mine = low.filter((i) => !sup || !i.supplierName || i.supplierName === sup.name);
    setEdit({ supplierId: sup?.id || '', lines: mine.map((i) => ({ itemId: i.id, name: i.name, unit: i.unit, qty: num(i.reorderQty) || Math.max(1, num(i.reorderLevel) * 2 - num(i.qty)), rate: num(i.costPrice), gst: num(i.gst) })) });
  }
  function send(po) {
    const sup = suppliers.find((s) => s.id === po.supplierId);
    const text = `${settings.hotelName || 'Hotel'} – ${po.number}\n${po.lines.map((l) => `• ${l.name}: ${l.qty} ${l.unit || ''}`).join('\n')}\n${po.expected ? `Please deliver by ${fmtShort(po.expected)}.` : ''}`;
    const phone = (sup?.phone || '').replace(/\D/g, '');
    window.open(`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  return (
    <ModulePage crumb={['Stock', 'Purchases']} title="Purchases" subtitle={isAdmin ? 'Approve requests, place orders and receive deliveries' : 'Ask the owner for stock; receive deliveries'}
      actions={<>{low.length > 0 && <Button variant="secondary" icon="autorenew" onClick={reorder}>Reorder {low.length} low items</Button>}<Button icon="add" onClick={() => setEdit({})} disabled={!suppliers.length}>{isAdmin ? 'New order' : 'Request'}</Button></>}>
      {!suppliers.length && <p className="rounded-lg bg-warn-container p-3 text-body-md text-on-warn-container">Add a supplier first (Stock → Suppliers).</p>}
      <Stats items={[
        { label: 'Waiting approval', value: rows.filter((p) => p.status === 'Requested').length, icon: 'pending_actions', tone: rows.some((p) => p.status === 'Requested') ? 'error' : undefined },
        { label: 'On order', value: rows.filter((p) => ['Approved', 'Ordered'].includes(p.status)).length, icon: 'local_shipping' },
        { label: 'Received this month', value: money(rows.filter((p) => p.status === 'Received' && (p.receivedOn || '').startsWith(month)).reduce((a, p) => a + num(p.total), 0)), icon: 'inventory' },
        { label: 'Low stock items', value: low.length, icon: 'warning', tone: low.length ? 'error' : undefined },
      ]} />
      <DataTable rows={pos ? rows : null} onRow={(p) => (['Requested', 'Approved'].includes(p.status) && (isAdmin || p.status === 'Requested') ? setEdit(p) : poPdf(p, settings, suppliers.find((s) => s.id === p.supplierId)))}
        search={(p) => `${p.number} ${p.supplierName} ${p.invoiceNo || ''} ${(p.lines || []).map((l) => l.name).join(' ')}`}
        filters={[
          { id: 'open', label: 'Open', test: (p) => ['Requested', 'Approved', 'Ordered'].includes(p.status) },
          { id: 'Requested', label: 'Waiting approval', test: (p) => p.status === 'Requested' },
          { id: 'Received', label: 'Received', test: (p) => p.status === 'Received' },
          { id: 'all', label: 'All' },
        ]}
        empty="No purchase orders yet."
        columns={[
          { key: 'n', label: 'PO', render: (p) => <><b>{p.number}</b><div className="text-label-sm text-on-surface-variant">{fmtShort(p.date)}{p.requestedBy ? ` · ${p.requestedBy}` : ''}</div></> },
          { key: 's', label: 'Supplier', render: (p) => <>{p.supplierName}<div className="text-label-sm text-on-surface-variant">{(p.lines || []).length} items{p.invoiceNo ? ` · Inv ${p.invoiceNo}` : ''}</div></> },
          { key: 'st', label: 'Status', render: (p) => <><Chip tone={PO_STATUS[p.status]}>{p.status}</Chip>{p.short && <Chip tone="warn" className="ml-1">Short</Chip>}</> },
          { key: 'd', label: 'Deliver by', render: (p) => (p.expected ? <span className={p.expected < today() && ['Approved', 'Ordered'].includes(p.status) ? 'text-error' : ''}>{fmtShort(p.expected)}</span> : '—') },
          { key: 't', label: 'Total', right: true, render: (p) => money(p.total) },
        ]}
        actions={(p) => (
          <div className="flex justify-end gap-1">
            {p.status === 'Requested' && isAdmin && <><Button size="sm" icon="check" onClick={() => setStatus(p, 'Approved', { approvedBy: user.name || '' })}>Approve</Button><Button size="sm" variant="ghost" onClick={() => setStatus(p, 'Rejected')}>Reject</Button></>}
            {p.status === 'Approved' && <Button size="sm" variant="secondary" icon="send" onClick={() => { send(p); setStatus(p, 'Ordered', { orderedOn: today() }); }}>Order</Button>}
            {['Approved', 'Ordered'].includes(p.status) && <Button size="sm" icon="inventory" onClick={() => setRecv(p)}>Receive</Button>}
            <Button size="sm" variant="ghost" icon="picture_as_pdf" aria-label="PDF" onClick={() => poPdf(p, settings, suppliers.find((s) => s.id === p.supplierId))} />
            {['Requested', 'Approved'].includes(p.status) && isAdmin && <Button size="sm" variant="ghost" icon="close" aria-label="Cancel order" onClick={() => setStatus(p, 'Cancelled')} />}
          </div>
        )} />
      {edit && <POModal po={edit} items={items} suppliers={suppliers} isAdmin={isAdmin} onClose={() => setEdit(null)} />}
      {recv && <ReceiveModal po={recv} items={items} onClose={() => setRecv(null)} />}
    </ModulePage>
  );
}

