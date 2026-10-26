import { createPortal } from 'react-dom';
// Shared UI primitives, styled after the Google Stitch design system:
// borderless white cards with soft shadows, brand-coloured primary actions and
// accents (see src/lib/palettes.js), Plus Jakarta Sans headings, Material Symbols.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Icon } from './icons';
import { motion } from 'framer-motion';
import { Reveal } from '../motion';
import { BellIcon, FlapText, Odometer, TrolleyLoader, playDing, ripple } from '../motion/hotel';
import { useAppearance } from '../context/AppearanceContext';
import { STATUS_LABEL } from '../lib/billing';

export const cx = (...c) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', size = 'md', className, loading, icon, children, onPointerDown, ...rest }) {
  const base = 'relative overflow-hidden isolate inline-flex items-center justify-center gap-space-xs rounded-lg font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-secondary focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
  const sizes = { sm: 'h-8 px-3 text-label-md', md: 'h-9 px-space-md text-label-lg', lg: 'h-11 px-space-lg text-label-lg' };
  const variants = {
    primary: 'bg-primary text-on-primary hover:bg-primary-container hover:shadow-md shadow-sm',
    secondary: 'bg-surface-container-low text-on-surface hover:bg-surface-container shadow-sm',
    ghost: 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface',
    danger: 'bg-error text-on-error hover:bg-on-error-container shadow-sm',
    'danger-ghost': 'text-error hover:bg-error-container',
  };
  const iconCls = variant === 'secondary' ? 'text-on-surface-variant' : '';
  return (
    <button className={cx(base, sizes[size], variants[variant], className)} disabled={loading || rest.disabled} onPointerDown={(e) => { ripple(e); onPointerDown?.(e); }} {...rest}>
      {loading ? <Icon name="progress_activity" size={16} className="animate-spin" /> : icon ? <Icon name={icon} size={16} className={iconCls} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon, title, tone = 'default', className, disabled, ...rest }) {
  const tones = {
    default: 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container',
    primary: 'text-primary hover:bg-surface-container',
    danger: 'text-on-surface-variant hover:text-error hover:bg-error-container',
  };
  return (
    <button type="button" title={title} aria-label={title} disabled={disabled}
      className={cx('rounded-lg p-1.5 transition-colors', disabled ? 'cursor-not-allowed text-outline-variant' : tones[tone], className)} {...rest}>
      <Icon name={icon} size={16} />
    </button>
  );
}

export function Field({ label, error, hint, children, className, required }) {
  return (
    <label className={cx('block', className)}>
      {label && (
        <span className="mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant">
          {label}{required && <span className="text-error"> *</span>}
        </span>
      )}
      {children}
      {error ? <span className="mt-1 block text-label-md text-error">{error}</span> : hint ? <span className="mt-1 block text-label-md text-on-surface-variant">{hint}</span> : null}
    </label>
  );
}

const inputCls = 'block w-full rounded-lg border-0 bg-surface-container-low px-space-md h-10 text-body-md text-on-surface placeholder:text-on-surface-variant/70 transition-all focus:bg-surface-container-lowest focus:outline-none focus:ring-1 focus:ring-secondary disabled:opacity-60';

export function Input({ className, invalid, ...rest }) {
  return <input className={cx(inputCls, invalid && 'ring-1 ring-error', className)} {...rest} />;
}
export function Textarea({ className, ...rest }) {
  return <textarea className={cx(inputCls, 'h-auto py-2', className)} rows={3} {...rest} />;
}
export function Select({ className, invalid, children, icon, ...rest }) {
  return (
    <div className={cx('relative inline-flex items-center', !/(^|\s)w-/.test(className || '') && 'w-full', className)}>
      {icon && <Icon name={icon} size={16} className="pointer-events-none absolute left-2.5 text-on-surface-variant" />}
      <select className={cx(inputCls, 'cursor-pointer appearance-none pr-8 hover:bg-surface-container', /(^|\s)h-9/.test(className || '') && 'h-9 text-label-md', icon && 'pl-8', invalid && 'ring-1 ring-error')} {...rest}>{children}</select>
      <Icon name="expand_more" size={14} className="pointer-events-none absolute right-2 text-on-surface-variant" />
    </div>
  );
}

