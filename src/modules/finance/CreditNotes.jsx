// Credit notes & refunds: reduce what a guest owes after a bill is issued
// (overcharge, service failure, early departure) and record money returned.
// The original invoice stays unchanged, as GST rules require.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { downloadCsv } from '../../lib/csv';
import { Button, Field, Input, Modal, Select, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Stats, fmtDate, money, nextNumber, num, round2, saveRecord, today, useLive } from '../kit';
import { docPdf, rs } from '../docPdf';

export const CN_REASONS = ['Overcharged', 'Service not provided', 'Early check-out', 'Discount after billing', 'Booking cancelled — refund', 'Other'];

export function cnPdf(c, settings) {
  return docPdf({
    settings, title: 'Credit note', number: c.number, filename: `${c.number}.pdf`,
    left: [['Issued to', c.guestName], ['Guest GSTIN', c.guestGstin], ['Room', c.roomNumber]],
    right: [['Date', fmtDate(c.date)], ['Against invoice', `${c.invoiceNumber} · ${fmtDate(c.invoiceDate)}`], ['Reason', c.reason]],
    head: ['Description', 'Taxable value', 'Tax', 'Amount'],
    body: [[c.note || c.reason, rs(c.taxable), (c.taxLines || []).map((t) => `${t.name} ${rs(t.amount)}`).join('\n') || '—', rs(c.total)]],
    columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } },
    totals: [['Taxable value', rs(c.taxable)], ['Tax', rs(round2(c.total - c.taxable))], ['Credit total', rs(c.total), true], ...(num(c.refundAmount) ? [[`Refunded (${c.refundMethod})`, rs(c.refundAmount)]] : [])],
    sign: 'Authorised signatory',
  });
}

