// Restaurant POS: take table, room-service and takeaway orders, send KOTs to
// the kitchen, settle with one or more payment methods (split bill), charge
// to a guest's room bill, and print an 80 mm receipt. Recipe ingredients are
// deducted from inventory when an order is settled.
import { useMemo, useState } from 'react';
import { addDoc, increment, serverTimestamp, updateDoc } from '../../backend/firestore';
import { hcol, hdoc } from '../../lib/scope';
import { actor } from '../../lib/db';
import { saveFile } from '../../platform';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Modal, Select, cx, useToast, errMsg } from '../../components/ui';
import { celebrate } from '../../motion/hotel';
import { Chip, ModulePage, Panel, fmtShort, money, nextNumber, num, round2, saveRecord, today, useInHouse, useLive, nowTime } from '../kit';
import { chargeToBill } from '../billOps';
import { CATEGORIES } from './Menu';

export const orderTotals = (lines = [], discount = 0) => {
  const sub = round2(lines.reduce((a, l) => a + num(l.qty) * num(l.price), 0));
  const disc = Math.min(round2(num(discount)), sub);
  const ratio = sub ? (sub - disc) / sub : 0;
  const tax = round2(lines.reduce((a, l) => a + (num(l.qty) * num(l.price) * ratio * num(l.gst)) / 100, 0));
  const raw = round2(sub - disc + tax);
  const total = Math.round(raw);
  return { sub, disc, tax, roundOff: round2(total - raw), total };
};

/** Deducts recipe ingredients for a served order from inventory. */
export async function consumeRecipes(user, order, menu) {
  const use = new Map();
  order.lines.forEach((l) => {
    const m = menu.find((x) => x.id === l.menuId);
    (m?.recipe || []).forEach((r) => use.set(r.itemId, { qty: (use.get(r.itemId)?.qty || 0) + num(r.qty) * num(l.qty), name: r.name }));
  });
  for (const [itemId, { qty, name }] of use) {
    await updateDoc(hdoc('stockItems', itemId), { qty: increment(-round2(qty)), updatedAt: serverTimestamp() }).catch(() => {});
    await addDoc(hcol('stockMoves'), { itemId, itemName: name, type: 'Kitchen use', qty: -round2(qty), ref: order.number, date: today(), createdAt: serverTimestamp(), createdBy: actor(user) }).catch(() => {});
  }
}

export async function receiptPdf(order, settings) {
  const { jsPDF } = await import('jspdf');
  const t = orderTotals(order.lines, order.discount);
  const h = 90 + order.lines.length * 6 + (order.payments?.length || 1) * 5;
  const doc = new jsPDF({ unit: 'mm', format: [80, h] });
  let y = 8;
  const c = (txt, size = 9, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.text(String(txt), 40, y, { align: 'center' }); y += size * 0.45 + 1.5; };
  const row = (l, r, bold = false) => { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8.5); doc.text(String(l), 5, y); doc.text(String(r), 75, y, { align: 'right' }); y += 4.6; };
  const rs = (n) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  c(settings.hotelName || 'Restaurant', 12, true);
  if (settings.address || settings.city) c([settings.address, settings.city].filter(Boolean).join(', '), 7.5);
  if (settings.gstin) c(`GSTIN ${settings.gstin}`, 7.5);
  y += 1; c(`${order.number} · ${fmtShort(order.date)} ${order.time || ''}`, 8);
  c(order.type === 'Table' ? `Table ${order.table}` : order.type === 'Room' ? `Room ${order.roomNumber} · ${order.guestName}` : `Takeaway${order.customer ? ` · ${order.customer}` : ''}`, 8);
  doc.line(5, y, 75, y); y += 4;
  order.lines.forEach((l) => row(`${l.qty} × ${l.name}`.slice(0, 34), rs(num(l.qty) * num(l.price))));
  doc.line(5, y, 75, y); y += 4;
  row('Subtotal', rs(t.sub));
  if (t.disc) row('Discount', `-${rs(t.disc)}`);
  row('GST', rs(t.tax));
  if (t.roundOff) row('Round off', rs(t.roundOff));
  row('TOTAL', rs(t.total), true);
  y += 1;
  (order.payments || []).forEach((p) => row(`Paid · ${p.method}`, rs(p.amount)));
  if (order.status === 'Charged to room') row('Charged to room', `${order.roomNumber} · ${order.invoiceNumber || ''}`);
  y += 3; c('Thank you! Visit again.', 8);
  await saveFile(`${order.number}.pdf`, doc.output('blob'), 'application/pdf');
}

