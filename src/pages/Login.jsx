// Sign-in (username + password) and first-time setup of the site administrator.
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { bootstrapAdmin, importLegacyHotel, legacyHotelName, usernameProblem, passwordProblem } from '../lib/db';
import { Icon } from '../components/icons';
import { Button, Field, Input, errMsg } from '../components/ui';
import { Logo } from '../components/Layout';
import { KeyCardTap, PoolLight } from '../motion/hotel';

/** Sign-in header: pool light with the key card tapping in (motion picks 01 + 33). */
function ArrivalBand({ note = 'FRONT DESK OPEN' }) {
  return (
    <div className="relative mb-space-md flex h-44 items-center justify-center overflow-hidden rounded-xl text-white shadow-sm" style={{ background: 'rgb(var(--c-w-bg2))' }}>
      <PoolLight />
      <div className="relative -ml-16 scale-90"><KeyCardTap room="STAFF" title="Welcome" note={note} /></div>
    </div>
  );
}

function Shell({ children, wide, note }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className={`w-full ${wide ? 'max-w-md' : 'max-w-sm'}`}>
        <div className="mb-4 flex justify-center"><Logo name="StayBill" subtitle="Hotel Billing" /></div>
        <ArrivalBand note={note} />
        <div className="rounded-xl bg-surface-container-lowest p-space-lg shadow-[0_1px_8px_rgba(0,0,0,0.06)]">{children}</div>
      </div>
    </div>
  );
}

export default function Login({ onBack }) {
  const { login, error, setError } = useAuth();
  const [form, setForm] = useState({ username: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);

  async function onLogin(e) {
    e.preventDefault();
    if (!form.username.trim() || !form.password) return setError('Enter your username and password.');
    setBusy(true);
    try { await login(form.username, form.password); } catch (err) { setError(errMsg(err).replace('email or password', 'username or password')); }
    setBusy(false);
  }

  return (
    <Shell>
      <form onSubmit={onLogin} className="space-y-4">
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Sign in</h1>
          <p className="text-body-md text-on-surface-variant">Administrator, hotel owner or front-desk staff: use the username and password you were given.</p>
        </div>
        <Field label="Username"><Input id="login-username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoFocus /></Field>
        <Field label="Password">
          <div className="relative">
            <Input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password" className="pr-10" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-on-surface-variant hover:text-on-surface" aria-label={show ? 'Hide password' : 'Show password'}>
              <Icon name={show ? 'visibility_off' : 'visibility'} size={16} />
            </button>
          </div>
        </Field>
        {error && <p className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">{error}</p>}
        <Button type="submit" className="h-10 w-full" loading={busy} icon="login">Sign in</Button>
        <div className="flex items-center justify-between text-label-md">
          <button type="button" onClick={() => setHelp(!help)} className="text-secondary hover:underline">Forgot password?</button>
          {onBack && <button type="button" onClick={onBack} className="flex items-center gap-1 text-on-surface-variant hover:text-on-surface"><Icon name="arrow_back" size={14} />Back to home</button>}
        </div>
        {help && (
          <p className="rounded-lg bg-surface-container-low px-3 py-2 text-label-md text-on-surface-variant">
            Front-desk staff: ask your hotel owner to set a new password. Hotel owners: ask the StayBill administrator. Everyone can change their own password after signing in, from the menu under their name.
          </p>
        )}
      </form>
    </Shell>
  );
}

/** First visit: create the site administrator's login. */
export function Setup() {
  const [form, setForm] = useState({ name: '', username: 'admin', password: '', confirm: '' });
  const [legacy, setLegacy] = useState(null);
  const [importIt, setImportIt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  useEffect(() => { legacyHotelName().then(setLegacy); }, []);

  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (!form.name.trim()) return setErr('Enter your name.');
    const u = usernameProblem(form.username); if (u) return setErr(u);
    const p = passwordProblem(form.password); if (p) return setErr(p);
    if (form.password !== form.confirm) return setErr('Passwords do not match.');
    setBusy(true);
    try {
      const uid = await bootstrapAdmin({ name: form.name.trim(), username: form.username, password: form.password });
      if (legacy && importIt) await importLegacyHotel({ uid, name: form.name.trim() });
    } catch (e2) { setErr(errMsg(e2).replace('email address', 'username')); setBusy(false); }
  }

  return (
    <Shell wide note="SITE SETUP">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h1 className="font-headline text-headline-md text-on-surface">Set up StayBill</h1>
          <p className="text-body-md text-on-surface-variant">Create the <b>administrator</b> login for this StayBill site. You will then add hotels and give each hotel owner their own username and password. Owners create logins for their employees.</p>
        </div>
        <Field label="Your name" required><Input id="setup-name" value={form.name} onChange={set('name')} placeholder="e.g. Meena" autoFocus /></Field>
        <Field label="Administrator username" required hint="Letters, numbers, dots or dashes. You'll sign in with this."><Input id="setup-username" autoCapitalize="none" spellCheck={false} value={form.username} onChange={set('username')} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Password" required><Input id="setup-password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} /></Field>
          <Field label="Confirm password" required><Input id="setup-confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} /></Field>
        </div>
        {legacy && (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-body-md text-on-surface">
            <input type="checkbox" className="mt-1" checked={importIt} onChange={(e) => setImportIt(e.target.checked)} />
            <span>Bring in <b>{legacy}</b> with its existing bills, guests and rooms. You can add its owner's login afterwards.</span>
          </label>
        )}
        {err && <p className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">{err}</p>}
        <Button type="submit" className="h-10 w-full" loading={busy} icon="admin_panel_settings">Create administrator login</Button>
      </form>
    </Shell>
  );
}

/** claude.ai viewer who is signed out, or whom the page is not shared with. */
export function HostedSignedOut({ reason = 'signed-out' }) {
  return (
    <Shell note="CLAUDE.AI">
      {reason === 'no-access' ? (
        <>
          <h1 className="font-headline text-headline-md text-on-surface">Ask the owner for access</h1>
          <p className="mt-1 text-body-md text-on-surface-variant">This StayBill site keeps hotel data private. The person who runs it needs to share this page with you so you can contribute (Share menu on claude.ai). Then open it again and sign in with your StayBill username and password.</p>
        </>
      ) : (
        <>
          <h1 className="font-headline text-headline-md text-on-surface">Sign in to claude.ai first</h1>
          <p className="mt-1 text-body-md text-on-surface-variant">This copy of StayBill runs on claude.ai. Sign in to your claude.ai account, then open this page again and sign in with your StayBill username and password.</p>
        </>
      )}
    </Shell>
  );
}