export function Card({ className, children, ...rest }) {
  return <Reveal className={cx('rounded-xl bg-surface-container-lowest shadow-sm', className)} {...rest}>{children}</Reveal>;
}
export function CardHeader({ title, actions, subtitle, icon }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-space-md py-space-md">
      <div className="flex items-center gap-space-xs">
        {icon && <Icon name={icon} size={18} className="text-secondary" />}
        <div>
          <h2 className="font-headline text-headline-sm tracking-tight text-on-surface">{title}</h2>
          {subtitle && <p className="text-label-md text-on-surface-variant">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Page title block with the Stitch-style eyebrow breadcrumb. */
export function PageHeader({ title, subtitle, actions, back, crumbs }) {
  return (
    <div className="mb-space-lg flex flex-col justify-between gap-space-md lg:flex-row lg:items-end">
      <div>
        {back}
        {crumbs && (
          <div className="mb-1 flex items-center gap-space-xs text-label-sm uppercase tracking-wider text-on-surface-variant">
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-space-xs">
                {i > 0 && <span>/</span>}
                <span className={i === crumbs.length - 1 ? 'font-semibold text-secondary' : ''}>{c}</span>
              </span>
            ))}
          </div>
        )}
        <h1 className="font-headline text-headline-lg tracking-tight text-on-surface">{title}</h1>
        {subtitle && <p className="mt-0.5 text-body-md text-on-surface-variant">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-space-sm">{actions}</div>}
    </div>
  );
}

export function BackLink({ to, children, as: As }) {
  return <As to={to} className="mb-1 inline-flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface"><Icon name="arrow_back" size={14} />{children}</As>;
}

const STATUS_STYLE = {
  PAID: 'bg-ok-container text-on-ok-container',
  PARTIALLY_PAID: 'bg-warn-container text-on-warn-container',
  PENDING: 'bg-error-container text-on-error-container',
  CANCELLED: 'bg-surface-container text-on-surface-variant line-through',
};
const STATUS_SHORT = { PAID: 'PAID', PARTIALLY_PAID: 'PARTIAL', PENDING: 'PENDING', CANCELLED: 'CANCELLED' };
export function StatusBadge({ status, long, flap }) {
  const text = long ? (STATUS_LABEL[status] || status).toUpperCase() : STATUS_SHORT[status] || status;
  return (
    <span className={cx('inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-label-sm font-semibold', flap && 'font-mono tracking-wider', STATUS_STYLE[status] || STATUS_STYLE.CANCELLED)}>
      {flap ? <FlapText text={text} /> : text}
    </span>
  );
}
export function Badge({ children, tone = 'slate' }) {
  const tones = {
    slate: 'bg-surface-container text-on-surface-variant',
    green: 'bg-ok-container text-on-ok-container',
    blue: 'bg-surface-container-low text-secondary',
    red: 'bg-error-container text-on-error-container',
  };
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-label-sm font-semibold', tones[tone])}>{children}</span>;
}

export function Spinner({ className }) {
  return <Icon name="progress_activity" size={20} className={cx('animate-spin text-outline', className)} />;
}
export function Loading({ label = 'Loading…' }) {
  const { motion: level } = useAppearance();
  if (level !== 'off') return <div className="flex items-center justify-center py-12"><TrolleyLoader label={label} /></div>;
  return <div className="flex items-center justify-center gap-2 py-16 text-body-md text-on-surface-variant"><Spinner />{label}</div>;
}
export function Empty({ icon: IconC, title, children }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
      {IconC && <IconC className="mb-3 h-8 w-8 text-outline-variant" />}
      <p className="text-label-lg font-semibold text-on-surface">{title}</p>
      {children && <div className="mt-1 text-body-md text-on-surface-variant">{children}</div>}
    </div>
  );
}

