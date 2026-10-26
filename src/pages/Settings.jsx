import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoginFields, ResetPasswordModal, genPassword } from './AdminHome';
import MailStatus from '../components/MailStatus';
import SubscriptionCard from './SubscriptionCard';
import { GROUPS, MODULES } from '../modules/registry';
import { Plus, Pencil, Trash2, Upload, Download, KeyRound } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import {
  saveSettings, saveInvoiceSettings, getCounter, createTax, updateTax, deleteTax,
  listUsers, createAccount, updateAccount, usernameProblem, passwordProblem, recentMail, listAudit, exportBackup, restoreBackup,
  listGallery, addGalleryPhoto, updateGalleryCaption, deleteGalleryPhoto,
} from '../lib/db';
import { fmtDateTime } from '../lib/format';
import { formatInvoiceNumber } from '../lib/billing';
import { downloadText } from '../lib/csv';
import { today } from '../lib/dates';
import { HOSTED, DEMO } from '../platform';
import { PALETTES, DEFAULT_BRAND, resolveBrand, applyBrand, isHex, sameBrand, contrast } from '../lib/palettes';
import { Icon } from '../components/icons';
import { Badge, Button, IconButton, Card, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Td, Textarea, Toggle, useToast, useConfirm, errMsg } from '../components/ui';

const TABS = [
  { id: 'hotel', label: 'Hotel' }, { id: 'invoice', label: 'Invoice' }, { id: 'taxes', label: 'Taxes' },
  { id: 'modules', label: 'Modules' }, { id: 'users', label: 'Staff logins' }, { id: 'permissions', label: 'Permissions' }, { id: 'email', label: 'Guest emails' }, { id: 'audit', label: 'Audit Log' }, { id: 'backup', label: 'Backup' }, { id: 'welcome', label: 'Gallery' }, { id: 'plan', label: 'Subscription' },
];

export default function Settings() {
  const [tab, setTab] = useState('hotel');
  return (
    <div>
      <PageHeader crumbs={['Configuration', 'Settings']} title="Settings" subtitle="Hotel, invoice, tax and user configuration" />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'hotel' && <><HotelSettings /><BrandSettings /></>}
      {tab === 'invoice' && <InvoiceSettings />}
      {tab === 'taxes' && <TaxSettings />}
      {tab === 'modules' && <ModuleSettings />}
      {tab === 'users' && <StaffManagement />}
      {tab === 'email' && <EmailSettings />}
      {tab === 'permissions' && <Permissions />}
      {tab === 'audit' && <AuditLog />}
      {tab === 'backup' && <Backup />}
      {tab === 'welcome' && <WelcomeSettings />}
      {tab === 'plan' && <SubscriptionCard />}
    </div>
  );
}

function resizeImage(file, max = 240) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const png = c.toDataURL('image/png');
      resolve(png.length < 150000 ? png : c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = url;
  });
}

function HotelSettings() {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [f, setF] = useState(settings);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function onLogo(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = await resizeImage(file);
      if (data.length > 180000) return toast('Logo is too large after resizing. Use a simpler image.', 'error');
      setF({ ...f, logo: data });
    } catch (err) { toast(errMsg(err), 'error'); }
    e.target.value = '';
  }
  async function save() {
    if (!f.hotelName?.trim()) return toast('Hotel name is required', 'error');
    setBusy(true);
    try {
      const keys = ['hotelName', 'logo', 'address', 'city', 'state', 'country', 'phone', 'email', 'website', 'gstin'];
      await saveSettings(user, Object.fromEntries(keys.map((k) => [k, (f[k] || '').toString().trim()])), 'HOTEL_SETTINGS_UPDATED');
      toast('Hotel settings saved');
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-6 flex items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-dashed border-slate-300 bg-slate-50">
          {f.logo ? <img src={f.logo} alt="Logo" className="h-full w-full object-contain" /> : <span className="text-xs text-slate-400">No logo</span>}
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} />
          <Button variant="secondary" size="sm" onClick={() => fileRef.current.click()}><Upload className="h-4 w-4" />Upload logo</Button>
          {f.logo && <Button variant="ghost" size="sm" onClick={() => setF({ ...f, logo: '' })}>Remove</Button>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hotel name" required><Input value={f.hotelName || ''} onChange={set('hotelName')} /></Field>
        <Field label="GSTIN"><Input className="uppercase" value={f.gstin || ''} onChange={set('gstin')} /></Field>
        <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={f.address || ''} onChange={set('address')} /></Field>
        <Field label="City"><Input value={f.city || ''} onChange={set('city')} /></Field>
        <Field label="State"><Input value={f.state || ''} onChange={set('state')} /></Field>
        <Field label="Country"><Input value={f.country || ''} onChange={set('country')} /></Field>
        <Field label="Phone"><Input type="tel" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><Input type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Website"><Input value={f.website || ''} onChange={set('website')} /></Field>
      </div>
      <div className="mt-6 flex justify-end"><Button onClick={save} loading={busy}>Save hotel settings</Button></div>
    </Card>
  );
}

