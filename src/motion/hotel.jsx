// Hotel-themed animations chosen from the StayBill motion shortlist (01–34).
// Each one reads the Animations setting: Off shows a still, finished state.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppearance } from '../context/AppearanceContext';
import { Icon } from '../components/icons';
import { money, fmtDay } from '../lib/format';
import { addDays, today } from '../lib/dates';
import { cssTriplet } from '../lib/palettes';
import './hotel.css';

const useLevel = () => useAppearance().motion;
const cls = (...c) => c.filter(Boolean).join(' ');

// ---------- 01 Key-card tap ----------
export function KeyCardTap({ once = false, room = 'ROOM 204', title = 'Welcome back', note = 'ACCESS GRANTED', className = '' }) {
  return (
    <div className={cls('hm hm-kc', once && 'once', className)} aria-hidden="true">
      <div className="hm-kc-lock"><div className="hm-kc-reader" /><div className="hm-kc-led" /><div className="hm-kc-handle" /></div>
      <div className="hm-kc-ring" />
      <div className="hm-kc-card" data-room={room} />
      <div className="hm-kc-text">{title}<small>{note}</small></div>
    </div>
  );
}

// ---------- 02 Concierge bell (toast icon + optional ding) ----------
export function BellIcon() {
  return <span className="hm hm-bell" aria-hidden="true"><u /><s /><i /><b /></span>;
}
let audioCtx;
export function playDing() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    [[1568, 0.16], [2093, 0.08], [3136, 0.03]].forEach(([f, v]) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 1.4);
    });
  } catch { /* sound not available */ }
}

// ---------- 03 Receipt printer ----------
export function PrinterFeed({ play, children }) {
  const level = useLevel();
  const [done, setDone] = useState(!play || level === 'off');
  useEffect(() => {
    if (done) return undefined;
    const t = setTimeout(() => setDone(true), 2600);
    return () => clearTimeout(t);
  }, [done]);
  if (!play || level === 'off') return children;
  return (
    <div className={cls('hm hm-printer', done && 'done')}>
      <div className="hm-printer-slot no-print" aria-hidden="true"><i /></div>
      <div className={done ? '' : 'hm-printer-clip'}>
        <div className={done ? '' : 'hm-printer-paper'}>{children}</div>
      </div>
    </div>
  );
}

// ---------- 04 Split-flap text ----------
const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function FlapText({ text, className }) {
  const level = useLevel();
  const target = String(text ?? '');
  const [chars, setChars] = useState(() => (level === 'off' ? [...target] : [...target].map(() => ' ')));
  const [spin, setSpin] = useState({});
  useEffect(() => {
    if (level === 'off') { setChars([...target]); return undefined; }
    const timers = [];
    [...target].forEach((ch, i) => {
      let n = 3 + (i % 4) + Math.floor(i / 3);
      const tick = () => {
        if (n-- > 0 && ch !== ' ') {
          setChars((c) => { const x = [...c]; x[i] = FLAP_CHARS[(Math.random() * FLAP_CHARS.length) | 0]; return x; });
          setSpin((s) => ({ ...s, [i]: (s[i] || 0) + 1 }));
          timers.push(setTimeout(tick, 55));
        } else {
          setChars((c) => { const x = [...c]; x[i] = ch; x.length = target.length; return x; });
        }
      };
      timers.push(setTimeout(tick, i * 35));
    });
    return () => timers.forEach(clearTimeout);
  }, [target, level]);
  return (
    <span className={cls('hm hm-flap', className)} aria-label={target}>
      {chars.slice(0, target.length).map((c, i) => <span key={`${i}-${spin[i] || 0}`} aria-hidden="true" className={spin[i] ? 'spin' : ''}>{c}</span>)}
    </span>
  );
}

