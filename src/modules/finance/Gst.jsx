// GST & e-invoice: GSTR-1 and GSTR-3B figures for the month, the GSTN offline
// tool CSVs, NIC e-invoice JSON for business guests, and Tally / Zoho exports.
// Filing and IRN generation happen on the GST portal or through your GSP.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveSettings } from '../../lib/db';
import { downloadCsv, downloadText } from '../../lib/csv';
import { Button, Field, Input, Modal, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Panel, Stats, fmtDate, money, num, today, useLive } from '../kit';
import { useBooks } from './ledger';
import { STATES, eInvoice, gstr1, gstr3b, stateOf, tallyXml } from './gstData';

const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); const last = new Date(y, mo, 0).getDate(); return [`${m}-01`, `${m}-${String(last).padStart(2, '0')}`]; };
const dmy = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-') : '');

function SetupModal({ onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [v, setV] = useState({ legalName: settings.legalName || '', pincode: settings.pincode || '', tallyCompany: settings.tallyCompany || '' });
  async function save() { try { await saveSettings(user, v, 'GST_SETTINGS'); toast('Saved'); onClose(); } catch (e) { toast(errMsg(e), 'error'); } }
  return (
    <Modal open onClose={onClose} title="GST details" icon="tune" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Legal name (as on GST certificate)" className="sm:col-span-2"><Input value={v.legalName} onChange={(e) => setV({ ...v, legalName: e.target.value })} /></Field>
        <Field label="Pincode"><Input value={v.pincode} onChange={(e) => setV({ ...v, pincode: e.target.value })} inputMode="numeric" /></Field>
        <Field label="Tally company name"><Input value={v.tallyCompany} onChange={(e) => setV({ ...v, tallyCompany: e.target.value })} /></Field>
        <p className="text-label-md text-on-surface-variant sm:col-span-2">GSTIN, address and state are taken from Settings → Hotel details.</p>
      </div>
    </Modal>
  );
}

export default function Gst() {
  const { settings } = useData();
  const books = useBooks(settings.openingBalances);
  const menu = useLive('menuItems') || [];
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(0); return today().slice(8) <= '11' ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : today().slice(0, 7); });
  const [tab, setTab] = useState('3b');
  const [setup, setSetup] = useState(false);
  const [from, to] = monthRange(month);
  const code = Object.entries(STATES).find(([, n]) => n.toLowerCase() === String(settings.state || '').trim().toLowerCase())?.[0];
  const hotelState = stateOf(settings.gstin) || (code ? `${String(code).padStart(2, '0')}-${STATES[code]}` : '');
  const data = { ...books, menu };
  const r = useMemo(() => (books.ready ? gstr3b(data, from, to, hotelState) : null), [books.ready, books.bills, books.orders, books.creditNotes, books.expenses, books.pos, from, to, hotelState, menu]); // eslint-disable-line react-hooks/exhaustive-deps
  const r1 = r?.r1;
  const tag = month.replace('-', '');

  const exportR1 = (kind) => {
    if (kind === 'b2b') downloadCsv(`b2b-${tag}.csv`, ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'], r1.b2b.map((x) => [x.gstin, x.name, x.number, dmy(x.date), x.value, x.pos, 'N', '', 'Regular B2B', '', x.rate, x.taxable, 0]));
    if (kind === 'b2cs') downloadCsv(`b2cs-${tag}.csv`, ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'], r1.b2cs.map((x) => ['OE', x.pos, '', x.rate, x.taxable, 0, '']));
    if (kind === 'cdnr') downloadCsv(`cdnr-${tag}.csv`, ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'], r1.cdnr.map((x) => [x.gstin, x.name, x.number, dmy(x.date), 'C', hotelState || stateOf(x.gstin), 'N', 'Regular B2B', x.value, '', x.rate, x.taxable, 0]));
    if (kind === 'hsn') downloadCsv(`hsn-${tag}.csv`, ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'], r1.hsn.map((x) => [x.code, x.desc, x.uqc, x.qty, Math.round((x.taxable + x.igst + x.cgst + x.sgst) * 100) / 100, x.rate, x.taxable, x.igst, x.cgst, x.sgst, 0]));
  };
  const allJson = () => downloadText(JSON.stringify(r1.b2b.map((x) => eInvoice(x.bill, settings)), null, 2), `e-invoices-${tag}.json`, 'application/json');

  return (
    <ModulePage crumb={['Finance', 'GST & e-invoice']} title="GST & e-invoice" subtitle={`${settings.gstin ? `GSTIN ${settings.gstin}` : 'Add your GSTIN in Settings'} · ${new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`}
      tabs={[{ id: '3b', label: 'GSTR-3B', icon: 'summarize' }, { id: 'r1', label: 'GSTR-1', icon: 'table_view' }, { id: 'einv', label: 'E-invoice', icon: 'qr_code_2', count: r1?.b2b.length }, { id: 'export', label: 'Tally & exports', icon: 'ios_share' }]} tab={tab} onTab={setTab}
      actions={<><div className="w-40"><Input type="month" value={month} onChange={(e) => setMonth(e.target.value || month)} aria-label="Tax period" /></div><Button variant="secondary" icon="tune" onClick={() => setSetup(true)}>GST details</Button></>}>
      {!r ? <Panel><p className="text-body-md text-on-surface-variant">Loading…</p></Panel> : <>
        {!settings.gstin && <p className="rounded-lg bg-warn-container p-3 text-body-md text-on-warn-container">Add your hotel’s GSTIN in Settings → Hotel details so returns and e-invoices carry it.</p>}
        <Stats items={[
          { label: 'Taxable sales', value: money(r.out.taxable), icon: 'point_of_sale' },
          { label: 'Output GST', value: money(r.out.igst + r.out.cgst + r.out.sgst), icon: 'arrow_upward' },
          { label: 'Input credit', value: money(r.itc.igst + r.itc.cgst + r.itc.sgst), icon: 'arrow_downward' },
          { label: 'GST to pay', value: money(r.totalPayable), icon: 'account_balance', tone: r.totalPayable ? 'error' : 'ok', sub: `Due 20 ${new Date(`${monthRange(month)[1]}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' })} +1` },
        ]} />
        {tab === '3b' && (
          <div className="grid gap-space-md lg:grid-cols-2">
            <Panel title="3.1(a) Outward taxable supplies" icon="upload">
              <Table3 rows={[['Taxable value', r.out.taxable], ['Integrated tax', r.out.igst], ['Central tax', r.out.cgst], ['State / UT tax', r.out.sgst]]} />
            </Panel>
            <Panel title="4(A)(5) Input tax credit — all other ITC" icon="download">
              <Table3 rows={[['Integrated tax', r.itc.igst], ['Central tax', r.itc.cgst], ['State / UT tax', r.itc.sgst]]} />
              <p className="mt-2 text-label-md text-on-surface-variant">From expenses with ITC claimed and goods received against purchase orders. Match with GSTR-2B before filing.</p>
            </Panel>
            <Panel title="Tax payable in cash" icon="payments" className="lg:col-span-2">
              <Table3 rows={[['Integrated tax', r.payable.igst], ['Central tax', r.payable.cgst], ['State / UT tax', r.payable.sgst], ['Total', r.totalPayable]]} />
            </Panel>
          </div>
        )}
        {tab === 'r1' && (
          <div className="space-y-space-md">
            <Panel title={`B2B invoices (${r1.b2b.length})`} icon="business" actions={<Button size="sm" variant="secondary" icon="file_download" onClick={() => exportR1('b2b')}>b2b.csv</Button>}>
              <MiniTable head={['Invoice', 'Date', 'GSTIN', 'Guest', 'Taxable', 'Tax', 'Value']} rows={r1.b2b.map((x) => [x.number, fmtDate(x.date), x.gstin, x.name, money(x.taxable), money(x.igst + x.cgst + x.sgst), money(x.value)])} />
            </Panel>
            <Panel title="B2C (small) by rate" icon="groups" actions={<Button size="sm" variant="secondary" icon="file_download" onClick={() => exportR1('b2cs')}>b2cs.csv</Button>}>
              <MiniTable head={['Place of supply', 'Rate', 'Taxable', 'CGST', 'SGST', 'IGST']} rows={r1.b2cs.map((x) => [x.pos || '—', `${x.rate}%`, money(x.taxable), money(x.cgst), money(x.sgst), money(x.igst)])} />
            </Panel>
            <Panel title={`Credit notes (${r1.cdnr.length + r1.cdnur.length})`} icon="assignment_return" actions={r1.cdnr.length > 0 && <Button size="sm" variant="secondary" icon="file_download" onClick={() => exportR1('cdnr')}>cdnr.csv</Button>}>
              <MiniTable head={['Note', 'Date', 'Against', 'Guest', 'Taxable', 'Value']} rows={[...r1.cdnr, ...r1.cdnur].map((x) => [x.number, fmtDate(x.date), x.invoice, `${x.name}${x.gstin ? ` · ${x.gstin}` : ''}`, money(x.taxable), money(x.value)])} />
            </Panel>
            <Panel title="HSN / SAC summary" icon="tag" actions={<Button size="sm" variant="secondary" icon="file_download" onClick={() => exportR1('hsn')}>hsn.csv</Button>}>
              <MiniTable head={['SAC', 'Description', 'Rate', 'Qty', 'Taxable', 'Tax']} rows={r1.hsn.map((x) => [x.code, x.desc, `${x.rate}%`, x.qty, money(x.taxable), money(x.igst + x.cgst + x.sgst)])} />
            </Panel>
            <Panel title="Documents issued" icon="description"><p className="text-body-md">Invoices {r1.docs.from || '—'} to {r1.docs.to || '—'} · {r1.docs.total} issued · {r1.docs.cancelled} cancelled</p></Panel>
          </div>
        )}
        {tab === 'einv' && (
          <>
            <p className="rounded-lg bg-surface-container-low p-3 text-body-md text-on-surface-variant">E-invoicing applies once your turnover crosses ₹5 crore. Download the JSON (NIC schema 1.1) and upload it on the IRP portal or through your GST Suvidha Provider to get the IRN and QR code. Direct IRN generation needs your GSP API account.</p>
            <DataTable rows={r1.b2b} rowKey="number" empty="No bills to business guests (with a GSTIN) this month."
              toolbar={r1.b2b.length > 0 && <Button size="sm" variant="secondary" icon="file_download" onClick={allJson}>All as one JSON</Button>}
              columns={[
                { key: 'n', label: 'Invoice', render: (x) => <><b>{x.number}</b><div className="text-label-sm text-on-surface-variant">{fmtDate(x.date)}</div></> },
                { key: 'g', label: 'Buyer', render: (x) => <>{x.name}<div className="text-label-sm text-on-surface-variant">{x.gstin}</div></> },
                { key: 'p', label: 'Place of supply', render: (x) => x.pos },
                { key: 'v', label: 'Value', right: true, render: (x) => money(x.value) },
                { key: 's', label: '', render: (x) => (x.bill.irn ? <Chip tone="ok">IRN</Chip> : <Chip>No IRN</Chip>) },
              ]}
              actions={(x) => <Button size="sm" variant="ghost" icon="data_object" onClick={() => downloadText(JSON.stringify(eInvoice(x.bill, settings), null, 2), `${x.number}-einvoice.json`, 'application/json')}>JSON</Button>} />
          </>
        )}
        {tab === 'export' && (
          <div className="grid gap-space-md md:grid-cols-2">
            <Panel title="Tally Prime / ERP 9" icon="ios_share">
              <p className="text-body-md text-on-surface-variant">All vouchers for the month (sales, receipts, purchases, payments, payroll) as Tally XML. Create ledgers with the same names in Tally first, then Gateway → Import → Vouchers.</p>
              <Button className="mt-3" icon="file_download" onClick={() => downloadText(tallyXml(books.J, from, to, settings.tallyCompany), `tally-vouchers-${tag}.xml`, 'application/xml')}>Download Tally XML</Button>
            </Panel>
            <Panel title="Zoho Books / Excel" icon="table_chart">
              <p className="text-body-md text-on-surface-variant">The month’s journal (date, voucher, account, debit, credit) as CSV for Zoho Books’ journal import or your accountant.</p>
              <Button className="mt-3" icon="file_download" onClick={() => downloadCsv(`journal-${tag}.csv`, ['Journal Date', 'Reference Number', 'Notes', 'Account', 'Debit', 'Credit'], books.J.filter((e) => e.date >= from && e.date <= to).flatMap((e) => e.lines.map((l) => [e.date, e.ref, e.narration, l.account.replace(/^Expense: /, ''), l.dr || '', l.cr || ''])))}>Download journal CSV</Button>
            </Panel>
            <Panel title="Sales register" icon="receipt_long">
              <Button icon="file_download" onClick={() => downloadCsv(`sales-register-${tag}.csv`, ['Invoice', 'Date', 'Guest', 'GSTIN', 'Room', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Status'], books.bills.filter((b) => b.billDate >= from && b.billDate <= to).sort((a, b) => (a.invoiceSeq || 0) - (b.invoiceSeq || 0)).map((b) => { const t = (n) => (b.taxes || []).filter((x) => String(x.name).toUpperCase().includes(n)).reduce((a, x) => a + num(x.amount), 0); return [b.invoiceNumber, b.billDate, b.guestName, b.guest?.gstin || '', b.roomNumber, b.taxableAmount, t('CGST'), t('SGST'), t('IGST'), b.grandTotal, b.paymentStatus]; }))}>Sales register CSV</Button>
            </Panel>
            <Panel title="Purchase register" icon="shopping_cart">
              <Button icon="file_download" onClick={() => downloadCsv(`purchase-register-${tag}.csv`, ['Date', 'Supplier / vendor', 'Invoice', 'Taxable', 'GST', 'Total', 'Type'], [...books.pos.filter((p) => (p.receivedOn || p.date) >= from && (p.receivedOn || p.date) <= to).map((p) => [p.receivedOn || p.date, p.supplierName, p.invoiceNo || p.number, p.base, p.tax, p.total, 'Purchase']), ...books.expenses.filter((e) => e.date >= from && e.date <= to).map((e) => [e.date, e.vendor || e.category, e.invoiceNo || e.number, e.amount, e.gstAmount, e.total, e.itc !== false ? 'Expense (ITC)' : 'Expense'])])}>Purchase register CSV</Button>
            </Panel>
          </div>
        )}
      </>}
      {setup && <SetupModal onClose={() => setSetup(false)} />}
    </ModulePage>
  );
}

function Table3({ rows }) {
  return <div className="text-body-md">{rows.map(([k, v]) => <div key={k} className="flex justify-between border-b border-surface-container py-1.5 last:border-0 last:font-semibold"><span>{k}</span><span className="tabular-nums">{money(v)}</span></div>)}</div>;
}
function MiniTable({ head, rows }) {
  if (!rows.length) return <p className="text-body-md text-on-surface-variant">Nothing this month.</p>;
  return (
    <div className="thin-scroll overflow-x-auto">
      <table className="w-full text-body-sm">
        <thead><tr className="text-left text-label-sm uppercase tracking-wider text-on-surface-variant">{head.map((h) => <th key={h} className="px-2 py-1.5">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-surface-container">{r.map((c, j) => <td key={j} className="px-2 py-1.5 tabular-nums">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
