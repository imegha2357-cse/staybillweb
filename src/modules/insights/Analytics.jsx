// Analytics: occupancy, ADR, RevPAR, revenue trends, channel mix, room types,
// day-of-week pattern, 30-day forecast from the books, and staff performance.
import { useMemo, useState } from 'react';
import { useData } from '../../context/DataContext';
import { addDays } from '../../lib/dates';
import { downloadCsv } from '../../lib/csv';
import { Button, Input, cx } from '../../components/ui';
import { DataTable, MiniChart, ModulePage, Panel, Stats, fmtShort, money, num, round2, today, useLive } from '../kit';
import { bookingNights } from '../front/Bookings';

const PRESETS = [['Last 30 days', 30], ['Last 90 days', 90], ['Last 12 months', 365]];
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Occupancy & room revenue per day from bills (one room per bill). */
export function dailyStats(bills, dates, roomCount) {
  const live = bills.filter((b) => b.paymentStatus !== 'CANCELLED');
  return dates.map((d) => {
    const stay = live.filter((b) => b.checkIn <= d && b.checkOut > d);
    const rev = stay.reduce((a, b) => a + num(b.roomRate) * (num(b.taxableAmount) / (num(b.subtotal) || 1) || 1), 0);
    return { d, sold: stay.length, rev: round2(rev), occ: roomCount ? stay.length / roomCount : 0 };
  });
}