/** Brand colours: pick a hotel palette or enter your own colours. Preview is live. */
function BrandSettings() {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const saved = settings.brand && !(settings.brand.id === 'ocean' && !settings.brand.chosen) ? settings.brand : DEFAULT_BRAND;
  const [brand, setBrand] = useState(saved);
  const [custom, setCustom] = useState(() => {
    const r = resolveBrand(saved);
    return { primary: r.primary, accent: r.accent, background: r.background, night: r.night };
  });
  const [busy, setBusy] = useState(false);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  // Live preview while choosing; put the saved colours back when leaving.
  useEffect(() => { applyBrand(brand, { remember: false }); }, [brand]);
  useEffect(() => () => applyBrand(savedRef.current), []);

  const dirty = !sameBrand(brand, saved);
  const pickCustom = (next) => { setCustom(next); if (Object.values(next).every(isHex)) setBrand({ id: 'custom', ...next }); };
  const lowContrast = brand.id === 'custom' && isHex(custom.primary) && contrast(custom.primary, '#ffffff') < 3;

  async function save() {
    setBusy(true);
    try {
      await saveSettings(user, { brand: brand.id === 'custom' ? { id: 'custom', ...custom } : { id: brand.id, chosen: true } }, 'BRAND_COLOURS_UPDATED');
      applyBrand(brand);
      toast('Brand colours saved for everyone');
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }

  const options = [...PALETTES, { id: 'custom', name: 'Your hotel colours', tagline: 'Match your logo or signage', ...custom }];
  return (
    <Card className="mt-6 p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-headline text-headline-sm text-on-surface">Brand colours</h3>
          <p className="text-body-sm text-on-surface-variant">Used across the app, the night theme, invoices and the home page, for every user. Bill status colours stay the same.</p>
        </div>
        {dirty && <Badge tone="blue">Previewing, not saved yet</Badge>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" role="radiogroup" aria-label="Brand palette">
        {options.map((p) => {
          const on = brand.id === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on}
              onClick={() => (p.id === 'custom' ? pickCustom(custom) : setBrand({ id: p.id, chosen: true }))}
              className={`flex items-center gap-3 rounded-xl p-3 text-left ring-1 transition ${on ? 'bg-surface-container-low ring-2 ring-secondary' : 'ring-outline-variant/60 hover:bg-surface-container-low'}`}>
              <span className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/10" style={{ background: p.background }} aria-hidden="true">
                <span className="absolute inset-y-0 left-0 w-1/2" style={{ background: p.primary }} />
                <span className="absolute bottom-1 right-1 h-4 w-4 rounded-full" style={{ background: p.accent }} />
                <span className="absolute right-1 top-1 h-3 w-3 rounded-full" style={{ background: p.night }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-label-md font-semibold text-on-surface">{p.name}{p.id === 'ocean' && <span className="ml-1 font-normal text-on-surface-variant">· default</span>}</span>
                <span className="block text-label-sm text-on-surface-variant">{p.tagline}</span>
              </span>
              {on && <Icon name="check_circle" size={20} className="text-secondary" />}
            </button>
          );
        })}
      </div>
      {brand.id === 'custom' && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[['primary', 'Primary', 'Buttons, sidebar, headings'], ['accent', 'Accent', 'Links, highlights, glows'], ['background', 'Background', 'Light theme page colour'], ['night', 'Night background', 'Night theme sky']].map(([k, label, hint]) => (
            <Field key={k} label={label} hint={hint}>
              <div className="flex items-center gap-2">
                <input type="color" aria-label={`${label} colour picker`} value={isHex(custom[k]) ? custom[k] : '#000000'}
                  onChange={(e) => pickCustom({ ...custom, [k]: e.target.value })}
                  className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-outline-variant bg-transparent p-0.5" />
                <Input value={custom[k]} maxLength={7} className="font-mono uppercase"
                  onChange={(e) => { const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`; pickCustom({ ...custom, [k]: v }); }} />
              </div>
            </Field>
          ))}
          {lowContrast && <p className="text-label-sm text-error sm:col-span-2 lg:col-span-4">This primary colour is quite light, so white button text may be hard to read. A darker shade works better.</p>}
        </div>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {dirty && <Button variant="ghost" onClick={() => setBrand(saved)}>Undo preview</Button>}
        <Button onClick={save} loading={busy} disabled={!dirty}>Save brand colours</Button>
      </div>
    </Card>
  );
}

function InvoiceSettings() {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [f, setF] = useState({ invoicePrefix: settings.invoicePrefix, invoiceStartNumber: settings.invoiceStartNumber, currency: settings.currency, invoiceFooter: settings.invoiceFooter, monthlyGoal: settings.monthlyGoal || '' });
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getCounter().then(setNext).catch(() => {}); }, []);

  async function save() {
    const prefix = (f.invoicePrefix || '').trim().toUpperCase();
    const start = parseInt(f.invoiceStartNumber, 10);
    if (!/^[A-Z0-9][A-Z0-9/-]{0,9}$/.test(prefix)) return toast('Prefix: up to 10 letters or numbers, optionally ending with "-" or "/".', 'error');
    if (!(start > 0)) return toast('Starting number must be a positive whole number.', 'error');
    setBusy(true);
    try {
      const goal = Number(f.monthlyGoal) || 0;
      if (goal < 0) { setBusy(false); return toast('Monthly goal cannot be negative.', 'error'); }
      await saveInvoiceSettings(user, { invoicePrefix: prefix, invoiceStartNumber: start, currency: f.currency, invoiceFooter: (f.invoiceFooter || '').trim(), monthlyGoal: goal });
      setNext(await getCounter());
      toast('Invoice settings saved');
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  const preview = formatInvoiceNumber(f.invoicePrefix, Math.max(next || 0, parseInt(f.invoiceStartNumber, 10) || 0));

  return (
    <Card className="p-4 sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Invoice prefix" hint='e.g. "INV"'><Input className="uppercase" value={f.invoicePrefix} onChange={(e) => setF({ ...f, invoicePrefix: e.target.value })} /></Field>
        <Field label="Starting invoice number" hint="Numbers only ever move forward, so issued numbers are never reused.">
          <Input type="number" min="1" value={f.invoiceStartNumber} onChange={(e) => setF({ ...f, invoiceStartNumber: e.target.value })} />
        </Field>
        <Field label="Currency">
          <Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            {['INR', 'USD', 'EUR', 'GBP', 'AED', 'LKR', 'NPR'].map((c) => <option key={c}>{c}</option>)}
          </Select>
        </Field>
        <div className="flex flex-col justify-end">
          <div className="rounded-lg bg-slate-50 px-4 py-2.5 text-sm">Next invoice: <b className="font-mono">{preview}</b></div>
        </div>
        <Field label="Monthly revenue goal (optional)" hint="When this month's invoiced total reaches it, the dashboard celebrates with falling petals."><Input type="number" min="0" step="1000" value={f.monthlyGoal} onChange={(e) => setF({ ...f, monthlyGoal: e.target.value })} placeholder="e.g. 100000" /></Field>
        <Field label="Invoice footer" className="sm:col-span-2"><Textarea rows={2} value={f.invoiceFooter} onChange={(e) => setF({ ...f, invoiceFooter: e.target.value })} /></Field>
      </div>
      <div className="mt-6 flex justify-end"><Button onClick={save} loading={busy}>Save invoice settings</Button></div>
    </Card>
  );
}

function TaxSettings() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const { taxes } = useData();
  const toast = useToast();
  const [edit, setEdit] = useState(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const rate = Number(edit.rate);
    if (!edit.name?.trim()) return toast('Tax name is required', 'error');
    if (edit.rate === '' || isNaN(rate) || rate < 0 || rate > 100) return toast('Rate must be between 0 and 100', 'error');
    setBusy(true);
    try {
      const data = { name: edit.name.trim().toUpperCase(), rate, status: edit.status };
      if (edit.id) await updateTax(user, edit.id, data); else await createTax(user, data);
      toast('Tax saved');
      setEdit(null);
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  async function toggle(t) {
    try { await updateTax(user, t.id, { status: t.status === 'active' ? 'inactive' : 'active' }); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function remove(t) {
    if (!(await confirm(`Delete tax ${t.name}? Existing bills keep the tax they were saved with.`, { title: 'Delete tax', confirmLabel: 'Delete tax' }))) return;
    try { await deleteTax(user, t.id); toast('Tax deleted'); } catch (e) { toast(errMsg(e), 'error'); }
  }
  const totalRate = taxes.filter((t) => t.status === 'active').reduce((s, t) => s + t.rate, 0);

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">Active taxes are applied to the taxable amount (subtotal − discount). Combined active rate: <b className="text-slate-800">{totalRate}%</b></p>
        <Button size="sm" onClick={() => setEdit({ name: '', rate: '', status: 'active' })}><Plus className="h-4 w-4" />Add tax</Button>
      </div>
      <Table head={['Tax name', { label: 'Rate', right: true }, 'Status', '']}>
        {taxes.length === 0 ? <tr><Td colSpan={4} className="py-6 text-center text-slate-500">No taxes configured.</Td></tr> : taxes.map((t) => (
          <tr key={t.id}>
            <Td className="font-medium text-slate-900">{t.name}</Td>
            <Td right>{t.rate}%</Td>
            <Td><button onClick={() => toggle(t)}>{t.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</button></Td>
            <Td className="whitespace-nowrap text-right">
              <button onClick={() => setEdit(t)} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit"><Pencil className="h-4 w-4" /></button>
              <button onClick={() => remove(t)} className="rounded p-1.5 text-slate-400 hover:bg-error-container hover:text-error" aria-label="Delete"><Trash2 className="h-4 w-4" /></button>
            </Td>
          </tr>
        ))}
      </Table>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit tax' : 'Add tax'}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={busy}>Save tax</Button></>}>
        {edit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tax name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="CGST" autoFocus /></Field>
            <Field label="Rate (%)"><Input type="number" min="0" max="100" step="0.01" value={edit.rate} onChange={(e) => setEdit({ ...edit, rate: e.target.value })} placeholder="2.5" /></Field>
            <Field label="Status" className="col-span-2">
              <Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option></Select>
            </Field>
          </div>
        )}
      </Modal>
    </Card>
  );
}


/** Switch modules on or off for this hotel, and choose which ones employees can open. */
function ModuleSettings() {
  const { user, hotel } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const on = settings.modules || {};
  const staff = settings.staffAccess || {};
  const plan = hotel?.planModules || null;
  async function set(patch, msg) { try { await saveSettings(user, patch, 'MODULES_UPDATED'); toast(msg); } catch (e) { toast(errMsg(e), 'error'); } }
  return (
    <div className="space-y-space-md">
      <p className="text-body-md text-on-surface-variant">Turn off modules your hotel does not use, so the menu stays simple. Billing, bills, guests and reports are always on.{plan ? ' Modules not in your plan are greyed out; ask the StayBill administrator to change your plan.' : ''}</p>
      {GROUPS.map((g) => {
        const list = MODULES.filter((m) => m.group === g.id && !m.core);
        if (!list.length) return null;
        return (
          <Card key={g.id} className="p-4 sm:p-5">
            <h3 className="mb-2 flex items-center gap-2 font-headline text-headline-sm text-on-surface"><Icon name={g.icon} size={18} className="text-secondary" />{g.label}</h3>
            <div className="divide-y divide-surface-container">
              {list.map((m) => {
                const inPlan = !plan || plan.includes(m.id);
                const enabled = inPlan && on[m.id] !== false;
                const staffOk = staff[m.id] ?? !!m.staff;
                return (
                  <div key={m.id} className={`grid gap-2 py-2 sm:grid-cols-[1fr_auto_auto] sm:items-center ${inPlan ? '' : 'opacity-50'}`}>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-semibold text-on-surface"><Icon name={m.icon} size={16} />{m.label}{!inPlan && <Badge>Not in plan</Badge>}</div>
                      <div className="text-label-md text-on-surface-variant">{m.desc}</div>
                    </div>
                    <label className="flex items-center gap-2 text-label-md text-on-surface-variant">
                      <input type="checkbox" disabled={!enabled} checked={enabled && staffOk} onChange={(e) => set({ staffAccess: { ...staff, [m.id]: e.target.checked } }, `${m.label}: employees ${e.target.checked ? 'can' : 'cannot'} open it`)} />Employees
                    </label>
                    <button type="button" role="switch" aria-checked={enabled} aria-label={`${m.label} on or off`} disabled={!inPlan}
                      onClick={() => set({ modules: { ...on, [m.id]: !enabled } }, `${m.label} turned ${enabled ? 'off' : 'on'}`)}
                      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${enabled ? 'bg-primary' : 'bg-outline-variant'}`}>
                      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Staff logins for this hotel: the owner adds employees with a username and password. */
function StaffManagement() {
  const { user, isSiteAdmin, hotelId } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [rows, setRows] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(null);
  const load = () => listUsers(hotelId).then(setRows).catch((e) => { toast(errMsg(e), 'error'); setRows([]); });
  useEffect(() => { load(); }, [hotelId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    const e = {};
    if (!edit.name?.trim()) e.name = 'Enter their name.';
    if (!edit.id) {
      const u = usernameProblem(edit.username); if (u) e.username = u;
      const p = passwordProblem(edit.password); if (p) e.password = p;
    }
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (edit.id) {
        await updateAccount(user, edit, { name: edit.name.trim(), phone: edit.phone || '' });
        toast('Saved');
      } else {
        await createAccount(user, { name: edit.name.trim(), username: edit.username, password: edit.password, phone: edit.phone || '', role: edit.role || 'employee', hotelId });
        toast(`Login created for ${edit.name.trim()}: ${edit.username.trim().toLowerCase()}`);
      }
      setEdit(null); load();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }
  async function toggle(u) {
    const off = u.status === 'active';
    if (u.id === user.uid) return toast('You cannot switch off your own login.', 'error');
    if (off && !(await confirm(`Switch off ${u.name}'s login? They will be signed out and cannot sign in until you switch it back on. Their bills stay.`, { title: 'Switch off login', confirmLabel: 'Switch off' }))) return;
    try { await updateAccount(user, u, { status: off ? 'inactive' : 'active' }); toast(off ? `${u.name} switched off` : `${u.name} switched on`); load(); } catch (e) { toast(errMsg(e), 'error'); }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-body-md text-on-surface-variant">Each person signs in with their own username and password. Employees see only this hotel.</p>
        <Button size="sm" icon="person_add" onClick={() => { setErr({}); setEdit({ name: '', username: '', password: genPassword(), phone: '', role: 'employee' }); }}>Add employee</Button>
      </div>
      {!rows ? <Loading /> : (
        <Table head={['Name', 'Username', 'Role', 'Phone', 'Status', '']}>
          {rows.map((u) => (
            <tr key={u.id} className="h-14">
              <Td className="font-medium text-on-surface">{u.name}{u.id === user.uid && <span className="ml-1 text-label-sm font-normal text-on-surface-variant">(you)</span>}</Td>
              <Td className="font-mono">{u.username || '—'}</Td>
              <Td>{u.role === 'owner' ? <Badge tone="green">Owner</Badge> : <Badge>Employee</Badge>}</Td>
              <Td>{u.phone || '—'}</Td>
              <Td>{u.status === 'active' ? <Badge tone="green">Active</Badge> : <Badge>Switched off</Badge>}</Td>
              <Td className="whitespace-nowrap text-right">
                <IconButton icon="edit" title="Edit name and phone" onClick={() => { setErr({}); setEdit({ ...u }); }} />
                {u.id !== user.uid && (u.role === 'employee' || isSiteAdmin) && <IconButton icon="key" title="Set a new password" onClick={() => setReset(u)} />}
                {u.id !== user.uid && (u.role === 'employee' || isSiteAdmin) && <IconButton icon={u.status === 'active' ? 'block' : 'check_circle'} tone={u.status === 'active' ? 'danger' : 'default'} title={u.status === 'active' ? 'Switch off login' : 'Switch on login'} onClick={() => toggle(u)} />}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'Add employee'} icon="badge"
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} loading={busy}>{edit?.id ? 'Save' : 'Create login'}</Button></>}>
        {edit && (
          <div className="space-y-3 pb-space-sm">
            {!edit.id && isSiteAdmin && (
              <Field label="Role">
                <Select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                  <option value="employee">Employee (front desk)</option>
                  <option value="owner">Hotel owner</option>
                </Select>
              </Field>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name" required error={err.name}><Input id="staff-name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus invalid={!!err.name} /></Field>
              <Field label="Phone"><Input id="staff-phone" type="tel" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            </div>
            {!edit.id && <LoginFields f={edit} setF={setEdit} err={err} />}
            {edit.id && <p className="text-label-md text-on-surface-variant">Username <b className="font-mono">{edit.username}</b> cannot be changed. Use the key button to set a new password.</p>}
          </div>
        )}
      </Modal>
      <ResetPasswordModal target={reset} onClose={() => setReset(null)} />
    </Card>
  );
}

/** Automatic guest emails (sent by the StayBill Cloud Function through Gmail). */
function EmailSettings() {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [log, setLog] = useState(null);
  useEffect(() => { recentMail(30).then(setLog).catch(() => setLog([])); }, []);
  async function set(k, v) {
    try { await saveSettings(user, { [k]: v }, 'EMAIL_SETTINGS_UPDATED'); toast('Saved'); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <div className="space-y-space-md">
      <Card className="divide-y divide-surface-container px-4 sm:px-6">
        <p className="py-3 text-body-md text-on-surface-variant">StayBill emails the guest from your hotel's Gmail account when a bill is created and when it is paid in full (with the invoice PDF attached). The guest's email must be on the bill.</p>
        <Toggle label="Email guests automatically" description="Turn off to stop all automatic guest emails for this hotel." checked={settings.emailGuests !== false} onChange={(v) => set('emailGuests', v)} />
        <Toggle label="When a bill is created" description="Booking confirmation: room, dates, nights and amount due." checked={settings.emailOnCreate !== false} onChange={(v) => set('emailOnCreate', v)} />
        <Toggle label="When a bill is paid in full" description="Thank-you email with the invoice PDF attached." checked={settings.emailOnPaid !== false} onChange={(v) => set('emailOnPaid', v)} />
        <div className="py-3 text-label-md text-on-surface-variant">Replies go to the hotel email in <b>Settings → Hotel</b>{settings.email ? ` (${settings.email})` : ' (not set yet)'}.</div>
      </Card>
      {HOSTED && (
        <div className="flex items-start gap-2 rounded-xl bg-warn-container px-space-md py-3 text-body-md text-on-warn-container">
          <Icon name="info" size={18} />
          <span>This copy of StayBill runs without a mail server, so emails are listed below as <b>Waiting</b> and are not sent. They send automatically in the Firebase version once the email function is deployed (README → Guest emails).</span>
        </div>
      )}
      <Card>
        <CardTitle>Recent guest emails</CardTitle>
        {!log ? <Loading /> : log.length === 0 ? <p className="px-4 pb-4 text-body-md text-on-surface-variant">No guest emails yet.</p> : (
          <Table head={['When', 'Bill', 'Email', 'To', 'Status']}>
            {log.map((m) => (
              <tr key={m.id} className="h-12">
                <Td className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</Td>
                <Td><Link to={`/bills/${m.billId}`} className="text-secondary hover:underline">{m.invoiceNumber || 'Open bill'}</Link></Td>
                <Td>{m.kind === 'paid' ? 'Paid in full + PDF' : 'Booking confirmation'}{m.manual ? ' (resent)' : ''}</Td>
                <Td className="max-w-[220px] truncate">{m.to || '—'}</Td>
                <Td><MailStatus m={m} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
const CardTitle = ({ children }) => <h3 className="px-4 pb-2 pt-4 font-headline text-headline-sm text-on-surface">{children}</h3>;

function Permissions() {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const p = settings.permissions;
  async function set(k, v) {
    try { await saveSettings(user, { permissions: { ...p, [k]: v } }, 'PERMISSIONS_UPDATED'); toast('Permission updated'); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Card className="divide-y divide-slate-100 px-4 sm:px-6">
      <p className="py-3 text-sm text-slate-500">Employees cannot change hotel settings or staff logins. Allow them these extra actions if needed:</p>
      <Toggle label="Edit bills" description="Change charges, dates or discounts on non-cancelled bills." checked={p.receptionistCanEditBills} onChange={(v) => set('receptionistCanEditBills', v)} />
      <Toggle label="Cancel bills" description="Mark bills as cancelled (reason is always recorded)." checked={p.receptionistCanCancelBills} onChange={(v) => set('receptionistCanCancelBills', v)} />
      <Toggle label="View reports" description="See sales, payment and bill reports." checked={p.receptionistCanViewReports} onChange={(v) => set('receptionistCanViewReports', v)} />
      <Toggle label="Manage rooms" description="Add rooms and change room rates." checked={p.receptionistCanManageRooms} onChange={(v) => set('receptionistCanManageRooms', v)} />
    </Card>
  );
}

const pretty = (a) => a.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
function AuditLog() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [filter, setFilter] = useState('');
  useEffect(() => { listAudit({ max: 300 }).then(setRows).catch((e) => { toast(errMsg(e), 'error'); setRows([]); }); }, [toast]);
  const shown = (rows || []).filter((r) => !filter || r.action === filter);
  const actions = [...new Set((rows || []).map((r) => r.action))].sort();
  const detail = (d = {}) => Object.entries(d).filter(([, v]) => v !== '' && v !== null && typeof v !== 'object').map(([k, v]) => `${k}: ${v}`).join(' · ');
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <p className="text-sm text-slate-500">Latest 300 recorded actions. Entries cannot be edited or deleted.</p>
        <Select className="h-9 w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{pretty(a)}</option>)}
        </Select>
      </div>
      {!rows ? <Loading /> : (
        <Table head={['When', 'User', 'Action', 'Details']}>
          {shown.map((r) => (
            <tr key={r.id}>
              <Td className="whitespace-nowrap text-xs">{fmtDateTime(r.createdAt)}</Td>
              <Td>{r.user?.name}</Td>
              <Td className="whitespace-nowrap font-medium">{pretty(r.action)}</Td>
              <Td className="max-w-md truncate text-xs text-slate-500" title={detail(r.details)}>{detail(r.details)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function Backup() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const fileRef = useRef();
  async function onExport() {
    setBusy('export');
    try {
      const data = await exportBackup(user);
      downloadText(JSON.stringify(data), `staybill-backup-${today()}.json`, 'application/json');
      toast('Backup downloaded');
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy('');
  }
  async function onRestore(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!(await confirm('Restore this backup? Records in the backup will overwrite the current records with the same IDs. Records not in the backup are kept.', { title: 'Restore backup', confirmLabel: 'Restore' }))) return;
    setBusy('restore');
    try {
      const counts = await restoreBackup(user, JSON.parse(await file.text()));
      toast(`Restored ${Object.values(counts).reduce((a, b) => a + b, 0)} records`);
    } catch (err) { toast(errMsg(err), 'error'); }
    setBusy('');
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-5">
        <h3 className="font-semibold">Download backup</h3>
        <p className="mt-1 text-sm text-slate-500">Exports all bills, payments, guests, rooms, settings and the audit log as a single JSON file. Keep it somewhere safe; download one regularly (e.g. weekly).</p>
        <Button className="mt-4" onClick={onExport} loading={busy === 'export'}><Download className="h-4 w-4" />Download backup</Button>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold">Restore from backup</h3>
        <p className="mt-1 text-sm text-slate-500">Writes the records from a StayBill backup file back into the database. The audit log is append-only and is not overwritten.</p>
        <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={onRestore} />
        <Button variant="secondary" className="mt-4" onClick={() => fileRef.current.click()} loading={busy === 'restore'}><Upload className="h-4 w-4" />Restore backup…</Button>
      </Card>
      <Card className="p-5 text-sm text-slate-600 md:col-span-2">
        <b className="text-slate-800">Automatic backups:</b> Firestore also supports scheduled, managed backups from the Google Cloud console (Firestore → Disaster recovery → Backups), which the README explains how to turn on. Billing writes use Firestore transactions, so a bill, its invoice number and its payments are always saved together or not at all.
      </Card>
    </div>
  );
}

function resizePhoto(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let q = 0.82;
      let size = max;
      let out = '';
      // Shrink until it fits comfortably in one database document.
      for (let i = 0; i < 6; i += 1) {
        const scale = Math.min(1, size / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL('image/jpeg', q);
        if (out.length < 200000) break;
        size = Math.round(size * 0.8);
        q = Math.max(0.6, q - 0.06);
      }
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => reject(new Error('Could not read that image.'));
    img.src = url;
  });
}

function WelcomeSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [photos, setPhotos] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const load = () => listGallery().then(setPhotos).catch((e) => { toast(errMsg(e), 'error'); setPhotos([]); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function onFiles(e) {
    const files = [...(e.target.files || [])].slice(0, Math.max(0, 12 - (photos?.length || 0)));
    e.target.value = '';
    if (!files.length) { toast('The gallery holds up to 12 photos.', 'error'); return; }
    setBusy(true);
    try {
      let order = (photos || []).reduce((m, p) => Math.max(m, p.order ?? 0), 0);
      for (const f of files) {
        // eslint-disable-next-line no-await-in-loop
        const image = await resizePhoto(f);
        order += 1;
        // eslint-disable-next-line no-await-in-loop
        await addGalleryPhoto(user, { image, caption: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), order });
      }
      toast(`${files.length} photo${files.length === 1 ? '' : 's'} added`);
      await load();
    } catch (err) { toast(errMsg(err), 'error'); }
    setBusy(false);
  }
  async function remove(p) {
    if (!(await confirm(`Remove "${p.caption || 'this photo'}" from the gallery?`, { title: 'Remove photo', confirmLabel: 'Remove' }))) return;
    try { await deleteGalleryPhoto(user, p.id); toast('Photo removed'); load(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function saveCaption(p, caption) {
    if ((p.caption || '') === caption.trim()) return;
    try { await updateGalleryCaption(user, p.id, caption); toast('Caption saved'); } catch (e) { toast(errMsg(e), 'error'); }
  }

  return (
    <div className="grid items-start gap-space-md lg:grid-cols-[1fr_320px]">
      <Card className="p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-headline text-headline-sm text-on-surface">Photo gallery</h3>
            <p className="text-body-md text-on-surface-variant">Photos of your hotel for the gallery on the home page. Up to 12; the first 8 are shown.</p>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" multiple className="hidden" onChange={onFiles} />
          <Button icon="add_photo_alternate" loading={busy} onClick={() => fileRef.current.click()} disabled={(photos?.length || 0) >= 12}>Add photos</Button>
        </div>
        {!photos ? <Loading /> : photos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-outline-variant p-8 text-center text-body-md text-on-surface-variant">
            No photos yet. The home page gallery shows illustrated placeholders until you add some.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p) => (
              <div key={p.id} className="overflow-hidden rounded-xl bg-surface-container-low">
                <div className="relative aspect-[4/3]">
                  <img src={p.image} alt={p.caption || 'Hotel photo'} className="h-full w-full object-cover" />
                  <button type="button" onClick={() => remove(p)} aria-label="Remove photo"
                    className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-error"><Trash2 className="h-4 w-4" /></button>
                </div>
                <input defaultValue={p.caption || ''} onBlur={(e) => saveCaption(p, e.target.value)} placeholder="Caption"
                  className="w-full bg-transparent px-3 py-2 text-label-md text-on-surface focus:outline-none" aria-label="Photo caption" />
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card className="space-y-2 p-space-md text-body-md text-on-surface-variant">
        <h3 className="font-headline text-headline-sm text-on-surface">Where these photos appear</h3>
        <p>The gallery is part of the home page, below the live front desk, alongside the night-city hero, features and how a bill is made.</p>
        <p>Staff can choose the theme and animation level for their device from the <b>Appearance</b> menu (palette icon in the top bar).</p>
        <Link to="/" className="inline-flex items-center gap-1 font-medium text-secondary hover:underline">Open the home page<Icon name="arrow_forward" size={14} /></Link>
      </Card>
    </div>
  );
}
