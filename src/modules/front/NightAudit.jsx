// Night audit: review the day, deal with no-shows and unpaid check-outs, then
// close the day so its bills can no longer be changed by front-desk staff.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDocs, query, where } from '../../backend/firestore';
import { hcol } from '../../lib/scope';
import { saveSettings } from '../../lib/db';
import { PAYMENT_METHODS } from '../../lib/billing';
import { addDays } from '../../lib/dates';
import { downloadReportPdf } from '../../lib/pdf';
import { moneyPdf } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Button, Field, Input, useConfirm, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Panel, Stats, fmtDate, fmtShort, money, saveRecord, setRecord, today, useLive } from '../kit';

async function rows(name, w) {
  const s = await getDocs(query(hcol(name), ...w.map(([f, op, v]) => where(f, op, v))));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export default function NightAudit() {
  const { user, isAdmin } = useAuth();
  const { settings, rooms } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [date, setDate] = useState(today());
  const [data, setData] = useState(null);
  const audits = useLive('nightAudits');
  const closed = settings.closedThrough || '';

  useEffect(() => {
    setData(null);
    Promise.all([
      rows('bills', [['billDate', '==', date]]), rows('payments', [['date', '==', date]]),
      rows('bills', [['checkOut', '==', date]]), rows('bookings', [['checkIn', '<=', date]]),
      rows('orders', [['date', '==', date]]).catch(() => []),
      rows('bills', [['checkOut', '>', date]]),
    ]).then(([bills, pays, outs, bks, orders, staying]) => setData({ bills, pays, outs, bks, orders, staying }))
      .catch((e) => { toast(errMsg(e), 'error'); setData({ bills: [], pays: [], outs: [], bks: [], orders: [], staying: [] }); });
  }, [date, toast]);

  const s = useMemo(() => {
    if (!data) return null;
    const live = data.bills.filter((b) => b.paymentStatus !== 'CANCELLED');
    const inHouse = data.staying.filter((b) => b.paymentStatus !== 'CANCELLED' && b.checkIn <= date);
    const sellable = rooms.filter((r) => r.status !== 'inactive').length;
    return {
      live,
      cancelled: data.bills.filter((b) => b.paymentStatus === 'CANCELLED'),
      invoiced: live.reduce((a, b) => a + b.grandTotal, 0),
      tax: live.reduce((a, b) => a + b.taxAmount, 0),
      collected: data.pays.reduce((a, p) => a + p.amount, 0),
      byMethod: PAYMENT_METHODS.map((m) => [m, data.pays.filter((p) => p.method === m).reduce((a, p) => a + p.amount, 0)]),
      unpaidOut: data.outs.filter((b) => b.paymentStatus !== 'CANCELLED' && b.balanceAmount > 0),
      noShows: data.bks.filter((b) => ['Confirmed', 'Requested', 'Enquiry'].includes(b.status) && b.checkIn <= date),
      openOrders: data.orders.filter((o) => !['Settled', 'Charged to room', 'Cancelled'].includes(o.status)),
      posSales: data.orders.filter((o) => ['Settled', 'Charged to room'].includes(o.status)).reduce((a, o) => a + (o.total || 0), 0),
      inHouse: inHouse.length,
      occupancy: sellable ? Math.round((inHouse.length / sellable) * 100) : 0,
    };
  }, [data, date, rooms]);

  async function closeDay() {
    if (s.openOrders.length && !(await confirm(`${s.openOrders.length} restaurant order(s) are still open. Close the day anyway?`, { title: 'Open orders', confirmLabel: 'Close anyway', danger: false }))) return;
    if (!(await confirm(`Close ${fmtDate(date)}? Front-desk staff will no longer be able to edit or cancel bills dated on or before this day. Owners still can.`, { title: 'Close the day', confirmLabel: 'Close day', danger: false }))) return;
    try {
      const summary = {
        date, bills: s.live.length, invoiced: s.invoiced, tax: s.tax, collected: s.collected, cancelled: s.cancelled.length,
        unpaidCheckouts: s.unpaidOut.length, unpaidAmount: s.unpaidOut.reduce((a, b) => a + b.balanceAmount, 0),
        inHouse: s.inHouse, occupancy: s.occupancy, posSales: s.posSales, byMethod: Object.fromEntries(s.byMethod),
      };
      await setRecord(user, 'nightAudits', date, { ...summary, closedBy: user.name, closedByUid: user.uid }, 'NIGHT_AUDIT_CLOSED');
      if (date > closed) await saveSettings(user, { closedThrough: date }, 'DAY_CLOSED');
      toast(`${fmtDate(date)} closed`);
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function pdf() {
    await downloadReportPdf({
      title: `Night audit · ${fmtDate(date)}`, hotelName: settings.hotelName, filename: `night-audit-${date}.pdf`,
      summary: [['Bills', String(s.live.length)], ['Invoiced', moneyPdf(s.invoiced)], ['Tax', moneyPdf(s.tax)], ['Collected', moneyPdf(s.collected)], ['Occupancy', `${s.occupancy}%`], ['Restaurant', moneyPdf(s.posSales)]],
      sections: [
        { title: 'Collections by method', head: ['Method', 'Amount'], rows: s.byMethod.map(([m, a]) => [m, moneyPdf(a)]) },
        { title: 'Bills', head: ['Invoice', 'Guest', 'Room', 'Total', 'Balance'], rows: s.live.map((b) => [b.invoiceNumber, b.guestName, b.roomNumber, moneyPdf(b.grandTotal), moneyPdf(b.balanceAmount)]) },
        { title: 'Check-outs with balance due', head: ['Invoice', 'Guest', 'Room', 'Balance'], rows: s.unpaidOut.map((b) => [b.invoiceNumber, b.guestName, b.roomNumber, moneyPdf(b.balanceAmount)]) },
      ],
    });
  }
  const isClosed = closed && date <= closed;
  return (
    <ModulePage crumb={['Front desk', 'Night audit']} title="Night audit" subtitle={closed ? `Days are closed up to ${fmtDate(closed)}` : 'No day has been closed yet'}
      actions={<>
        <Field><Input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Audit date" /></Field>
        <Button variant="secondary" icon="picture_as_pdf" disabled={!s} onClick={pdf}>PDF</Button>
        {isAdmin || user.role === 'employee' ? <Button icon="lock" disabled={!s || isClosed} onClick={closeDay}>{isClosed ? 'Day closed' : 'Close this day'}</Button> : null}
      </>}>
      {!s ? <Panel><p className="text-body-md text-on-surface-variant">Loading the day…</p></Panel> : (
        <>
          <Stats items={[
            { label: 'Invoiced', value: money(s.invoiced), icon: 'receipt_long', sub: `${s.live.length} bills · tax ${money(s.tax)}` },
            { label: 'Collected', value: money(s.collected), icon: 'payments', sub: s.byMethod.filter(([, a]) => a).map(([m, a]) => `${m} ${money(a)}`).join(' · ') || 'No payments' },
            { label: 'Occupancy', value: `${s.occupancy}%`, icon: 'bed', sub: `${s.inHouse} rooms occupied` },
            { label: 'Restaurant', value: money(s.posSales), icon: 'restaurant', sub: `${s.openOrders.length} open orders` },
          ]} />
          <div className="grid gap-space-md lg:grid-cols-2">
            <Panel title="Check-outs with balance due" icon="warning">
              {s.unpaidOut.length === 0 ? <p className="text-body-md text-on-ok-container">All of today's check-outs are settled.</p> : s.unpaidOut.map((b) => (
                <button type="button" key={b.id} onClick={() => nav(`/bills/${b.id}`)} className="flex w-full justify-between border-b border-surface-container py-2 text-left last:border-0">
                  <span>Room {b.roomNumber} · {b.guestName} · {b.invoiceNumber}</span><Chip tone="error">{money(b.balanceAmount)}</Chip>
                </button>
              ))}
            </Panel>
            <Panel title="Bookings that did not arrive" icon="person_off">
              {s.noShows.length === 0 ? <p className="text-body-md text-on-ok-container">No pending arrivals.</p> : s.noShows.map((b) => (
                <div key={b.id} className="flex items-center justify-between gap-2 border-b border-surface-container py-2 last:border-0">
                  <span>{b.number} · {b.guestName} · due {fmtShort(b.checkIn)}</span>
                  <span className="flex gap-1">
                    <Button size="sm" variant="secondary" onClick={() => nav(`/bills/new?booking=${b.id}`)}>Check in</Button>
                    <Button size="sm" variant="danger-ghost" onClick={async () => { await saveRecord(user, 'bookings', b.id, { status: 'No-show', cancelledOn: date }, 'BOOKING_NO_SHOW'); toast(`${b.number} marked no-show`); setDate(date === today() ? addDays(date, 0) : date); }}>No-show</Button>
                  </span>
                </div>
              ))}
            </Panel>
          </div>
          {s.cancelled.length > 0 && <Panel title="Cancelled today" icon="block">{s.cancelled.map((b) => <div key={b.id} className="py-1 text-body-md">{b.invoiceNumber} · {b.guestName} · {money(b.grandTotal)} · {b.cancelReason}</div>)}</Panel>}
        </>
      )}
      <DataTable rows={audits ? [...audits].sort((a, b) => (a.date < b.date ? 1 : -1)) : null} dense empty="No days closed yet."
        columns={[
          { key: 'date', label: 'Closed day', render: (a) => <b>{fmtDate(a.date)}</b> },
          { key: 'inv', label: 'Invoiced', right: true, render: (a) => money(a.invoiced) },
          { key: 'col', label: 'Collected', right: true, render: (a) => money(a.collected) },
          { key: 'occ', label: 'Occupancy', right: true, render: (a) => `${a.occupancy}%` },
          { key: 'due', label: 'Unpaid check-outs', right: true, render: (a) => (a.unpaidCheckouts ? `${a.unpaidCheckouts} · ${money(a.unpaidAmount)}` : '—') },
          { key: 'by', label: 'Closed by', render: (a) => a.closedBy },
        ]} onRow={(a) => setDate(a.date)} />
    </ModulePage>
  );
}
