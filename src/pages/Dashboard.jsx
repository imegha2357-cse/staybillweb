import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { billsInRange, recentBills, paymentsInRange, listUsers } from '../lib/db';
import { today, addDays, eachDay } from '../lib/dates';
import { money, fmtDay, fmtTime } from '../lib/format';
import { PAYMENT_STATUS } from '../lib/billing';
import { useData } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../components/icons';
import { MetricCard, Sparkline, Spinner, StatusBadge, useToast, errMsg, cx } from '../components/ui';
import { SkyHeader, Facade, CheckoutTicker, FlapText, greetingFor, useHour, celebrate, ripple } from '../motion/hotel';
import { useOccupancy } from '../lib/useOccupancy';

/** Compact metric used on guest and report pages. */
export function StatCard({ label, value, tone, icon }) {
  return <MetricCard label={label} value={value} icon={icon} tone={tone === 'amber' ? 'error' : tone === 'green' ? 'accent' : 'default'} />;
}

export default function Dashboard() {
  const { user, isEmployee, hotelId } = useAuth();
  const { can, outstanding, settings, rooms } = useData();
  const [team, setTeam] = useState([]);
  useEffect(() => { if (!isEmployee) listUsers(hotelId).then(setTeam).catch(() => {}); }, [isEmployee, hotelId]);
  const occ = useOccupancy();
  const hourNow = useHour();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    const t = today();
    const weekStart = addDays(t, -6);
    Promise.all([billsInRange(weekStart, t), paymentsInRange(t, t), recentBills(8)])
      .then(([week, pays, recent]) => setData({ week, pays, recent }))
      .catch((e) => { toast(errMsg(e), 'error'); setData({ week: [], pays: [], recent: [] }); });
  }, [toast]);

  const s = useMemo(() => {
    if (!data) return null;
    const t = today();
    const live = data.week.filter((b) => b.paymentStatus !== PAYMENT_STATUS.CANCELLED);
    const todays = live.filter((b) => b.billDate === t);
    const revenue = todays.reduce((a, b) => a + b.grandTotal, 0);
    const collected = data.pays.reduce((a, p) => a + p.amount, 0);
    const spark = eachDay(addDays(t, -6), t).map((d) => live.filter((b) => b.billDate === d).reduce((a, b) => a + b.grandTotal, 0));
    const counts = eachDay(addDays(t, -6), t).map((d) => live.filter((b) => b.billDate === d).length);
    const mine = todays.filter((b) => b.createdBy?.uid === user.uid);
    const myPays = data.pays.filter((p) => p.receivedBy?.uid === user.uid);
    const due = outstanding.filter((b) => b.checkOut <= t);
    const perStaff = {};
    todays.forEach((b) => { const k = b.createdBy?.uid; if (k) perStaff[k] = { bills: (perStaff[k]?.bills || 0) + 1, total: (perStaff[k]?.total || 0) + b.grandTotal, collected: perStaff[k]?.collected || 0 }; });
    data.pays.forEach((p) => { const k = p.receivedBy?.uid; if (k) perStaff[k] = { bills: perStaff[k]?.bills || 0, total: perStaff[k]?.total || 0, collected: (perStaff[k]?.collected || 0) + p.amount }; });
    return {
      todays, revenue, collected, pending: outstanding.reduce((a, b) => a + b.balanceAmount, 0), spark, counts,
      mine, myCollected: myPays.reduce((a, p) => a + p.amount, 0), myPays, due, dueAmount: due.reduce((a, b) => a + b.balanceAmount, 0), perStaff,
    };
  }, [data, outstanding, user.uid]);

  const actions = [
    { label: 'View Bills', icon: 'payments', to: '/bills' },
    { label: 'Add Guest', icon: 'person_add', to: '/guests?new=1' },
    can.manageRooms && { label: 'Add Room', icon: 'meeting_room', to: '/rooms?new=1' },
    { label: 'Record Payment', icon: 'add_card', to: '/bills#collect' },
  ].filter(Boolean);

  const greet = greetingFor(hourNow);

  // Monthly revenue goal → petal celebration once per month (motion pick 32).
  useEffect(() => {
    const goal = Number(settings.monthlyGoal) || 0;
    if (!goal) return;
    const t = today(); const month = t.slice(0, 7);
    let seen = '';
    try { seen = localStorage.getItem('staybill-goal-celebrated') || ''; } catch { /* ignore */ }
    if (seen === `${month}:${goal}`) return;
    billsInRange(`${month}-01`, t).then((bills) => {
      const total = bills.filter((b) => b.paymentStatus !== PAYMENT_STATUS.CANCELLED).reduce((a, b) => a + b.grandTotal, 0);
      if (total >= goal) {
        try { localStorage.setItem('staybill-goal-celebrated', `${month}:${goal}`); } catch { /* ignore */ }
        setTimeout(() => celebrate(`${money(goal)} reached this month`, 'Monthly goal'), 900);
      }
    }).catch(() => {});
  }, [settings.monthlyGoal]);

  return (
    <div className="flex w-full flex-col">
      <SkyHeader facade={<Facade rooms={rooms} occupied={occ.occupied} />}>
        <div className="hm-sky-glass">
          <div className="mb-1 text-label-sm uppercase tracking-wider text-white/75">{isEmployee ? "Front desk dashboard" : "Owner dashboard"} <span className="mx-1">/</span> <span className="font-semibold text-white">{settings.hotelName}</span></div>
          <h1 className="font-headline text-headline-lg tracking-tight text-white" style={{ background: 'none', color: '#fff', WebkitTextFillColor: '#fff' }}>{greet}, {user.name.split(' ')[0]}</h1>
          <p className="mt-0.5 text-body-md text-white/80">Billing activity for {fmtDay(today(), true)}{occ.ready && rooms.length ? ` · ${occ.occupied.size} of ${rooms.filter((r) => r.status !== 'inactive').length} rooms occupied tonight` : ''}</p>
        </div>
      </SkyHeader>
      <CheckoutTicker bills={outstanding} />

      {/* New Bill + quick actions */}
      <div className="mb-space-lg grid gap-space-md lg:grid-cols-[1.1fr_2fr]">
        <button onClick={() => nav('/bills/new')} onPointerDown={ripple}
          className="group relative isolate overflow-hidden flex items-center justify-between rounded-xl bg-primary p-space-lg text-left text-on-primary shadow-sm transition-all hover:bg-primary-container hover:shadow-md">
          <div>
            <div className="flex items-center gap-2 font-headline text-headline-md"><Icon name="add" size={22} />New Bill</div>
            <div className="mt-0.5 text-body-md text-on-primary-container">Guest → Room → Charges → Tax → Payment → Invoice</div>
          </div>
          <Icon name="arrow_forward" size={20} className="transition-transform group-hover:translate-x-1" />
        </button>
        <div className="grid grid-cols-2 gap-space-md sm:grid-cols-4">
          {actions.map((a) => (
            <Link key={a.label} to={a.to} className="flex flex-col items-start justify-center gap-2 rounded-xl bg-surface-container-lowest p-space-md text-label-lg text-on-surface shadow-sm transition-colors hover:bg-surface-container-low">
              <span className="rounded-lg bg-surface-container-low p-2 text-secondary"><Icon name={a.icon} size={18} /></span>{a.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Summary cards (PRD §10). Employees get a front-desk view of their own shift. */}
      <div className="mb-space-lg grid grid-cols-1 gap-space-md sm:grid-cols-2 xl:grid-cols-4">
        {!s ? [0, 1, 2, 3].map((i) => <div key={i} className="flex h-[140px] items-center justify-center rounded-xl bg-surface-container-lowest shadow-sm"><Spinner /></div>) : isEmployee && !can.viewReports ? (<>
          <MetricCard label="My Bills Today" value={s.mine.length} icon="receipt_long" tone="accent" sub={`${s.todays.length} at the desk today in total`} />
          <MetricCard label="I Collected Today" value={money(s.myCollected)} icon="payments" sub={`${s.myPays.length} payment${s.myPays.length === 1 ? '' : 's'} taken by me`} />
          <MetricCard label="Check-outs To Collect" value={money(s.dueAmount)} icon="logout" tone="error" sub={`${s.due.length} guest${s.due.length === 1 ? '' : 's'} checking out with money due`}>
            <Link to="/bills#collect" className="mt-3 flex items-center justify-between rounded-lg bg-surface-container-low px-2 py-1.5 text-label-sm text-on-surface-variant hover:bg-surface-container">
              <span>Open fast-collect queue</span><Icon name="chevron_right" size={14} />
            </Link>
          </MetricCard>
          <MetricCard label="Rooms Occupied Tonight" value={`${occ.occupied.size}/${rooms.filter((r) => r.status !== 'inactive').length}`} icon="hotel" sub="From bills whose stay covers tonight" />
        </>) : (<>
          <MetricCard label="Today's Bills" value={s.todays.length} icon="receipt_long" tone="accent" sub={`${s.counts.reduce((a, b) => a + b, 0)} in the last 7 days`}>
            <div className="mt-3 pt-2"><Sparkline values={s.counts} /></div>
          </MetricCard>
          <MetricCard label="Today's Revenue" value={money(s.revenue)} icon="trending_up" sub="Invoiced today (excl. cancelled)">
            <div className="mt-3 pt-2"><Sparkline values={s.spark} /></div>
          </MetricCard>
          <MetricCard label="Collected Today" value={money(s.collected)} icon="check_circle" sub={`${data.pays.length} payment${data.pays.length === 1 ? '' : 's'} received`}>
            <div className="mt-4">
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-surface-container-low">
                <div className="h-full bg-primary" style={{ width: `${s.revenue ? Math.min(100, (s.collected / s.revenue) * 100) : (s.collected ? 100 : 0)}%` }} />
              </div>
              <div className="mt-1.5 text-label-sm text-on-surface-variant">vs {money(s.revenue)} invoiced today</div>
            </div>
          </MetricCard>
          <MetricCard label="Pending Amount" value={money(s.pending)} icon="pending_actions" tone="error" sub={`${outstanding.length} bill${outstanding.length === 1 ? '' : 's'} awaiting payment`}>
            <Link to="/bills#collect" className="mt-3 flex items-center justify-between rounded-lg bg-surface-container-low px-2 py-1.5 text-label-sm text-on-surface-variant hover:bg-surface-container">
              <span>Open fast-collect queue</span><Icon name="chevron_right" size={14} />
            </Link>
          </MetricCard>
        </>)}
      </div>

      {/* Owner: who did what at the desk today */}
      {!isEmployee && s && team.length > 0 && (
        <div className="mb-space-lg rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
          <div className="mb-space-sm flex items-center justify-between">
            <div className="flex items-center gap-space-xs"><Icon name="groups" size={18} className="text-secondary" /><h2 className="font-headline text-headline-sm text-on-surface">Your team today</h2></div>
            {can.users && <Link to="/settings" className="text-label-lg font-medium text-secondary hover:underline">Manage staff logins</Link>}
          </div>
          <div className="grid gap-space-sm sm:grid-cols-2 lg:grid-cols-4">
            {team.filter((m) => m.status === 'active').map((m) => {
              const st = s.perStaff[m.id] || { bills: 0, total: 0, collected: 0 };
              return (
                <div key={m.id} className="flex items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-container text-label-md font-semibold text-on-primary">{m.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-label-lg font-semibold text-on-surface">{m.name}<span className="ml-1 text-label-sm font-normal text-on-surface-variant">{m.role === 'owner' ? 'owner' : ''}</span></div>
                    <div className="text-label-sm text-on-surface-variant">{st.bills} bill{st.bills === 1 ? '' : 's'} · {money(st.collected)} collected</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent bills (PRD §11) */}
      <div className="overflow-hidden rounded-xl bg-surface-container-lowest shadow-sm">
        <div className="flex items-center justify-between px-space-md py-space-md">
          <div className="flex items-center gap-space-xs">
            <Icon name="history" size={18} className="text-secondary" />
            <h2 className="font-headline text-headline-sm text-on-surface">Recent Bills</h2>
          </div>
          <Link to="/bills" className="text-label-lg font-medium text-secondary hover:underline">View ledger</Link>
        </div>
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="h-11 bg-surface-container-low text-label-sm uppercase tracking-wider text-on-surface-variant">
                {['Invoice #', 'Date & Time', 'Guest', 'Room', 'Amount', 'Balance', 'Status'].map((h) => (
                  <th key={h} className={cx('whitespace-nowrap px-space-md py-2 font-semibold', (h === 'Amount' || h === 'Balance') && 'text-right', h === 'Status' && 'text-center')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {!data ? <tr><td colSpan={7} className="py-12 text-center"><Spinner /></td></tr>
                : data.recent.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-12 text-center">
                    <Icon name="receipt_long" size={32} className="mb-2 text-outline-variant" />
                    <p className="text-label-lg font-semibold">No bills yet</p>
                    <p className="text-body-md text-on-surface-variant">Click <b>New Bill</b> to create your first invoice.</p>
                  </td></tr>
                ) : data.recent.map((b) => {
                  const c = b.paymentStatus === 'CANCELLED';
                  return (
                    <tr key={b.id} onClick={() => nav(`/bills/${b.id}`)} className="h-14 cursor-pointer transition-colors hover:bg-surface-container-low/60">
                      <td className={cx('whitespace-nowrap px-space-md font-financial-tabular text-financial-tabular', c ? 'text-outline line-through' : 'text-on-surface')}><FlapText text={b.invoiceNumber} /></td>
                      <td className="whitespace-nowrap px-space-md"><div className="text-body-sm text-on-surface">{fmtDay(b.billDate)}</div><div className="text-label-sm text-on-surface-variant">{fmtTime(b.createdAt)}</div></td>
                      <td className="px-space-md text-label-lg font-semibold text-on-surface">{b.guestName}</td>
                      <td className="whitespace-nowrap px-space-md"><span className="flex items-center gap-2"><span className={cx('h-2 w-2 rounded-full', c ? 'bg-outline' : 'bg-secondary')} />Room {b.roomNumber}</span></td>
                      <td className="whitespace-nowrap px-space-md text-right font-financial-tabular text-financial-tabular">{money(b.grandTotal)}</td>
                      <td className={cx('whitespace-nowrap px-space-md text-right font-financial-tabular text-financial-tabular', !c && b.balanceAmount > 0 ? 'font-bold text-error' : 'text-secondary')}>{money(c ? 0 : b.balanceAmount)}</td>
                      <td className="px-space-md text-center"><StatusBadge status={b.paymentStatus} flap /></td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