function SettleModal({ order, onClose, menu }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const inHouse = useInHouse();
  const [mode, setMode] = useState(order.type === 'Room' ? 'room' : 'pay');
  const [discount, setDiscount] = useState(order.discount || '');
  const t = orderTotals(order.lines, discount);
  const [pays, setPays] = useState([{ method: 'Cash', amount: String(t.total) }]);
  const [billId, setBillId] = useState(order.billId || '');
  const [split, setSplit] = useState(2);
  const [busy, setBusy] = useState(false);
  const paid = round2(pays.reduce((a, p) => a + num(p.amount), 0));
  async function settle() {
    setBusy(true);
    try {
      let patch;
      if (mode === 'room') {
        if (!billId) throw new Error('Choose the guest’s room.');
        const bill = inHouse.find((b) => b.id === billId);
        const lines = order.lines.map((l) => ({ description: `${l.name} (${order.number})`, quantity: num(l.qty), rate: round2(num(l.price) * (1 - (t.sub ? t.disc / t.sub : 0))) }));
        const r = await chargeToBill(user, billId, lines, { source: 'restaurant', ref: order.number });
        patch = { status: 'Charged to room', billId, roomNumber: r.roomNumber, guestName: bill?.guestName || order.guestName || '', invoiceNumber: r.invoiceNumber, discount: num(discount), ...t, settledAt: serverTimestamp() };
      } else {
        if (Math.abs(paid - t.total) > 0.5) throw new Error(`Payments add up to ${money(paid)}, but the total is ${money(t.total)}.`);
        patch = { status: 'Settled', payments: pays.filter((p) => num(p.amount) > 0).map((p) => ({ method: p.method, amount: num(p.amount) })), discount: num(discount), ...t, settledAt: serverTimestamp() };
      }
      await saveRecord(user, 'orders', order.id, patch, 'ORDER_SETTLED');
      await consumeRecipes(user, { ...order, ...patch }, menu);
      toast(mode === 'room' ? `${order.number} added to room ${patch.roomNumber}'s bill` : `${order.number} settled · ${money(t.total)}`);
      if (mode !== 'room') receiptPdf({ ...order, ...patch }, settings).catch(() => {});
      if (t.total >= 5000) celebrate(`${money(t.total)} table settled`, 'Big order');
      onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title={`Settle ${order.number}`} icon="point_of_sale"
      footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button onClick={settle} loading={busy} icon="check">{mode === 'room' ? 'Charge to room' : 'Settle & print receipt'}</Button></>}>
      <div className="space-y-space-md pb-space-sm">
        <div className="rounded-xl bg-surface-container-low p-3 text-body-md">
          {order.lines.map((l, i) => <div key={i} className="flex justify-between"><span>{l.qty} × {l.name}</span><span className="tabular-nums">{money(num(l.qty) * num(l.price))}</span></div>)}
          <div className="mt-2 border-t border-outline-variant/40 pt-2">
            <div className="flex justify-between"><span>Subtotal</span><span>{money(t.sub)}</span></div>
            {t.disc > 0 && <div className="flex justify-between"><span>Discount</span><span>-{money(t.disc)}</span></div>}
            <div className="flex justify-between"><span>GST</span><span>{money(t.tax)}</span></div>
            {t.roundOff !== 0 && <div className="flex justify-between text-on-surface-variant"><span>Round off</span><span>{money(t.roundOff)}</span></div>}
            <div className="flex justify-between font-headline text-headline-sm"><span>Total</span><span>{money(t.total)}</span></div>
          </div>
        </div>
        <Field label="Discount (amount)"><Input type="number" min="0" value={discount} onChange={(e) => { setDiscount(e.target.value); const nt = orderTotals(order.lines, e.target.value); setPays([{ method: pays[0]?.method || 'Cash', amount: String(nt.total) }]); }} /></Field>
        <div className="inline-flex rounded-lg bg-surface-container-low p-1">
          {[['pay', 'Pay now', 'payments'], ['room', 'Charge to room', 'hotel']].map(([k, l, ic]) => (
            <button key={k} type="button" onClick={() => setMode(k)} className={cx('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-label-lg', mode === k ? 'bg-surface-container-lowest shadow-sm' : 'text-on-surface-variant')}><Icon name={ic} size={16} />{l}</button>
          ))}
        </div>
        {mode === 'pay' ? (
          <div className="space-y-2">
            {pays.map((p, i) => (
              <div key={i} className="grid grid-cols-[140px_1fr_32px] gap-2">
                <Select value={p.method} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, method: e.target.value } : x)))}>{['Cash', 'UPI', 'Card', 'Other'].map((m) => <option key={m}>{m}</option>)}</Select>
                <Input type="number" min="0" value={p.amount} onChange={(e) => setPays(pays.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                {pays.length > 1 ? <button type="button" onClick={() => setPays(pays.filter((_, j) => j !== i))} aria-label="Remove payment"><Icon name="close" size={16} /></button> : <span />}
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 text-label-md">
              <Button size="sm" variant="secondary" icon="call_split" onClick={() => setPays([...pays, { method: 'UPI', amount: String(round2(Math.max(0, t.total - paid))) }])}>Add payment method</Button>
              <span className="text-on-surface-variant">Split equally between</span>
              <Input type="number" min="2" className="w-16" value={split} onChange={(e) => setSplit(e.target.value)} />
              <Button size="sm" variant="ghost" onClick={() => { const n = Math.max(2, num(split)); const each = Math.floor((t.total / n) * 100) / 100; setPays(Array.from({ length: n }, (_, i) => ({ method: 'Cash', amount: String(i === n - 1 ? round2(t.total - each * (n - 1)) : each) }))); }}>Split</Button>
            </div>
            <p className={cx('text-label-md', Math.abs(paid - t.total) > 0.5 ? 'text-error' : 'text-on-ok-container')}>Paying {money(paid)} of {money(t.total)}</p>
          </div>
        ) : (
          <Field label="Guest's room" hint="Added to their room bill before tax; the bill's taxes apply.">
            <Select value={billId} onChange={(e) => setBillId(e.target.value)}>
              <option value="">Choose an in-house guest…</option>
              {inHouse.filter((b) => b.paymentStatus !== 'PAID' && !b.checkedOutAt).map((b) => <option key={b.id} value={b.id}>Room {b.roomNumber} · {b.guestName} · {b.invoiceNumber}</option>)}
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

export default function Pos() {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const menuRaw = useLive('menuItems');
  const orders = useLive('orders', { where: [['date', '==', today()]] });
  const inHouse = useInHouse();
  const menu = useMemo(() => (menuRaw || []).filter((m) => m.available !== false), [menuRaw]);
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [cart, setCart] = useState([]);
  const [type, setType] = useState('Table');
  const [table, setTable] = useState('');
  const [billId, setBillId] = useState('');
  const [customer, setCustomer] = useState('');
  const [editing, setEditing] = useState(null);
  const [settle, setSettle] = useState(null);
  const [busy, setBusy] = useState(false);
  const cats = CATEGORIES.filter((c) => menu.some((m) => m.category === c));
  const shown = menu.filter((m) => (!cat || m.category === cat) && (!q || m.name.toLowerCase().includes(q.toLowerCase())));
  const add = (m) => setCart((c) => { const i = c.findIndex((l) => l.menuId === m.id && !l.note); if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l)); return [...c, { menuId: m.id, name: m.name, price: num(m.price), gst: num(m.gst), qty: 1 }]; });
  const setQty = (i, d) => setCart((c) => c.map((l, j) => (j === i ? { ...l, qty: Math.max(0, l.qty + d) } : l)).filter((l) => l.qty > 0));
  const t = orderTotals(cart);
  const open = (orders || []).filter((o) => !['Settled', 'Charged to room', 'Cancelled'].includes(o.status)).sort((a, b) => (a.number < b.number ? 1 : -1));
  const done = (orders || []).filter((o) => ['Settled', 'Charged to room'].includes(o.status));
  async function send() {
    if (!cart.length) return toast('Add items first.', 'error');
    if (type === 'Table' && !table.trim()) return toast('Enter the table number.', 'error');
    if (type === 'Room' && !billId) return toast('Choose the guest’s room.', 'error');
    setBusy(true);
    try {
      const bill = inHouse.find((b) => b.id === billId);
      if (editing) {
        const lines = [...editing.lines, ...cart.map((l) => ({ ...l, kot: (editing.kots || 1) + 1 }))];
        await saveRecord(user, 'orders', editing.id, { lines, kots: (editing.kots || 1) + 1, status: 'New', ...orderTotals(lines, editing.discount) }, 'ORDER_UPDATED');
        toast(`Added to ${editing.number}. KOT sent to the kitchen.`);
      } else {
        const number = await nextNumber(`kot-${today()}`, `KOT-${today().slice(5).replace('-', '')}`, 3);
        await saveRecord(user, 'orders', null, {
          number, date: today(), time: nowTime(), type, table: type === 'Table' ? table.trim() : '', billId: type === 'Room' ? billId : '',
          roomNumber: bill?.roomNumber || '', guestName: bill?.guestName || '', customer: type === 'Takeaway' ? customer.trim() : '',
          lines: cart.map((l) => ({ ...l, kot: 1 })), kots: 1, status: 'New', ...t, waiter: user.name,
        }, 'ORDER_CREATED');
        toast(`${number} sent to the kitchen`);
      }
      setCart([]); setEditing(null); setTable(''); setCustomer('');
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  async function cancelOrder(o) {
    try { await saveRecord(user, 'orders', o.id, { status: 'Cancelled' }, 'ORDER_CANCELLED'); toast(`${o.number} cancelled`); } catch (e) { toast(errMsg(e), 'error'); }
  }
  const STATUS_TONE = { New: 'warn', Cooking: 'info', Ready: 'ok', Served: 'muted' };
  return (
    <ModulePage crumb={['Restaurant', 'POS']} title="Restaurant POS" subtitle={`${open.length} open orders · ${money(done.reduce((a, o) => a + (o.total || 0), 0))} sold today`}>
      {menuRaw && menu.length === 0 && <Panel><p className="text-body-md text-on-surface-variant">Your menu is empty. Add dishes in <b>Restaurant → Menu & recipes</b> first.</p></Panel>}
      <div className="grid items-start gap-space-md xl:grid-cols-[1fr_380px]">
        <div className="space-y-space-sm">
          <div className="flex flex-wrap items-center gap-1">
            {['', ...cats].map((c) => <button key={c || 'all'} type="button" onClick={() => setCat(c)} className={cx('rounded-full px-3 py-1.5 text-label-lg', cat === c ? 'bg-primary text-on-primary' : 'bg-surface-container-lowest text-on-surface-variant shadow-sm hover:text-on-surface')}>{c || 'All'}</button>)}
            <div className="relative ml-auto"><Icon name="search" size={16} className="pointer-events-none absolute left-3 top-2.5 text-outline" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dish…" className="w-48 rounded-full bg-surface-container-lowest py-2 pl-9 pr-3 text-body-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-secondary" aria-label="Find a dish" /></div>
          </div>
          <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-3 lg:grid-cols-4">
            {shown.map((m) => (
              <button key={m.id} type="button" onClick={() => add(m)} className="flex min-h-[86px] flex-col justify-between rounded-xl bg-surface-container-lowest p-3 text-left shadow-sm transition-transform hover:-translate-y-0.5 active:scale-[.98]">
                <span className="flex items-start gap-1.5"><span className={cx('mt-1 h-2.5 w-2.5 shrink-0 rounded-sm border-2', m.veg === 'Non-veg' ? 'border-red-600' : m.veg === 'Egg' ? 'border-amber-500' : 'border-green-600')} /><span className="text-label-lg font-semibold leading-tight text-on-surface">{m.name}</span></span>
                <span className="text-body-md text-secondary">{money(m.price)}</span>
              </button>
            ))}
          </div>
          <Panel title={`Open orders (${open.length})`} icon="receipt">
            {open.length === 0 ? <p className="text-body-md text-on-surface-variant">No open orders.</p> : (
              <div className="grid gap-space-sm sm:grid-cols-2">
                {open.map((o) => (
                  <div key={o.id} className="rounded-xl bg-surface-container-low p-3">
                    <div className="flex items-center justify-between"><b>{o.number}</b><Chip tone={STATUS_TONE[o.status]}>{o.status}</Chip></div>
                    <div className="text-label-md text-on-surface-variant">{o.type === 'Table' ? `Table ${o.table}` : o.type === 'Room' ? `Room ${o.roomNumber} · ${o.guestName}` : `Takeaway ${o.customer || ''}`} · {o.time}</div>
                    <div className="mt-1 text-body-md">{o.lines.map((l) => `${l.qty}× ${l.name}`).join(', ')}</div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <b>{money(o.total)}</b>
                      <span className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => { setEditing(o); setCart([]); }}>Add items</Button>
                        <Button size="sm" variant="ghost" onClick={() => cancelOrder(o)}>Cancel</Button>
                        <Button size="sm" icon="payments" onClick={() => setSettle(o)}>Settle</Button>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          {done.length > 0 && (
            <Panel title={`Settled today (${done.length})`} icon="task_alt">
              <div className="divide-y divide-surface-container">
                {done.map((o) => <div key={o.id} className="flex items-center justify-between py-1.5 text-body-md"><span>{o.number} · {o.type === 'Room' ? `Room ${o.roomNumber}` : o.type === 'Table' ? `Table ${o.table}` : 'Takeaway'} · {o.status}</span><span className="flex items-center gap-2 tabular-nums">{money(o.total)}<Button size="sm" variant="ghost" icon="receipt_long" onClick={() => receiptPdf(o, settings).catch(() => {})} aria-label="Receipt" /></span></div>)}
              </div>
            </Panel>
          )}
        </div>
        <div className="space-y-space-sm xl:sticky xl:top-20">
          <Panel title={editing ? `Add to ${editing.number}` : 'New order'} icon="shopping_bag" actions={editing && <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>New order instead</Button>}>
            {!editing && (
              <div className="mb-space-sm space-y-2">
                <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-container-low p-1">
                  {[['Table', 'table_restaurant'], ['Room', 'room_service'], ['Takeaway', 'takeout_dining']].map(([k, ic]) => (
                    <button key={k} type="button" onClick={() => setType(k)} className={cx('flex flex-col items-center gap-0.5 rounded-md py-1.5 text-label-md', type === k ? 'bg-surface-container-lowest shadow-sm' : 'text-on-surface-variant')}><Icon name={ic} size={18} />{k === 'Room' ? 'Room service' : k}</button>
                  ))}
                </div>
                {type === 'Table' && <Input placeholder="Table number" value={table} onChange={(e) => setTable(e.target.value)} aria-label="Table number" />}
                {type === 'Room' && <Select value={billId} onChange={(e) => setBillId(e.target.value)} aria-label="Room"><option value="">Choose room…</option>{inHouse.filter((b) => !b.checkedOutAt).map((b) => <option key={b.id} value={b.id}>Room {b.roomNumber} · {b.guestName}</option>)}</Select>}
                {type === 'Takeaway' && <Input placeholder="Customer name / phone (optional)" value={customer} onChange={(e) => setCustomer(e.target.value)} aria-label="Customer" />}
              </div>
            )}
            {cart.length === 0 ? <p className="py-6 text-center text-body-md text-on-surface-variant">Tap dishes to add them.</p> : (
              <div className="divide-y divide-surface-container">
                {cart.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1"><div className="truncate font-semibold">{l.name}</div><div className="text-label-sm text-on-surface-variant">{money(l.price)} each</div></div>
                    <div className="flex items-center gap-1">
                      <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-low" onClick={() => setQty(i, -1)} aria-label={`Fewer ${l.name}`}><Icon name="remove" size={16} /></button>
                      <span className="w-6 text-center font-semibold tabular-nums">{l.qty}</span>
                      <button type="button" className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-low" onClick={() => setQty(i, 1)} aria-label={`More ${l.name}`}><Icon name="add" size={16} /></button>
                    </div>
                    <span className="w-20 text-right tabular-nums">{money(l.qty * l.price)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 space-y-0.5 border-t border-surface-container pt-2 text-body-md">
              <div className="flex justify-between"><span>Subtotal</span><span>{money(t.sub)}</span></div>
              <div className="flex justify-between"><span>GST</span><span>{money(t.tax)}</span></div>
              <div className="flex justify-between font-headline text-headline-sm"><span>Total</span><span>{money(t.total)}</span></div>
            </div>
            <Button className="mt-space-sm h-11 w-full" icon="soup_kitchen" loading={busy} disabled={!cart.length} onClick={send}>{editing ? 'Add & send KOT' : 'Send to kitchen'}</Button>
          </Panel>
        </div>
      </div>
      {settle && <SettleModal order={settle} menu={menuRaw || []} onClose={() => setSettle(null)} />}
    </ModulePage>
  );
}
