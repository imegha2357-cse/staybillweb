// Bookings: reservations, availability calendar, advance payments, groups,
// confirmations, cancellations and no-shows. Checking in opens a new bill
// pre-filled from the booking.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDoc, serverTimestamp } from '../../backend/firestore';
import { hcol } from '../../lib/scope';
import { actor } from '../../lib/db';
import { autoWhatsApp, bookingVars, sendWhatsApp, validWaNumber } from '../../lib/whatsapp';
import { calcNights, round2 } from '../../lib/billing';
import { addDays } from '../../lib/dates';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Modal, Select, Textarea, cx, useToast, errMsg } from '../../components/ui';
import {
  Chip, DataTable, FormFields, ModulePage, Panel, Stats, fmtShort, money, nextNumber, saveRecord, today, useLive, validate, num,
} from '../kit';

export const SOURCES = ['Walk-in', 'Phone', 'Email', 'Website', 'Booking.com', 'MakeMyTrip', 'Goibibo', 'Agoda', 'Airbnb', 'Expedia', 'Travel agent', 'Corporate'];
export const OTA_SOURCES = ['Booking.com', 'MakeMyTrip', 'Goibibo', 'Agoda', 'Airbnb', 'Expedia'];
const ACTIVE = ['Requested', 'Enquiry', 'Confirmed', 'Checked in'];
const TONES = { Requested: 'warn', Enquiry: 'muted', Confirmed: 'info', 'Checked in': 'ok', 'Checked out': 'muted', Cancelled: 'error', 'No-show': 'error' };
const overlaps = (a, b) => a.checkIn < b.checkOut && b.checkIn < a.checkOut;

export function bookingNights(b) { return calcNights(b.checkIn, b.checkOut) || 0; }
export function bookingTotal(b) { return round2(bookingNights(b) * num(b.rate) * Math.max(1, num(b.rooms) || 1)); }

/** Rooms of a type still free on every night of the stay. */
export function freeRooms({ rooms, bookings, bills, roomType, checkIn, checkOut, exceptId }) {
  const stay = { checkIn, checkOut };
  const list = rooms.filter((r) => r.status !== 'inactive' && (!roomType || r.roomType === roomType));
  const busy = new Set();
  (bookings || []).filter((b) => b.id !== exceptId && ACTIVE.includes(b.status) && b.roomNumber && overlaps(b, stay)).forEach((b) => busy.add(b.roomNumber));
  (bills || []).filter((b) => b.paymentStatus !== 'CANCELLED' && !b.checkedOutAt && overlaps(b, stay)).forEach((b) => busy.add(b.roomNumber));
  const free = list.filter((r) => !busy.has(r.roomNumber));
  // Unassigned bookings of the same type also take a room each.
  const unassigned = (bookings || []).filter((b) => b.id !== exceptId && ACTIVE.includes(b.status) && !b.roomNumber && b.roomType === roomType && overlaps(b, stay))
    .reduce((n, b) => n + Math.max(1, num(b.rooms) || 1), 0);
  return { free, count: Math.max(0, free.length - unassigned) };
}

/** Queue a reservation email to the guest (sent by the email function). */
export async function queueBookingEmail(user, booking, kind = 'reservation') {
  if (!booking.email) return null;
  return addDoc(hcol('mail'), {
    bookingId: booking.id, invoiceNumber: booking.number || '', to: booking.email, kind, status: 'queued',
    createdAt: serverTimestamp(), requestedBy: actor(user),
  });
}

