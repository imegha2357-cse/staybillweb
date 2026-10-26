// Expenses: day-to-day spending with GST input credit, receipts and a monthly
// breakdown by category.
import { useMemo, useState } from 'react';
import { downloadCsv } from '../../lib/csv';
import { Button, Input } from '../../components/ui';
import { Chip, DataTable, MiniChart, ModulePage, Panel, RecordModal, Stats, fmtDate, money, nextNumber, num, round2, today } from '../kit';
import { useLive } from '../kit';

export const EXPENSE_CATS = ['Electricity', 'Water', 'Gas / fuel', 'Internet & phone', 'Rent', 'Repairs & maintenance', 'Laundry', 'Housekeeping supplies', 'Kitchen & groceries', 'Marketing & OTA commission', 'Travel & transport', 'Bank charges', 'Professional fees', 'Licences & taxes', 'Insurance', 'Staff welfare', 'Printing & stationery', 'Miscellaneous'];
const FIELDS = [
  { key: 'date', label: 'Date', type: 'date', required: true, half: true },
  { key: 'category', label: 'Category', type: 'select', options: EXPENSE_CATS, required: true, half: true },
  { key: 'vendor', label: 'Paid to', half: true, placeholder: 'TNEB, Airtel…' },
  { key: 'invoiceNo', label: 'Bill / invoice no.', half: true },
  { key: 'amount', label: 'Amount before GST', type: 'money', required: true, half: true, check: (v) => (num(v) > 0 ? '' : 'Enter the amount.') },
  { key: 'gstRate', label: 'GST %', type: 'select', options: ['0', '5', '12', '18', '28'], placeholder: false, half: true },
  { key: 'vendorGstin', label: 'Vendor GSTIN', half: true, upper: true, show: (v) => num(v.gstRate) > 0 },
  { key: 'itc', label: 'Claim input tax credit', type: 'toggle', hint: 'Turn off for blocked credits (food, personal use) or bills without your GSTIN.', show: (v) => num(v.gstRate) > 0 },
  { key: 'method', label: 'Paid by', type: 'select', options: ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque'], placeholder: false, half: true },
  { key: 'description', label: 'Note', half: true },
  { key: 'receipt', label: 'Receipt photo', type: 'image' },
];

export default function Expenses() {
  const rows = useLive('expenses');
  const [edit, setEdit] = useState(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const list = useMemo(() => (rows || []).filter((e) => (e.date || '').startsWith(month)).sort((a, b) => (a.date < b.date ? 1 : -1)), [rows, month]);
  const total = list.reduce((a, e) => a + num(e.total), 0);
  const itc = list.filter((e) => e.itc !== false).reduce((a, e) => a + num(e.gstAmount), 0);
  const byCat = Object.entries(list.reduce((m, e) => ({ ...m, [e.category]: (m[e.category] || 0) + num(e.total) }), {})).sort((a, b) => b[1] - a[1]);
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(`${month}-01T00:00:00`); d.setMonth(d.getMonth() - 5 + i); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  return (
    <ModulePage crumb={['Finance', 'Expenses']} title="Expenses" subtitle="Electricity, repairs, commissions and everything else you pay for"
      actions={<><div className="w-40"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value || today().slice(0, 7))} aria-label="Month" /></div><Button variant="secondary" icon="file_download" onClick={() => downloadCsv(`expenses-${month}.csv`, ['Date', 'No.', 'Category', 'Paid to', 'Invoice', 'Amount', 'GST %', 'GST', 'Total', 'ITC', 'Vendor GSTIN', 'Paid by', 'Note'], list.map((e) => [e.date, e.number, e.category, e.vendor, e.invoiceNo, e.amount, e.gstRate, e.gstAmount, e.total, e.itc !== false ? 'Yes' : 'No', e.vendorGstin, e.method, e.description]))}>CSV</Button><Button icon="add" onClick={() => setEdit({ date: today(), gstRate: '0', method: 'Cash', itc: true })}>Add expense</Button></>}>
      <Stats items={[
        { label: 'Spent this month', value: money(total), icon: 'receipt', sub: `${list.length} expenses` },
        { label: 'GST input credit', value: money(itc), icon: 'savings' },
        { label: 'Biggest category', value: byCat[0] ? byCat[0][0] : '—', icon: 'category', sub: byCat[0] ? money(byCat[0][1]) : '' },
        { label: 'Paid in cash', value: money(list.filter((e) => e.method === 'Cash').reduce((a, e) => a + num(e.total), 0)), icon: 'payments' },
      ]} />
      <div className="grid gap-space-md lg:grid-cols-2">
        <Panel title="By category" icon="donut_small">
          {byCat.length === 0 ? <p className="text-body-md text-on-surface-variant">Nothing this month.</p> : byCat.map(([c, v]) => (
            <div key={c} className="flex items-center gap-3 py-1 text-body-md"><span className="w-44 truncate">{c}</span><div className="h-2 flex-1 rounded-full bg-surface-container"><div className="h-2 rounded-full bg-secondary" style={{ width: `${(v / byCat[0][1]) * 100}%` }} /></div><span className="w-24 text-right tabular-nums">{money(v)}</span></div>
          ))}
        </Panel>
        <Panel title="Last 6 months" icon="bar_chart">
          <MiniChart height={160} labels={months.map((m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }))} format={money}
            series={[{ label: 'Expenses', color: 'rgb(var(--c-secondary))', values: months.map((m) => (rows || []).filter((e) => (e.date || '').startsWith(m)).reduce((a, e) => a + num(e.total), 0)) }]} />
        </Panel>
      </div>
      <DataTable rows={rows ? list : null} onRow={(e) => setEdit({ ...e, gstRate: String(e.gstRate ?? 0) })} search={(e) => `${e.category} ${e.vendor} ${e.invoiceNo} ${e.description}`} empty="No expenses this month."
        columns={[
          { key: 'd', label: 'Date', render: (e) => fmtDate(e.date) },
          { key: 'c', label: 'Expense', render: (e) => <><b>{e.category}</b><div className="text-label-sm text-on-surface-variant">{[e.number, e.vendor, e.invoiceNo && `inv ${e.invoiceNo}`, e.description].filter(Boolean).join(' · ')}</div></> },
          { key: 'm', label: 'Paid by', render: (e) => e.method },
          { key: 'g', label: 'GST', right: true, render: (e) => (num(e.gstAmount) ? <>{money(e.gstAmount)}{e.itc === false && <Chip className="ml-1">no ITC</Chip>}</> : '—') },
          { key: 't', label: 'Total', right: true, render: (e) => <b>{money(e.total)}</b> },
        ]} />
      <RecordModal open={!!edit} onClose={() => setEdit(null)} wide title={edit?.id ? `Expense ${edit.number || ''}` : 'Add expense'} icon="receipt" collection="expenses" label="EXPENSE" fields={FIELDS} initial={edit}
        transform={async (v) => {
          const rate = num(v.gstRate); const amount = round2(num(v.amount)); const gstAmount = round2((amount * rate) / 100);
          return { ...v, gstRate: rate, amount, gstAmount, total: round2(amount + gstAmount), itc: rate > 0 ? v.itc !== false : false, vendorGstin: (v.vendorGstin || '').toUpperCase(), number: v.number || await nextNumber('expense', 'EXP') };
        }} />
    </ModulePage>
  );
}