function CNModal({ onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const bills = useLive('bills') || [];
  const [v, setV] = useState({ billId: '', mode: 'total', amount: '', reason: CN_REASONS[0], note: '', refund: false, refundMethod: 'UPI', refundRef: '' });
  const [busy, setBusy] = useState(false);
  const bill = bills.find((b) => b.id === v.billId);
  const rate = bill ? (bill.taxes || []).reduce((a, t) => a + num(t.rate), 0) : 0;
  // Amount entered includes tax ("total") or excludes it ("taxable").
  let taxable = !bill ? 0 : v.mode === 'total' ? round2(num(v.amount) / (1 + rate / 100)) : round2(num(v.amount));
  const taxLines = (bill?.taxes || []).map((t) => ({ name: t.name, rate: num(t.rate), amount: round2((taxable * num(t.rate)) / 100) }));
  // A total typed with GST included is kept exact; any paisa of rounding goes to the taxable value.
  if (bill && v.mode === 'total') taxable = round2(num(v.amount) - taxLines.reduce((a, t) => a + t.amount, 0));
  const total = round2(taxable + taxLines.reduce((a, t) => a + t.amount, 0));
  async function save() {
    if (!bill) return toast('Choose the bill.', 'error');
    if (!(total > 0)) return toast('Enter the amount to credit.', 'error');
    if (total > num(bill.grandTotal)) return toast(`The credit cannot be more than the bill (${money(bill.grandTotal)}).`, 'error');
    if (v.refund && total > num(bill.paidAmount)) return toast(`Only ${money(bill.paidAmount)} was paid on this bill.`, 'error');
    setBusy(true);
    try {
      const number = await nextNumber('creditNote', 'CN');
      await saveRecord(user, 'creditNotes', null, {
        number, date: today(), billId: bill.id, invoiceNumber: bill.invoiceNumber, invoiceDate: bill.billDate, guestId: bill.guestId || null, guestName: bill.guestName, guestGstin: bill.guest?.gstin || '', roomNumber: bill.roomNumber,
        reason: v.reason, note: v.note.trim(), taxable, taxLines, total, status: 'Issued',
        ...(v.refund ? { refundAmount: total, refundMethod: v.refundMethod, refundRef: v.refundRef.trim(), refundDate: today() } : {}),
      }, 'CREDIT_NOTE_ISSUED');
      toast(`${number} issued${v.refund ? ` · ${money(total)} refunded` : ''}`); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} wide title="New credit note" icon="assignment_return"
      footer={<><span className="mr-auto text-label-lg">Credit <b>{money(total)}</b></span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Issue credit note</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Bill" className="sm:col-span-2"><Select value={v.billId} onChange={(e) => setV({ ...v, billId: e.target.value })}><option value="">Choose…</option>{bills.filter((b) => b.paymentStatus !== 'CANCELLED').sort((a, b) => (b.invoiceSeq || 0) - (a.invoiceSeq || 0)).map((b) => <option key={b.id} value={b.id}>{b.invoiceNumber} · {b.guestName} · {money(b.grandTotal)}</option>)}</Select></Field>
        <Field label="Amount"><Input type="number" min="0" step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="The amount"><Select value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value })}><option value="total">includes GST</option><option value="taxable">is before GST</option></Select></Field>
        <Field label="Reason"><Select value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })}>{CN_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
        <Field label="Details"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="AC not working on 2nd night" /></Field>
        {bill && <p className="rounded-lg bg-surface-container-low p-3 text-body-md sm:col-span-2">Taxable {money(taxable)} {taxLines.map((t) => `+ ${t.name} ${money(t.amount)}`).join(' ')} = <b>{money(total)}</b>. Bill paid so far: {money(bill.paidAmount)}.</p>}
        <label className="flex items-center gap-2 text-body-md sm:col-span-2"><input type="checkbox" checked={v.refund} onChange={(e) => setV({ ...v, refund: e.target.checked })} />Refund this amount to the guest now</label>
        {v.refund && <>
          <Field label="Refund by"><Select value={v.refundMethod} onChange={(e) => setV({ ...v, refundMethod: e.target.value })}>{['Cash', 'UPI', 'Bank Transfer', 'Card'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
          <Field label="Reference"><Input value={v.refundRef} onChange={(e) => setV({ ...v, refundRef: e.target.value })} /></Field>
        </>}
      </div>
    </Modal>
  );
}

export default function CreditNotes() {
  const { settings } = useData();
  const rows = useLive('creditNotes');
  const [open, setOpen] = useState(false);
  const list = useMemo(() => (rows || []).slice().sort((a, b) => (b.number || '').localeCompare(a.number || '')), [rows]);
  const month = today().slice(0, 7);
  const m = list.filter((c) => (c.date || '').startsWith(month));
  return (
    <ModulePage crumb={['Finance', 'Credit notes & refunds']} title="Credit notes & refunds" subtitle="Correct an issued bill without changing the original invoice"
      actions={<><Button variant="secondary" icon="file_download" onClick={() => downloadCsv(`credit-notes-${today()}.csv`, ['Number', 'Date', 'Invoice', 'Guest', 'GSTIN', 'Reason', 'Taxable', 'Tax', 'Total', 'Refunded', 'Method'], list.map((c) => [c.number, c.date, c.invoiceNumber, c.guestName, c.guestGstin, c.reason, c.taxable, round2(c.total - c.taxable), c.total, c.refundAmount || 0, c.refundMethod || '']))}>CSV</Button><Button icon="add" onClick={() => setOpen(true)}>New credit note</Button></>}>
      <Stats items={[
        { label: 'Credit notes this month', value: m.length, icon: 'assignment_return' },
        { label: 'Credited this month', value: money(m.reduce((a, c) => a + num(c.total), 0)), icon: 'remove_circle' },
        { label: 'Refunded this month', value: money(m.reduce((a, c) => a + num(c.refundAmount), 0)), icon: 'currency_exchange' },
      ]} />
      <DataTable rows={rows ? list : null} onRow={(c) => cnPdf(c, settings)} search={(c) => `${c.number} ${c.invoiceNumber} ${c.guestName} ${c.reason}`} empty="No credit notes. Issue one when a guest was overcharged or is owed a refund."
        columns={[
          { key: 'n', label: 'Credit note', render: (c) => <><b>{c.number}</b><div className="text-label-sm text-on-surface-variant">{fmtDate(c.date)}</div></> },
          { key: 'i', label: 'Against', render: (c) => <>{c.invoiceNumber}<div className="text-label-sm text-on-surface-variant">{c.guestName}</div></> },
          { key: 'r', label: 'Reason', render: (c) => <>{c.reason}<div className="line-clamp-1 text-label-sm text-on-surface-variant">{c.note}</div></> },
          { key: 'rf', label: 'Refund', render: (c) => (num(c.refundAmount) ? <Chip tone="ok">{c.refundMethod} {money(c.refundAmount)}</Chip> : <Chip>Credit only</Chip>) },
          { key: 't', label: 'Total', right: true, render: (c) => <b>{money(c.total)}</b> },
        ]}
        actions={(c) => <Button size="sm" variant="ghost" icon="picture_as_pdf" aria-label="PDF" onClick={() => cnPdf(c, settings)} />} />
      {open && <CNModal onClose={() => setOpen(false)} />}
    </ModulePage>
  );
}
