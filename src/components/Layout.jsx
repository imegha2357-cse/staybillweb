// App shell: one see-through menu bar across the top (no sidebar), so every
// page reads as part of one continuous website. The menu adapts to the role:
// administrator console, hotel owner, or front-desk employee.
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { changeOwnPassword } from '../lib/db';
import { Icon } from './icons';
import { Button, Field, Input, Modal, cx, useToast, errMsg } from './ui';
import { IN_CLAUDE, DEMO } from '../platform';
import { useAppearance } from '../context/AppearanceContext';
import { PageTransition, CursorGlow, Starfield, PauseMotionButton } from '../motion';
import AppearanceMenu from './AppearanceMenu';
import { AlertBell, ElevatorDoors, ripple } from '../motion/hotel';
import { GROUPS, MODULES } from '../modules/registry';

export function initials(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

export function Logo({ name, logo, subtitle = 'Billing & Payments' }) {
  return (
    <div className="flex min-w-0 items-center gap-space-sm">
      {logo ? (
        <img src={logo} alt="" className="h-8 w-8 shrink-0 rounded-lg object-contain" />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary"><Icon name="receipt_long" size={18} /></div>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[120px] truncate font-headline 2xl:max-w-[170px] text-headline-sm leading-tight tracking-tight text-on-surface">{name || 'StayBill'}</span>
        <span className="truncate text-label-sm uppercase tracking-wider text-on-surface-variant">{subtitle}</span>
      </div>
    </div>
  );
}

const ROLE_LABEL = { admin: 'Administrator', owner: 'Hotel owner', employee: 'Front desk' };

function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const up = () => setOn(true);
    const down = () => setOn(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

function ChangePasswordModal({ open, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (open) { setF({ current: '', next: '', confirm: '' }); setErr(''); } }, [open]);
  async function save() {
    if (f.next !== f.confirm) return setErr('The new passwords do not match.');
    setBusy(true); setErr('');
    try { await changeOwnPassword(f.current, f.next); toast('Your password has been changed'); onClose(); } catch (e) { setErr(errMsg(e)); }
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title="Change my password" icon="key"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Change password</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <Field label="Current password"><Input id="pw-current" type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoFocus /></Field>
        <Field label="New password" hint="At least 6 characters."><Input id="pw-new" type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="Confirm new password"><Input id="pw-confirm" type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
        {err && <p className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">{err}</p>}
      </div>
    </Modal>
  );
}

function AccountMenu({ onPassword }) {
  const { user, logout, hotel, isSiteAdmin, hotelId, setAdminHotel } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-label-lg text-on-surface hover:bg-surface-container-low';
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Account menu"
        className="flex items-center gap-space-sm rounded-full p-0.5 pr-1 transition-colors hover:bg-surface-container-low sm:pr-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-container text-label-md font-semibold text-on-primary">{initials(user.name)}</span>
        <span className="hidden flex-col text-left 2xl:flex">
          <span className="max-w-[140px] truncate text-label-lg leading-snug text-on-surface">{user.name}</span>
          <span className="text-label-sm leading-none text-on-surface-variant">{ROLE_LABEL[user.role]}</span>
        </span>
        <Icon name="expand_more" size={16} className="hidden text-on-surface-variant 2xl:inline" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}
            className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl bg-surface-container-lowest p-space-sm shadow-xl ring-1 ring-outline-variant/30">
            <div className="px-3 pb-2 pt-1">
              <div className="truncate font-headline text-headline-sm text-on-surface">{user.name}</div>
              <div className="font-mono text-label-sm text-on-surface-variant">{user.username}</div>
              <div className="mt-1 text-label-sm text-secondary">{ROLE_LABEL[user.role]}{hotel?.name && !isSiteAdmin ? ` · ${hotel.name}` : ''}</div>
            </div>
            <div className="border-t border-surface-container pt-1">
              {isSiteAdmin && hotelId && <button type="button" className={item} onClick={() => { setOpen(false); setAdminHotel(null); nav('/'); }}><Icon name="domain" size={16} />Back to all hotels</button>}
              <button type="button" className={item} onClick={() => { setOpen(false); onPassword(); }}><Icon name="key" size={16} />Change my password</button>
              <button type="button" className={item} onClick={() => { setOpen(false); logout(); }}><Icon name="logout" size={16} />Sign out</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


/** One menu-bar entry: a direct link, or a group that opens a dropdown of modules. */
function NavGroup({ group, items, loc, active, mobile, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const timer = useRef();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  if (mobile) {
    return (
      <div className="py-1">
        <div className="flex items-center gap-1.5 px-2 pb-1 text-label-sm uppercase tracking-wider text-on-surface-variant"><Icon name={group.icon} size={14} />{group.label}</div>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {items.map((it) => (
            <NavLink key={it.id} to={it.path} end={it.end} onClick={onPick}
              className={({ isActive }) => cx('flex items-center gap-2 rounded-lg px-2.5 py-2 text-label-lg', (it.match ? it.match(loc.pathname) : isActive) ? 'bg-primary-container text-on-primary' : 'text-on-surface hover:bg-surface-container-low')}>
              <Icon name={it.icon} size={17} /><span className="truncate">{it.label}</span>
            </NavLink>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="relative" ref={ref} onMouseEnter={() => { clearTimeout(timer.current); setOpen(true); }} onMouseLeave={() => { timer.current = setTimeout(() => setOpen(false), 160); }}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="true"
        className={cx('flex items-center gap-0.5 whitespace-nowrap rounded-full px-2 py-1.5 text-label-lg transition-colors 2xl:px-2.5',
          active ? 'bg-primary-container text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface')}>
        <Icon name={group.icon} size={17} className="hidden 2xl:inline" /><span>{group.label}</span><Icon name="expand_more" size={15} className={cx('transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}
            className="absolute left-1/2 top-full z-50 mt-2 w-[min(560px,92vw)] -translate-x-1/2 rounded-2xl bg-surface-container-lowest p-space-sm shadow-xl ring-1 ring-outline-variant/30">
            <div className="grid gap-1 sm:grid-cols-2">
              {items.map((it) => (
                <NavLink key={it.id} to={it.path} end={it.end}
                  className={({ isActive }) => cx('flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors', (it.match ? it.match(loc.pathname) : isActive) ? 'bg-surface-container-low' : 'hover:bg-surface-container-low')}>
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-container text-on-primary"><Icon name={it.icon} size={17} /></span>
                  <span className="min-w-0">
                    <span className="block text-label-lg font-semibold text-on-surface">{it.label}</span>
                    {it.desc && <span className="line-clamp-2 block text-label-sm text-on-surface-variant">{it.desc}</span>}
                  </span>
                </NavLink>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function Layout() {
  const { user, isSiteAdmin, hotelId, hotel, setAdminHotel } = useAuth();
  const { settings, can, outstanding, mods } = useData();
  const [menu, setMenu] = useState(false);
  const [pw, setPw] = useState(false);
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  const online = useOnline();
  const { theme, transition } = useAppearance();
  const inHotel = !!hotelId;
  const adminConsole = isSiteAdmin && !inHotel;

  useEffect(() => { setMenu(false); }, [loc.pathname]);

  const BILLS_MATCH = (p) => p === '/bills' || (/^\/bills\/(?!new)/.test(p)) || p === '/payments' || p === '/print';
  const groups = adminConsole ? [] : GROUPS.map((g) => ({
    group: g,
    items: MODULES.filter((m) => m.group === g.id && mods[m.id]).map((m) => (m.id === 'bills' ? { ...m, match: BILLS_MATCH } : m)),
  })).filter((g) => g.items.length);
  const items = adminConsole ? [
    { to: '/', label: 'Hotels', icon: 'domain', end: true },
    { to: '/people', label: 'Logins', icon: 'group' },
    { to: '/plans', label: 'Plans & billing', icon: 'workspace_premium' },
  ] : [
    { to: '/', label: 'Home', icon: 'cottage', end: true },
  ];
  const tail = [];
  const showSettings = !adminConsole && can.settings;
  const groupActive = (g) => g.items.some((it) => (it.match ? it.match(loc.pathname) : it.end ? loc.pathname === it.path : loc.pathname === it.path || loc.pathname.startsWith(`${it.path}/`)));

  function onSearch(e) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    nav(`/bills?q=${encodeURIComponent(t)}`);
    setQ('');
  }
  const linkCls = (it, isActive) => cx('relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-label-lg transition-colors',
    (it.match ? it.match(loc.pathname) : isActive) ? 'bg-primary-container text-on-primary shadow-sm' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface');

  return (
    <div className="relative isolate min-h-screen bg-surface">
      {theme === 'dark' && <Starfield className="no-print fixed inset-0 -z-10 h-full w-full opacity-70" density={0.6} />}
      <CursorGlow />

      <header className="no-print fixed inset-x-0 top-0 z-40 bg-surface-container-lowest/85 shadow-[0_1px_8px_rgba(0,0,0,0.05)] backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-space-sm px-gutter lg:px-gutter-desktop">
          <Link to="/" className="mr-1 shrink-0" aria-label="Home">
            <Logo name={adminConsole ? 'StayBill' : settings.hotelName} logo={adminConsole ? '' : settings.logo} subtitle={adminConsole ? 'Administrator' : ROLE_LABEL[user.role]} />
          </Link>
          <nav aria-label="Main" className="mx-auto hidden min-w-0 items-center gap-0.5 lg:flex">
            {items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => linkCls(it, isActive)}>
                <Icon name={it.icon} size={17} className={adminConsole ? '' : 'hidden 2xl:inline'} /><span>{it.label}</span>
              </NavLink>
            ))}
            {groups.map((g) => <NavGroup key={g.group.id} group={g.group} items={g.items} loc={loc} active={groupActive(g)} />)}
            {tail.map((it) => (
              <NavLink key={it.to} to={it.to} className={({ isActive }) => linkCls(it, isActive)}>
                <Icon name={it.icon} size={17} className="hidden 2xl:inline" /><span>{it.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-space-sm lg:ml-0">
            {inHotel && (
              <form onSubmit={onSearch} className="relative hidden items-center 2xl:flex">
                <Icon name="search" size={16} className="pointer-events-none absolute left-3 text-outline" />
                <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search bills" placeholder="Search bills, rooms, guests…"
                  className="hm-search w-56 rounded-full bg-surface-container-low py-1.5 pl-9 pr-3 text-body-sm text-on-surface placeholder:text-on-surface-variant focus:bg-surface-container-lowest focus:outline-none focus:ring-1 focus:ring-secondary" />
              </form>
            )}
            {inHotel && (
              <Link to="/bills/new" onPointerDown={ripple} className="relative isolate hidden items-center gap-space-xs overflow-hidden rounded-full bg-primary px-space-md py-1.5 text-label-lg text-on-primary shadow-sm transition-colors hover:bg-primary-container sm:inline-flex lg:hidden 2xl:inline-flex">
                <Icon name="add" size={16} />New Bill
              </Link>
            )}
            {showSettings && <NavLink to="/settings" title="Settings" aria-label="Settings" className={({ isActive }) => cx('hidden rounded-lg p-space-sm transition-colors sm:block', isActive ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface')}><Icon name="settings" size={20} /></NavLink>}
            <AppearanceMenu />
            {inHotel && <AlertBell bills={outstanding} />}
            <AccountMenu onPassword={() => setPw(true)} />
            <button type="button" onClick={() => setMenu(!menu)} className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-low lg:hidden" aria-expanded={menu} aria-label="Open menu">
              <Icon name={menu ? 'close' : 'menu'} size={22} />
            </button>
          </div>
        </div>
        <AnimatePresence>
          {menu && (
            <motion.nav aria-label="Main" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}
              className="overflow-hidden border-t border-surface-container lg:hidden">
              <div className="max-h-[calc(100dvh-140px)] overflow-y-auto p-space-sm">
                <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                  {[...items, ...(showSettings ? [{ to: '/settings', label: 'Settings', icon: 'settings' }] : [])].map((it) => (
                    <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => cx(linkCls(it, isActive), 'justify-start rounded-lg py-2.5')}>
                      <Icon name={it.icon} size={18} /><span>{it.label}</span>
                    </NavLink>
                  ))}
                </div>
                {groups.map((g) => <NavGroup key={g.group.id} mobile group={g.group} items={g.items} loc={loc} onPick={() => setMenu(false)} />)}
              </div>
              {inHotel && (
                <form onSubmit={onSearch} className="relative mx-space-sm mb-space-sm flex items-center">
                  <Icon name="search" size={16} className="pointer-events-none absolute left-3 text-outline" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search bills" placeholder="Search bills, rooms, guests…"
                    className="w-full rounded-lg bg-surface-container-low py-2 pl-9 pr-3 text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-secondary" />
                </form>
              )}
            </motion.nav>
          )}
        </AnimatePresence>
      </header>

      <div className="relative flex min-h-screen flex-col">
        <main className="mx-auto w-full max-w-[1600px] flex-1 bg-surface px-gutter pb-space-lg pt-[5.25rem] lg:px-gutter-desktop">
          {isSiteAdmin && inHotel && (
            <div className="no-print mb-space-md flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary-container px-space-md py-2 text-label-md text-on-primary">
              <span className="flex items-center gap-2"><Icon name="admin_panel_settings" size={16} />You are viewing <b>{hotel?.name || settings.hotelName}</b> as the administrator, with the owner's dashboard.</span>
              <button type="button" onClick={() => { setAdminHotel(null); nav('/'); }} className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 font-semibold hover:bg-white/25"><Icon name="arrow_back" size={14} />All hotels</button>
            </div>
          )}
          {DEMO && (
            <div className="no-print mb-space-md flex flex-wrap items-center gap-2 rounded-xl bg-surface-container-high px-space-md py-2 text-label-md text-on-secondary-container">
              <Icon name="info" size={16} />
              <span><b>Demo mode:</b> data is saved in this browser only. Add your Firebase settings to share it across computers and send guest emails.</span>
            </div>
          )}
          <PageTransition id={loc.pathname}><Outlet /></PageTransition>
          {transition === 'elevator' && <ElevatorDoors path={loc.pathname} />}
        </main>

        <footer className="no-print w-full bg-surface-container-lowest px-gutter py-space-xs shadow-[0_-1px_6px_rgba(0,0,0,0.03)] lg:px-gutter-desktop">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-space-md gap-y-1 text-label-sm text-on-surface-variant">
            <div className="flex flex-wrap items-center gap-x-space-md gap-y-1">
              <span className="flex items-center gap-space-xs">
                <span className={cx('h-2 w-2 rounded-full', online ? 'animate-pulse bg-secondary' : 'bg-error')} />
                {online ? 'System Online' : 'Offline — changes will sync when reconnected'}
              </span>
              <span className="text-outline-variant">•</span>
              <span>Signed in: {user.name} ({ROLE_LABEL[user.role]})</span>
              {inHotel && settings.gstin && <><span className="text-outline-variant">•</span><span className="font-medium text-secondary">GSTIN: {settings.gstin}</span></>}
            </div>
            <span className="flex items-center gap-x-space-md"><PauseMotionButton inline /><span>{IN_CLAUDE ? 'Hosted on claude.ai' : DEMO ? 'Demo mode · data saved in this browser' : 'Firebase'}{inHotel ? ` · ${settings.currency}` : ''}</span></span>
          </div>
        </footer>
      </div>
      <ChangePasswordModal open={pw} onClose={() => setPw(false)} />
    </div>
  );
}
