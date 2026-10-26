// The animated "night city" sections of StayBill. They are used on the home
// page inside the app (between and around the live front-desk dashboard) and
// on the public landing page shown to signed-out visitors in Firebase mode.
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useScroll, useTransform, useMotionValueEvent } from 'framer-motion';
import Lenis from 'lenis';
import { KeyCardTap, PoolLight } from '../motion/hotel';
import { listGallery } from '../lib/db';
import { useAppearance } from '../context/AppearanceContext';
import { CountUp, CursorGlow, PauseMotionButton, Reveal, Starfield, EASE } from '../motion';
import { Icon } from '../components/icons';
import './welcome.css';

// ---------- small helpers ----------
function rand(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

const FEATURES = [
  'Room charges', 'Food & laundry', 'Extra bed', 'CGST + SGST', 'Discounts', 'Partial payments', 'UPI', 'Card', 'Cash',
  'Bank transfer', 'A4 invoices', 'PDF & print', 'Guest history', 'Outstanding queue', 'Daily sales', 'Audit trail',
];
const STEPS = [
  { icon: 'person_add', title: 'Guest', text: 'Pick a returning guest or add a new one. Details fill in automatically.' },
  { icon: 'meeting_room', title: 'Room & stay', text: 'Choose the room and dates. Nights and room charges are calculated for you.' },
  { icon: 'restaurant', title: 'Extra charges', text: 'Add food, laundry, extra bed or transport with one tap.' },
  { icon: 'percent', title: 'Discount & tax', text: 'Percentage or fixed discount, then CGST and SGST from your settings.' },
  { icon: 'payments', title: 'Payment', text: 'Cash, UPI, card or bank. Full, partial or pending, all tracked.' },
  { icon: 'receipt_long', title: 'Invoice', text: 'A numbered A4 invoice, ready to print, download or share.' },
];
const BILL_LINES = [
  ['Deluxe Room · 3 nights', 7500], ['Food × 2', 850], ['Laundry', 300], ['Discount', -500], ['CGST + SGST', 865],
];
const PILLARS = [
  { icon: 'bolt', title: 'Fast at the desk', text: 'A normal checkout bill takes a couple of minutes, with no manual maths.' },
  { icon: 'calculate', title: 'Always accurate', text: 'Nights, subtotal, discount, tax and balance are computed and saved together.' },
  { icon: 'account_balance_wallet', title: 'Every rupee tracked', text: 'Split payments, pending balances and a fast-collect queue for checkouts.' },
  { icon: 'description', title: 'Professional invoices', text: 'Your logo, GSTIN and footer on every A4 invoice and PDF.' },
  { icon: 'insights', title: 'Simple reports', text: 'Daily sales, payment and bill reports with PDF and Excel export.' },
  { icon: 'verified_user', title: 'Safe by design', text: 'Roles, audit trail and cancelled bills that are never deleted.' },
];
const ART = [
  { label: 'Lobby', icon: 'chair', g: 'from-w-vivid2/70 via-w-bg3 to-w-bg2' },
  { label: 'Deluxe Room', icon: 'bed', g: 'from-w-deep via-w-bg3 to-w-bg2' },
  { label: 'Suite', icon: 'king_bed', g: 'from-w-vivid/50 via-w-bg3 to-w-bg2' },
  { label: 'Restaurant', icon: 'restaurant', g: 'from-w-glow2/50 via-w-bg3 to-w-bg2' },
  { label: 'Pool', icon: 'pool', g: 'from-w-vivid/70 via-w-bg3 to-w-bg2' },
  { label: 'Reception', icon: 'concierge', g: 'from-w-deep via-w-bg2 to-w-bg2' },
  { label: 'Family Room', icon: 'family_restroom', g: 'from-w-vivid2 via-w-deep to-w-bg2' },
  { label: 'Terrace', icon: 'deck', g: 'from-w-glow/40 via-w-bg3 to-w-bg2' },
];

// ---------- Neon skyline ----------
export function Skyline({ sign = false }) {
  const { buildings, windows } = useMemo(() => {
    const r = rand(7);
    const b = [];
    let x = 0;
    while (x < 1440) {
      const w = 40 + Math.floor(r() * 70);
      const h = 90 + Math.floor(r() * 170);
      b.push({ x, w, h });
      x += w + 6 + Math.floor(r() * 14);
    }
    const win = [];
    b.forEach((bl) => {
      for (let wy = 380 - bl.h + 14; wy < 370; wy += 14) {
        for (let wx = bl.x + 8; wx < bl.x + bl.w - 8; wx += 12) {
          if (r() > 0.62) win.push({ x: wx, y: wy, d: (r() * 4).toFixed(2), warm: r() > 0.5 });
        }
      }
    });
    return { buildings: b, windows: win };
  }, []);
  const road = 'M -40 500 C 260 430, 520 470, 760 445 S 1180 410, 1500 455';
  return (
    <svg viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" className="h-full w-full" aria-hidden="true">
      <defs>
        <linearGradient id="wl-bfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'rgb(var(--c-w-bg3))' }} /><stop offset="1" style={{ stopColor: 'rgb(var(--c-w-bg))' }} /></linearGradient>
        <linearGradient id="wl-stroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style={{ stopColor: 'rgb(var(--c-w-glow2))' }} /><stop offset="0.5" style={{ stopColor: 'rgb(var(--c-w-soft))' }} /><stop offset="1" style={{ stopColor: 'rgb(var(--c-w-glow2))' }} /></linearGradient>
        <linearGradient id="wl-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: 'rgb(var(--c-w-deep))', stopOpacity: 0.8 }} /><stop offset="1" style={{ stopColor: 'rgb(var(--c-w-bg))' }} /></linearGradient>
        <radialGradient id="wl-moon" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stopColor="#fff" stopOpacity="0.9" /><stop offset="1" style={{ stopColor: 'rgb(var(--c-w-glow))', stopOpacity: 0 }} /></radialGradient>
      </defs>
      <circle cx="1160" cy="90" r="70" fill="url(#wl-moon)" opacity="0.35" />
      {/* city */}
      <g className="wl-neon">
        {buildings.map((b, i) => (
          <rect key={i} x={b.x} y={380 - b.h} width={b.w} height={b.h} fill="url(#wl-bfill)" stroke="url(#wl-stroke)" strokeWidth="1.1" opacity={0.55 + (i % 3) * 0.15} />
        ))}
      </g>
      {windows.map((w, i) => (
        <rect key={i} className="wl-window" style={{ animationDelay: `${w.d}s`, fill: w.warm ? 'rgb(var(--c-w-warm))' : 'rgb(var(--c-w-soft))' }} x={w.x} y={w.y} width="4" height="6" rx="1" />
      ))}
      {/* the hotel: domed palace with a lit sign */}
      <g className="wl-neon" fill="url(#wl-bfill)" style={{ stroke: 'rgb(var(--c-w-soft))' }} strokeWidth="1.6">
        <rect x="560" y="210" width="320" height="170" />
        <path d="M 620 210 Q 720 90 820 210 Z" />
        <path d="M 715 120 L 720 70 L 725 120" />
        <rect x="520" y="250" width="40" height="130" />
        <rect x="880" y="250" width="40" height="130" />
        <path d="M 520 250 Q 540 215 560 250" />
        <path d="M 880 250 Q 900 215 920 250" />
        {[0, 1, 2, 3, 4].map((i) => <path key={i} d={`M ${590 + i * 56} 380 L ${590 + i * 56} 330 Q ${612 + i * 56} 300 ${634 + i * 56} 330 L ${634 + i * 56} 380`} />)}
      </g>
      {sign && <text x="720" y="262" textAnchor="middle" fill="#fff" fontFamily="Plus Jakarta Sans, Inter, sans-serif" fontWeight="700" fontSize="22" letterSpacing="6"
        style={{ filter: 'drop-shadow(0 0 6px rgb(var(--c-w-glow)))' }}>HOTEL</text>}
      {/* lighthouse */}
      <g className="wl-neon" fill="url(#wl-bfill)" style={{ stroke: 'rgb(var(--c-w-soft))' }} strokeWidth="1.4">
        <path d="M 120 380 L 132 250 L 156 250 L 168 380 Z" />
        <rect x="128" y="232" width="32" height="18" />
        <path d="M 126 232 L 144 214 L 162 232" />
      </g>
      <path d="M 144 240 L -40 200 L -40 280 Z" style={{ fill: 'rgb(var(--c-w-soft))', opacity: 0.08 }} />
      {/* water + bridge */}
      <rect x="0" y="380" width="1440" height="180" fill="url(#wl-water)" />
      <g className="wl-neon" fill="none" style={{ stroke: 'rgb(var(--c-w-soft))' }} strokeWidth="1.3" opacity="0.8">
        <path d="M 0 400 L 1440 400" />
        {Array.from({ length: 16 }, (_, i) => <path key={i} d={`M ${i * 90} 430 Q ${i * 90 + 45} 395 ${i * 90 + 90} 430`} />)}
      </g>
      {/* road + moving light streaks */}
      <path d={road} fill="none" style={{ stroke: 'rgb(var(--c-w-vivid))', strokeOpacity: 0.35 }} strokeWidth="14" />
      <path d={road} fill="none" style={{ stroke: 'rgb(var(--c-w-soft))', strokeOpacity: 0.5 }} strokeWidth="1.5" />
      <path d={road} fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" className="wl-streak" style={{ filter: 'drop-shadow(0 0 6px #fff)' }} />
      <path d={road} fill="none" strokeWidth="2.5" strokeLinecap="round" className="wl-streak s2" style={{ stroke: 'rgb(var(--c-w-warm))', filter: 'drop-shadow(0 0 6px rgb(var(--c-w-warm)))' }} />
      <path d={road} fill="none" strokeWidth="2.5" strokeLinecap="round" className="wl-streak s3" style={{ stroke: 'rgb(var(--c-w-soft))', filter: 'drop-shadow(0 0 6px rgb(var(--c-w-glow)))' }} />
    </svg>
  );
}

// ---------- Pinned "how it works" ----------
export function HowItWorks({ motionLevel, stickyTop = 0, cta }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [step, setStep] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => setStep(Math.min(STEPS.length - 1, Math.floor(v * STEPS.length))));
  const bar = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);
  const off = motionLevel === 'off';
  const shownLines = off ? BILL_LINES.length : Math.min(BILL_LINES.length, Math.max(0, step - 0));
  const total = BILL_LINES.slice(0, shownLines).reduce((s, l) => s + l[1], 0);

  return (
    <section id="how" ref={ref} className="relative scroll-mt-16" style={{ height: off ? 'auto' : `${STEPS.length * 70}vh` }}>
      <div className={off ? 'py-20' : 'sticky flex items-center py-16'} style={off ? undefined : { top: stickyTop, minHeight: `calc(100vh - ${stickyTop}px)` }}>
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-4 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-w-glow">How it works</p>
            <h2 className="mt-2 font-headline text-4xl font-bold tracking-tight text-white sm:text-5xl">From check-in to invoice.</h2>
            <div className="relative mt-8 pl-6">
              <div className="absolute left-0 top-1 h-[calc(100%-8px)] w-px bg-white/10" />
              {!off && <motion.div className="absolute left-0 top-1 w-px bg-gradient-to-b from-w-soft to-w-vivid" style={{ height: bar }} />}
              <ol className="space-y-4">
                {STEPS.map((s, i) => {
                  const on = off || i <= step;
                  return (
                    <li key={s.title} className={`flex gap-3 transition-all duration-500 ${on ? 'opacity-100' : 'opacity-35'}`}>
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ${i === step && !off ? 'bg-w-vivid text-white ring-w-glow shadow-[0_0_20px_rgb(var(--c-w-vivid)/.8)]' : 'bg-white/5 text-w-mist ring-white/15'}`}>
                        <Icon name={s.icon} size={16} />
                      </span>
                      <div>
                        <div className="font-headline text-lg font-semibold text-white">{i + 1}. {s.title}</div>
                        <p className="text-sm text-w-mist2">{s.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
            {cta}
          </div>
          {/* Live bill preview */}
          <div className="wl-glass rounded-2xl p-6">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-w-mist3">Invoice</div>
                <div className="font-headline text-xl font-bold text-white">INV-1001</div>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${step >= 5 || off ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-w-mist'}`}>
                {step >= 5 || off ? 'PAID · UPI' : step >= 4 ? 'RECORDING PAYMENT' : 'DRAFT'}
              </span>
            </div>
            <div className="mt-4 text-sm text-w-mist2">Guest: <b className="text-white">John</b> · Room 204 · 15–18 Sep</div>
            <ul className="mt-4 space-y-2 text-sm">
              <AnimatePresence initial={false}>
                {BILL_LINES.slice(0, shownLines).map(([l, a]) => (
                  <motion.li key={l} layout initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.4 }}
                    className="flex justify-between">
                    <span className="text-w-mist">{l}</span>
                    <span className="tabular-nums text-white">{a < 0 ? '-' : ''}₹{Math.abs(a).toLocaleString('en-IN')}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <div className="mt-5 flex items-baseline justify-between rounded-xl bg-gradient-to-r from-w-vivid2 to-w-glow2 px-4 py-3">
              <span className="text-sm font-medium text-white/90">Grand Total</span>
              <span className="font-headline text-3xl font-bold tabular-nums text-white">₹{total.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Shared data loaders ----------
export function useHotelLook(given) {
  const [hotel] = useState(given || '');
  const [photos, setPhotos] = useState([]);
  useEffect(() => {
    // Signed-out visitors see the generic StayBill page; a hotel's own name and photos show once someone signs in.
    if (!given) return;
    listGallery().then((list) => setPhotos([...list].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))).catch(() => {});
  }, [given]);
  return { hotel: given || hotel, photos };
}

/** Dark night-sky band. `clip` keeps rounded corners without breaking sticky sections. */
export function NightBand({ children, className = '', id }) {
  const { motion: level } = useAppearance();
  return (
    <div id={id} className={`wl-root relative overflow-clip font-sans ${className}`} data-theme="dark" data-motion={level === 'off' ? 'off' : 'on'}>
      {children}
    </div>
  );
}

// ---------- Hero ----------
export function Hero({ hotel, primary, secondary, compact = false, keyCard = true }) {
  const { motion: level } = useAppearance();
  const off = level === 'off';
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const cityY = useTransform(scrollYProgress, [0, 1], ['0%', '18%']);
  const titleY = useTransform(scrollYProgress, [0, 1], ['0%', '-35%']);
  const titleO = useTransform(scrollYProgress, [0, 0.85], [1, 0]);
  const hotelLabel = hotel || 'Hotel Billing Suite';
  return (
    <section ref={heroRef} className={`relative flex flex-col items-center overflow-hidden ${compact ? 'min-h-[640px] lg:min-h-[740px]' : 'min-h-[100svh]'}`}>
      <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_50%_10%,rgb(var(--c-w-vivid)/.35),transparent_60%),linear-gradient(180deg,rgb(var(--c-w-bg2)),rgb(var(--c-w-bg)))]" />
      <Starfield className="absolute inset-0 h-full w-full" density={1} shooting={level === 'full'} />
      <motion.div className={`absolute inset-x-0 bottom-0 ${compact ? 'h-[48%]' : 'h-[58%]'}`} style={off ? undefined : { y: cityY }}>
        <Skyline sign={!compact} />
      </motion.div>
      <div className={`absolute inset-x-0 bottom-0 h-[50%] bg-gradient-to-t from-w-bg ${compact ? 'via-w-bg/85' : 'via-w-bg/75'} to-transparent`} />
      <motion.div className={`relative z-10 flex flex-col items-center px-4 text-center ${compact ? 'mt-4' : 'mt-[12vh]'}`} style={off ? undefined : { y: titleY, opacity: titleO }}>
        {keyCard && <div className="-mb-3 -ml-16 scale-[.8] text-white sm:scale-90"><KeyCardTap once room="ROOM 204" title="Welcome" note="ACCESS GRANTED" /></div>}
        <motion.h1 className={`wl-title font-headline font-bold tracking-tight ${compact ? 'text-6xl sm:text-7xl md:text-8xl' : 'text-7xl sm:text-8xl md:text-9xl'}`}
          initial={off ? false : { opacity: 0, y: 30, filter: 'blur(14px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 1.2, delay: keyCard ? 1.4 : 0.2, ease: EASE }}>
          StayBill
        </motion.h1>
        <motion.div className="mt-2 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.35em] text-w-mist"
          initial={off ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: keyCard ? 1.9 : 0.6, duration: 1 }}>
          <span className="h-px w-10 bg-w-mist/50" />{hotelLabel}<span className="h-px w-10 bg-w-mist/50" />
        </motion.div>
      </motion.div>
      <div className="relative z-10 mt-auto w-full px-4 pb-8 text-center">
        <Reveal as="h2" className="font-headline text-3xl font-bold tracking-tight text-white drop-shadow-[0_2px_20px_rgba(0,0,0,.7)] sm:text-5xl">
          Check in. Charge. Collect. <span className="wl-dim">Invoice.</span>
        </Reveal>
        <Reveal as="p" delay={0.1} className="mx-auto mt-3 max-w-xl text-base text-w-soft drop-shadow-[0_2px_12px_rgba(0,0,0,.8)]">
          Simple, accurate hotel billing for the front desk: room charges, extras, GST, payments and professional invoices.
        </Reveal>
        <Reveal delay={0.2} className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {primary && (
            <button type="button" onClick={primary.onClick} className="wl-btn flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white">
              <Icon name={primary.icon || 'rocket_launch'} size={16} /> {primary.label}
            </button>
          )}
          {secondary && (
            <button type="button" onClick={secondary.onClick} className="flex items-center gap-1 rounded-full px-5 py-3 text-sm font-medium text-w-soft ring-1 ring-white/15 hover:bg-white/10">
              {secondary.label} <Icon name={secondary.icon || 'arrow_downward'} size={14} />
            </button>
          )}
        </Reveal>
        <div className="mx-auto mt-8 grid max-w-3xl grid-cols-2 gap-6 sm:grid-cols-4">
          {[['5', 'Payment modes'], ['6', 'Steps to a bill'], ['3', 'Report types'], ['100%', 'Auto-calculated']].map(([n, l], i) => (
            <Reveal key={l} delay={0.1 * i}>
              <div className="font-headline text-3xl font-bold text-white gsx-glow-text sm:text-4xl"><CountUp value={n} duration={1600} /></div>
              <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-w-mist3">{l}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------- About + marquee ----------
export function Features({ cta }) {
  return (
    <section id="features" className="relative mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
      <Reveal className="wl-glass flex flex-col items-start justify-between gap-6 rounded-3xl p-8 md:flex-row md:items-center">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-w-glow">About StayBill</p>
          <h2 className="mt-2 font-headline text-4xl font-bold tracking-tight text-white">More than a bill.</h2>
          <p className="mt-3 text-w-mist2">StayBill replaces paper invoices and spreadsheets with one place for every guest bill, payment and outstanding balance. It does billing, and does it well. It does not try to run the whole hotel.</p>
        </div>
        {cta}
      </Reveal>
      <Reveal delay={0.1} className="wl-glass mt-6 rounded-3xl p-5">
        <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.3em] text-w-mist3">Everything a front desk needs</p>
        <div className="wl-marquee overflow-hidden">
          <div className="wl-marquee-track gap-3">
            {[...FEATURES, ...FEATURES].map((f, i) => (
              <span key={i} className="flex shrink-0 items-center gap-2 rounded-full bg-white/5 px-4 py-2 text-sm text-w-soft ring-1 ring-white/10">
                <span className="h-1.5 w-1.5 rounded-full bg-w-glow shadow-[0_0_8px_rgb(var(--c-w-glow))]" />{f}
              </span>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}

// ---------- Pillars ----------
export function Pillars() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-20">
      <Reveal className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-w-glow">Core pillars</p>
        <h2 className="mt-2 font-headline text-4xl font-bold tracking-tight text-white sm:text-5xl">Bill. Collect. Report.</h2>
        <p className="mx-auto mt-3 max-w-xl text-w-mist2">Six things StayBill does so your reception team doesn't have to.</p>
      </Reveal>
      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((p, i) => (
          <Reveal key={p.title} delay={0.06 * i} className="wl-glass wl-card rounded-2xl p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-w-glow2/30 to-w-vivid2/30 text-w-soft ring-1 ring-white/10"><Icon name={p.icon} size={20} /></span>
            <h3 className="mt-4 font-headline text-lg font-semibold text-white">{p.title}</h3>
            <p className="mt-1 text-sm text-w-mist2">{p.text}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ---------- Gallery ----------
export function Gallery({ photos = [], hint }) {
  const gallery = photos.length ? photos.map((p) => ({ ...p, isPhoto: true })) : ART;
  return (
    <section id="gallery" className="relative mx-auto max-w-6xl scroll-mt-20 px-4 py-16">
      <div className="pointer-events-none absolute inset-x-4 top-8 h-56 overflow-hidden rounded-3xl opacity-70 [mask-image:linear-gradient(180deg,#000_30%,transparent)]"><PoolLight /></div>
      <Reveal className="relative mb-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-w-glow">Our hotel in moments</p>
        <h2 className="mt-2 font-headline text-4xl font-bold tracking-tight text-white">Photo Gallery</h2>
      </Reveal>
      <div className="grid auto-rows-[160px] grid-cols-2 gap-3 sm:auto-rows-[200px] md:grid-cols-4">
        {gallery.slice(0, 8).map((g, i) => (
          <Reveal key={g.id || g.label} delay={0.05 * i} amount={0.1}
            className={`wl-tile group relative overflow-hidden rounded-2xl ring-1 ring-white/10 ${i === 0 || i === 5 ? 'md:col-span-2 md:row-span-2' : ''}`}>
            {g.isPhoto ? (
              <img src={g.image} alt={g.caption || 'Hotel photo'} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className={`wl-art flex h-full w-full items-center justify-center bg-gradient-to-br ${g.g}`}>
                <Icon name={g.icon} size={i === 0 || i === 5 ? 64 : 40} className="text-white/70 drop-shadow-[0_0_18px_rgb(var(--c-w-glow)/.8)]" />
              </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-sm font-medium text-white opacity-90">
              {g.caption || g.label}
            </div>
          </Reveal>
        ))}
      </div>
      {!photos.length && hint && <p className="mt-4 text-center text-xs text-w-mist3">{hint}</p>}
    </section>
  );
}

// ---------- Closing call to action + giant footer word ----------
export function Closing({ action, hotel, links }) {
  return (
    <>
      <section id="contact" className="relative overflow-hidden px-4 py-24 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(700px_300px_at_50%_60%,rgb(var(--c-w-vivid)/.35),transparent_70%)]" />
        <Reveal className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-w-glow">Ready when you are</p>
          <h2 className="mx-auto mt-2 max-w-2xl font-headline text-4xl font-bold tracking-tight text-white sm:text-5xl">Your next checkout could take two minutes.</h2>
          <p className="mx-auto mt-3 max-w-lg text-w-mist2">Create the bill, take the payment, hand over the invoice.</p>
          {action && (
            <button type="button" onClick={action.onClick} className="wl-btn mx-auto mt-8 flex items-center gap-2 rounded-full px-7 py-3.5 text-sm font-semibold text-white">
              <Icon name={action.icon || 'rocket_launch'} size={16} /> {action.label}
            </button>
          )}
        </Reveal>
      </section>
      <footer className="relative overflow-hidden border-t border-white/10 px-4 pt-12">
        <div className="mx-auto grid max-w-6xl gap-8 pb-10 sm:grid-cols-3">
          <div>
            <div className="flex items-center gap-2 font-headline text-lg font-bold text-white"><Icon name="receipt_long" size={18} className="text-w-glow" />StayBill</div>
            <p className="mt-2 text-sm text-w-mist3">Hotel billing, invoices and payments. {hotel && `For ${hotel}.`}</p>
          </div>
          <div className="text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-w-mist3">Explore</div>
            {links.map(([l, fn]) => <button key={l} type="button" onClick={fn} className="block py-1 text-w-mist hover:text-white">{l}</button>)}
          </div>
          <div className="text-sm">
            <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-w-mist3">Front desk</div>
            {action && <button type="button" onClick={action.onClick} className="wl-btn mt-1 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white">{action.label} <Icon name="arrow_forward" size={14} /></button>}
          </div>
        </div>
        <Reveal y={60} className="wl-giant select-none text-center text-[18vw]" aria-hidden="true">STAYBILL</Reveal>
      </footer>
    </>
  );
}

// ---------- Public landing (signed-out visitors, Firebase mode) ----------
export default function Welcome({ onEnter, ctaLabel = 'Sign in' }) {
  const { motion: level } = useAppearance();
  const off = level === 'off';
  const { hotel, photos } = useHotelLook();

  useEffect(() => {
    if (off) return undefined;
    const lenis = new Lenis({ duration: level === 'full' ? 1.2 : 0.9, smoothWheel: true });
    let raf;
    const loop = (t) => { lenis.raf(t); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); lenis.destroy(); };
  }, [off, level]);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: off ? 'auto' : 'smooth' });
  const enter = { label: ctaLabel, onClick: onEnter, icon: 'login' };

  return (
    <NightBand className="min-h-screen">
      <CursorGlow />
      <PauseMotionButton className="!bottom-5" />
      <header className="fixed inset-x-0 top-0 z-50 px-3">
        <div className="mx-auto mt-3 flex max-w-6xl items-center justify-between rounded-2xl px-4 py-2.5 wl-glass">
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: off ? 'auto' : 'smooth' })} className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-w-glow2 to-w-vivid2 text-white shadow-[0_0_18px_rgb(var(--c-w-vivid)/.7)]"><Icon name="receipt_long" size={18} /></span>
            <span className="font-headline text-base font-bold text-white">StayBill</span>
            <span className="hidden text-sm text-w-mist3 sm:inline">{hotel}</span>
          </button>
          <nav className="hidden items-center gap-1 text-sm text-w-mist md:flex">
            {[['features', 'Features'], ['how', 'How it works'], ['gallery', 'Gallery'], ['contact', 'Get started']].map(([id, l]) => (
              <button key={id} type="button" onClick={() => go(id)} className="rounded-lg px-3 py-1.5 transition-colors hover:bg-white/10 hover:text-white">{l}</button>
            ))}
          </nav>
          <button type="button" onClick={onEnter} className="wl-btn flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-white">{ctaLabel} <Icon name="arrow_forward" size={14} /></button>
        </div>
      </header>
      <div className="pt-16">
        <Hero hotel={hotel} primary={enter} secondary={{ label: 'See how it works', onClick: () => go('how') }} />
      </div>
      <Features cta={<button type="button" onClick={onEnter} className="wl-btn flex shrink-0 items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-semibold text-white">{ctaLabel} <Icon name="arrow_forward" size={14} /></button>} />
      <HowItWorks motionLevel={level} />
      <Pillars />
      <Gallery photos={photos} />
      <Closing action={enter} hotel={hotel} links={[['Features', () => go('features')], ['How it works', () => go('how')], ['Gallery', () => go('gallery')]]} />
    </NightBand>
  );
}
