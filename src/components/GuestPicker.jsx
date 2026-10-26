import { useEffect, useRef, useState } from 'react';
import { Search, UserCheck, UserPlus, X } from './icons';
import { searchGuests, findGuestByPhone } from '../lib/db';
import { Field, Input, Textarea, cx } from './ui';

/**
 * Guest section of the bill (PRD §18): pick an existing guest (auto-populates)
 * or enter a new one.
 */
export default function GuestPicker({ guestId, guest, onChange, errors = {} }) {
  const [mode, setMode] = useState(guestId ? 'existing' : 'new');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [dup, setDup] = useState(null);
  const timer = useRef();

  useEffect(() => {
    if (mode !== 'existing' || guestId) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      searchGuests(term, 8).then(setResults).catch(() => setResults([]));
    }, 200);
    return () => clearTimeout(timer.current);
  }, [term, mode, guestId]);

  const set = (k) => (e) => onChange({ guestId, guest: { ...guest, [k]: e.target.value } });
  const pick = (g) => {
    const { id, createdAt, updatedAt, createdBy, idImage, ...rest } = g; // eslint-disable-line no-unused-vars
    onChange({ guestId: id, guest: { ...rest, name: g.name, phone: g.phone, email: g.email, address: g.address, gstin: g.gstin } });
    setOpen(false); setTerm(''); setDup(null);
  };
  const clear = () => onChange({ guestId: null, guest: { name: '', phone: '', email: '', address: '', gstin: '' } });

  async function checkDup() {
    if (guestId || !guest.phone) return;
    const g = await findGuestByPhone(guest.phone).catch(() => null);
    setDup(g);
  }

  return (
    <div>
      <div className="mb-4 inline-flex rounded-lg bg-slate-100 p-1 text-sm">
        {[{ id: 'existing', label: 'Existing guest', icon: UserCheck }, { id: 'new', label: 'New guest', icon: UserPlus }].map(({ id, label, icon: Icon }) => (
          <button type="button" key={id} onClick={() => { setMode(id); if (id === 'new') { clear(); } setDup(null); }}
            className={cx('flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium', mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </div>

      {mode === 'existing' && !guestId && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="Search by guest name or phone…" value={term}
            onChange={(e) => { setTerm(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} autoFocus />
          {open && (
            <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {results.length === 0 ? (
                <div className="px-3 py-3 text-sm text-slate-500">No matching guests. <button type="button" className="font-medium text-brand-700" onClick={() => { setMode('new'); onChange({ guestId: null, guest: { ...guest, name: /\d/.test(term) ? '' : term, phone: /\d/.test(term) ? term : '' } }); }}>Add as new guest</button></div>
              ) : results.map((g) => (
                <button type="button" key={g.id} onClick={() => pick(g)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className="font-medium text-slate-800">{g.name}</span>
                  <span className="text-slate-500">{g.phone}</span>
                </button>
              ))}
            </div>
          )}
          {errors.guestName && <span className="mt-1 block text-xs text-error">Select a guest or add a new one.</span>}
        </div>
      )}

      {(mode === 'new' || guestId) && (
        <>
          {guestId && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              <span className="flex items-center gap-2"><UserCheck className="h-4 w-4" />Existing guest selected — details loaded.</span>
              <button type="button" onClick={clear} className="flex items-center gap-1 font-medium hover:underline"><X className="h-3.5 w-3.5" />Change</button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Guest name" required error={errors.guestName}><Input value={guest.name} onChange={set('name')} invalid={!!errors.guestName} autoFocus={mode === 'new' && !guestId} /></Field>
            <Field label="Phone number" error={errors.guestPhone}><Input type="tel" value={guest.phone} onChange={set('phone')} onBlur={checkDup} invalid={!!errors.guestPhone} /></Field>
            <Field label="Email" error={errors.guestEmail}><Input type="email" value={guest.email} onChange={set('email')} /></Field>
            <Field label="GSTIN" hint="If the guest needs a business invoice"><Input value={guest.gstin} onChange={set('gstin')} className="uppercase" /></Field>
            <Field label="Address" className="sm:col-span-2"><Textarea rows={2} value={guest.address} onChange={set('address')} /></Field>
          </div>
          {dup && !guestId && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-transparent bg-error-container px-3 py-2 text-sm text-on-error-container">
              <span><b>{dup.name}</b> is already saved with this phone number.</span>
              <button type="button" onClick={() => pick(dup)} className="font-medium underline">Use existing guest</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
