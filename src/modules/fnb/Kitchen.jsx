// Kitchen display: today's orders as tickets moving New → Cooking → Ready →
// Served, with how long each has been waiting. Updates live.
import { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Icon } from '../../components/icons';
import { Button, cx, useToast, errMsg } from '../../components/ui';
import { ModulePage, saveRecord, today, useLive } from '../kit';

const COLS = [
  { id: 'New', label: 'New', next: 'Cooking', action: 'Start cooking', tone: 'bg-warn-container text-on-warn-container' },
  { id: 'Cooking', label: 'Cooking', next: 'Ready', action: 'Ready', tone: 'bg-secondary-container text-on-secondary-container' },
  { id: 'Ready', label: 'Ready to serve', next: 'Served', action: 'Served', tone: 'bg-ok-container text-on-ok-container' },
];
const minutesSince = (o, now) => {
  const ms = o.createdAt?.seconds ? o.createdAt.seconds * 1000 : null;
  return ms ? Math.max(0, Math.floor((now - ms) / 60000)) : 0;
};

export default function Kitchen() {
  const { user } = useAuth();
  const toast = useToast();
  const orders = useLive('orders', { where: [['date', '==', today()]] });
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const live = (orders || []).filter((o) => COLS.some((c) => c.id === o.status) || (o.status === 'Served' && false));
  async function move(o, status) {
    try { await saveRecord(user, 'orders', o.id, { status, [`${status.toLowerCase()}At`]: Date.now() }); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <ModulePage crumb={['Restaurant', 'Kitchen']} title="Kitchen display" subtitle={`${live.length} tickets in the kitchen · updates live`}>
      <div className="grid gap-space-md lg:grid-cols-3">
        {COLS.map((c) => {
          const list = live.filter((o) => o.status === c.id).sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
          return (
            <div key={c.id} className="rounded-2xl bg-surface-container-low p-space-sm">
              <div className={cx('mb-space-sm flex items-center justify-between rounded-xl px-3 py-2 font-headline text-headline-sm', c.tone)}><span>{c.label}</span><span>{list.length}</span></div>
              <div className="space-y-space-sm">
                {list.length === 0 && <p className="px-2 py-6 text-center text-body-md text-on-surface-variant">Nothing here.</p>}
                {list.map((o) => {
                  const mins = minutesSince(o, now);
                  const latest = Math.max(...o.lines.map((l) => l.kot || 1));
                  return (
                    <div key={o.id} className={cx('rounded-xl bg-surface-container-lowest p-3 shadow-sm', mins >= 20 && c.id !== 'Ready' && 'ring-2 ring-error')}>
                      <div className="flex items-center justify-between">
                        <b className="font-headline text-headline-sm">{o.type === 'Table' ? `Table ${o.table}` : o.type === 'Room' ? `Room ${o.roomNumber}` : 'Takeaway'}</b>
                        <span className={cx('flex items-center gap-1 text-label-md', mins >= 20 ? 'font-bold text-error' : 'text-on-surface-variant')}><Icon name="timer" size={14} />{mins} min</span>
                      </div>
                      <div className="text-label-sm text-on-surface-variant">{o.number}{o.kots > 1 ? ` · KOT ${latest}` : ''} · {o.time} · {o.waiter || ''}</div>
                      <ul className="mt-2 space-y-1">
                        {o.lines.map((l, i) => (
                          <li key={i} className={cx('flex gap-2 text-body-lg', l.kot === latest && o.kots > 1 && 'font-semibold text-secondary')}>
                            <span className="w-7 shrink-0 text-right font-bold tabular-nums">{l.qty}×</span><span>{l.name}{l.note ? <span className="block text-label-md text-on-surface-variant">{l.note}</span> : null}</span>
                          </li>
                        ))}
                      </ul>
                      <Button className="mt-3 w-full" size="sm" variant={c.id === 'Ready' ? 'primary' : 'secondary'} onClick={() => move(o, c.next)}>{c.action}</Button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </ModulePage>
  );
}
