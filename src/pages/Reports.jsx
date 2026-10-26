import { useEffect, useMemo, useState } from 'react';
import { FileText, FileSpreadsheet } from '../components/icons';
import { billsInRange, paymentsInRange } from '../lib/db';
import { PAYMENT_METHODS, STATUS_LABEL } from '../lib/billing';
import { eachDay } from '../lib/dates';
import { money, moneyPdf, fmtDay, fmtTime, num2 } from '../lib/format';
import { downloadCsv } from '../lib/csv';
import { downloadReportPdf } from '../lib/pdf';
import { useData } from '../context/DataContext';
import DateRangeFilter, { initialRange } from '../components/DateRangeFilter';
import { StatCard } from './Dashboard';
import { Button, Card, Loading, PageHeader, Table, Td, Tabs, useToast, errMsg } from '../components/ui';
import { paymentRef } from './Bills';

const STATUSES = ['PAID', 'PARTIALLY_PAID', 'PENDING', 'CANCELLED'];
const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);

export default function Reports() {
  const { settings } = useData();
  const toast = useToast();
  const [range, setRange] = useState(() => initialRange('month'));
  const [tab, setTab] = useState('sales');
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    Promise.all([billsInRange(range.from, range.to), paymentsInRange(range.from, range.to)])
      .then(([bills, payments]) => setData({ bills, payments }))
      .catch((e) => { toast(errMsg(e), 'error'); setData({ bills: [], payments: [] }); });
  }, [range, toast]);

  const r = useMemo(() => {
    if (!data) return null;
    const live = data.bills.filter((b) => b.paymentStatus !== 'CANCELLED');
    const days = eachDay(range.from, range.to).reverse().map((d) => {
      const bs = live.filter((b) => b.billDate === d);
      const ps = data.payments.filter((p) => p.date === d);
      return { date: d, bills: bs.length, sales: sum(bs, 'grandTotal'), discount: sum(bs, 'discountAmount'), tax: sum(bs, 'taxAmount'), collected: sum(ps, 'amount'), pending: sum(bs, 'balanceAmount') };
    }).filter((d) => d.bills || d.collected);
    const methods = PAYMENT_METHODS.map((m) => {
      const ps = data.payments.filter((p) => p.method === m);
      return { method: m, count: ps.length, amount: sum(ps, 'amount') };
    });
    const statuses = STATUSES.map((s) => {
      const bs = data.bills.filter((b) => b.paymentStatus === s);
      return { status: s, count: bs.length, amount: sum(bs, 'grandTotal'), balance: s === 'CANCELLED' ? 0 : sum(bs, 'balanceAmount') };
    });
    return {
      live, days, methods, statuses,
      summary: {
        bills: live.length, sales: sum(live, 'grandTotal'), collected: sum(data.payments, 'amount'),
        pending: sum(live, 'balanceAmount'), discount: sum(live, 'discountAmount'), tax: sum(live, 'taxAmount'), subtotal: sum(live, 'subtotal'),
      },
    };
  }, [data, range]);

  const period = range.from === range.to ? fmtDay(range.from) : `${fmtDay(range.from)} to ${fmtDay(range.to)}`;
  const file = (name, ext) => `${name}-${range.from}-to-${range.to}.${ext}`;

  function exportPdf() {
    const s = r.summary;
    const base = { hotelName: settings.hotelName, subtitle: period };
    if (tab === 'sales') {
      downloadReportPdf({
        ...base, title: 'Daily Sales Report', filename: file('daily-sales', 'pdf'),
        summary: [['Number of bills', String(s.bills)], ['Total sales', moneyPdf(s.sales)], ['Total collected', moneyPdf(s.collected)], ['Total pending', moneyPdf(s.pending)], ['Total discounts', moneyPdf(s.discount)], ['Total tax', moneyPdf(s.tax)]],
        sections: [{ title: 'By day', head: ['Date', 'Bills', 'Sales', 'Discount', 'Tax', 'Collected', 'Pending'], rightCols: [1, 2, 3, 4, 5, 6],
          body: r.days.map((d) => [fmtDay(d.date), d.bills, num2(d.sales), num2(d.discount), num2(d.tax), num2(d.collected), num2(d.pending)]),
          foot: ['Total', s.bills, num2(s.sales), num2(s.discount), num2(s.tax), num2(s.collected), num2(s.pending)] }],
      });
    } else if (tab === 'payments') {
      downloadReportPdf({
        ...base, title: 'Payment Report', filename: file('payments', 'pdf'),
        summary: [...r.methods.map((m) => [m.method, `${moneyPdf(m.amount)}  (${m.count})`]), ['Total', moneyPdf(s.collected)]],
        sections: [{ title: 'Payments', head: ['Payment ID', 'Invoice', 'Guest', 'Method', 'Date', 'Time', 'By', 'Amount'], rightCols: [7],
          body: data.payments.map((p) => [paymentRef(p.id), p.invoiceNumber, p.guestName, p.method, fmtDay(p.date), fmtTime(p.createdAt), p.receivedBy?.name || '', num2(p.amount)]),
          foot: ['', '', '', '', '', '', 'Total', num2(s.collected)] }],
      });
    } else {
      downloadReportPdf({
        ...base, title: 'Bill Report', filename: file('bills', 'pdf'),
        summary: r.statuses.map((x) => [STATUS_LABEL[x.status], `${x.count} bills · ${moneyPdf(x.amount)}`]),
        sections: [{ title: 'Bills', head: ['Invoice', 'Date', 'Guest', 'Room', 'Total', 'Paid', 'Balance', 'Status'], rightCols: [4, 5, 6],
          body: data.bills.map((b) => [b.invoiceNumber, fmtDay(b.billDate), b.guestName, b.roomNumber, num2(b.grandTotal), num2(b.paidAmount), num2(b.balanceAmount), STATUS_LABEL[b.paymentStatus]]) }],
      });
    }
  }
  function exportCsv() {
    if (tab === 'sales') downloadCsv(file('daily-sales', 'csv'), ['Date', 'Bills', 'Sales', 'Discount', 'Tax', 'Collected', 'Pending'], r.days.map((d) => [d.date, d.bills, d.sales, d.discount, d.tax, d.collected, d.pending]));
    else if (tab === 'payments') downloadCsv(file('payments', 'csv'), ['Payment ID', 'Invoice', 'Guest', 'Method', 'Reference', 'Date', 'Time', 'Recorded by', 'Amount'], data.payments.map((p) => [paymentRef(p.id), p.invoiceNumber, p.guestName, p.method, p.referenceNumber, p.date, fmtTime(p.createdAt), p.receivedBy?.name, p.amount]));
    else downloadCsv(file('bills', 'csv'), ['Invoice', 'Date', 'Guest', 'Phone', 'Room', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Status'], data.bills.map((b) => [b.invoiceNumber, b.billDate, b.guestName, b.guestPhone, b.roomNumber, b.subtotal, b.discountAmount, b.taxAmount, b.grandTotal, b.paidAmount, b.balanceAmount, STATUS_LABEL[b.paymentStatus]]));
  }

  return (
    <div>
      <PageHeader crumbs={['Finance', 'Reports']} title="Reports" subtitle={period}
        actions={<>
          <Button variant="secondary" onClick={exportCsv} disabled={!r}><FileSpreadsheet className="h-4 w-4" />Excel / CSV</Button>
          <Button variant="secondary" onClick={exportPdf} disabled={!r}><FileText className="h-4 w-4" />PDF</Button>
        </>} />
      <div className="mb-4"><DateRangeFilter value={range} onChange={setRange} /></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'sales', label: 'Daily Sales' }, { id: 'payments', label: 'Payment Report' }, { id: 'bills', label: 'Bill Report' }]} />

      {!r ? <Loading /> : tab === 'sales' ? (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Bills" value={r.summary.bills} />
            <StatCard label="Total sales" value={money(r.summary.sales)} />
            <StatCard label="Collected" value={money(r.summary.collected)} tone="green" />
            <StatCard label="Pending" value={money(r.summary.pending)} tone="amber" />
            <StatCard label="Discounts" value={money(r.summary.discount)} />
            <StatCard label="Tax" value={money(r.summary.tax)} />
          </div>
          <Card>
            <Table head={['Date', { label: 'Bills', right: true }, { label: 'Sales', right: true }, { label: 'Discount', right: true }, { label: 'Tax', right: true }, { label: 'Collected', right: true }, { label: 'Pending', right: true }]}>
              {r.days.length === 0 ? <tr><Td colSpan={7} className="py-8 text-center text-slate-500">No activity in this period.</Td></tr> : r.days.map((d) => (
                <tr key={d.date}>
                  <Td className="whitespace-nowrap">{fmtDay(d.date)}</Td>
                  <Td right>{d.bills}</Td><Td right>{money(d.sales)}</Td><Td right>{money(d.discount)}</Td><Td right>{money(d.tax)}</Td>
                  <Td right className="text-secondary">{money(d.collected)}</Td><Td right className="text-error">{money(d.pending)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          <p className="mt-2 text-xs text-slate-500">Sales, discount, tax and pending are from bills dated in the period (excluding cancelled). Collected is money received in the period.</p>
        </>
      ) : tab === 'payments' ? (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
          <Card>
            <Table head={['Method', { label: 'Count', right: true }, { label: 'Amount', right: true }]}>
              {r.methods.map((m) => <tr key={m.method}><Td>{m.method}</Td><Td right>{m.count}</Td><Td right>{money(m.amount)}</Td></tr>)}
              <tr className="font-semibold"><Td>Total</Td><Td right>{data.payments.length}</Td><Td right>{money(r.summary.collected)}</Td></tr>
            </Table>
          </Card>
          <Card>
            <Table head={['Invoice', 'Guest', 'Method', 'Date', { label: 'Amount', right: true }]}>
              {data.payments.length === 0 ? <tr><Td colSpan={5} className="py-8 text-center text-slate-500">No payments in this period.</Td></tr> : data.payments.map((p) => (
                <tr key={p.id}><Td className="font-medium">{p.invoiceNumber}</Td><Td>{p.guestName}</Td><Td>{p.method}</Td><Td className="whitespace-nowrap">{fmtDay(p.date)} {fmtTime(p.createdAt)}</Td><Td right>{money(p.amount)}</Td></tr>
              ))}
            </Table>
          </Card>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
          <Card>
            <Table head={['Status', { label: 'Bills', right: true }, { label: 'Amount', right: true }]}>
              {r.statuses.map((x) => <tr key={x.status}><Td>{STATUS_LABEL[x.status]}</Td><Td right>{x.count}</Td><Td right>{money(x.amount)}</Td></tr>)}
            </Table>
          </Card>
          <Card>
            <Table head={['Invoice', 'Guest', 'Room', { label: 'Total', right: true }, { label: 'Balance', right: true }, 'Status']}>
              {data.bills.length === 0 ? <tr><Td colSpan={6} className="py-8 text-center text-slate-500">No bills in this period.</Td></tr> : data.bills.map((b) => (
                <tr key={b.id}><Td className="font-medium">{b.invoiceNumber}</Td><Td>{b.guestName}</Td><Td>{b.roomNumber}</Td><Td right>{money(b.grandTotal)}</Td><Td right>{money(b.balanceAmount)}</Td><Td>{STATUS_LABEL[b.paymentStatus]}</Td></tr>
              ))}
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}
