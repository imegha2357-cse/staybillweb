// Shared building blocks for the StayBill modules: live data hooks, saving
// with an audit trail, numbered documents, and the table / form / picker UI.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc, deleteDoc, getDoc, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, orderBy, limit as qlimit,
} from '../backend/firestore';
import { db } from '../firebase';
import { hcol, hdoc } from '../lib/scope';
import { actor, auditPayload, listUsers, searchGuests } from '../lib/db';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { money, currencySymbol } from '../lib/format';
import { today } from '../lib/dates';
import { round2 } from '../lib/billing';
import { Icon } from '../components/icons';
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, Textarea, Toggle, cx, useToast, errMsg } from '../components/ui';

// ---------- data ----------
const TS = new Set(['createdAt', 'updatedAt']);
/** Live rows of a hotel collection. constraints: [['field','==',v], ...], order: ['field','desc'] */
export function useLive(name, { where: w = [], order = null, max = null, skip = false } = {}) {
  const { hotelId } = useAuth();
  const [rows, setRows] = useState(null);
  const key = JSON.stringify([name, hotelId, w, order, max, skip]);
  useEffect(() => {
    if (!hotelId || skip) { setRows(skip ? [] : null); return undefined; }
    setRows(null);
    const cons = w.map(([f, op, v]) => where(f, op, v));
    if (order) cons.push(orderBy(order[0], order[1] || 'asc'));
    if (max) cons.push(qlimit(max));
    return onSnapshot(query(hcol(name, hotelId), ...cons),
      (s) => setRows(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setRows([]));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}
export function useDocLive(name, id) {
  const { hotelId } = useAuth();
  const [row, setRow] = useState(undefined);
  useEffect(() => {
    if (!hotelId || !id) { setRow(null); return undefined; }
    return onSnapshot(hdoc(name, id, hotelId), (s) => setRow(s.exists() ? { id: s.id, ...s.data() } : null), () => setRow(null));
  }, [hotelId, name, id]);
  return row;
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== undefined && k !== 'id' && !TS.has(k) && !k.endsWith('__ms')));

/** Create or update a record, with an audit entry. Returns the id. */
export async function saveRecord(user, name, id, data, label) {
  const body = clean(data);
  if (id) {
    await updateDoc(hdoc(name, id), { ...body, updatedAt: serverTimestamp(), updatedBy: actor(user) });
  } else {
    const ref = await addDoc(hcol(name), { ...body, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: actor(user) });
    id = ref.id;
  }
  if (label) addDoc(hcol('auditLogs'), auditPayload(user, label, name, id, summarize(body))).catch(() => {});
  return id;
}
export async function setRecord(user, name, id, data, label) {
  await setDoc(hdoc(name, id), { ...clean(data), updatedAt: serverTimestamp(), updatedBy: actor(user) }, { merge: true });
  if (label) addDoc(hcol('auditLogs'), auditPayload(user, label, name, id, summarize(data))).catch(() => {});
}
export async function removeRecord(user, name, id, label) {
  await deleteDoc(hdoc(name, id));
  if (label) addDoc(hcol('auditLogs'), auditPayload(user, label, name, id, {})).catch(() => {});
}
function summarize(o) {
  const out = {};
  Object.entries(o).slice(0, 12).forEach(([k, v]) => { if (typeof v !== 'object' || v === null) out[k] = v; });
  return out;
}
/** Next number in a hotel counter (KOT-0001, PO-0001, CN-0001 …). Never reused. */
export async function nextNumber(counter, prefix, pad = 4) {
  return runTransaction(db, async (tx) => {
    const ref = hdoc('counters', counter);
    const s = await tx.get(ref);
    const n = s.exists() ? s.data().next : 1;
    tx.set(ref, { next: n + 1 });
    return `${prefix}-${String(n).padStart(pad, '0')}`;
  });
}
export async function getRecord(name, id) {
  const s = await getDoc(hdoc(name, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/** Staff of the current hotel (for "assigned to" pickers). */
const StaffCtx = createContext(null);
export function useStaff() {
  const cached = useContext(StaffCtx);
  const { hotelId } = useAuth();
  const [rows, setRows] = useState(cached || null);
  useEffect(() => { if (!cached && hotelId) listUsers(hotelId).then(setRows).catch(() => setRows([])); }, [hotelId, cached]);
  return rows || [];
}
export const staffName = (staff, uid) => staff.find((s) => s.id === uid)?.name || '';

/** Bills of guests staying tonight or checking out today (for charge-to-room). */
export function useInHouse() {
  const t = today();
  const rows = useLive('bills', { where: [['checkOut', '>=', t]] });
  return useMemo(() => (rows || []).filter((b) => b.paymentStatus !== 'CANCELLED' && b.checkIn <= t)
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })), [rows, t]);
}

// ---------- formatting ----------
export const fmtDate = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtShort = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—');
export const nowTime = () => new Date().toTimeString().slice(0, 5);
export const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);
export { money, today, round2 };

// ---------- page chrome ----------
export function ModulePage({ crumb, title, subtitle, actions, children, tabs, tab, onTab }) {
  return (
    <div className="flex flex-col gap-space-md">
      <PageHeader crumbs={crumb} title={title} subtitle={subtitle} actions={actions} />
      {tabs && (
        <div className="-mt-space-sm flex items-center gap-1 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => onTab(t.id)}
              className={cx('flex items-center gap-1.5 whitespace-nowrap rounded-lg px-space-md py-1.5 text-label-lg transition-colors',
                tab === t.id ? 'bg-primary text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface')}>
              {t.icon && <Icon name={t.icon} size={16} />}{t.label}{t.count !== undefined && <span className="opacity-70">({t.count})</span>}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

/** Row of small stat cards. items: [{label, value, icon, tone, sub}] */
export function Stats({ items }) {
  return (
    <div className={cx('grid grid-cols-2 gap-space-md', items.length >= 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
      {items.map((s) => (
        <div key={s.label} className="flex items-start justify-between gap-2 rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
          <div className="min-w-0">
            <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">{s.label}</div>
            <div className={cx('mt-1 font-headline text-headline-md font-bold tabular-nums', s.tone === 'error' ? 'text-error' : s.tone === 'ok' ? 'text-on-ok-container' : 'text-on-surface')}>{s.value}</div>
            {s.sub && <div className="mt-0.5 truncate text-label-md text-on-surface-variant">{s.sub}</div>}
          </div>
          {s.icon && <span className={cx('rounded-lg p-2', s.tone === 'error' ? 'bg-error-container text-on-error-container' : 'bg-surface-container-low text-secondary')}><Icon name={s.icon} size={20} /></span>}
        </div>
      ))}
    </div>
  );
}

/** Coloured status chip. tones: ok, warn, error, info, muted */
const TONE = {
  ok: 'bg-ok-container text-on-ok-container', warn: 'bg-warn-container text-on-warn-container',
  error: 'bg-error-container text-on-error-container', info: 'bg-surface-container-high text-secondary', muted: 'bg-surface-container text-on-surface-variant',
};
export function Chip({ tone = 'muted', children, className }) {
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-label-sm font-semibold', TONE[tone] || TONE.muted, className)}>{children}</span>;
}

/**
 * Searchable table. columns: [{key, label, render(row), right, className, sort(row)}]
 * filters: [{id, label, test(row)}]
 */
export function DataTable({ rows, columns, onRow, empty = 'Nothing here yet.', search, filters, actions, toolbar, rowKey = 'id', dense, initialFilter }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState(initialFilter || filters?.[0]?.id || null);
  const shown = useMemo(() => {
    let r = rows || [];
    if (filters && f) { const ft = filters.find((x) => x.id === f); if (ft?.test) r = r.filter(ft.test); }
    if (search && q.trim()) { const t = q.trim().toLowerCase(); r = r.filter((row) => search(row).toLowerCase().includes(t)); }
    return r;
  }, [rows, f, q, filters, search]);
  return (
    <Card className="overflow-hidden">
      {(search || filters || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-space-md py-space-sm">
          <div className="flex flex-wrap items-center gap-1">
            {filters?.map((ft) => (
              <button key={ft.id} type="button" onClick={() => setF(ft.id)}
                className={cx('rounded-lg px-3 py-1.5 text-label-md transition-colors', f === ft.id ? 'bg-primary text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-low')}>
                {ft.label}{rows && ft.test ? ` (${rows.filter(ft.test).length})` : rows && !ft.test ? ` (${rows.length})` : ''}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {toolbar}
            {search && (
              <div className="relative">
                <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-2.5 text-outline" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" aria-label="Search"
                  className="hm-search w-56 rounded-lg bg-surface-container-low py-2 pl-9 pr-3 text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-secondary" />
              </div>
            )}
          </div>
        </div>
      )}
      {rows === null ? <div className="py-12 text-center text-body-md text-on-surface-variant">Loading…</div> : shown.length === 0 ? (
        <div className="px-4 py-12 text-center text-body-md text-on-surface-variant">{q ? 'No matches.' : empty}</div>
      ) : (
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="h-10 bg-surface-container-low text-label-sm uppercase tracking-wider text-on-surface-variant">
                {columns.map((c) => <th key={c.key} className={cx('whitespace-nowrap px-space-md py-2 font-semibold', c.right && 'text-right')}>{c.label}</th>)}
                {actions && <th className="px-space-md" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-low">
              {shown.map((r) => (
                <tr key={r[rowKey]} onClick={onRow ? () => onRow(r) : undefined} className={cx(dense ? 'h-11' : 'h-14', 'transition-colors hover:bg-surface-container-low/60', onRow && 'cursor-pointer')}>
                  {columns.map((c) => (
                    <td key={c.key} className={cx('px-space-md py-2 text-body-md text-on-surface', c.right && 'text-right tabular-nums', c.className)}>
                      {c.render ? c.render(r) : r[c.key] ?? '—'}
                    </td>
                  ))}
                  {actions && <td className="whitespace-nowrap px-space-md py-2 text-right" onClick={(e) => e.stopPropagation()}>{actions(r)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------- forms ----------
/**
 * Field spec: { key, label, type, required, options, hint, half, placeholder, min, step, show(values) }
 * types: text, textarea, number, money, date, time, select, toggle, staff, room, roomType, image, email, tel, chips
 */
export function FormFields({ fields, value, onChange, errors = {} }) {
  const { rooms, roomTypes } = useData();
  const staff = useStaff();
  const set = (k, v) => onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.filter((f) => !f.show || f.show(value)).map((f) => {
        const v = value[f.key] ?? '';
        const id = `fld-${f.key}`;
        const wrap = (child) => <Field key={f.key} label={f.label} required={f.required} error={errors[f.key]} hint={f.hint} className={f.half ? '' : 'sm:col-span-2'}>{child}</Field>;
        // Groups of buttons must not sit inside a <label> (a click anywhere would press the first button).
        const group = (child) => (
          <div key={f.key} role="group" aria-label={f.label} className={f.half ? '' : 'sm:col-span-2'}>
            <span className="mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant">{f.label}</span>{child}
            {f.hint && <span className="mt-1 block text-label-sm text-on-surface-variant">{f.hint}</span>}
          </div>
        );
        switch (f.type) {
          case 'textarea': return wrap(<Textarea id={id} rows={f.rows || 2} value={v} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />);
          case 'number': case 'money':
            return wrap(<Input id={id} type="number" inputMode="decimal" min={f.min ?? 0} step={f.step ?? (f.type === 'money' ? '0.01' : '1')} value={v} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder || (f.type === 'money' ? currencySymbol().trim() : '')} invalid={!!errors[f.key]} />);
          case 'date': return wrap(<Input id={id} type="date" value={v} onChange={(e) => set(f.key, e.target.value)} invalid={!!errors[f.key]} />);
          case 'time': return wrap(<Input id={id} type="time" value={v} onChange={(e) => set(f.key, e.target.value)} />);
          case 'select':
            return wrap(
              <Select id={id} value={v} onChange={(e) => set(f.key, e.target.value)} invalid={!!errors[f.key]}>
                {f.placeholder !== false && <option value="">{f.placeholder || 'Choose…'}</option>}
                {(typeof f.options === 'function' ? f.options(value) : f.options).map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
              </Select>,
            );
          case 'staff':
            return wrap(
              <Select id={id} value={v} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">{f.placeholder || 'Not assigned'}</option>
                {staff.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>,
            );
          case 'room':
            return wrap(
              <Select id={id} value={v} onChange={(e) => set(f.key, e.target.value)} invalid={!!errors[f.key]}>
                <option value="">{f.placeholder || 'Choose room…'}</option>
                {rooms.map((r) => <option key={r.id} value={r.roomNumber}>{r.roomNumber} · {r.roomType}</option>)}
              </Select>,
            );
          case 'roomType':
            return wrap(
              <Select id={id} value={v} onChange={(e) => set(f.key, e.target.value)} invalid={!!errors[f.key]}>
                <option value="">Choose room type…</option>
                {roomTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
              </Select>,
            );
          case 'toggle': return <div key={f.key} className="sm:col-span-2"><Toggle label={f.label} description={f.hint} checked={!!value[f.key]} onChange={(x) => set(f.key, x)} /></div>;
          case 'chips':
            return group(
              <div className="flex flex-wrap gap-1.5">
                {f.options.map((o) => {
                  const on = (value[f.key] || []).includes(o);
                  return <button type="button" key={o} onClick={() => set(f.key, on ? value[f.key].filter((x) => x !== o) : [...(value[f.key] || []), o])}
                    className={cx('rounded-full px-3 py-1 text-label-md ring-1', on ? 'bg-primary-container text-on-primary ring-transparent' : 'text-on-surface-variant ring-outline-variant hover:bg-surface-container-low')}>{o}</button>;
                })}
              </div>,
            );
          case 'image': return group(<ImageField value={v} onChange={(x) => set(f.key, x)} />);
          default:
            return wrap(<Input id={id} type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : 'text'} value={v} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} invalid={!!errors[f.key]} autoFocus={f.autoFocus} className={f.upper ? 'uppercase' : ''} />);
        }
      })}
    </div>
  );
}
export function validate(fields, value) {
  const e = {};
  fields.filter((f) => !f.show || f.show(value)).forEach((f) => {
    const v = value[f.key];
    if (f.required && (v === undefined || v === null || String(v).trim() === '')) e[f.key] = `${f.label} is required.`;
    if ((f.type === 'number' || f.type === 'money') && v !== '' && v !== undefined && Number(v) < (f.min ?? 0)) e[f.key] = `${f.label} cannot be less than ${f.min ?? 0}.`;
    if (f.type === 'email' && v && !/^\S+@\S+\.\S+$/.test(v)) e[f.key] = 'Enter a valid email.';
    if (f.check) { const m = f.check(v, value); if (m) e[f.key] = m; }
  });
  return e;
}
/** Modal form that saves a record. */
export function RecordModal({ open, onClose, title, icon, fields, initial, collection, label, onSaved, transform, wide, saveLabel = 'Save', extra }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({});
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV({ ...(initial || {}) }); setErr({}); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    const e = validate(fields, v);
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const data = transform ? await transform(v) : v;
      const numbers = Object.fromEntries(fields.filter((f) => (f.type === 'number' || f.type === 'money') && (!f.show || f.show(v))).map((f) => [f.key, v[f.key] === '' || v[f.key] === undefined ? (f.blankNull ? null : 0) : Number(v[f.key])]));
      const id = await saveRecord(user, collection, initial?.id, { ...data, ...numbers, ...(transform ? {} : {}) }, label && `${label}_${initial?.id ? 'UPDATED' : 'CREATED'}`);
      toast(initial?.id ? 'Saved' : `${title.replace(/^(Add|New) /, '').replace(/^./, (c) => c.toUpperCase())} added`);
      onSaved?.(id, { ...data, ...numbers, id });
      onClose();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title={title} icon={icon} wide={wide}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{saveLabel}</Button></>}>
      <div className="pb-space-sm">
        <FormFields fields={fields} value={v} onChange={setV} errors={err} />
        {extra && extra(v, setV)}
      </div>
    </Modal>
  );
}

/** Image upload, resized to fit in a document (≤ ~180 KB). */
export function ImageField({ value, onChange, max = 900 }) {
  const ref = useRef();
  const toast = useToast();
  async function pick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try { onChange(await resizeImage(file, max)); } catch (err) { toast(errMsg(err), 'error'); }
  }
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-16 w-24 items-center justify-center overflow-hidden rounded-lg bg-surface-container-low ring-1 ring-outline-variant/50">
        {value ? <img src={value} alt="" className="h-full w-full object-cover" /> : <Icon name="photo_camera" size={22} className="text-outline" />}
      </div>
      <input ref={ref} type="file" accept="image/*" capture="environment" className="hidden" onChange={pick} />
      <Button type="button" size="sm" variant="secondary" icon="upload" onClick={() => ref.current.click()}>{value ? 'Replace' : 'Add photo'}</Button>
      {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange('')}>Remove</Button>}
    </div>
  );
}
export function resizeImage(file, max = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let q = quality; let out = c.toDataURL('image/jpeg', q);
      while (out.length > 180000 && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
      if (out.length > 240000) reject(new Error('That photo is too large. Try a smaller one.'));
      else resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

/** Search existing guests; returns the chosen guest. */
export function GuestSearch({ onPick, placeholder = 'Search guests by name or phone…', autoFocus }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!q.trim()) { setRows([]); return undefined; }
    const t = setTimeout(() => searchGuests(q, 8).then(setRows).catch(() => setRows([])), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-3 text-outline" />
      <Input className="pl-9" placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} autoFocus={autoFocus} />
      {open && rows.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg bg-surface-container-lowest shadow-lg ring-1 ring-outline-variant/40">
          {rows.map((g) => (
            <button key={g.id} type="button" onClick={() => { onPick(g); setOpen(false); setQ(''); }} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-surface-container-low">
              <span><span className="font-semibold text-on-surface">{g.name}</span>{g.vip && <Badge tone="blue">VIP</Badge>}{g.blacklisted && <Badge tone="red">Blacklisted</Badge>}</span>
              <span className="text-label-md text-on-surface-variant">{g.phone || g.email || ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Line editor (items with qty × rate and GST %). */
export function LinesEditor({ lines, onChange, itemOptions, itemLabel = 'Item', showGst = true }) {
  const set = (i, patch) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_80px_110px_80px_110px_32px] gap-2 px-1 text-label-sm uppercase tracking-wider text-on-surface-variant sm:grid">
        <span>{itemLabel}</span><span>Qty</span><span>Rate</span><span>{showGst ? 'GST %' : ''}</span><span className="text-right">Amount</span><span />
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_32px] gap-2 rounded-lg p-1 ring-1 ring-surface-container sm:grid-cols-[1fr_80px_110px_80px_110px_32px] sm:ring-0">
          {itemOptions ? (
            <Select value={l.itemId || ''} onChange={(e) => { const o = itemOptions.find((x) => x.id === e.target.value); set(i, { itemId: e.target.value, name: o?.name || '', rate: l.rate || o?.rate || '', gst: l.gst ?? o?.gst ?? 0, unit: o?.unit || '' }); }}>
              <option value="">Choose…</option>
              {itemOptions.map((o) => <option key={o.id} value={o.id}>{o.name}{o.unit ? ` (${o.unit})` : ''}</option>)}
            </Select>
          ) : <Input value={l.name || ''} placeholder="Description" onChange={(e) => set(i, { name: e.target.value })} />}
          <button type="button" onClick={() => onChange(lines.filter((_, j) => j !== i))} className="flex items-center justify-center rounded-lg text-on-surface-variant hover:bg-error-container hover:text-error sm:order-last" aria-label="Remove line"><Icon name="close" size={16} /></button>
          <div className="col-span-2 grid grid-cols-4 gap-2 sm:col-span-4 sm:contents">
            <Input type="number" min="0" step="any" value={l.qty ?? ''} onChange={(e) => set(i, { qty: e.target.value })} aria-label="Quantity" placeholder="Qty" />
            <Input type="number" min="0" step="0.01" value={l.rate ?? ''} onChange={(e) => set(i, { rate: e.target.value })} aria-label="Rate" placeholder="Rate" />
            {showGst ? <Input type="number" min="0" step="0.5" value={l.gst ?? ''} onChange={(e) => set(i, { gst: e.target.value })} aria-label="GST percent" placeholder="GST %" /> : <span />}
            <div className="flex h-10 items-center justify-end px-1 text-body-md tabular-nums">{money(lineTotals(l).total)}</div>
          </div>
        </div>
      ))}
      <Button type="button" size="sm" variant="secondary" icon="add" onClick={() => onChange([...lines, { qty: 1, rate: '', gst: showGst ? 0 : 0 }])}>Add line</Button>
    </div>
  );
}
export function lineTotals(l) {
  const base = round2(num(l.qty) * num(l.rate));
  const tax = round2((base * num(l.gst)) / 100);
  return { base, tax, total: round2(base + tax) };
}
export function linesTotals(lines = []) {
  return lines.reduce((a, l) => { const t = lineTotals(l); return { base: round2(a.base + t.base), tax: round2(a.tax + t.tax), total: round2(a.total + t.total) }; }, { base: 0, tax: 0, total: 0 });
}

export function Empty({ icon = 'inbox', title, children, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl bg-surface-container-lowest px-4 py-12 text-center shadow-sm">
      <Icon name={icon} size={36} className="mb-2 text-outline-variant" />
      <p className="text-label-lg font-semibold text-on-surface">{title}</p>
      {children && <div className="mt-1 max-w-md text-body-md text-on-surface-variant">{children}</div>}
      {action && <div className="mt-space-md">{action}</div>}
    </div>
  );
}

/** Panel with a title, used inside module pages. */
export function Panel({ title, icon, actions, children, className }) {
  return (
    <div className={cx('rounded-xl bg-surface-container-lowest shadow-sm', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-space-md pt-space-md">
          <div className="flex items-center gap-space-xs">{icon && <Icon name={icon} size={18} className="text-secondary" />}<h2 className="font-headline text-headline-sm text-on-surface">{title}</h2></div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="p-space-md">{children}</div>
    </div>
  );
}

/** Simple SVG bar/line chart. series: [{label, values:[], color}] labels: [] */
export function MiniChart({ labels, series, height = 180, type = 'bar', format = (v) => v }) {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const W = 600; const H = height; const pad = { l: 8, r: 8, t: 14, b: 24 };
  const iw = W - pad.l - pad.r; const ih = H - pad.t - pad.b;
  const n = labels.length || 1;
  const step = iw / n;
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[420px]" role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {[0.25, 0.5, 0.75, 1].map((g) => <line key={g} x1={pad.l} x2={W - pad.r} y1={pad.t + ih * (1 - g)} y2={pad.t + ih * (1 - g)} stroke="rgb(var(--c-outline-variant))" strokeOpacity="0.4" strokeDasharray="3 4" />)}
        {type === 'bar' && series.map((s, si) => s.values.map((v, i) => {
          const bw = (step * 0.7) / series.length;
          const x = pad.l + i * step + step * 0.15 + si * bw;
          const h = (v / max) * ih;
          return <rect key={`${si}-${i}`} x={x} y={pad.t + ih - h} width={Math.max(1, bw - 2)} height={h} rx="3" fill={s.color || 'rgb(var(--c-primary))'}><title>{`${labels[i]}: ${format(v)}`}</title></rect>;
        }))}
        {type === 'line' && series.map((s, si) => (
          <g key={si}>
            <polyline fill="none" stroke={s.color || 'rgb(var(--c-primary))'} strokeWidth="2.5" strokeLinejoin="round"
              points={s.values.map((v, i) => `${pad.l + i * step + step / 2},${pad.t + ih - (v / max) * ih}`).join(' ')} />
            {s.values.map((v, i) => <circle key={i} cx={pad.l + i * step + step / 2} cy={pad.t + ih - (v / max) * ih} r="3" fill={s.color || 'rgb(var(--c-primary))'}><title>{`${labels[i]}: ${format(v)}`}</title></circle>)}
          </g>
        ))}
        {labels.map((l, i) => (n <= 12 || i % Math.ceil(n / 12) === 0) && <text key={i} x={pad.l + i * step + step / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="rgb(var(--c-on-surface-variant))">{l}</text>)}
      </svg>
      {series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-3 text-label-md text-on-surface-variant">
          {series.map((s) => <span key={s.label} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color || 'rgb(var(--c-primary))' }} />{s.label}</span>)}
        </div>
      )}
    </div>
  );
}
