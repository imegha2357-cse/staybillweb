// Booking website: a public page per hotel where guests pick dates and a room
// type and send a booking request. The hotel publishes a small public profile
// (name, photos, room types, rates, sold-out dates); requests land in Bookings
// as "Requested" for the front desk to confirm.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, serverTimestamp } from '../../backend/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveSettings } from '../../lib/db';
import { addDays } from '../../lib/dates';
import { Button, Field, Input, Textarea, Toggle, cx, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Panel, Stats, fmtDate, money, num, today, useLive } from '../kit';
import { bookingUrl, siteBase } from '../guests/publicLinks';

export const AMENITIES = ['Free Wi-Fi', 'Air conditioning', 'TV', 'Hot water', 'Breakfast', 'Parking', 'Room service', 'Lift', 'Power backup', 'Laundry', 'Restaurant', 'Swimming pool', 'Airport pickup', 'Pet friendly'];

/** Room types that are full on each date, for the next 120 days. */
export function soldOutDates({ rooms, roomTypes, bills, bookings }) {
  const out = {};
  const t = today();
  const live = bills.filter((b) => b.paymentStatus !== 'CANCELLED');
  const held = bookings.filter((b) => ['Confirmed', 'Requested'].includes(b.status));
  roomTypes.forEach((rt) => {
    const total = rooms.filter((r) => r.roomType === rt.name && r.status !== 'inactive' && r.hkStatus !== 'ooo').length;
    const dates = [];
    for (let i = 0; i < 120; i += 1) {
      const d = addDays(t, i);
      const used = live.filter((b) => b.roomType === rt.name && b.checkIn <= d && b.checkOut > d).length
        + held.filter((b) => b.roomType === rt.name && b.checkIn <= d && b.checkOut > d).reduce((a, b) => a + Math.max(1, num(b.rooms) || 1), 0);
      if (used >= total) dates.push(d);
    }
    out[rt.name] = dates;
  });
  return out;
}

export async function publishProfile({ hotelId, settings, roomTypes, rooms, bills, bookings, site }) {
  const types = roomTypes.filter((rt) => site.types?.[rt.name]?.show !== false && rooms.some((r) => r.roomType === rt.name)).map((rt) => {
    const o = site.types?.[rt.name] || {};
    return { name: rt.name, rate: num(o.rate) || num(rt.defaultRate), capacity: num(o.capacity) || 2, description: o.description || '', image: o.image || '' };
  });
  await setDoc(doc(db, 'publicHotels', hotelId), {
    hotelId, open: !!site.open, name: settings.hotelName || '', city: settings.city || '', address: settings.address || '', phone: settings.phone || '', email: settings.email || '',
    logo: settings.logo || '', currency: settings.currency || 'INR', intro: site.intro || '', policies: site.policies || '', amenities: site.amenities || [],
    checkInTime: site.checkInTime || '12:00', checkOutTime: site.checkOutTime || '11:00', taxNote: site.taxNote || 'Taxes extra as applicable',
    photos: [], roomTypes: types,
    soldOut: soldOutDates({ rooms, roomTypes, bills, bookings }), updatedAt: serverTimestamp(),
  });
}

