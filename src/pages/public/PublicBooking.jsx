// Public booking page: /book/:hotelId — no sign-in. Guests choose dates and a
// room type and send a request; the hotel confirms it from Bookings.
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { addDoc, doc, getDoc, serverTimestamp } from '../../backend/firestore';
import { db } from '../../firebase';
import { hcol } from '../../lib/scope';
import { addDays, today } from '../../lib/dates';
import { money, setCurrency } from '../../lib/format';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Select, Textarea, cx } from '../../components/ui';

const nightsOf = (a, b) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5));
const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export function PublicShell({ hotel, children }) {
  return (
    <div className="min-h-screen bg-surface">
      <header className="bg-gradient-to-br from-primary to-secondary text-on-primary">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-5">
          {hotel?.logo ? <img src={hotel.logo} alt="" className="h-12 w-12 rounded-xl bg-white object-contain p-1" /> : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/15"><Icon name="hotel" size={26} /></span>}
          <div className="min-w-0">
            <div className="truncate font-headline text-headline-md">{hotel?.name || 'Hotel'}</div>
            <div className="truncate text-body-md opacity-85">{[hotel?.address, hotel?.city].filter(Boolean).join(', ')}</div>
          </div>
          {hotel?.phone && <a href={`tel:${hotel.phone}`} className="ml-auto hidden items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-label-lg sm:flex"><Icon name="call" size={16} />{hotel.phone}</a>}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      <footer className="pb-8 text-center text-label-md text-on-surface-variant">Powered by StayBill</footer>
    </div>
  );
}

export default function PublicBooking() {
  const { hotelId } = useParams();
  const [hotel, setHotel] = useState(undefined);
  const [q, setQ] = useState({ checkIn: addDays(today(), 1), checkOut: addDays(today(), 2), adults: 2, children: 0 });
  const [pick, setPick] = useState(null);
  const [f, setF] = useState({ name: '', phone: '', email: '', notes: '', rooms: 1 });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    getDoc(doc(db, 'publicHotels', hotelId)).then((s) => { const h = s.exists() ? s.data() : null; if (h?.currency) setCurrency(h.currency); setHotel(h); }).catch(() => setHotel(null));
  }, [hotelId]);
  const nights = nightsOf(q.checkIn, q.checkOut);
  const avail = useMemo(() => (hotel?.roomTypes || []).map((t) => {
    const blocked = [];
    for (let d = q.checkIn; d < q.checkOut; d = addDays(d, 1)) if ((hotel.soldOut?.[t.name] || []).includes(d)) blocked.push(d);
    return { ...t, blocked, fits: num(t.capacity) * Math.max(1, f.rooms) >= num(q.adults) };
  }), [hotel, q, f.rooms]);

  if (hotel === undefined) return <PublicShell><p className="py-20 text-center text-body-md text-on-surface-variant">Loading…</p></PublicShell>;
  if (!hotel) return <PublicShell><div className="py-20 text-center"><Icon name="travel_explore" size={40} className="text-outline" /><p className="mt-2 text-body-lg">This booking page does not exist.</p></div></PublicShell>;
  if (!hotel.open) return <PublicShell hotel={hotel}><div className="py-16 text-center"><p className="text-body-lg">Online booking is closed right now.</p>{hotel.phone && <p className="mt-2 text-body-md text-on-surface-variant">Please call <a className="text-secondary" href={`tel:${hotel.phone}`}>{hotel.phone}</a> to book.</p>}</div></PublicShell>;

  async function send() {
    setErr('');
    if (!pick) return setErr('Choose a room type.');
    if (!f.name.trim()) return setErr('Enter your name.');
    if (!/^[0-9+\-\s]{8,15}$/.test(f.phone.trim())) return setErr('Enter a phone number we can call.');
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) return setErr('Check the email address.');
    setBusy(true);
    try {
      const ref = `WEB-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      await addDoc(hcol('bookings', hotelId), {
        number: ref, status: 'Requested', source: 'Website', guestName: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(),
        checkIn: q.checkIn, checkOut: q.checkOut, roomType: pick.name, rooms: Math.max(1, num(f.rooms)), adults: num(q.adults), children: num(q.children),
        rate: num(pick.rate), notes: f.notes.trim().slice(0, 500), createdAt: serverTimestamp(), createdBy: { uid: null, name: 'Booking website' },
      });
      setDone({ ref, total: nights * num(pick.rate) * Math.max(1, num(f.rooms)) });
    } catch (e) { setErr('Sorry, we could not send your request. Please call the hotel.'); }
    setBusy(false);
  }

  if (done) {
    return (
      <PublicShell hotel={hotel}>
        <div className="mx-auto max-w-lg rounded-2xl bg-surface-container-lowest p-6 text-center shadow-sm">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ok-container text-on-ok-container"><Icon name="check" size={30} /></span>
          <h1 className="mt-3 font-headline text-headline-md">Request sent</h1>
          <p className="mt-1 text-body-md text-on-surface-variant">Reference <b className="text-on-surface">{done.ref}</b>. {hotel.name} will confirm availability{f.email ? ' by email' : ''} or call you shortly.</p>
          <div className="mt-4 rounded-xl bg-surface-container-low p-3 text-left text-body-md">
            <div className="flex justify-between"><span>{pick.name}{num(f.rooms) > 1 ? ` × ${f.rooms}` : ''}</span><span>{nights} night{nights === 1 ? '' : 's'}</span></div>
            <div className="flex justify-between"><span>{fmt(q.checkIn)} → {fmt(q.checkOut)}</span><b>{money(done.total)}</b></div>
            <div className="text-label-md text-on-surface-variant">{hotel.taxNote}</div>
          </div>
        </div>
      </PublicShell>
    );
  }

  const photos = hotel.photos || [];
  return (
    <PublicShell hotel={hotel}>
      {photos.length > 0 && (
        <div className="relative mb-5 h-56 overflow-hidden rounded-2xl sm:h-72">
          <img src={photos[photo].image} alt={photos[photo].caption || hotel.name} className="h-full w-full object-cover" />
          {photos.length > 1 && <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">{photos.map((p, i) => <button key={i} type="button" aria-label={`Photo ${i + 1}`} onClick={() => setPhoto(i)} className={cx('h-2 w-2 rounded-full', i === photo ? 'bg-white' : 'bg-white/50')} />)}</div>}
        </div>
      )}
      {hotel.intro && <p className="mb-4 whitespace-pre-line text-body-lg text-on-surface">{hotel.intro}</p>}
      {(hotel.amenities || []).length > 0 && <div className="mb-5 flex flex-wrap gap-1.5">{hotel.amenities.map((a) => <span key={a} className="rounded-full bg-surface-container-low px-3 py-1 text-label-md text-on-surface-variant">{a}</span>)}</div>}

      <section className="mb-5 grid gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-sm sm:grid-cols-4">
        <Field label="Check-in"><Input type="date" min={today()} value={q.checkIn} onChange={(e) => { const v = e.target.value; setQ({ ...q, checkIn: v, checkOut: q.checkOut <= v ? addDays(v, 1) : q.checkOut }); setPick(null); }} /></Field>
        <Field label="Check-out"><Input type="date" min={addDays(q.checkIn, 1)} value={q.checkOut} onChange={(e) => { setQ({ ...q, checkOut: e.target.value }); setPick(null); }} /></Field>
        <Field label="Adults"><Select value={q.adults} onChange={(e) => setQ({ ...q, adults: e.target.value })}>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        <Field label="Children"><Select value={q.children} onChange={(e) => setQ({ ...q, children: e.target.value })}>{[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
      </section>

      <h2 className="mb-2 font-headline text-headline-sm">{nights} night{nights === 1 ? '' : 's'} · {fmt(q.checkIn)} → {fmt(q.checkOut)}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {avail.map((t) => {
          const full = t.blocked.length > 0;
          return (
            <button key={t.name} type="button" disabled={full || nights < 1} onClick={() => setPick(t)}
              className={cx('rounded-2xl bg-surface-container-lowest p-4 text-left shadow-sm ring-2 transition-all disabled:opacity-60', pick?.name === t.name ? 'ring-secondary' : 'ring-transparent hover:ring-outline-variant')}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="font-headline text-headline-sm">{t.name}</div><div className="text-label-md text-on-surface-variant">Sleeps {t.capacity}{t.description ? ` · ${t.description}` : ''}</div></div>
                <div className="text-right"><div className="font-headline text-headline-sm">{money(t.rate)}</div><div className="text-label-sm text-on-surface-variant">per night</div></div>
              </div>
              <div className="mt-2 flex items-center justify-between text-body-md">
                {full ? <span className="text-error">Sold out on {t.blocked.slice(0, 2).map(fmt).join(', ')}</span> : !t.fits ? <span className="text-warn">Choose more rooms for {q.adults} adults</span> : <span className="text-on-ok-container">Available</span>}
                {!full && nights > 0 && <b>{money(nights * num(t.rate))} total</b>}
              </div>
            </button>
          );
        })}
      </div>

      {pick && (
        <section className="mt-5 grid gap-3 rounded-2xl bg-surface-container-lowest p-4 shadow-sm sm:grid-cols-2">
          <h2 className="font-headline text-headline-sm sm:col-span-2">Your details</h2>
          <Field label="Full name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></Field>
          <Field label="Mobile number" required><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /></Field>
          <Field label="Email (for confirmation)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></Field>
          <Field label="Rooms"><Select value={f.rooms} onChange={(e) => setF({ ...f, rooms: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
          <Field label="Special requests" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Early check-in, airport pickup…" /></Field>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-container-low p-3 sm:col-span-2">
            <div className="text-body-md">{pick.name}{f.rooms > 1 ? ` × ${f.rooms}` : ''} · {nights} night{nights === 1 ? '' : 's'}<div className="font-headline text-headline-sm">{money(nights * num(pick.rate) * f.rooms)}</div><div className="text-label-md text-on-surface-variant">{hotel.taxNote} · pay at the hotel</div></div>
            <Button size="lg" icon="send" loading={busy} onClick={send}>Request booking</Button>
          </div>
          {err && <p className="text-body-md text-error sm:col-span-2" role="alert">{err}</p>}
        </section>
      )}

      {hotel.policies && <section className="mt-6 rounded-2xl bg-surface-container-lowest p-4 text-body-md shadow-sm"><h2 className="mb-1 font-headline text-headline-sm">Good to know</h2><p className="whitespace-pre-line text-on-surface-variant">Check-in from {hotel.checkInTime} · check-out by {hotel.checkOutTime}{'\n'}{hotel.policies}</p></section>}
    </PublicShell>
  );
}

function num(v) { return Number(v) || 0; }
