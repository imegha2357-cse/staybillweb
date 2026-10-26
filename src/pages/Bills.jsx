// Bills & Payments Ledger — the Google Stitch screen, wired to live Firestore data.
// Covers PRD §32, §36–41: bill list, search, filters, status tabs, outstanding
// queue, payment recording, today's collections and payment history.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { billsInRange, searchBills, paymentsInRange, paymentsForBill } from '../lib/db';
import { PAYMENT_METHODS, STATUS_LABEL } from '../lib/billing';
import { money, fmtDay, fmtTime, fmtDayShort } from '../lib/format';
import { RANGE_PRESETS, presetRange, today, eachDay } from '../lib/dates';
import { downloadCsv } from '../lib/csv';
import { downloadInvoicePdf, downloadInvoicesPdf } from '../lib/pdf';
import { CAN_PRINT } from '../platform';
import { useData } from '../context/DataContext';
import { Icon } from '../components/icons';
import RecordPaymentModal, { methodIcon } from '../components/RecordPaymentModal';
import { CheckoutTicker, Hi } from '../motion/hotel';
import { Button, IconButton, MetricCard, Modal, PageHeader, Select, Sparkline, StatusBadge, Spinner, Input, useToast, errMsg, cx } from '../components/ui';

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'PAID', label: 'Paid' },
  { id: 'PARTIALLY_PAID', label: 'Partially Paid' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'CANCELLED', label: 'Cancelled' },
];

export const paymentRef = (id) => `PAY-${id.slice(0, 8).toUpperCase()}`;
const sum = (arr, k) => arr.reduce((s, x) => s + (x[k] || 0), 0);
const modeOf = (b) => {
  const m = b.paymentMethods || [];
  return m.length > 1 ? 'Split' : m[0] || '';
};
function rangeLabel(r) {
  const p = RANGE_PRESETS.find((x) => x.id === r.preset)?.label || 'Custom';
  if (r.preset === 'custom') return r.from === r.to ? fmtDay(r.from) : `${fmtDayShort(r.from)} – ${fmtDay(r.to)}`;
  return r.from === r.to ? `${p} (${fmtDay(r.from)})` : `${p} (${fmtDayShort(r.from)} – ${fmtDay(r.to)})`;
}

function RowMenu({ bill, canEdit, canCancel, onPdf }) {
  const [pos, setPos] = useState(null);
  const ref = useRef();
  const btn = useRef();
  const nav = useNavigate();
  useEffect(() => {
    if (!pos) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target) && !btn.current?.contains(e.target)) setPos(null); };
    const hide = () => setPos(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide); };
  }, [pos]);
  function toggle(e) {
    e.stopPropagation();
    if (pos) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    const h = 230;
    const up = r.bottom + h > window.innerHeight - 8;
    setPos({ right: Math.max(8, window.innerWidth - r.right), top: up ? undefined : r.bottom + 4, bottom: up ? window.innerHeight - r.top + 4 : undefined });
  }
  const item = 'flex w-full items-center gap-space-sm px-space-md py-2 text-left text-label-lg text-on-surface hover:bg-surface-container-low';
  return (
    <>
      <span ref={btn}><IconButton icon="more_vert" title="More actions" onClick={toggle} /></span>
      {pos && (
        <div ref={ref} style={{ position: 'fixed', ...pos }} className="z-[45] w-48 overflow-hidden rounded-xl bg-surface-container-lowest py-1 shadow-lg ring-1 ring-surface-container" onClick={(e) => e.stopPropagation()}>
          <button className={item} onClick={() => nav(`/bills/${bill.id}`)}><Icon name="visibility" size={16} />View bill</button>
          <button className={item} onClick={() => { setPos(null); onPdf(bill); }}><Icon name="picture_as_pdf" size={16} />Download PDF</button>
          {canEdit && <button className={item} onClick={() => nav(`/bills/${bill.id}/edit`)}><Icon name="edit" size={16} />Edit bill</button>}
          {canCancel && <button className={cx(item, 'text-error')} onClick={() => nav(`/bills/${bill.id}?cancel=1`)}><Icon name="block" size={16} />Cancel bill</button>}
          <button className={item} onClick={() => nav(`/guests/${bill.guestId}`)}><Icon name="person" size={16} />Guest history</button>
        </div>
      )}
    </>
  );
}

