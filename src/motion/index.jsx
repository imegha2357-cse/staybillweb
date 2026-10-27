// Motion building blocks (Option B/D in the app, everything on the welcome page).
// Every component degrades to a plain, fully visible element when motion is off.
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useAppearance } from '../context/AppearanceContext';
import { Icon } from '../components/icons';
import { cssTriplet } from '../lib/palettes';

const EASE = [0.22, 1, 0.36, 1];

/** Bumps whenever the brand palette changes, so canvas effects re-read colours. */
function useBrandTick() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const on = () => setN((x) => x + 1);
    window.addEventListener('staybill:brand', on);
    return () => window.removeEventListener('staybill:brand', on);
  }, []);
  return n;
}

/** Fades (and in Full mode, un-blurs) content into view as it scrolls in. */
export function Reveal({ as = 'div', children, delay = 0, y = 14, className, style, once = true, amount = 0.15, ...rest }) {
  const { motion: level } = useAppearance();
  const Tag = motion[as] || motion.div;
  if (level === 'off') {
    const Plain = as;
    return <Plain className={className} style={style} {...rest}>{children}</Plain>;
  }
  const full = level === 'full';
  return (
    <Tag
      className={className}
      style={style}
      initial={{ opacity: 0, y: full ? y : Math.min(y, 8), filter: full ? 'blur(8px)' : 'blur(0px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once, amount }}
      transition={{ duration: full ? 0.7 : 0.35, delay, ease: EASE }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Animates the number inside a formatted string, e.g. "₹26,620" or "1200+". */
export function CountUp({ value, duration }) {
  const { motion: level } = useAppearance();
  const text = String(value ?? '');
  const m = text.match(/-?[\d,]+(\.\d+)?/);
  const [shown, setShown] = useState(level === 'off' || !m ? text : text.replace(m[0], '0'));
  const ref = useRef(null);
  const started = useRef(false);

  useEffect(() => {
    if (level === 'off' || !m) { setShown(text); return undefined; }
    const target = Number(m[0].replace(/,/g, ''));
    const decimals = m[1] ? m[1].length - 1 : 0;
    const useGrouping = m[0].includes(',');
    const fmt = (n) => (useGrouping
      ? new Intl.NumberFormat('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)
      : n.toFixed(decimals));
    let raf;
    const run = () => {
      const ms = duration ?? (level === 'full' ? 1400 : 700);
      const t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / ms);
        const eased = 1 - (1 - p) ** 3;
        setShown(text.replace(m[0], fmt(target * eased)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    // Start when visible (once); later value changes animate straight away.
    if (started.current) { run(); return () => cancelAnimationFrame(raf); }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') { started.current = true; run(); return () => cancelAnimationFrame(raf); }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); started.current = true; run(); }
    }, { threshold: 0.2 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [text, level]); // eslint-disable-line react-hooks/exhaustive-deps

  return <span ref={ref} className="tabular-nums">{shown}</span>;
}

/** Re-mounts its children with a short fade/slide whenever `id` changes. */
export function PageTransition({ id, children }) {
  const { motion: level } = useAppearance();
  if (level === 'off') return children;
  return (
    <motion.div
      key={id}
      initial={{ opacity: 0, y: level === 'full' ? 16 : 6, filter: level === 'full' ? 'blur(6px)' : 'blur(0px)' }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: level === 'full' ? 0.5 : 0.25, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/** Glowing cursor dot with a comet trail (Full motion, mouse/trackpad only). */
export function CursorGlow({ force = false }) {
  const { motion: level } = useAppearance();
  const canvas = useRef(null);
  const dot = useRef(null);
  const enabled = (force || level === 'full') && level !== 'off';
  const tick = useBrandTick();

  useEffect(() => {
    if (!enabled) return undefined;
    let fine = true;
    try { fine = window.matchMedia('(pointer: fine)').matches; } catch { /* ignore */ }
    if (!fine) return undefined;
    const c = canvas.current;
    const ctx = c.getContext('2d');
    let w = 0; let h = 0; let raf;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => { w = window.innerWidth; h = window.innerHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    resize();
    const pts = [];
    const target = { x: -100, y: -100 };
    const head = { x: -100, y: -100 };
    const trail = cssTriplet('w-glow', '190 160 255');
    const onMove = (e) => { target.x = e.clientX; target.y = e.clientY; };
    const draw = () => {
      head.x += (target.x - head.x) * 0.35;
      head.y += (target.y - head.y) * 0.35;
      pts.push({ x: head.x, y: head.y });
      if (pts.length > 22) pts.shift();
      ctx.clearRect(0, 0, w, h);
      for (let i = 1; i < pts.length; i += 1) {
        const a = i / pts.length;
        ctx.strokeStyle = `rgb(${trail} / ${a * 0.55})`;
        ctx.lineWidth = a * 3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
      if (dot.current) dot.current.style.transform = `translate(${target.x - 5}px, ${target.y - 5}px)`;
      raf = requestAnimationFrame(draw);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('resize', resize);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('mousemove', onMove); window.removeEventListener('resize', resize); };
  }, [enabled, tick]);

  if (!enabled) return null;
  return (
    <div className="no-print pointer-events-none fixed inset-0 z-[80]" aria-hidden="true">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
      <div ref={dot} className="absolute left-0 top-0 h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_14px_4px_rgb(var(--c-w-glow)/0.75)]" />
    </div>
  );
}

/** Twinkling star field (with the odd shooting star in Full motion). */
export function Starfield({ className = '', density = 1, shooting }) {
  const { motion: level } = useAppearance();
  const ref = useRef(null);
  const tick = useBrandTick();
  useEffect(() => {
    const c = ref.current;
    if (!c) return undefined;
    const ctx = c.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0; let h = 0; let raf; let stars = []; let shoot = null;
    const resize = () => {
      w = c.clientWidth; h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round((w * h) / 9000 * density);
      stars = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.2 + 0.2, p: Math.random() * Math.PI * 2, s: 0.5 + Math.random() * 1.5 }));
    };
    resize();
    // Twinkling redraws the whole canvas every frame; only the opt-in 'full' level pays for it.
    const still = level !== 'full';
    const starC = cssTriplet('w-star', '230 220 255');
    const tailC = cssTriplet('w-glow', '177 151 252');
    const allowShoot = (shooting ?? level === 'full') && !still;
    const frame = (t) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const a = still ? 0.6 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 1000 * s.s + s.p));
        ctx.fillStyle = `rgb(${starC} / ${a})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      if (allowShoot) {
        if (!shoot && Math.random() < 0.004) shoot = { x: Math.random() * w * 0.7, y: Math.random() * h * 0.35, vx: 7 + Math.random() * 4, vy: 2.5 + Math.random() * 2, life: 1 };
        if (shoot) {
          const g = ctx.createLinearGradient(shoot.x, shoot.y, shoot.x - shoot.vx * 14, shoot.y - shoot.vy * 14);
          g.addColorStop(0, `rgba(255,255,255,${shoot.life})`); g.addColorStop(1, `rgb(${tailC} / 0)`);
          ctx.strokeStyle = g; ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.moveTo(shoot.x, shoot.y); ctx.lineTo(shoot.x - shoot.vx * 14, shoot.y - shoot.vy * 14); ctx.stroke();
          shoot.x += shoot.vx; shoot.y += shoot.vy; shoot.life -= 0.012;
          if (shoot.life <= 0 || shoot.x > w + 50) shoot = null;
        }
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(c);
    return () => { cancelAnimationFrame(raf); ro?.disconnect(); };
  }, [level, density, shooting, tick]);
  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none ${className}`} />;
}

/** Floating "Pause motion" switch, shown whenever animations are on. */
export function PauseMotionButton({ className = '', inline = false }) {
  const { motionSetting, paused, setPaused } = useAppearance();
  if (motionSetting === 'off') return null;
  const pos = inline
    ? 'inline-flex px-2 py-0.5 text-label-sm hover:bg-surface-container-low'
    : 'fixed bottom-12 left-4 z-[70] px-3 py-1.5 text-label-md bg-surface-container-lowest/90 shadow-md ring-1 ring-outline-variant/40';
  return (
    <button type="button" onClick={() => setPaused(!paused)}
      className={`no-print flex items-center gap-1.5 rounded-full text-on-surface-variant hover:text-on-surface ${pos} ${className}`}
      aria-pressed={paused}>
      <Icon name={paused ? 'play_arrow' : 'pause'} size={14} />{paused ? 'Play motion' : 'Pause motion'}
    </button>
  );
}

export { motion, EASE };