// ---------- 05 + 06 Sky header with lit facade ----------
const SKY = [ // hour, top, bottom
  [0, '#061b2a', '#0b2f3a'], [5, '#0c2740', '#2a3f62'], [6.5, '#2a4f72', '#f5a27a'], [8.5, '#5fb0c9', '#c8ecec'],
  [13, '#3f9fb8', '#bfe6e4'], [16.5, '#4b86a8', '#f3c99a'], [18.2, '#33416b', '#f2785c'], [19.6, '#0f2b45', '#2a3f62'], [24, '#061b2a', '#0b2f3a'],
];
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mixC = (a, b, t) => hex(a).map((v, i) => Math.round(v + (hex(b)[i] - v) * t));
function skyAt(h) {
  for (let i = 0; i < SKY.length - 1; i += 1) {
    const A = SKY[i]; const B = SKY[i + 1];
    if (h >= A[0] && h <= B[0]) { const t = (h - A[0]) / (B[0] - A[0]); return [mixC(A[1], B[1], t), mixC(A[2], B[2], t)]; }
  }
  return [hex(SKY[0][1]), hex(SKY[0][2])];
}
export function useHour() {
  const [h, setH] = useState(() => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; });
  useEffect(() => {
    const t = setInterval(() => { const d = new Date(); setH(d.getHours() + d.getMinutes() / 60); }, 60000);
    return () => clearInterval(t);
  }, []);
  return h;
}
export function greetingFor(h) {
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
}
const STARS = Array.from({ length: 34 }, (_, i) => ({ x: (i * 37) % 100, y: (i * 53) % 70, d: (i % 7) * 0.4 }));
export function SkyHeader({ children, facade }) {
  const level = useLevel();
  const h = useHour();
  const [top, bot] = skyAt(h);
  const day = h >= 6 && h < 18.5;
  const u = day ? (h - 6) / 12.5 : ((h < 6 ? h + 24 : h) - 18.5) / 11.5;
  const night = h >= 19.6 || h < 5.5;
  return (
    <div className="hm hm-sky mb-space-lg" style={{ background: `linear-gradient(180deg, rgb(${top}), rgb(${bot}))` }}>
      {night && STARS.map((s, i) => <span key={i} className="hm-sky-star" style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }} />)}
      {!night && level !== 'off' && <>
        <span className="hm-sky-cloud" style={{ top: '22%', width: 90, animationDuration: '70s' }} />
        <span className="hm-sky-cloud" style={{ top: '40%', width: 60, animationDuration: '95s', animationDelay: '-40s' }} />
      </>}
      <span className={cls('hm-sky-sun', day ? 'sun' : 'moon')} style={{ left: `${8 + u * 62}%`, top: `${82 - Math.sin(Math.max(0, Math.min(1, u)) * Math.PI) * 62}%` }} />
      <span className="hm-sky-hill" />
      {facade}
      <div className="hm-sky-content">{children}</div>
    </div>
  );
}

export function Facade({ rooms = [], occupied = new Set() }) {
  const level = useLevel();
  const list = rooms.slice(0, 40);
  const cols = Math.min(8, Math.max(3, Math.ceil(Math.sqrt(list.length * 1.6))));
  const lit = list.filter((r) => occupied.has(r.roomNumber)).length;
  if (!list.length) return null;
  return (
    <div className="hm-fac hidden sm:flex" aria-label={`${lit} of ${list.length} rooms occupied tonight`}>
      <span className="hm-fac-sign">HOTEL</span>
      <div className="hm-fac-bld" style={{ gridTemplateColumns: `repeat(${cols}, 12px)` }}>
        <div className="hm-fac-count"><b>{lit}/{list.length}</b>ROOMS LIT</div>
        {list.map((r, i) => (
          <span key={r.id} title={`Room ${r.roomNumber}: ${r.status === 'inactive' ? 'inactive' : occupied.has(r.roomNumber) ? 'occupied' : 'ready'}`}
            className={cls('hm-win', r.status === 'inactive' ? 'inactive' : occupied.has(r.roomNumber) && 'on')}
            style={level === 'off' ? undefined : { animationDelay: `${0.25 + i * 0.12}s` }} />
        ))}
        <span className="hm-fac-door" />
      </div>
    </div>
  );
}

// ---------- 08 Luggage trolley loader ----------
export function TrolleyLoader({ label = 'Loading…' }) {
  return (
    <div className="hm hm-trol-wrap" role="status">
      <div className="hm-trol-track" />
      <div className="hm-trol" aria-hidden="true">
        <div className="hm-trol-bar" /><div className="hm-trol-post l" /><div className="hm-trol-post r" />
        <div className="hm-bag b3" /><div className="hm-bag b1" /><div className="hm-bag b2" />
        <div className="hm-trol-base" /><div className="hm-wheel l" /><div className="hm-wheel r" />
      </div>
      <div className="hm-trol-label">{label}</div>
    </div>
  );
}