const FIELDS = (roomsFor) => [
  { key: 'guestName', label: 'Guest name', required: true, half: true, autoFocus: true },
  { key: 'phone', label: 'Phone', type: 'tel', half: true },
  { key: 'email', label: 'Email (for confirmation)', type: 'email', half: true },
  { key: 'source', label: 'Source', type: 'select', options: SOURCES, half: true, placeholder: false },
  { key: 'checkIn', label: 'Check-in', type: 'date', required: true, half: true },
  { key: 'checkOut', label: 'Check-out', type: 'date', required: true, half: true, check: (v, all) => (v && all.checkIn && v <= all.checkIn ? 'Check-out must be after check-in.' : '') },
  { key: 'roomType', label: 'Room type', type: 'roomType', required: true, half: true },
  { key: 'roomNumber', label: 'Room (optional)', type: 'select', half: true, placeholder: 'Assign at check-in', options: roomsFor },
  { key: 'rooms', label: 'Rooms', type: 'number', min: 1, half: true, hint: 'More than 1 for groups' },
  { key: 'adults', label: 'Adults', type: 'number', min: 1, half: true },
  { key: 'children', label: 'Children', type: 'number', half: true },
  { key: 'rate', label: 'Rate per night', type: 'money', required: true, half: true },
  { key: 'groupName', label: 'Group / company', half: true, placeholder: 'e.g. Sharma wedding' },
  { key: 'otaRef', label: 'OTA / reference no.', half: true, show: (v) => v.source && !['Walk-in', 'Phone'].includes(v.source) },
  { key: 'advance', label: 'Advance received', type: 'money', half: true },
  { key: 'advanceMethod', label: 'Advance paid by', type: 'select', options: ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Online gateway', 'OTA collect'], half: true, show: (v) => num(v.advance) > 0 },
  { key: 'nationality', label: 'Nationality', half: true, placeholder: 'Indian' },
  { key: 'status', label: 'Status', type: 'select', options: ['Enquiry', 'Requested', 'Confirmed'], half: true, placeholder: false, show: (v) => !v.id || ['Enquiry', 'Requested', 'Confirmed'].includes(v.status) },
  { key: 'notes', label: 'Notes / special requests', type: 'textarea' },
];

function BookingModal({ open, onClose, initial, bookings, bills }) {
  const { user } = useAuth();
  const { rooms, roomTypes, settings } = useData();
  const toast = useToast();
  const [v, setV] = useState({});
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const [sendMail, setSendMail] = useState(true);
  useEffect(() => {
    if (!open) return;
    const t = today();
    setV(initial?.id ? { ...initial } : { source: 'Phone', status: 'Confirmed', checkIn: t, checkOut: addDays(t, 1), adults: 2, rooms: 1, ...initial });
    setErr({});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const typeRate = roomTypes.find((t) => t.name === v.roomType)?.defaultRate;
  const avail = v.roomType && v.checkIn && v.checkOut && v.checkOut > v.checkIn
    ? freeRooms({ rooms, bookings, bills, roomType: v.roomType, checkIn: v.checkIn, checkOut: v.checkOut, exceptId: v.id }) : null;
  const fields = FIELDS(() => (avail ? avail.free.map((r) => ({ value: r.roomNumber, label: `${r.roomNumber}` })) : []).concat(v.roomNumber && !avail?.free.some((r) => r.roomNumber === v.roomNumber) ? [{ value: v.roomNumber, label: `${v.roomNumber} (busy)` }] : []));

  async function save() {
    const e = validate(fields, v);
    if (avail && v.status !== 'Enquiry' && avail.count < Math.max(1, num(v.rooms) || 1) && !v.id) e.roomType = `Only ${avail.count} ${v.roomType} room${avail.count === 1 ? '' : 's'} free for these dates.`;
    if (v.roomNumber && avail && !avail.free.some((r) => r.roomNumber === v.roomNumber)) e.roomNumber = `Room ${v.roomNumber} is taken on some of these nights.`;
    setErr(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const data = {
        ...v, rate: num(v.rate), advance: num(v.advance), adults: num(v.adults) || 1, children: num(v.children), rooms: Math.max(1, num(v.rooms) || 1),
        nights: calcNights(v.checkIn, v.checkOut), total: 0, email: (v.email || '').trim(), guestNameLower: (v.guestName || '').trim().toLowerCase(),
      };
      data.total = bookingTotal(data);
      if (!v.id) data.number = await nextNumber('booking', 'BK');
      const id = await saveRecord(user, 'bookings', v.id, data, v.id ? 'BOOKING_UPDATED' : 'BOOKING_CREATED');
      if (!v.id && sendMail && data.email && data.status === 'Confirmed' && settings.emailGuests !== false) await queueBookingEmail(user, { ...data, id });
      if (!v.id && sendMail && data.status === 'Confirmed') await autoWhatsApp(user, settings, { kind: 'reservation', phone: data.phone, vars: bookingVars(data, settings), bookingId: id, guestName: data.guestName });
      toast(v.id ? 'Booking saved' : `Booking ${data.number} created`);
      onClose();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open={open} onClose={onClose} title={v.id ? `Booking ${v.number || ''}` : 'New booking'} icon="event_available" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{v.id ? 'Save booking' : 'Create booking'}</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <FormFields fields={fields} value={v} onChange={(x) => setV(x.roomType !== v.roomType && !v.rate && typeRate !== undefined ? { ...x, rate: roomTypes.find((t) => t.name === x.roomType)?.defaultRate ?? x.rate } : x)} errors={err} />
        {v.roomType && !v.rate && typeRate !== undefined && <button type="button" className="text-label-md text-secondary hover:underline" onClick={() => setV({ ...v, rate: typeRate })}>Use the {v.roomType} rate ({money(typeRate)})</button>}
        {avail && (
          <div className={cx('flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-body-md', avail.count > 0 ? 'bg-ok-container text-on-ok-container' : 'bg-error-container text-on-error-container')}>
            <span><Icon name={avail.count > 0 ? 'event_available' : 'event_busy'} size={16} /> {avail.count} {v.roomType} room{avail.count === 1 ? '' : 's'} free · {calcNights(v.checkIn, v.checkOut)} night{calcNights(v.checkIn, v.checkOut) === 1 ? '' : 's'}</span>
            {num(v.rate) > 0 && <b>Stay total {money(bookingTotal(v))}</b>}
          </div>
        )}
        {!v.id && v.email && <label className="flex items-center gap-2 text-body-md"><input type="checkbox" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} />Email the confirmation to the guest</label>}
      </div>
    </Modal>
  );
}

function CancelModal({ booking, onClose, noShow }) {
  const { user } = useAuth();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState('');
  const [busy, setBusy] = useState(false);
  if (!booking) return null;
  async function save() {
    setBusy(true);
    try {
      await saveRecord(user, 'bookings', booking.id, {
        status: noShow ? 'No-show' : 'Cancelled', cancelReason: reason.trim() || (noShow ? 'Guest did not arrive' : ''), refund: num(refund), cancelledOn: today(),
      }, noShow ? 'BOOKING_NO_SHOW' : 'BOOKING_CANCELLED');
      toast(noShow ? `${booking.number} marked as no-show` : `${booking.number} cancelled`);
      onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title={noShow ? `No-show: ${booking.number}` : `Cancel ${booking.number}`} icon={noShow ? 'person_off' : 'event_busy'}
      footer={<><Button variant="secondary" onClick={onClose}>Keep booking</Button><Button variant="danger" onClick={save} loading={busy}>{noShow ? 'Mark no-show' : 'Cancel booking'}</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <p className="text-body-md text-on-surface-variant">{booking.guestName} · {booking.roomType} · {fmtShort(booking.checkIn)} → {fmtShort(booking.checkOut)}{booking.advance ? ` · advance ${money(booking.advance)}` : ''}</p>
        <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={noShow ? 'Guest did not arrive' : 'e.g. Plans changed'} /></Field>
        {booking.advance > 0 && <Field label={noShow ? 'No-show charge kept / refund' : 'Refund to guest'} hint={`Advance received: ${money(booking.advance)}. Enter how much is refunded (0 keeps it all).`}><Input type="number" min="0" max={booking.advance} value={refund} onChange={(e) => setRefund(e.target.value)} /></Field>}
      </div>
    </Modal>
  );
}

/** Rooms × 14-day calendar with bookings and in-house bills. */
function Calendar({ bookings, bills, onPick, onNew }) {
  const { rooms } = useData();
  const [start, setStart] = useState(today());
  const days = Array.from({ length: 14 }, (_, i) => addDays(start, i));
  const live = rooms.filter((r) => r.status !== 'inactive');
  const cellOf = (room, d) => {
    const bill = bills.find((b) => b.roomNumber === room.roomNumber && b.paymentStatus !== 'CANCELLED' && b.checkIn <= d && d < b.checkOut);
    if (bill) return { kind: 'bill', label: bill.guestName, item: bill };
    const bk = bookings.find((b) => b.roomNumber === room.roomNumber && ACTIVE.includes(b.status) && b.checkIn <= d && d < b.checkOut);
    if (bk) return { kind: 'booking', label: bk.guestName, item: bk };
    return null;
  };
  const unassigned = (d) => bookings.filter((b) => ACTIVE.includes(b.status) && !b.roomNumber && b.checkIn <= d && d < b.checkOut);
  return (
    <Panel title="Availability calendar" icon="calendar_view_month" actions={(
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" icon="chevron_left" onClick={() => setStart(addDays(start, -7))}>Week</Button>
        <Button size="sm" variant="secondary" onClick={() => setStart(today())}>Today</Button>
        <Button size="sm" variant="ghost" onClick={() => setStart(addDays(start, 7))}>Week<Icon name="chevron_right" size={16} /></Button>
      </div>
    )}>
      {live.length === 0 ? <p className="text-body-md text-on-surface-variant">Add rooms under Rooms & Tariffs to see the calendar.</p> : (
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-label-md">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-24 bg-surface-container-lowest px-2 py-1 text-left text-label-sm uppercase text-on-surface-variant">Room</th>
                {days.map((d) => {
                  const dt = new Date(`${d}T00:00:00`);
                  return <th key={d} className={cx('px-1 py-1 text-center font-semibold', d === today() ? 'text-secondary' : 'text-on-surface-variant', [0, 6].includes(dt.getDay()) && 'bg-surface-container-low/60')}>
                    <div className="text-[10px] uppercase">{dt.toLocaleDateString('en-IN', { weekday: 'short' })}</div><div>{dt.getDate()}</div>
                  </th>;
                })}
              </tr>
            </thead>
            <tbody>
              {live.map((r) => (
                <tr key={r.id}>
                  <td className="sticky left-0 z-10 border-t border-surface-container bg-surface-container-lowest px-2 py-1"><b>{r.roomNumber}</b><div className="text-[10px] text-on-surface-variant">{r.roomType}</div></td>
                  {days.map((d) => {
                    const c = cellOf(r, d);
                    const first = c && (c.item.checkIn === d || d === days[0]);
                    return (
                      <td key={d} className="h-10 border-t border-surface-container p-0.5">
                        {c ? (
                          <button type="button" onClick={() => onPick(c)} title={`${c.label} · ${c.kind === 'bill' ? c.item.invoiceNumber : c.item.number}`}
                            className={cx('h-full w-full truncate rounded-md px-1 text-left text-[11px] font-semibold', c.kind === 'bill' ? 'bg-primary-container text-on-primary' : c.item.status === 'Confirmed' ? 'bg-secondary-container text-on-secondary-container' : 'bg-warn-container text-on-warn-container')}>
                            {first ? c.label : ''}
                          </button>
                        ) : (
                          <button type="button" onClick={() => onNew({ roomNumber: r.roomNumber, roomType: r.roomType, checkIn: d, checkOut: addDays(d, 1), rate: r.rate })} className="h-full w-full rounded-md hover:bg-surface-container-low" aria-label={`Book room ${r.roomNumber} on ${d}`} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="sticky left-0 z-10 border-t border-surface-container bg-surface-container-lowest px-2 py-1 text-[11px] text-on-surface-variant">Unassigned</td>
                {days.map((d) => { const u = unassigned(d); return <td key={d} className="border-t border-surface-container p-0.5 text-center">{u.length ? <Chip tone="warn">{u.length}</Chip> : ''}</td>; })}
              </tr>
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap gap-3 text-label-md text-on-surface-variant">
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-primary-container" />In house (bill)</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-secondary-container" />Confirmed booking</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-warn-container" />Enquiry / request</span>
            <span>Click an empty cell to book that room.</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

export default function Bookings() {
  const nav = useNavigate();
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const bookings = useLive('bookings');
  const bills = useLive('bills', { where: [['checkOut', '>=', addDays(today(), -1)]] });
  const [tab, setTab] = useState('list');
  const [edit, setEdit] = useState(null);
  const [cancel, setCancel] = useState(null);
  const t = today();
  const rows = useMemo(() => (bookings || []).slice().sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1)), [bookings]);
  const arrivals = rows.filter((b) => b.checkIn === t && ['Confirmed', 'Requested', 'Enquiry'].includes(b.status));
  const stats = [
    { label: 'Arriving today', value: arrivals.length, icon: 'flight_land', sub: arrivals.map((b) => b.guestName).slice(0, 3).join(', ') || 'No arrivals' },
    { label: 'Upcoming', value: rows.filter((b) => b.checkIn > t && ['Confirmed', 'Enquiry'].includes(b.status)).length, icon: 'event_upcoming', sub: 'Confirmed and enquiries' },
    { label: 'Requests to confirm', value: rows.filter((b) => b.status === 'Requested').length, icon: 'mark_email_unread', tone: rows.some((b) => b.status === 'Requested') ? 'error' : undefined, sub: 'From the booking page' },
    { label: 'Advances held', value: money(rows.filter((b) => ACTIVE.includes(b.status) && b.status !== 'Checked in').reduce((a, b) => a + num(b.advance), 0)), icon: 'savings', sub: 'Before check-in' },
  ];
  async function confirm(b) {
    try {
      await saveRecord(user, 'bookings', b.id, { status: 'Confirmed' }, 'BOOKING_CONFIRMED');
      if (b.email) await queueBookingEmail(user, { ...b, status: 'Confirmed' });
      await autoWhatsApp(user, settings, { kind: 'reservation', phone: b.phone, vars: bookingVars(b, settings), bookingId: b.id, guestName: b.guestName });
      toast(`${b.number} confirmed${b.email ? ' and the guest emailed' : ''}`);
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  const actions = (b) => (
    <div className="flex justify-end gap-1">
      {['Requested', 'Enquiry'].includes(b.status) && <Button size="sm" variant="secondary" icon="check" onClick={() => confirm(b)}>Confirm</Button>}
      {['Confirmed', 'Requested', 'Enquiry'].includes(b.status) && b.checkIn <= addDays(t, 0) && <Button size="sm" icon="login" onClick={() => nav(`/bills/new?booking=${b.id}`)}>Check in</Button>}
      {['Confirmed', 'Requested', 'Enquiry'].includes(b.status) && b.checkIn > t && <Button size="sm" variant="ghost" icon="login" onClick={() => nav(`/bills/new?booking=${b.id}`)}>Early check-in</Button>}
      {b.billId && <Button size="sm" variant="ghost" icon="receipt_long" onClick={() => nav(`/bills/${b.billId}`)}>Bill</Button>}
      {['Confirmed', 'Requested', 'Enquiry'].includes(b.status) && validWaNumber(b.phone) && (
        <Button size="sm" variant="ghost" icon="chat" title="Send the booking confirmation on WhatsApp" aria-label={`WhatsApp ${b.guestName}`}
          onClick={() => { try { sendWhatsApp(user, settings, { phone: b.phone, kind: 'reservation', vars: bookingVars(b, settings), bookingId: b.id, guestName: b.guestName }); } catch (e) { toast(errMsg(e), 'error'); } }} />
      )}
      {['Confirmed', 'Requested', 'Enquiry'].includes(b.status) && <>
        {b.checkIn <= t && <Button size="sm" variant="ghost" icon="person_off" onClick={() => setCancel({ b, noShow: true })}>No-show</Button>}
        <Button size="sm" variant="danger-ghost" icon="event_busy" onClick={() => setCancel({ b })}>Cancel</Button>
      </>}
    </div>
  );
  return (
    <ModulePage crumb={['Front desk', 'Bookings']} title="Bookings" subtitle="Reservations, availability and arrivals"
      actions={<Button icon="add" onClick={() => setEdit({})}>New booking</Button>}
      tabs={[{ id: 'list', label: 'Bookings', icon: 'list' }, { id: 'calendar', label: 'Calendar', icon: 'calendar_view_month' }]} tab={tab} onTab={setTab}>
      <Stats items={stats} />
      {tab === 'calendar' ? (
        <Calendar bookings={rows} bills={bills || []} onNew={(x) => setEdit(x)} onPick={(c) => (c.kind === 'bill' ? nav(`/bills/${c.item.id}`) : setEdit(c.item))} />
      ) : (
        <DataTable rows={bookings ? rows : null} onRow={(b) => setEdit(b)} actions={actions}
          search={(b) => `${b.number} ${b.guestName} ${b.phone} ${b.email} ${b.groupName} ${b.otaRef} ${b.roomNumber}`}
          filters={[
            { id: 'upcoming', label: 'Upcoming', test: (b) => ['Confirmed', 'Requested', 'Enquiry'].includes(b.status) && b.checkOut >= t },
            { id: 'today', label: 'Arriving today', test: (b) => b.checkIn === t && ['Confirmed', 'Requested', 'Enquiry'].includes(b.status) },
            { id: 'requests', label: 'Requests', test: (b) => b.status === 'Requested' },
            { id: 'inhouse', label: 'Checked in', test: (b) => b.status === 'Checked in' },
            { id: 'closed', label: 'Cancelled & no-show', test: (b) => ['Cancelled', 'No-show'].includes(b.status) },
            { id: 'all', label: 'All' },
          ]}
          empty="No bookings here. Create one with New booking, or share your booking page (Settings → Booking page)."
          columns={[
            { key: 'number', label: 'Booking', render: (b) => <><div className="font-semibold">{b.number}</div><div className="text-label-sm text-on-surface-variant">{b.source}{b.otaRef ? ` · ${b.otaRef}` : ''}</div></> },
            { key: 'guest', label: 'Guest', render: (b) => <><div className="font-semibold">{b.guestName}</div><div className="text-label-sm text-on-surface-variant">{b.phone || b.email || ''}{b.groupName ? ` · ${b.groupName}` : ''}</div></> },
            { key: 'stay', label: 'Stay', render: (b) => <><div>{fmtShort(b.checkIn)} → {fmtShort(b.checkOut)}</div><div className="text-label-sm text-on-surface-variant">{bookingNights(b)} night{bookingNights(b) === 1 ? '' : 's'} · {b.adults || 1} adult{(b.adults || 1) === 1 ? '' : 's'}{b.children ? ` + ${b.children}` : ''}</div></> },
            { key: 'room', label: 'Room', render: (b) => <><div>{b.roomNumber || <span className="text-on-surface-variant">Unassigned</span>}</div><div className="text-label-sm text-on-surface-variant">{b.roomType}{num(b.rooms) > 1 ? ` × ${b.rooms}` : ''}</div></> },
            { key: 'total', label: 'Total', right: true, render: (b) => <><div>{money(b.total || bookingTotal(b))}</div>{b.advance > 0 && <div className="text-label-sm text-on-ok-container">Adv. {money(b.advance)}</div>}</> },
            { key: 'status', label: 'Status', render: (b) => <Chip tone={TONES[b.status]}>{b.status}</Chip> },
          ]}
        />
      )}
      <BookingModal open={!!edit} initial={edit} onClose={() => setEdit(null)} bookings={rows} bills={bills || []} />
      {cancel && <CancelModal booking={cancel.b} noShow={cancel.noShow} onClose={() => setCancel(null)} />}
    </ModulePage>
  );
}