export default function Website() {
  const { user, hotelId } = useAuth();
  const { settings, roomTypes, rooms } = useData();
  const toast = useToast();
  const nav = useNavigate();
  const bills = useLive('bills', { where: [['checkOut', '>=', today()]] });
  const bookings = useLive('bookings');
  const [site, setSite] = useState(() => ({ open: false, intro: '', policies: 'Check-in from 12 noon, check-out by 11 am.\nValid photo ID required for all guests.\nFree cancellation up to 48 hours before arrival.', amenities: ['Free Wi-Fi', 'Air conditioning', 'Hot water'], checkInTime: '12:00', checkOutTime: '11:00', types: {}, ...(settings.bookingSite || {}) }));
  const [busy, setBusy] = useState(false);
  const [pub, setPub] = useState(undefined);
  useEffect(() => { getDoc(doc(db, 'publicHotels', hotelId)).then((s) => setPub(s.exists() ? s.data() : null)).catch(() => setPub(null)); }, [hotelId, busy]);
  const web = useMemo(() => (bookings || []).filter((b) => b.source === 'Website').sort((a, b) => (a.createdAt?.seconds || 0) < (b.createdAt?.seconds || 0) ? 1 : -1), [bookings]);
  const setType = (name, patch) => setSite({ ...site, types: { ...site.types, [name]: { ...(site.types?.[name] || {}), ...patch } } });
  const url = bookingUrl(hotelId);

  async function publish(open = site.open) {
    if (!bills || !bookings) return;
    setBusy(true);
    try {
      const next = { ...site, open };
      await saveSettings(user, { bookingSite: next, publicUrl: siteBase() }, 'WEBSITE_PUBLISHED');
      await publishProfile({ hotelId, settings, roomTypes, rooms, bills, bookings, site: next });
      setSite(next);
      toast(open ? 'Booking page is live' : 'Booking page is closed');
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }

  return (
    <ModulePage crumb={['Front desk', 'Booking website']} title="Booking website" subtitle="Take direct bookings without paying commission"
      actions={<>
        <Button variant="secondary" icon="content_copy" onClick={() => navigator.clipboard?.writeText(url).then(() => toast('Link copied')).catch(() => toast(url))}>Copy link</Button>
        <Button variant="secondary" icon="open_in_new" onClick={() => window.open(url, '_blank', 'noopener')}>Open page</Button>
        <Button icon="publish" loading={busy} onClick={() => publish(true)}>{pub?.open ? 'Update page' : 'Publish page'}</Button>
      </>}>
      <Stats items={[
        { label: 'Page', value: pub === undefined ? '…' : pub?.open ? 'Live' : 'Not live', icon: 'language', tone: pub?.open ? 'ok' : undefined, sub: pub?.updatedAt ? 'Rates and availability refresh when you update' : '' },
        { label: 'Requests waiting', value: web.filter((b) => b.status === 'Requested').length, icon: 'mark_email_unread', tone: web.some((b) => b.status === 'Requested') ? 'error' : undefined },
        { label: 'Direct bookings this month', value: web.filter((b) => (b.checkIn || '').startsWith(today().slice(0, 7)) && b.status !== 'Cancelled').length, icon: 'event_available' },
        { label: 'Commission saved', value: money(web.filter((b) => ['Confirmed', 'Checked in', 'Checked out'].includes(b.status)).reduce((a, b) => a + num(b.rate) * Math.max(1, Math.round((Date.parse(b.checkOut) - Date.parse(b.checkIn)) / 864e5)) * 0.18, 0)), icon: 'savings', sub: 'vs 18% OTA commission' },
      ]} />
      <div className="grid gap-space-md lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Page content" icon="edit_note" actions={<Toggle label={site.open ? 'Taking bookings' : 'Closed'} checked={!!site.open} onChange={(v) => publish(v)} />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Welcome text" className="sm:col-span-2"><Textarea rows={3} value={site.intro} onChange={(e) => setSite({ ...site, intro: e.target.value })} placeholder={`Stay at ${settings.hotelName || 'our hotel'}, minutes from the beach…`} /></Field>
            <Field label="Check-in from"><Input type="time" value={site.checkInTime} onChange={(e) => setSite({ ...site, checkInTime: e.target.value })} /></Field>
            <Field label="Check-out by"><Input type="time" value={site.checkOutTime} onChange={(e) => setSite({ ...site, checkOutTime: e.target.value })} /></Field>
            <Field label="Policies" className="sm:col-span-2"><Textarea rows={4} value={site.policies} onChange={(e) => setSite({ ...site, policies: e.target.value })} /></Field>
            <div className="sm:col-span-2" role="group" aria-label="Amenities">
              <span className="mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant">Amenities</span>
              <div className="flex flex-wrap gap-1.5">
                {AMENITIES.map((a) => { const on = site.amenities.includes(a); return <button key={a} type="button" onClick={() => setSite({ ...site, amenities: on ? site.amenities.filter((x) => x !== a) : [...site.amenities, a] })} className={cx('rounded-full px-3 py-1 text-label-md ring-1', on ? 'bg-primary-container text-on-primary ring-transparent' : 'text-on-surface-variant ring-outline-variant')}>{a}</button>; })}
              </div>
            </div>
          </div>
          <p className="mt-3 text-label-md text-on-surface-variant">Click “Update page” after changes; rates and sold-out dates are copied to the page then.</p>
        </Panel>
        <Panel title="Room types on the page" icon="meeting_room">
          {roomTypes.length === 0 ? <p className="text-body-md text-on-surface-variant">Add room types and rooms first.</p> : roomTypes.map((rt) => {
            const o = site.types?.[rt.name] || {}; const count = rooms.filter((r) => r.roomType === rt.name).length;
            return (
              <div key={rt.id} className={cx('mb-2 rounded-lg p-3 ring-1 ring-surface-container', (o.show === false || !count) && 'opacity-60')}>
                <div className="flex items-center justify-between gap-2"><b>{rt.name}</b><span className="text-label-md text-on-surface-variant">{count} room{count === 1 ? '' : 's'}</span><Toggle label="Show" checked={o.show !== false && count > 0} onChange={(v) => setType(rt.name, { show: v })} /></div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Input type="number" min="0" value={o.rate ?? ''} placeholder={`Rate ${rt.defaultRate || ''}`} onChange={(e) => setType(rt.name, { rate: e.target.value })} aria-label={`${rt.name} rate`} />
                  <Input type="number" min="1" value={o.capacity ?? ''} placeholder="Sleeps 2" onChange={(e) => setType(rt.name, { capacity: e.target.value })} aria-label={`${rt.name} capacity`} />
                  <Input className="col-span-2" value={o.description ?? ''} placeholder="Sea view, king bed, balcony…" onChange={(e) => setType(rt.name, { description: e.target.value })} aria-label={`${rt.name} description`} />
                </div>
              </div>
            );
          })}
        </Panel>
      </div>
      <DataTable rows={bookings ? web : null} empty="Requests from your booking page will appear here and in Bookings."
        toolbar={<span className="font-headline text-headline-sm">Requests from the page</span>}
        columns={[
          { key: 'n', label: 'Guest', render: (b) => <><b>{b.guestName}</b><div className="text-label-sm text-on-surface-variant">{[b.phone, b.email].filter(Boolean).join(' · ')}</div></> },
          { key: 'd', label: 'Stay', render: (b) => <>{fmtDate(b.checkIn)} → {fmtDate(b.checkOut)}<div className="text-label-sm text-on-surface-variant">{b.roomType}{num(b.rooms) > 1 ? ` × ${b.rooms}` : ''} · {b.adults || 1} adults</div></> },
          { key: 'r', label: 'Rate', right: true, render: (b) => money(b.rate) },
          { key: 's', label: 'Status', render: (b) => <Chip tone={{ Requested: 'warn', Confirmed: 'info', 'Checked in': 'ok', Cancelled: 'error' }[b.status]}>{b.status}</Chip> },
        ]}
        actions={(b) => (b.status === 'Requested' ? <Button size="sm" variant="secondary" icon="arrow_forward" onClick={() => nav('/bookings')}>Confirm in Bookings</Button> : null)} />
    </ModulePage>
  );
}