export default function Analytics() {
  const { rooms } = useData();
  const [span, setSpan] = useState(30);
  const [to, setTo] = useState(today());
  const from = addDays(to, -(span - 1));
  const bills = useLive('bills') || [];
  const orders = useLive('orders') || [];
  const bookings = useLive('bookings') || [];
  const hk = useLive('hkTasks') || [];
  const fb = useLive('feedback') || [];
  const roomCount = rooms.filter((r) => r.status !== 'inactive').length || rooms.length;
  const dates = useMemo(() => days(from, to), [from, to]);
  const daily = useMemo(() => dailyStats(bills, dates, roomCount), [bills, dates, roomCount]);

  const sold = daily.reduce((a, x) => a + x.sold, 0);
  const roomRev = daily.reduce((a, x) => a + x.rev, 0);
  const available = roomCount * dates.length;
  const inRange = bills.filter((b) => b.paymentStatus !== 'CANCELLED' && b.billDate >= from && b.billDate <= to);
  const fnbOrders = orders.filter((o) => ['Settled', 'Charged to room'].includes(o.status) && o.date >= from && o.date <= to);
  const fnbRev = fnbOrders.reduce((a, o) => a + num(o.sub) - num(o.disc), 0);
  const totalRev = inRange.reduce((a, b) => a + num(b.taxableAmount), 0) + fnbOrders.filter((o) => o.status === 'Settled').reduce((a, o) => a + num(o.sub) - num(o.disc), 0);
  const alos = inRange.length ? inRange.reduce((a, b) => a + num(b.nights), 0) / inRange.length : 0;
  const guestCounts = bills.filter((b) => b.paymentStatus !== 'CANCELLED').reduce((m, b) => ({ ...m, [b.guestId]: (m[b.guestId] || 0) + 1 }), {});
  const repeat = inRange.length ? inRange.filter((b) => guestCounts[b.guestId] > 1).length / inRange.length : 0;

  // Group the trend by week when the range is long.
  const bucket = span > 60 ? (span > 120 ? 30 : 7) : 1;
  const groups = [];
  for (let i = 0; i < daily.length; i += bucket) groups.push(daily.slice(i, i + bucket));
  const labels = groups.map((g) => (bucket === 30 ? new Date(`${g[0].d}T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }) : fmtShort(g[0].d)));

  const channels = Object.values(inRange.reduce((m, b) => { const k = b.source || 'Walk-in / direct'; m[k] = m[k] || { k, n: 0, nights: 0, rev: 0 }; m[k].n += 1; m[k].nights += num(b.nights); m[k].rev += num(b.taxableAmount); return m; }, {})).sort((a, b) => b.rev - a.rev);
  const types = Object.values(inRange.reduce((m, b) => { const k = b.roomType || 'Room'; m[k] = m[k] || { k, n: 0, nights: 0, rev: 0 }; m[k].n += 1; m[k].nights += num(b.nights); m[k].rev += num(b.roomAmount); return m; }, {})).sort((a, b) => b.rev - a.rev);
  const dow = DOW.map((name, i) => { const xs = daily.filter((x) => new Date(`${x.d}T00:00:00`).getDay() === i); return { name, occ: xs.length ? xs.reduce((a, x) => a + x.occ, 0) / xs.length : 0 }; });

  // Forecast: rooms already on the books for the next 30 days.
  const ahead = days(today(), addDays(today(), 29));
  const fc = ahead.map((d) => {
    const inHouse = bills.filter((b) => b.paymentStatus !== 'CANCELLED' && b.checkIn <= d && b.checkOut > d).length;
    const booked = bookings.filter((b) => ['Confirmed', 'Requested'].includes(b.status) && b.checkIn <= d && b.checkOut > d).reduce((a, b) => a + Math.max(1, num(b.rooms) || 1), 0);
    return { d, inHouse, booked, occ: roomCount ? Math.min(1, (inHouse + booked) / roomCount) : 0 };
  });
  const pickup = bookings.filter((b) => ['Confirmed', 'Requested'].includes(b.status) && b.checkIn >= today()).reduce((a, b) => a + bookingNights(b) * Math.max(1, num(b.rooms) || 1) * num(b.rate), 0);

  // Staff performance.
  const staff = {};
  const S = (name) => { const k = name || 'Unknown'; staff[k] = staff[k] || { name: k, bills: 0, billed: 0, orders: 0, sales: 0, hk: 0 }; return staff[k]; };
  inRange.forEach((b) => { const s = S(b.createdBy?.name); s.bills += 1; s.billed += num(b.grandTotal); });
  fnbOrders.forEach((o) => { const s = S(o.waiter); s.orders += 1; s.sales += num(o.total); });
  hk.filter((t) => t.doneBy && (t.doneAt || t.date || '') >= from).forEach((t) => { S(t.doneBy).hk += 1; });
  const staffRows = Object.values(staff).sort((a, b) => b.billed + b.sales - (a.billed + a.sales));
  const rating = fb.filter((f) => f.date >= from && f.date <= to);

  return (
    <ModulePage crumb={['Finance', 'Analytics']} title="Analytics" subtitle={`${fmtShort(from)} – ${fmtShort(to)} · ${roomCount} rooms`}
      actions={<>{PRESETS.map(([l, n]) => <Button key={n} size="sm" variant={span === n ? 'primary' : 'ghost'} onClick={() => setSpan(n)}>{l}</Button>)}<div className="w-40"><Input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value || today())} aria-label="Up to" /></div>
        <Button variant="secondary" icon="file_download" onClick={() => downloadCsv(`daily-${from}-${to}.csv`, ['Date', 'Rooms sold', 'Occupancy %', 'Room revenue', 'ADR', 'RevPAR'], daily.map((x) => [x.d, x.sold, Math.round(x.occ * 1000) / 10, x.rev, x.sold ? round2(x.rev / x.sold) : 0, roomCount ? round2(x.rev / roomCount) : 0]))}>CSV</Button></>}>
      <Stats items={[
        { label: 'Occupancy', value: pct(available ? sold / available : 0), icon: 'hotel', sub: `${sold} of ${available} room-nights` },
        { label: 'ADR', value: money(sold ? roomRev / sold : 0), icon: 'sell', sub: 'average daily rate' },
        { label: 'RevPAR', value: money(available ? roomRev / available : 0), icon: 'insights', sub: 'revenue per available room' },
        { label: 'Revenue', value: money(totalRev), icon: 'payments', sub: `F&B ${money(fnbRev)}` },
      ]} />
      <div className="grid gap-space-md lg:grid-cols-[2fr_1fr]">
        <Panel title="Occupancy" icon="show_chart">
          <MiniChart type="line" height={190} labels={labels} format={pct} series={[{ label: 'Occupancy', values: groups.map((g) => g.reduce((a, x) => a + x.occ, 0) / g.length) }]} />
        </Panel>
        <Panel title="At a glance" icon="info">
          <div className="space-y-2 text-body-md">
            {[['Bills', inRange.length], ['Average stay', `${alos.toFixed(1)} nights`], ['Repeat guests', pct(repeat)], ['Restaurant orders', fnbOrders.length], ['Average rating', rating.length ? `${(rating.reduce((a, f) => a + num(f.rating), 0) / rating.length).toFixed(1)} ★ (${rating.length})` : '—'], ['Future bookings value', money(pickup)]].map(([k, v]) => <div key={k} className="flex justify-between border-b border-surface-container py-1 last:border-0"><span className="text-on-surface-variant">{k}</span><b>{v}</b></div>)}
          </div>
        </Panel>
      </div>
      <Panel title="Revenue" icon="bar_chart">
        <MiniChart height={190} labels={labels} format={money} series={[
          { label: 'Rooms', values: groups.map((g) => g.reduce((a, x) => a + x.rev, 0)) },
          { label: 'Restaurant', color: 'rgb(var(--c-accent))', values: groups.map((g) => fnbOrders.filter((o) => o.date >= g[0].d && o.date <= g[g.length - 1].d).reduce((a, o) => a + num(o.sub) - num(o.disc), 0)) },
        ]} />
      </Panel>
      <div className="grid gap-space-md lg:grid-cols-2">
        <Panel title="Channel mix" icon="travel_explore">
          <BarList rows={channels.map((c) => [c.k, c.rev, `${c.n} stays · ${c.nights} nights`])} />
        </Panel>
        <Panel title="Room types" icon="meeting_room">
          <BarList rows={types.map((t) => [t.k, t.rev, `${t.nights} nights · ADR ${money(t.nights ? t.rev / t.nights : 0)}`])} />
        </Panel>
        <Panel title="Busiest days of the week" icon="calendar_view_week">
          <div className="flex h-36 items-end gap-2">
            {dow.map((x) => <div key={x.name} className="flex flex-1 flex-col items-center gap-1"><span className="text-label-sm tabular-nums text-on-surface-variant">{Math.round(x.occ * 100)}%</span><div className="w-full rounded-t-md bg-primary" style={{ height: `${Math.max(4, x.occ * 100)}%` }} /><span className="text-label-sm">{x.name}</span></div>)}
          </div>
        </Panel>
        <Panel title="Next 30 days on the books" icon="event_upcoming">
          <MiniChart height={150} labels={fc.map((x) => fmtShort(x.d))} format={pct} series={[{ label: 'Forecast occupancy', color: 'rgb(var(--c-secondary))', values: fc.map((x) => x.occ) }]} />
          <p className="mt-1 text-label-md text-on-surface-variant">In-house guests plus confirmed and requested bookings. Average {pct(fc.reduce((a, x) => a + x.occ, 0) / fc.length)}.</p>
        </Panel>
      </div>
      <DataTable rows={staffRows} rowKey="name" dense empty="No activity in this period."
        toolbar={<span className="font-headline text-headline-sm">Staff performance</span>}
        columns={[
          { key: 'n', label: 'Staff', render: (s) => <b>{s.name}</b> },
          { key: 'b', label: 'Bills', right: true, render: (s) => s.bills || '—' },
          { key: 'bv', label: 'Billed', right: true, render: (s) => (s.billed ? money(s.billed) : '—') },
          { key: 'o', label: 'Orders', right: true, render: (s) => s.orders || '—' },
          { key: 'ov', label: 'F&B sales', right: true, render: (s) => (s.sales ? money(s.sales) : '—') },
          { key: 'h', label: 'Rooms cleaned', right: true, render: (s) => s.hk || '—' },
        ]} />
    </ModulePage>
  );
}

function BarList({ rows }) {
  if (!rows.length) return <p className="text-body-md text-on-surface-variant">No stays in this period.</p>;
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return (
    <div className="space-y-2">
      {rows.map(([k, v, sub]) => (
        <div key={k} className="text-body-md">
          <div className="flex justify-between"><span>{k}</span><b className="tabular-nums">{money(v)}</b></div>
          <div className="mt-0.5 h-2 rounded-full bg-surface-container"><div className={cx('h-2 rounded-full bg-secondary')} style={{ width: `${(v / max) * 100}%` }} /></div>
          <div className="text-label-sm text-on-surface-variant">{sub}</div>
        </div>
      ))}
    </div>
  );
}