export default function Bills() {
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { roomTypes, outstanding, can, settings } = useData();

  const [range, setRange] = useState(() => ({ preset: 'month', ...presetRange('month') }));
  const [term, setTerm] = useState(params.get('q') || '');
  const [debounced, setDebounced] = useState((params.get('q') || '').trim());
  const [status, setStatus] = useState('all');
  const [filters, setFilters] = useState({ roomType: '', method: '', staff: '' });
  const [rangeBills, setRangeBills] = useState(null);
  const [searchRows, setSearchRows] = useState(null);
  const [payments, setPayments] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [payBill, setPayBill] = useState(null);
  const [directOpen, setDirectOpen] = useState(false);
  const [reasonBill, setReasonBill] = useState(null);
  const [showAllQueue, setShowAllQueue] = useState(false);
  const [historyAll, setHistoryAll] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const collectRef = useRef();

  // Header search → ?q=
  useEffect(() => {
    const q = params.get('q');
    if (q !== null) { setTerm(q); setDebounced(q.trim()); }
  }, [params]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);
  useEffect(() => {
    if (loc.hash === '#collect') setTimeout(() => collectRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }, [loc.hash]);

  const loadRange = useCallback(() => {
    setRangeBills(null); setPayments(null);
    billsInRange(range.from, range.to).then(setRangeBills).catch((e) => { toast(errMsg(e), 'error'); setRangeBills([]); });
    paymentsInRange(range.from, range.to).then(setPayments).catch((e) => { toast(errMsg(e), 'error'); setPayments([]); });
  }, [range, toast]);
  useEffect(() => { loadRange(); }, [loadRange]);

  useEffect(() => {
    if (!debounced) { setSearchRows(null); return; }
    setSearchRows(undefined);
    searchBills(debounced).then(setSearchRows).catch((e) => { toast(errMsg(e), 'error'); setSearchRows([]); });
  }, [debounced, toast]);

  useEffect(() => { setPage(1); setSelected(new Set()); }, [status, filters, debounced, range, perPage]);

  const base = debounced ? searchRows : rangeBills;
  const afterFilters = useMemo(() => (base || []).filter((b) =>
    (!filters.roomType || b.roomType === filters.roomType)
    && (!filters.method || (filters.method === 'Split' ? (b.paymentMethods || []).length > 1 : (b.paymentMethods || []).includes(filters.method)))
    && (!filters.staff || b.createdBy?.name === filters.staff)), [base, filters]);
  const counts = useMemo(() => {
    const c = { all: afterFilters.length };
    STATUS_TABS.slice(1).forEach((t) => { c[t.id] = afterFilters.filter((b) => b.paymentStatus === t.id).length; });
    return c;
  }, [afterFilters]);
  const rows = useMemo(() => afterFilters.filter((b) => status === 'all' || b.paymentStatus === status), [afterFilters, status]);
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const pageRows = rows.slice((page - 1) * perPage, page * perPage);
  const staffNames = useMemo(() => [...new Set((rangeBills || []).map((b) => b.createdBy?.name).filter(Boolean))].sort(), [rangeBills]);

  // ---- Metrics (selected date range) ----
  const m = useMemo(() => {
    if (!rangeBills || !payments) return null;
    const live = rangeBills.filter((b) => b.paymentStatus !== 'CANCELLED');
    const cancelled = rangeBills.filter((b) => b.paymentStatus === 'CANCELLED');
    const invoiced = sum(live, 'grandTotal');
    const collected = sum(payments, 'amount');
    const days = eachDay(range.from, range.to);
    const spark = days.length > 1 ? days.map((d) => sum(live.filter((b) => b.billDate === d), 'grandTotal')) : [0, invoiced];
    const t = today();
    const outTotal = sum(outstanding, 'balanceAmount');
    const dueToday = sum(outstanding.filter((b) => b.checkOut <= t), 'balanceAmount');
    const byMethod = Object.fromEntries(PAYMENT_METHODS.map((k) => [k, sum(payments.filter((p) => p.method === k), 'amount')]));
    const topMethod = Object.entries(byMethod).sort((a, b) => b[1] - a[1])[0];
    return { live, invoiced, collected, spark, cancelled, outTotal, dueToday, byMethod, topMethod, pct: invoiced > 0 ? Math.min(100, (collected / invoiced) * 100) : 0 };
  }, [rangeBills, payments, outstanding, range]);

  // ---- Fast-collect queue: earliest check-out first, then oldest bill ----
  const queue = useMemo(() => [...outstanding].sort((a, b) => (a.checkOut || '').localeCompare(b.checkOut || '') || (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)), [outstanding]);
  const shownQueue = showAllQueue ? queue : queue.slice(0, 3);

  const pageIds = pageRows.map((b) => b.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); pageIds.forEach((id) => (allOnPage ? n.delete(id) : n.add(id))); return n; });
  const toggleOne = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function onPdf(b) {
    try { await downloadInvoicePdf(b, settings, await paymentsForBill(b.id)); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function batchPrint() {
    const ids = [...selected];
    if (CAN_PRINT) { nav(`/print?ids=${ids.join(',')}`); return; }
    setBatchBusy(true);
    try {
      const all = [...(rangeBills || []), ...(searchRows || [])];
      const items = await Promise.all(ids.map(async (id) => ({ bill: all.find((x) => x.id === id), payments: await paymentsForBill(id) })));
      await downloadInvoicesPdf(items.filter((x) => x.bill), settings, `invoices-${today()}.pdf`);
    } catch (e) { toast(errMsg(e), 'error'); }
    setBatchBusy(false);
  }
  function exportCsv() {
    downloadCsv(`bills-${debounced ? 'search' : `${range.from}-to-${range.to}`}.csv`,
      ['Invoice', 'Date', 'Time', 'Guest', 'Phone', 'GSTIN', 'Room', 'Room type', 'Check-in', 'Check-out', 'Nights', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Balance', 'Status', 'Payment mode', 'Created by', 'Cancel reason'],
      rows.map((b) => [b.invoiceNumber, b.billDate, fmtTime(b.createdAt), b.guestName, b.guestPhone, b.guest?.gstin, b.roomNumber, b.roomType, b.checkIn, b.checkOut, b.nights, b.subtotal, b.discountAmount, b.taxAmount, b.grandTotal, b.paidAmount, b.balanceAmount, STATUS_LABEL[b.paymentStatus], modeOf(b), b.createdBy?.name, b.cancelReason]));
  }
  function exportPayments() {
    downloadCsv(`payments-${range.from}-to-${range.to}.csv`, ['Payment ID', 'Invoice', 'Guest', 'Room', 'Amount', 'Method', 'Reference', 'Date', 'Time', 'Recorded by', 'Notes'],
      (payments || []).map((p) => [paymentRef(p.id), p.invoiceNumber, p.guestName, p.roomNumber, p.amount, p.method, p.referenceNumber, p.date, fmtTime(p.createdAt), p.receivedBy?.name, p.notes]));
  }
  const afterPayment = () => { loadRange(); if (debounced) searchBills(debounced).then(setSearchRows).catch(() => {}); };

  const selectCls = 'h-9 w-auto min-w-[150px]';
  const td = 'px-3 py-2';

  return (
    <div className="flex w-full flex-col">
      <PageHeader crumbs={['Billing', 'Ledger & Receivables']} title="Bills & Payments Ledger"
        subtitle="Every invoice, payment and outstanding balance — with full audit trail"
        actions={<>
          <Button variant="secondary" icon={CAN_PRINT ? 'print' : 'picture_as_pdf'} disabled={!selected.size} loading={batchBusy} onClick={batchPrint}>{CAN_PRINT ? 'Batch Print' : 'Batch PDF'} ({selected.size})</Button>
          <Button variant="secondary" icon="file_download" onClick={exportCsv} disabled={!rows.length}>Export CSV / Excel</Button>
          <Button icon="add_card" onClick={() => setDirectOpen(true)}>Record Payment</Button>
        </>} />

      <CheckoutTicker bills={outstanding} />

      {/* Metric strip */}
      <div className="mb-space-lg grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
        {!m ? [0, 1, 2, 3].map((i) => <div key={i} className="flex h-[150px] items-center justify-center rounded-xl bg-surface-container-lowest shadow-sm"><Spinner /></div>) : (<>
          <MetricCard label={`Total Invoiced (${RANGE_PRESETS.find((x) => x.id === range.preset)?.label || 'Range'})`} value={money(m.invoiced)} icon="receipt_long" tone="accent"
            sub={`${m.live.length} bill${m.live.length === 1 ? '' : 's'} created`}>
            <div className="mt-3 pt-2"><Sparkline values={m.spark} /></div>
          </MetricCard>
          <MetricCard label="Total Collected" value={money(m.collected)} icon="check_circle"
            sub={`${payments.length} payment${payments.length === 1 ? '' : 's'}${m.topMethod && m.topMethod[1] > 0 ? ` • ${money(m.topMethod[1])} via ${m.topMethod[0]}` : ''}`}>
            <div className="mt-4">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-container-low">
                <div className="h-full bg-primary" style={{ width: `${m.pct}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-label-sm text-on-surface-variant">
                <span>of {money(m.invoiced)} invoiced</span>
                <span className="font-medium text-on-surface">{m.pct.toFixed(1)}% collected</span>
              </div>
            </div>
          </MetricCard>
          <MetricCard label="Outstanding Receivables" value={money(m.outTotal)} icon="pending_actions" tone="error"
            sub={`${outstanding.length} bill${outstanding.length === 1 ? '' : 's'} pending settlement`}>
            <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-container-low px-2 py-1.5">
              <span className="text-label-sm text-on-surface-variant">Due at/after check-out:</span>
              <span className="font-financial-tabular text-financial-tabular font-bold text-error">{money(m.dueToday)}</span>
            </div>
          </MetricCard>
          <MetricCard label="Cancelled Bills" value={money(sum(m.cancelled, 'grandTotal'))} icon="rule"
            sub={`${m.cancelled.length} bill${m.cancelled.length === 1 ? '' : 's'} cancelled • reason recorded`}>
            <div className="mt-3 flex items-center gap-1.5 pt-1 text-label-sm text-on-surface-variant">
              <Icon name="verified_user" size={14} className="text-secondary" />
              <span>Kept for audit — never deleted</span>
            </div>
          </MetricCard>
        </>)}
      </div>

      {/* Filters */}
      <div className="mb-space-lg flex flex-col gap-space-md rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
        <div className="flex flex-col items-stretch justify-between gap-space-md xl:flex-row xl:items-center">
          <div className="flex items-center gap-1 overflow-x-auto pb-1 xl:pb-0">
            {STATUS_TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setStatus(t.id)}
                className={cx('whitespace-nowrap rounded-lg px-space-md py-1.5 text-label-lg transition-colors',
                  status === t.id ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface')}>
                {t.label} ({counts[t.id] ?? 0})
              </button>
            ))}
          </div>
          <div className="relative max-w-xl flex-1">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-2.5 text-outline" />
            <input value={term} onChange={(e) => { setTerm(e.target.value); if (params.get('q') !== null) setParams({}, { replace: true }); }}
              className="hm-search w-full rounded-lg bg-surface-container-low py-2 pl-9 pr-8 text-body-sm text-on-surface transition-all placeholder:text-on-surface-variant focus:bg-surface-container-lowest focus:outline-none focus:ring-1 focus:ring-secondary"
              placeholder="Search by invoice # (e.g. INV-1049), guest name, phone or room number…" aria-label="Search bills" />
            {term && <button onClick={() => { setTerm(''); setParams({}, { replace: true }); }} className="absolute right-2.5 top-2.5 text-outline hover:text-on-surface" aria-label="Clear search"><Icon name="close" size={16} /></button>}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-space-sm">
          <div className="flex flex-wrap items-center gap-space-sm">
            <Select className={selectCls} icon="calendar_month" value={range.preset} disabled={!!debounced} aria-label="Date range"
              onChange={(e) => { const id = e.target.value; setRange(id === 'custom' ? { ...range, preset: 'custom' } : { preset: id, ...presetRange(id) }); }}>
              {RANGE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.id === range.preset ? rangeLabel(range) : p.label}</option>)}
            </Select>
            {range.preset === 'custom' && !debounced && (
              <div className="flex items-center gap-space-xs text-label-md text-on-surface-variant">
                <Input type="date" className="h-9 w-40" value={range.from} max={range.to} aria-label="From" onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} />
                to
                <Input type="date" className="h-9 w-40" value={range.to} min={range.from} aria-label="To" onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} />
              </div>
            )}
            <Select className={selectCls} value={filters.roomType} onChange={(e) => setFilters({ ...filters, roomType: e.target.value })} aria-label="Room type">
              <option value="">Room Type: All Types</option>
              {roomTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </Select>
            <Select className={selectCls} value={filters.method} onChange={(e) => setFilters({ ...filters, method: e.target.value })} aria-label="Payment method">
              <option value="">Payment Method: All</option>
              {PAYMENT_METHODS.map((p) => <option key={p} value={p}>{p}</option>)}
              <option value="Split">Split (multiple methods)</option>
            </Select>
            <Select className={selectCls} value={filters.staff} onChange={(e) => setFilters({ ...filters, staff: e.target.value })} aria-label="Created by">
              <option value="">Created By: All Staff</option>
              {staffNames.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
            {(filters.roomType || filters.method || filters.staff) && <Button size="sm" variant="ghost" onClick={() => setFilters({ roomType: '', method: '', staff: '' })}>Clear filters</Button>}
          </div>
          <div className="flex items-center gap-1 text-label-sm text-on-surface-variant">
            <Icon name="tune" size={14} className="text-secondary" />
            <span>{debounced ? `Searching all dates for “${debounced}”` : `Showing ${rangeLabel(range)}`}</span>
          </div>
        </div>
      </div>

      {/* Ledger table */}
      <div className="mb-space-lg overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="h-11 bg-surface-container-low text-label-sm uppercase tracking-wider text-on-surface-variant">
                <th className="w-10 pl-space-md pr-2"><input type="checkbox" className="cursor-pointer rounded" checked={allOnPage} onChange={toggleAll} aria-label="Select all on page" /></th>
                <th className="px-3 py-2 font-semibold">Invoice #</th>
                <th className="px-3 py-2 font-semibold">Date &amp; Time</th>
                <th className="px-3 py-2 font-semibold">Guest &amp; Contact</th>
                <th className="px-3 py-2 font-semibold">Room &amp; Category</th>
                <th className="px-3 py-2 text-right font-semibold">Total Amount</th>
                <th className="px-3 py-2 text-right font-semibold">Amount Paid</th>
                <th className="px-3 py-2 text-right font-semibold">Balance Due</th>
                <th className="px-3 py-2 text-center font-semibold">Payment Mode</th>
                <th className="px-3 py-2 text-center font-semibold">Status</th>
                <th className="py-2 pl-space-sm pr-space-md text-center font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {base === null || base === undefined ? (
                <tr><td colSpan={11} className="py-16 text-center"><Spinner /></td></tr>
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-14 text-center">
                  <Icon name="receipt_long" size={32} className="mb-2 text-outline-variant" />
                  <p className="text-label-lg font-semibold text-on-surface">{debounced ? 'No bills match your search' : 'No bills in this period'}</p>
                  <p className="text-body-md text-on-surface-variant">{debounced ? 'Try an invoice number, phone number or room.' : <>Try another date range, or <Link className="font-medium text-secondary hover:underline" to="/bills/new">create a new bill</Link>.</>}</p>
                </td></tr>
              ) : pageRows.map((b) => {
                const cancelled = b.paymentStatus === 'CANCELLED';
                const paid = b.paymentStatus === 'PAID';
                const muted = cancelled ? 'line-through text-outline' : '';
                const canEdit = can.editBills && !cancelled && !paid;
                const mode = modeOf(b);
                return (
                  <tr key={b.id} className={cx('group h-14 cursor-pointer transition-colors hover:bg-surface-container-low/60', cancelled && 'bg-surface-container-low/30', selected.has(b.id) && 'bg-surface-container-low/60')}
                    onClick={() => nav(`/bills/${b.id}`)}>
                    <td className="pl-space-md pr-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" className="cursor-pointer rounded" checked={selected.has(b.id)} onChange={() => toggleOne(b.id)} aria-label={`Select ${b.invoiceNumber}`} />
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-1.5">
                        <span className={cx('whitespace-nowrap font-financial-tabular text-financial-tabular font-semibold', cancelled ? muted : 'text-on-surface')}><Hi text={b.invoiceNumber} term={debounced} /></span>
                        {!cancelled && <Icon name="receipt" size={14} className="text-secondary" title="Open invoice" />}
                      </div>
                    </td>
                    <td className={td}>
                      <div className="flex flex-col whitespace-nowrap">
                        <span className={cx('font-financial-tabular text-financial-tabular font-normal', cancelled ? muted : 'text-on-surface')}>{fmtDay(b.billDate)}</span>
                        <span className={cx('text-label-sm', cancelled ? 'text-outline' : 'text-on-surface-variant')}>{fmtTime(b.createdAt)}</span>
                      </div>
                    </td>
                    <td className={td}>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span className={cx('text-label-lg', cancelled ? 'font-medium text-outline' : 'font-semibold text-on-surface')}><Hi text={b.guestName} term={debounced} /></span>
                          {b.guest?.gstin && !cancelled && <span className="rounded bg-surface-container px-1 py-0.5 text-[10px] font-bold text-on-surface-variant" title={`GSTIN ${b.guest.gstin}`}>GST</span>}
                        </div>
                        <span className={cx('max-w-[220px] truncate text-label-sm', cancelled ? 'text-outline' : 'text-on-surface-variant')}>
                          {cancelled ? `Cancelled: ${b.cancelReason || '—'}` : b.guestPhone ? <Hi text={b.guestPhone} term={debounced} /> : (b.guest?.gstin ? `GST: ${b.guest.gstin}` : '—')}
                        </span>
                      </div>
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <span className={cx('h-2 w-2 rounded-full', cancelled ? 'bg-outline' : 'bg-secondary')} />
                        <div className="flex flex-col whitespace-nowrap">
                          <span className={cx('text-body-md', cancelled ? 'text-outline' : 'font-medium text-on-surface')}>Room <Hi text={b.roomNumber} term={debounced} /></span>
                          <span className={cx('text-label-sm', cancelled ? 'text-outline' : 'text-on-surface-variant')}>{b.roomType || '—'} · {b.nights}N</span>
                        </div>
                      </div>
                    </td>
                    <td className={cx(td, 'text-right')}><span className={cx('whitespace-nowrap font-financial-tabular text-financial-tabular font-semibold', cancelled ? muted : 'text-on-surface')}>{money(b.grandTotal, { decimals: 'always' })}</span></td>
                    <td className={cx(td, 'text-right')}><span className={cx('whitespace-nowrap font-financial-tabular text-financial-tabular font-normal', cancelled ? muted : 'text-on-surface')}>{money(b.paidAmount, { decimals: 'always' })}</span></td>
                    <td className={cx(td, 'text-right')}>
                      <span className={cx('whitespace-nowrap font-financial-tabular text-financial-tabular', cancelled ? muted : b.balanceAmount > 0 ? 'font-bold text-error' : 'font-semibold text-secondary')}>
                        {money(cancelled ? 0 : b.balanceAmount, { decimals: 'always' })}
                      </span>
                    </td>
                    <td className={cx(td, 'text-center')}>
                      {cancelled ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-outline">Void</span>
                      ) : mode ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-on-surface" title={(b.paymentMethods || []).join(' + ')}>
                          <Icon name={methodIcon(mode)} size={12} className="text-secondary" />{mode === 'Bank Transfer' ? 'Bank' : mode}
                        </span>
                      ) : <span className="text-label-sm text-outline">Unpaid</span>}
                    </td>
                    <td className={cx(td, 'text-center')}><StatusBadge status={b.paymentStatus} /></td>
                    <td className="py-2 pl-space-sm pr-space-md text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        {cancelled ? (
                          <IconButton icon="policy" title="View cancellation note" onClick={() => setReasonBill(b)} />
                        ) : (<>
                          {b.balanceAmount > 0 && <IconButton icon="payments" tone="primary" title={`Collect ${money(b.balanceAmount)}`} onClick={() => setPayBill(b)} />}
                          <IconButton icon={CAN_PRINT ? 'print' : 'picture_as_pdf'} title={CAN_PRINT ? 'Print invoice' : 'Download invoice PDF'} onClick={() => (CAN_PRINT ? nav(`/bills/${b.id}?print=1`) : onPdf(b))} />
                          {!(b.balanceAmount > 0) && (
                            canEdit ? <IconButton icon="edit" title="Edit bill" onClick={() => nav(`/bills/${b.id}/edit`)} />
                              : <IconButton icon="edit_off" title={paid ? 'Bill locked (settled)' : 'Editing not permitted'} disabled />
                          )}
                        </>)}
                        <RowMenu bill={b} canEdit={canEdit} canCancel={can.cancelBills && !cancelled} onPdf={onPdf} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        <div className="flex flex-col items-center justify-between gap-space-sm bg-surface-container-lowest px-space-md py-space-sm sm:flex-row">
          <div className="flex items-center gap-space-md">
            <span className="text-label-sm text-on-surface-variant">
              Showing <span className="font-semibold text-on-surface">{rows.length ? (page - 1) * perPage + 1 : 0} – {Math.min(page * perPage, rows.length)}</span> of <span className="font-semibold text-on-surface">{rows.length}</span> bills
            </span>
            <div className="flex items-center gap-space-xs">
              <span className="text-label-sm text-on-surface-variant">Rows per page:</span>
              <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))} className="cursor-pointer rounded bg-surface-container-low px-2 py-1 text-label-sm text-on-surface focus:outline-none">
                {[10, 25, 50].map((n) => <option key={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center gap-space-xs">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="flex items-center gap-1 rounded bg-surface-container-low px-space-sm py-1 text-label-sm text-on-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40">
              <Icon name="chevron_left" size={14} /><span>Previous</span>
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1).reduce((acc, n, i, arr) => {
                if (i > 0 && n - arr[i - 1] > 1) acc.push(<span key={`gap${n}`} className="px-1 text-label-sm text-outline">…</span>);
                acc.push(<button key={n} onClick={() => setPage(n)} className={cx('h-7 w-7 rounded text-label-sm', n === page ? 'bg-primary font-semibold text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-low')}>{n}</button>);
                return acc;
              }, [])}
            </div>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="flex items-center gap-1 rounded bg-surface-container-low px-space-sm py-1 text-label-sm text-on-surface-variant hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40">
              <span>Next</span><Icon name="chevron_right" size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Fast-collect queue */}
      <div ref={collectRef} id="collect" className="mb-space-xl flex scroll-mt-24 flex-col gap-space-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-space-xs">
            <Icon name="flash_on" size={20} className="text-secondary" />
            <h2 className="font-headline text-headline-sm tracking-tight text-on-surface">Outstanding Balances Fast-Collect Queue</h2>
            {queue.length > 0 && <span className="rounded-full bg-error-container px-2 py-0.5 text-label-sm font-bold text-on-error-container">{queue.length} to collect</span>}
          </div>
          <span className="text-label-sm text-on-surface-variant">Sorted by check-out date &amp; age</span>
        </div>
        {queue.length === 0 ? (
          <div className="flex items-center gap-space-sm rounded-xl bg-surface-container-lowest p-space-md text-body-md text-on-surface-variant shadow-sm">
            <Icon name="task_alt" size={20} className="text-secondary" />All bills are fully settled. Nothing to collect.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-space-md md:grid-cols-3">
              {shownQueue.map((b) => {
                const t = today();
                const due = b.checkOut === t ? 'Check-out today' : b.checkOut < t ? `Checked out ${fmtDay(b.checkOut)}` : `Check-out ${fmtDay(b.checkOut)}`;
                return (
                  <div key={b.id} className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-space-sm">
                        <div className="flex h-10 min-w-[2.5rem] items-center justify-center rounded-lg bg-surface-container-low px-1 font-financial-tabular font-bold text-on-surface">{b.roomNumber}</div>
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-label-lg font-semibold text-on-surface">{b.guestName}</span>
                          <span className={cx('flex items-center gap-1 text-label-sm', b.checkOut <= t ? 'font-medium text-error' : 'text-on-surface-variant')}>
                            <Icon name={b.checkOut <= t ? 'alarm' : 'event'} size={12} />{due}
                          </span>
                        </div>
                      </div>
                      <Link to={`/bills/${b.id}`} className="shrink-0 rounded-full bg-surface-container px-2 py-0.5 text-label-sm font-medium text-on-surface-variant hover:text-on-surface">{b.invoiceNumber}</Link>
                    </div>
                    <div className="my-space-md flex items-center justify-between rounded-lg bg-surface-container-low p-space-sm">
                      <span className="text-label-sm text-on-surface-variant">{b.paymentStatus === 'PARTIALLY_PAID' ? `Paid ${money(b.paidAmount)} · Balance:` : 'Outstanding balance:'}</span>
                      <span className="font-financial-tabular text-headline-sm font-bold text-error">{money(b.balanceAmount)}</span>
                    </div>
                    <button onClick={() => setPayBill(b)} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-space-md py-2 text-label-lg text-on-primary shadow-sm transition-all hover:bg-primary-container">
                      <Icon name="add" size={16} /><span>Collect {money(b.balanceAmount)}</span>
                    </button>
                  </div>
                );
              })}
            </div>
            {queue.length > 3 && (
              <button onClick={() => setShowAllQueue(!showAllQueue)} className="self-start text-label-lg font-medium text-secondary hover:underline">
                {showAllQueue ? 'Show fewer' : `Show all ${queue.length} outstanding bills`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Collections + payment history */}
      <div className="grid items-start gap-space-md lg:grid-cols-[320px_1fr]">
        <div className="rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
          <div className="mb-space-sm flex items-center gap-space-xs">
            <Icon name="account_balance_wallet" size={18} className="text-secondary" />
            <h2 className="font-headline text-headline-sm text-on-surface">{range.preset === 'today' ? "Today's Collections" : 'Collections'}</h2>
          </div>
          <p className="mb-space-sm text-label-sm text-on-surface-variant">{rangeLabel(range)}</p>
          {!m ? <Spinner /> : (
            <dl className="divide-y divide-surface-container-low">
              {PAYMENT_METHODS.map((k) => (
                <div key={k} className="flex items-center justify-between py-2">
                  <dt className="flex items-center gap-space-sm text-body-md text-on-surface-variant"><Icon name={methodIcon(k)} size={16} className="text-secondary" />{k}</dt>
                  <dd className="font-financial-tabular text-financial-tabular text-on-surface">{money(m.byMethod[k])}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3">
                <dt className="text-label-lg font-semibold text-on-surface">Total</dt>
                <dd className="font-headline text-headline-sm font-bold tabular-nums text-on-surface">{money(m.collected)}</dd>
              </div>
            </dl>
          )}
        </div>

        <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 px-space-md py-space-md">
            <div className="flex items-center gap-space-xs">
              <Icon name="history" size={18} className="text-secondary" />
              <h2 className="font-headline text-headline-sm text-on-surface">Payment History</h2>
              <span className="text-label-sm text-on-surface-variant">· {payments?.length ?? 0} in period</span>
            </div>
            <Button size="sm" variant="secondary" icon="file_download" onClick={exportPayments} disabled={!payments?.length}>CSV</Button>
          </div>
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="h-10 bg-surface-container-low text-label-sm uppercase tracking-wider text-on-surface-variant">
                  {['Payment ID', 'Invoice', 'Guest', 'Amount', 'Method', 'Date', 'Time', 'Recorded by'].map((h) => (
                    <th key={h} className={cx('whitespace-nowrap px-space-md py-2 font-semibold', h === 'Amount' && 'text-right')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-low">
                {!payments ? <tr><td colSpan={8} className="py-10 text-center"><Spinner /></td></tr>
                  : payments.length === 0 ? <tr><td colSpan={8} className="py-10 text-center text-body-md text-on-surface-variant">No payments recorded in this period.</td></tr>
                    : (historyAll ? payments : payments.slice(0, 8)).map((p) => (
                      <tr key={p.id} onClick={() => nav(`/bills/${p.billId}`)} className="h-12 cursor-pointer transition-colors hover:bg-surface-container-low/60">
                        <td className="whitespace-nowrap px-space-md font-mono text-label-md text-on-surface-variant">{paymentRef(p.id)}</td>
                        <td className="whitespace-nowrap px-space-md font-financial-tabular text-financial-tabular text-on-surface">{p.invoiceNumber}</td>
                        <td className="px-space-md text-label-lg text-on-surface">{p.guestName}</td>
                        <td className="whitespace-nowrap px-space-md text-right font-financial-tabular text-financial-tabular text-on-surface">{money(p.amount, { decimals: 'always' })}</td>
                        <td className="whitespace-nowrap px-space-md">
                          <span className="inline-flex items-center gap-1 rounded-full bg-surface-container px-2 py-0.5 text-label-sm text-on-surface"><Icon name={methodIcon(p.method)} size={12} className="text-secondary" />{p.method}</span>
                          {p.referenceNumber && <div className="mt-0.5 text-label-sm text-on-surface-variant">{p.referenceNumber}</div>}
                        </td>
                        <td className="whitespace-nowrap px-space-md text-body-sm text-on-surface">{fmtDay(p.date)}</td>
                        <td className="whitespace-nowrap px-space-md text-body-sm text-on-surface-variant">{fmtTime(p.createdAt)}</td>
                        <td className="whitespace-nowrap px-space-md text-body-sm text-on-surface-variant">{p.receivedBy?.name}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
          {payments && payments.length > 8 && (
            <button onClick={() => setHistoryAll(!historyAll)} className="w-full py-2.5 text-label-lg font-medium text-secondary hover:bg-surface-container-low">
              {historyAll ? 'Show fewer' : `Show all ${payments.length} payments`}
            </button>
          )}
        </div>
      </div>

      <RecordPaymentModal bill={payBill} open={!!payBill} onClose={() => setPayBill(null)} onDone={afterPayment} />
      <RecordPaymentModal choices={queue} open={directOpen} onClose={() => setDirectOpen(false)} onDone={afterPayment} />
      <Modal open={!!reasonBill} onClose={() => setReasonBill(null)} title="Cancellation Note" icon="policy"
        footer={<><Button variant="secondary" onClick={() => setReasonBill(null)}>Close</Button><Button onClick={() => nav(`/bills/${reasonBill.id}`)}>Open bill</Button></>}>
        {reasonBill && (
          <div className="space-y-2 pb-space-sm text-body-md">
            <div className="rounded-xl bg-surface-container-low p-space-md">
              <span className="text-label-sm font-bold uppercase tracking-wider text-secondary">{reasonBill.invoiceNumber}</span>
              <div className="text-label-lg font-semibold text-on-surface">{reasonBill.guestName} · Room {reasonBill.roomNumber}</div>
              <div className="text-label-sm text-on-surface-variant">Original total {money(reasonBill.grandTotal)}{reasonBill.paidAmount > 0 ? ` · ${money(reasonBill.paidAmount)} had been paid` : ''}</div>
            </div>
            <p><span className="text-on-surface-variant">Reason:</span> <b>{reasonBill.cancelReason || '—'}</b></p>
            <p className="text-on-surface-variant">Cancelled by {reasonBill.cancelledBy?.name || '—'}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