// ---------- 09 Payment meter with coins ----------
export function PaymentMeter({ total, paid, className }) {
  const level = useLevel();
  const prev = useRef(paid);
  const [drop, setDrop] = useState(0);
  const [w, setW] = useState(level === 'off' ? paid : 0);
  useEffect(() => {
    if (paid > prev.current + 0.001 && level !== 'off') setDrop((d) => d + 1);
    prev.current = paid;
    const t = setTimeout(() => setW(paid), 60);
    return () => clearTimeout(t);
  }, [paid, level]);
  const pct = total > 0 ? Math.min(100, (w / total) * 100) : 100;
  return (
    <div className={cls('hm hm-pay', className)}>
      {drop > 0 && [0, 1, 2, 3].map((i) => (
        <span key={`${drop}-${i}`} className="hm-coin" style={{ left: `calc(${Math.max(4, Math.min(92, pct))}% - ${18 + i * 12}px)`, animationDelay: `${i * 0.12}s` }}>₹</span>
      ))}
      <div className="hm-pay-bar"><div className="hm-pay-fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

// ---------- 10 Elevator page transition ----------
const FLOORS = [
  [/^\/$/, 'L', 'Lobby'], [/^\/bills\/new/, '1', 'New Bill'], [/^\/bills/, '2', 'Bills'], [/^\/guests/, '3', 'Guests'],
  [/^\/rooms/, '4', 'Rooms'], [/^\/reports/, '5', 'Reports'], [/^\/settings/, '6', 'Settings'], [/^\/print/, '2', 'Print'],
];
const floorOf = (p) => FLOORS.find(([re]) => re.test(p)) || ['/', '·', 'StayBill'];
const floorNum = (f) => (f === 'L' ? 0 : Number(f) || 0);
export function ElevatorDoors({ path }) {
  const level = useLevel();
  const first = useRef(true);
  const last = useRef(path);
  const [run, setRun] = useState(null);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    if (level === 'off' || last.current === path) { last.current = path; return undefined; }
    const from = floorOf(last.current); const to = floorOf(path);
    last.current = path;
    if (from[1] === to[1] && from[2] === to[2]) return undefined;
    setRun({ key: Date.now(), from, to, open: false });
    const t1 = setTimeout(() => setRun((r) => r && { ...r, open: true }), 380);
    const t2 = setTimeout(() => setRun(null), 1150);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [path, level]);
  if (!run) return null;
  const up = floorNum(run.to[1]) >= floorNum(run.from[1]);
  return (
    <div key={run.key} className={cls('hm hm-lift no-print', run.open && 'open')} aria-hidden="true">
      <div className="hm-lift-door l" /><div className="hm-lift-door r" />
      <div className="hm-lift-panel">
        <span className={cls('hm-lift-arrow', !up && 'down')} />
        <FloorCount from={run.from[1]} to={run.to[1]} />
        <small>{run.to[2]}</small>
      </div>
    </div>
  );
}
function FloorCount({ from, to }) {
  const a = floorNum(from); const b = floorNum(to);
  const [n, setN] = useState(a);
  useEffect(() => {
    if (a === b) return undefined;
    const step = a < b ? 1 : -1; let cur = a;
    const t = setInterval(() => { cur += step; setN(cur); if (cur === b) clearInterval(t); }, Math.max(40, 300 / Math.abs(b - a)));
    return () => clearInterval(t);
  }, [a, b]);
  return <span className="hm-lift-num">{n === 0 ? 'L' : n}</span>;
}

// ---------- 12 Key rack ----------
const KEY_COLORS = ['rgb(var(--c-accent))', 'rgb(var(--c-w-vivid))', '#e9d29f'];
export function KeyRack({ rooms = [], occupied = new Set() }) {
  const shown = rooms.filter((r) => r.status !== 'inactive');
  if (!shown.length) return null;
  return (
    <div className="hm hm-rack" role="img" aria-label={`Key rack: ${shown.filter((r) => occupied.has(r.roomNumber)).length} of ${shown.length} keys out`}>
      {shown.map((r, i) => {
        const occ = occupied.has(r.roomNumber);
        return (
          <div key={r.id} className={cls('hm-hook', occ && 'occ leaving')} title={`Room ${r.roomNumber}: ${occ ? 'guest checked in' : 'key on hook'}`}>
            {occ ? (
              <>
                <div className="hm-key" style={{ '--k': KEY_COLORS[i % 3], position: 'absolute', top: 7 }}><i /><b>{r.roomNumber}</b></div>
                <div className="hm-hook-empty">IN USE</div>
              </>
            ) : (
              <div className="hm-key" style={{ '--k': KEY_COLORS[i % 3], animationDelay: `${-i * 0.37}s` }}><i /><b>{r.roomNumber}</b></div>
            )}
            <span className="hm-hook-tag">{r.roomNumber}</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------- 13 Door hanger ----------
const HANGER = {
  PENDING: ['Please settle bill', 'PAYMENT DUE'], PARTIALLY_PAID: ['Part paid', 'BALANCE DUE'],
  PAID: ['Paid, thank you', 'SETTLED'], CANCELLED: ['Cancelled', 'KEPT FOR AUDIT'],
};
export function DoorHanger({ status }) {
  const prev = useRef(status);
  const [flip, setFlip] = useState(0);
  useEffect(() => { if (prev.current !== status) setFlip((f) => f + 1); prev.current = status; }, [status]);
  const [a, b] = HANGER[status] || HANGER.PENDING;
  return (
    <div className="hm hm-hang" role="img" aria-label={`Status: ${a}`}>
      <span className="hm-hang-knob" />
      <div key={flip} className={cls('hm-hang-face', status, flip && 'flip')}><span>{a}<small>{b}</small></span></div>
    </div>
  );
}

// ---------- 14 Cloche reveal ----------
export function Cloche({ children, play = true }) {
  const level = useLevel();
  const [on, setOn] = useState(play && level !== 'off');
  useEffect(() => { if (!on) return undefined; const t = setTimeout(() => setOn(false), 2600); return () => clearTimeout(t); }, [on]);
  return (
    <span className="hm hm-cloche">
      {children}
      {on && <><span className="hm-cloche-dome" aria-hidden="true" />
        {[0, 1, 2].map((i) => <span key={i} className="hm-cloche-steam" style={{ left: `${35 + i * 14}%`, animationDelay: `${0.9 + i * 0.15}s` }} />)}</>}
    </span>
  );
}

// ---------- 15 Rubber stamp ----------
export function PaidStamp({ press, label = 'PAID', date, delay = 0 }) {
  const level = useLevel();
  return (
    <div className={cls('hm hm-stamp no-print', press && level !== 'off' && 'press')} style={{ '--d': `${delay}s` }} aria-hidden="true">
      <span className="hm-stamp-tool" />
      <span className="hm-stamp-ink">{label}{date && <small>{date}</small>}</span>
    </div>
  );
}

// ---------- 16 Nights strip ----------
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export function NightsStrip({ checkIn, checkOut }) {
  const days = useMemo(() => {
    if (!checkIn || !checkOut || checkOut < checkIn) return [];
    const out = []; let d = checkIn;
    for (let i = 0; i < 15 && d <= checkOut; i += 1) { out.push(d); d = addDays(d, 1); }
    return out;
  }, [checkIn, checkOut]);
  if (!days.length) return null;
  const more = days[days.length - 1] !== checkOut;
  return (
    <div className="hm hm-nights" aria-hidden="true">
      {days.map((d, i) => {
        const dt = new Date(`${d}T00:00:00`);
        const night = d < checkOut;
        return (
          <div key={`${checkIn}-${checkOut}-${d}`} className={cls('hm-nd', night && 'n', i === 0 && 'in', d === checkOut && 'out')} style={{ animationDelay: `${i * 0.12}s` }}>
            {WD[dt.getDay()]}<b>{dt.getDate()}</b>
          </div>
        );
      })}
      {more && <div className="hm-nd">…<b>{new Date(`${checkOut}T00:00:00`).getDate()}</b></div>}
    </div>
  );
}

// ---------- 19 Checklist ----------
export function Checklist({ items }) {
  const done = items.filter((i) => i.done).length;
  return (
    <div className="hm space-y-2">
      {items.map((it) => (
        <div key={it.label} className={cls('hm-chk-row text-body-md', it.done ? 'done text-on-surface' : 'text-on-surface-variant')}>
          <span className="hm-chk-box" />
          <span className="flex-1">{it.label}</span>
          {it.optional && !it.done && <span className="text-label-sm text-on-surface-variant">optional</span>}
        </div>
      ))}
      <div className="hm-chk-bar" aria-label={`${done} of ${items.length} done`}><i style={{ width: `${(done / items.length) * 100}%` }} /></div>
    </div>
  );
}

// ---------- 23 Check-out ticker ----------
export function CheckoutTicker({ bills }) {
  const t = today();
  const due = bills.filter((b) => b.balanceAmount > 0 && b.checkOut <= t).sort((a, b) => (a.checkOut < b.checkOut ? -1 : 1));
  if (!due.length) return null;
  const item = (b) => (
    <Link key={b.id} to={`/bills/${b.id}`}>
      Room {b.roomNumber} · {b.guestName} · {b.checkOut === t ? 'checks out today' : `checked out ${fmtDay(b.checkOut)}`} · <b>{money(b.balanceAmount)} due</b>
    </Link>
  );
  return (
    <div className="hm hm-ticker no-print mb-space-md" role="region" aria-label="Check-outs with money due">
      <span className="hm-ticker-live">DUE</span>
      <div className="hm-ticker-view">
        <div className="hm-ticker-track" style={{ '--dur': `${Math.max(18, due.length * 9)}s` }}>
          {due.map(item)}
          <span aria-hidden="true" style={{ display: 'contents' }}>{due.map((b) => <span key={`d-${b.id}`}>Room {b.roomNumber} · {b.guestName} · <b>{money(b.balanceAmount)} due</b></span>)}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- 24 Rolling odometer ----------
export function Odometer({ value }) {
  const level = useLevel();
  const text = String(value ?? '');
  const zero = text.replace(/\d/g, '0');
  const [shown, setShown] = useState(level === 'off' ? text : zero);
  const ref = useRef(null);
  const started = useRef(false);
  useEffect(() => {
    if (level === 'off') { setShown(text); return undefined; }
    if (started.current) { setShown(text); return undefined; }
    const el = ref.current;
    const go = () => { started.current = true; requestAnimationFrame(() => setShown(text)); };
    if (!el || typeof IntersectionObserver === 'undefined') { go(); return undefined; }
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io.disconnect(); go(); } }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [text, level]);
  const chars = [...(shown.length === text.length ? shown : text)];
  return (
    <span ref={ref} className="hm hm-odo tabular-nums" aria-label={text}>
      {chars.map((c, i) => (/\d/.test(c)
        ? <span key={i} className="hm-odo-d" aria-hidden="true"><span style={{ transform: `translateY(${-Number(c) * 1.25}em)`, transitionDelay: `${(chars.length - i) * 0.04}s` }}>{'0123456789'.split('').map((d) => <span key={d}>{d}</span>)}</span></span>
        : <span key={i} className="hm-odo-s" aria-hidden="true">{c}</span>))}
    </span>
  );
}

// ---------- 25 Ringing alert bell ----------
export function AlertBell({ bills }) {
  const t = today();
  const due = bills.filter((b) => b.balanceAmount > 0 && b.checkOut <= t);
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(0);
  const prev = useRef(null);
  const ref = useRef();
  useEffect(() => {
    if (prev.current === null ? due.length > 0 : due.length > prev.current) setRing((r) => r + 1);
    prev.current = due.length;
  }, [due.length]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const total = due.reduce((s, b) => s + b.balanceAmount, 0);
  return (
    <div className="relative" ref={ref}>
      <button type="button" key={ring} onClick={() => setOpen(!open)} aria-expanded={open}
        aria-label={due.length ? `${due.length} check-out${due.length === 1 ? '' : 's'} with money due` : 'No check-outs with money due'}
        className={cls('hm hm-abell relative rounded-lg p-space-sm text-on-surface-variant transition-colors hover:bg-surface-container-low hover:text-on-surface', ring && 'ring')}>
        <Icon name="notifications" size={20} className="hm-abell-icon" />
        {due.length > 0 && <span className="hm-abell-count">{due.length}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-24px)] rounded-xl bg-surface-container-lowest p-space-sm shadow-xl ring-1 ring-outline-variant/30">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="font-headline text-headline-sm text-on-surface">Check-outs to collect</span>
            {due.length > 0 && <span className="text-label-md font-semibold text-error">{money(total)}</span>}
          </div>
          {due.length === 0 ? <p className="px-2 pb-2 text-body-md text-on-surface-variant">All checked-out guests are settled.</p> : (
            <ul className="max-h-72 overflow-y-auto">
              {due.slice(0, 8).map((b) => (
                <li key={b.id}>
                  <Link to={`/bills/${b.id}`} onClick={() => setOpen(false)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-surface-container-low">
                    <span className="min-w-0">
                      <span className="block truncate text-label-lg font-semibold text-on-surface">Room {b.roomNumber} · {b.guestName}</span>
                      <span className="block text-label-sm text-on-surface-variant">{b.checkOut === t ? 'Checks out today' : `Checked out ${fmtDay(b.checkOut)}`} · {b.invoiceNumber}</span>
                    </span>
                    <span className="shrink-0 font-financial-tabular text-label-lg text-error">{money(b.balanceAmount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/bills#collect" onClick={() => setOpen(false)} className="mt-1 flex items-center justify-center gap-1 rounded-lg bg-surface-container-low px-2 py-2 text-label-md text-on-surface hover:bg-surface-container">
            Open fast-collect queue<Icon name="chevron_right" size={14} />
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------- 26 Search spotlight ----------
export function Hi({ text, term }) {
  const s = String(text ?? '');
  const q = String(term || '').trim();
  if (!q) return s;
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return s;
  return <>{s.slice(0, i)}<mark className="hm-hit">{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>;
}

// ---------- 27 Ripple ----------
export function ripple(e) {
  const el = e.currentTarget;
  if (!el || document.documentElement.dataset.motion === 'off') return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 2.2;
  const s = document.createElement('span');
  s.className = 'hm-ripple';
  s.style.width = s.style.height = `${size}px`;
  s.style.left = `${(e.clientX ?? r.left + r.width / 2) - r.left - size / 2}px`;
  s.style.top = `${(e.clientY ?? r.top + r.height / 2) - r.top - size / 2}px`;
  el.appendChild(s);
  setTimeout(() => s.remove(), 650);
}

// ---------- 30 Door ajar ----------
export function DoorScene({ locked = false, label }) {
  return (
    <div className={cls('hm hm-ajar', locked && 'locked')} aria-hidden="true">
      <div className="hm-ajar-beam" />
      <div className="hm-ajar-frame"><div className="hm-ajar-door">{label}</div></div>
      <div className="hm-ajar-floor" />
    </div>
  );
}

// ---------- 32 Petal celebration ----------
export function celebrate(title, note) {
  try { window.dispatchEvent(new CustomEvent('staybill:celebrate', { detail: { title, note } })); } catch { /* ignore */ }
}
export function CelebrationLayer() {
  const level = useLevel();
  const [msg, setMsg] = useState(null);
  const canvas = useRef(null);
  useEffect(() => {
    const on = (e) => setMsg({ ...e.detail, key: Date.now() });
    window.addEventListener('staybill:celebrate', on);
    return () => window.removeEventListener('staybill:celebrate', on);
  }, []);
  useEffect(() => {
    if (!msg) return undefined;
    const done = setTimeout(() => setMsg(null), 3700);
    const c = canvas.current;
    if (!c || level === 'off') return () => clearTimeout(done);
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth; const h = window.innerHeight;
    c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = [`rgb(${cssTriplet('accent', '242 120 92')})`, `rgb(${cssTriplet('w-warm', '248 179 161')})`, '#ffd79a', `rgb(${cssTriplet('w-vivid', '43 183 179')})`];
    const n = level === 'full' ? 110 : 60;
    const ps = Array.from({ length: n }, () => ({ x: Math.random() * w, y: -Math.random() * h * 0.6, s: 5 + Math.random() * 6, vy: 1.2 + Math.random() * 1.8, vx: -0.5 + Math.random(), a: Math.random() * 6, va: 0.02 + Math.random() * 0.05, c: cols[(Math.random() * cols.length) | 0] }));
    let raf; const t0 = performance.now();
    const frame = (t) => {
      const age = (t - t0) / 3600;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, Math.min(1, (1 - age) * 3));
      for (const p of ps) {
        p.y += p.vy; p.x += p.vx + Math.sin(p.a) * 0.6; p.a += p.va;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1, Math.abs(Math.cos(p.a)) * 0.8 + 0.2);
        ctx.fillStyle = p.c; ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, 7); ctx.fill(); ctx.restore();
      }
      if (age < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [msg, level]);
  if (!msg) return null;
  return (
    <div className="hm-celebrate no-print" key={msg.key} role="status">
      {level !== 'off' && <canvas ref={canvas} aria-hidden="true" />}
      <div className="hm-celebrate-card"><small>{msg.note || 'Celebration'}</small><b>{msg.title}</b></div>
    </div>
  );
}

// ---------- 33 Pool light ----------
export function PoolLight({ className = '', still }) {
  const level = useLevel();
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let w = 0; let h = 0; let raf;
    const size = () => { w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    const deep = `rgb(${cssTriplet('w-deep', '15 94 102')})`; const bg = `rgb(${cssTriplet('w-bg2', '6 35 42')})`;
    const draw = (t) => {
      const T = t / 1000;
      const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, deep); g.addColorStop(1, bg);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.lineWidth = 2; ctx.lineCap = 'round';
      const rows = Math.max(8, Math.round(h / 22));
      for (let k = 0; k < rows; k += 1) {
        ctx.strokeStyle = `rgba(214,255,250,${0.1 + 0.08 * Math.sin(T + k)})`;
        ctx.beginPath();
        for (let x = -10; x <= w + 10; x += 12) {
          const y = (k / (rows - 1)) * h + Math.sin(x / 38 + T * 1.3 + k) * 9 + Math.sin(x / 17 - T * 1.7 + k * 2) * 4;
          if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      const cols2 = Math.max(6, Math.round(w / 60));
      ctx.strokeStyle = 'rgba(214,255,250,0.08)';
      for (let k = 0; k < cols2; k += 1) {
        ctx.beginPath();
        for (let y = -10; y <= h + 10; y += 12) {
          const x = (k / (cols2 - 1)) * w + Math.sin(y / 30 + T * 1.1 + k) * 12;
          if (y === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };
    const animate = level === 'full' && !still;
    let visible = true;
    const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((e) => { visible = e[0]?.isIntersecting; }) : null;
    io?.observe(c);
    const loop = (t) => { if (visible) draw(t); raf = requestAnimationFrame(loop); };
    if (animate) raf = requestAnimationFrame(loop); else draw(2000);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { size(); if (!animate) draw(2000); }) : null;
    ro?.observe(c);
    const onBrand = () => { if (!animate) draw(2000); };
    window.addEventListener('staybill:brand', onBrand);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); io?.disconnect(); window.removeEventListener('staybill:brand', onBrand); };
  }, [level, still]);
  return <canvas ref={ref} aria-hidden="true" className={cls('hm-pool', className)} />;
}

// ---------- 34 Room ready sparkle ----------
export function RoomTile({ room, occupied, guest, onClick }) {
  const level = useLevel();
  const state = room.status === 'inactive' ? 'inactive' : occupied ? 'occ' : 'ready';
  const prev = useRef(null);
  const [sparkle, setSparkle] = useState(0);
  useEffect(() => {
    if (state === 'ready' && prev.current !== 'ready' && level !== 'off') setSparkle((s) => s + 1);
    prev.current = state;
  }, [state, level]);
  const label = state === 'inactive' ? 'Inactive' : occupied ? 'Occupied' : 'Ready';
  return (
    <button type="button" onClick={onClick} className={cls('hm hm-room text-left', state, sparkle && 'sparkle')} key={sparkle}>
      <span className="block font-headline text-headline-sm text-on-surface">{room.roomNumber}</span>
      <span className="block truncate text-label-sm text-on-surface-variant">{room.roomType}</span>
      <span className={cls('mt-1 block text-label-sm font-semibold uppercase tracking-wider', state === 'ready' ? 'text-on-ok-container' : state === 'occ' ? 'text-secondary' : 'text-on-surface-variant')}>{label}</span>
      {guest && <span className="block truncate text-label-sm text-on-surface-variant">{guest}</span>}
      {sparkle > 0 && [[8, 8, 0], [24, 18, 0.15], [12, 30, 0.3]].map(([r, t, d], i) => (
        <span key={`${sparkle}-${i}`} className="hm-spark" style={{ right: r, top: t, animationDelay: `${d + Math.random() * 0.6}s` }} />
      ))}
    </button>
  );
}