export function Modal({ open, onClose, title, icon, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  // Rendered at the end of <body>: a moving page (transitions use transforms) would
  // otherwise trap a fixed overlay inside the page and cut the window off.
  return createPortal(
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.18 }}
      className="no-print fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <motion.div initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}
        className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-surface-container-lowest shadow-xl sm:rounded-xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-lg')}>
        <div className="sticky top-0 z-10 flex items-center justify-between bg-surface-container-lowest px-space-lg pb-space-sm pt-space-lg">
          <div className="flex items-center gap-space-xs">
            {icon && <Icon name={icon} size={22} className="text-secondary" />}
            <h3 className="font-headline text-headline-sm text-on-surface">{title}</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-on-surface-variant hover:text-on-surface" aria-label="Close"><Icon name="close" size={18} /></button>
        </div>
        <div className="px-space-lg py-space-sm">{children}</div>
        {footer && <div className="sticky bottom-0 flex justify-end gap-space-sm bg-surface-container-lowest px-space-lg pb-space-lg pt-space-md">{footer}</div>}
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function Table({ head, children, className }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-left">
        <thead>
          <tr className="h-11 bg-surface-container-low text-label-sm uppercase tracking-wider text-on-surface-variant">
            {head.map((h, i) => (
              <th key={i} className={cx('whitespace-nowrap px-space-md py-2 font-semibold', typeof h === 'object' && h?.right && 'text-right', typeof h === 'object' && h?.center && 'text-center', typeof h === 'object' && h?.className)}>{typeof h === 'object' ? h?.label : h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-container-low">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ className, right, children, ...rest }) => (
  <td className={cx('px-space-md py-2.5 text-body-md text-on-surface', right && 'text-right font-financial-tabular tabular-nums', className)} {...rest}>{children}</td>
);
export const rowCls = 'h-14 transition-colors hover:bg-surface-container-low/60';

/** Pill tabs (black active pill), as in the Stitch status tabs. */
export function Tabs({ tabs, value, onChange, className }) {
  return (
    <div className={cx('mb-space-md flex items-center gap-1 overflow-x-auto pb-1', className)}>
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)}
          className={cx('whitespace-nowrap rounded-lg px-space-md py-1.5 text-label-lg transition-colors',
            value === t.id ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface')}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Option grid where the selected tile turns dark (payment method picker). */
export function ChoiceGrid({ options, value, onChange, cols = 5 }) {
  return (
    <div className="grid gap-space-xs" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button type="button" key={o.value} onClick={() => onChange(o.value)}
          className={cx('flex flex-col items-center justify-center rounded-lg p-2 transition-colors',
            value === o.value ? 'bg-primary-container text-on-primary' : 'bg-surface-container-low text-on-surface hover:bg-surface-container')}>
          <Icon name={o.icon} size={18} />
          <span className="mt-1 text-label-sm">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <span>
        <span className="block text-label-lg font-semibold text-on-surface">{label}</span>
        {description && <span className="block text-label-md text-on-surface-variant">{description}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-outline-variant')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0.5')} />
      </button>
    </label>
  );
}

/** Small area sparkline (Stitch metric card). values: numbers. */
export function Sparkline({ values = [] }) {
  const v = values.length > 1 ? values : [0, ...values, 0].slice(0, Math.max(2, values.length));
  const max = Math.max(...v, 1);
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * 100).toFixed(2)},${(22 - (y / max) * 19).toFixed(2)}`);
  const d = `M${pts.join(' L')}`;
  return (
    <svg className="h-8 w-full overflow-visible text-secondary" preserveAspectRatio="none" viewBox="0 0 100 24" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <path d={`${d} L100,24 L0,24 Z`} fill="currentColor" opacity="0.08" />
    </svg>
  );
}

/** Metric card from the Stitch header strip. */
export function MetricCard({ label, value, sub, icon, tone = 'default', children }) {
  const valueTone = tone === 'error' ? 'text-error' : 'text-on-surface';
  const iconTone = tone === 'error' ? 'bg-error-container text-on-error-container' : tone === 'accent' ? 'bg-surface-container-low text-secondary' : 'bg-surface-container-low text-on-surface';
  return (
    <Reveal className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">{label}</span>
          <div className="mt-1 flex items-baseline gap-space-xs">
            <span className={cx('font-headline text-headline-md font-bold tabular-nums', valueTone)}><Odometer value={value} /></span>
          </div>
          {sub && <span className={cx('mt-0.5 text-label-md', tone === 'error' ? 'font-medium text-error' : 'text-on-surface-variant')}>{sub}</span>}
        </div>
        {icon && <div className={cx('rounded-lg p-2', iconTone)}><Icon name={icon} size={20} /></div>}
      </div>
      {children}
    </Reveal>
  );
}

// ---------- Confirm dialog (window.confirm is blocked in sandboxed frames) ----------
const ConfirmCtx = createContext(async () => false);
export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const ask = useCallback((message, opts = {}) => new Promise((resolve) => setReq({ message, ...opts, resolve })), []);
  const done = (v) => { req?.resolve(v); setReq(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Modal open={!!req} onClose={() => done(false)} title={req?.title || 'Are you sure?'} icon={req?.danger === false ? 'help' : 'warning'}
        footer={<>
          <Button variant="secondary" onClick={() => done(false)}>{req?.cancelLabel || 'Cancel'}</Button>
          <Button variant={req?.danger === false ? 'primary' : 'danger'} onClick={() => done(true)} autoFocus>{req?.confirmLabel || 'Confirm'}</Button>
        </>}>
        <p className="pb-space-sm text-body-md text-on-surface-variant">{req?.message}</p>
      </Modal>
    </ConfirmCtx.Provider>
  );
}
/** const confirm = useConfirm(); if (!(await confirm('Delete?', {confirmLabel:'Delete'}))) return; */
export const useConfirm = () => useContext(ConfirmCtx);

// ---------- Toasts ----------
const ToastCtx = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const { sound, motion: level } = useAppearance();
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    if (type !== 'error' && sound) playDing();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 3500);
  }, [sound]);
  useEffect(() => {
    const onErr = (e) => push(String(e.detail || 'Something went wrong.'), 'error');
    window.addEventListener('staybill:error', onErr);
    return () => window.removeEventListener('staybill:error', onErr);
  }, [push]);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="no-print pointer-events-none fixed bottom-12 right-4 z-[70] flex flex-col gap-2">
        {toasts.map((t) => (
          <motion.div key={t.id} role="status" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className={cx('pointer-events-none flex max-w-sm items-start gap-2 rounded-lg px-4 py-3 text-body-md shadow-lg',
            t.type === 'error' ? 'bg-error text-on-error' : 'bg-primary-container text-on-primary')}>
            {t.type === 'error' ? <Icon name="error" size={16} /> : level === 'off' ? <Icon name="check_circle" size={16} className="text-secondary-fixed-dim" /> : <BellIcon />}
            <span>{t.message}</span>
          </motion.div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Friendly message for Firebase / thrown errors. */
export function errMsg(e) {
  const code = e?.code || '';
  const map = {
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/wrong-password': 'Incorrect email or password.',
    'auth/user-not-found': 'Incorrect email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'auth/email-already-in-use': 'An account with this email already exists.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/network-request-failed': 'Network error. Check your internet connection.',
    'permission-denied': 'You do not have permission to do this.',
    unavailable: 'Cannot reach the server. Check your internet connection.',
    'failed-precondition': 'A database index is required. See the browser console for the link to create it.',
  };
  return map[code] || e?.message?.replace(/^Firebase: /, '') || 'Something went wrong.';
}
