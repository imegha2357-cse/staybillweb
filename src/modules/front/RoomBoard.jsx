// Room board: live status of every room, arrivals, departures, in-house
// guests, room moves, stay extensions, check-out, groups and the Form C
// register for foreign guests.
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { arrayUnion, runTransaction, serverTimestamp, updateDoc } from '../../backend/firestore';
import { db } from '../../firebase';
import { hdoc } from '../../lib/scope';
import { actor } from '../../lib/db';
import { calcNights, computeBill, round2, statusFor } from '../../lib/billing';
import { addDays } from '../../lib/dates';
import { downloadCsv } from '../../lib/csv';
import { downloadInvoicesPdf } from '../../lib/pdf';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Modal, Select, Textarea, cx, useToast, useConfirm, errMsg } from '../../components/ui';
import { Chip, DataTable, FormFields, ModulePage, Panel, RecordModal, Stats, fmtShort, money, saveRecord, today, useLive, num } from '../kit';
import { checkOutBill } from '../billOps';
import { MinibarModal } from '../stock/Inventory';

export const HK = {
  clean: { label: 'Vacant clean', tone: 'ok', icon: 'check_circle' },
  inspected: { label: 'Inspected', tone: 'ok', icon: 'verified' },
  dirty: { label: 'Vacant dirty', tone: 'warn', icon: 'mop' },
  out_of_order: { label: 'Out of order', tone: 'error', icon: 'block' },
};

export async function setRoomStatus(user, room, hkStatus, extra = {}) {
  await updateDoc(hdoc('rooms', room.id), { hkStatus, hkUpdatedAt: serverTimestamp(), hkUpdatedBy: actor(user), ...extra });
}

/** Moves an in-house guest to another room (same rate). */
async function moveRoom(user, bill, to, from) {
  await updateDoc(hdoc('bills', bill.id), {
    roomId: to.id, roomNumber: to.roomNumber, roomType: to.roomType,
    roomMoves: arrayUnion({ from: bill.roomNumber, to: to.roomNumber, on: today(), by: user.name || '' }),
    updatedAt: serverTimestamp(), updatedBy: actor(user),
  });
  if (from) await setRoomStatus(user, from, 'dirty').catch(() => {});
}
/** Changes the check-out date and recalculates the room charge. */
async function changeStay(user, billId, checkOut) {
  return runTransaction(db, async (tx) => {
    const r = hdoc('bills', billId);
    const s = await tx.get(r);
    const b = s.data();
    if (b.paymentStatus === 'PAID' && checkOut > b.checkOut) {
      // a settled bill reopens: the extra nights become the balance
    }
    const nights = calcNights(b.checkIn, checkOut);
    if (!(nights > 0)) throw new Error('Check-out must be after check-in.');
    const c = computeBill({ nights, roomRate: b.roomRate, items: b.items || [], discountType: b.discountType || 'none', discountValue: b.discountValue || 0, taxes: (b.taxes || []).map((t) => ({ id: t.id, name: t.name, rate: t.rate })), paidAmount: b.paidAmount });
    if (c.grandTotal + 0.001 < b.paidAmount) throw new Error(`The new total would be less than the ${money(b.paidAmount)} already paid.`);
    tx.update(r, {
      checkOut, nights, roomAmount: c.roomAmount, subtotal: c.subtotal, discountAmount: c.discountAmount, taxableAmount: c.taxableAmount,
      taxes: c.taxes, taxAmount: c.taxAmount, grandTotal: c.grandTotal, balanceAmount: round2(Math.max(c.grandTotal - b.paidAmount, 0)),
      paymentStatus: statusFor(c.grandTotal, b.paidAmount), updatedAt: serverTimestamp(), updatedBy: actor(user),
    });
    return c;
  });
}

function RoomActions({ cell, onClose, freeRooms }) {
  const { user } = useAuth();
  const { rooms, settings } = useData();
  const nav = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [mode, setMode] = useState('');
  const [val, setVal] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [minibar, setMinibar] = useState(false);
  if (!cell) return null;
  const { room, bill, arrival } = cell;
  const run = async (fn, ok) => { setBusy(true); try { await fn(); toast(ok); onClose(); } catch (e) { toast(errMsg(e), 'error'); } setBusy(false); };
  return (
    <Modal open onClose={onClose} title={`Room ${room.roomNumber} · ${room.roomType}`} icon="meeting_room">
      <div className="space-y-space-md pb-space-sm">
        {bill && (
          <div className="rounded-xl bg-surface-container-low p-space-md">
            <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">In house</div>
            <div className="font-headline text-headline-sm">{bill.guestName}</div>
            <div className="text-body-md text-on-surface-variant">{fmtShort(bill.checkIn)} → {fmtShort(bill.checkOut)} · {bill.invoiceNumber} · balance {money(bill.balanceAmount)}</div>
            <div className="mt-space-sm flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon="receipt_long" onClick={() => nav(`/bills/${bill.id}`)}>Open bill</Button>
              <Button size="sm" variant="secondary" icon="swap_horiz" onClick={() => setMode('move')}>Move room</Button>
              <Button size="sm" variant="secondary" icon="date_range" onClick={() => { setMode('extend'); setVal(bill.checkOut); }}>Change check-out</Button>
              <Button size="sm" variant="secondary" icon="local_bar" onClick={() => setMinibar(true)}>Minibar</Button>
              <Button size="sm" icon="logout" onClick={async () => {
                if (bill.balanceAmount > 0 && !(await confirm(`${bill.guestName} still owes ${money(bill.balanceAmount)}. Check out anyway? The bill stays open for payment.`, { title: 'Balance due', confirmLabel: 'Check out', danger: false }))) return;
                run(() => checkOutBill(user, bill, { rooms, settings }), `${bill.guestName} checked out. Room ${room.roomNumber} sent to housekeeping.`);
              }}>Check out</Button>
            </div>
            {mode === 'move' && (
              <div className="mt-space-sm flex flex-wrap items-end gap-2">
                <Field label="Move to"><Select className="w-56" value={val} onChange={(e) => setVal(e.target.value)}><option value="">Choose a free room…</option>{freeRooms.map((r) => <option key={r.id} value={r.id}>{r.roomNumber} · {r.roomType}</option>)}</Select></Field>
                <Button size="sm" disabled={!val} loading={busy} onClick={() => run(() => moveRoom(user, bill, rooms.find((r) => r.id === val), room), `${bill.guestName} moved to room ${rooms.find((r) => r.id === val)?.roomNumber}`)}>Move</Button>
              </div>
            )}
            {mode === 'extend' && (
              <div className="mt-space-sm flex flex-wrap items-end gap-2">
                <Field label="New check-out"><Input type="date" min={addDays(bill.checkIn, 1)} value={val} onChange={(e) => setVal(e.target.value)} /></Field>
                <Button size="sm" loading={busy} onClick={() => run(() => changeStay(user, bill.id, val), `Stay updated to ${fmtShort(val)}`)}>Save</Button>
              </div>
            )}
          </div>
        )}
        {arrival && !bill && (
          <div className="rounded-xl bg-secondary-container/40 p-space-md">
            <div className="text-label-sm uppercase tracking-wider text-on-surface-variant">Arriving today</div>
            <div className="font-headline text-headline-sm">{arrival.guestName}</div>
            <div className="text-body-md text-on-surface-variant">{arrival.number} · {arrival.source}</div>
            <Button className="mt-space-sm" size="sm" icon="login" onClick={() => nav(`/bills/new?booking=${arrival.id}`)}>Check in</Button>
          </div>
        )}
        {!bill && (
          <div>
            <div className="mb-1 text-label-sm uppercase tracking-wider text-on-surface-variant">Housekeeping status</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(HK).map(([k, h]) => (
                <Button key={k} size="sm" variant={(room.hkStatus || 'clean') === k ? 'primary' : 'secondary'} icon={h.icon} onClick={() => (k === 'out_of_order' ? setMode('ooo') : run(() => setRoomStatus(user, room, k, { oooReason: '' }), `Room ${room.roomNumber}: ${h.label}`))}>{h.label}</Button>
              ))}
            </div>
            {mode === 'ooo' && (
              <div className="mt-space-sm space-y-2">
                <Field label="Reason"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. AC not working" /></Field>
                <Button size="sm" variant="danger" loading={busy} onClick={() => run(() => setRoomStatus(user, room, 'out_of_order', { oooReason: reason.trim() }), `Room ${room.roomNumber} is out of order`)}>Mark out of order</Button>
              </div>
            )}
            {room.oooReason && room.hkStatus === 'out_of_order' && <p className="mt-2 text-body-md text-error">Out of order: {room.oooReason}</p>}
          </div>
        )}
      </div>
      {minibar && bill && <MinibarModal bill={bill} onClose={() => { setMinibar(false); onClose(); }} />}
    </Modal>
  );
}

const FORM_C = [
  { key: 'nationality', label: 'Nationality', required: true, half: true },
  { key: 'passportNo', label: 'Passport number', required: true, half: true, upper: true },
  { key: 'passportExpiry', label: 'Passport valid until', type: 'date', half: true },
  { key: 'visaNo', label: 'Visa number', half: true, upper: true },
  { key: 'visaType', label: 'Visa type', type: 'select', options: ['Tourist', 'Business', 'e-Visa', 'Employment', 'Student', 'Medical', 'OCI / PIO', 'Other'], half: true },
  { key: 'visaExpiry', label: 'Visa valid until', type: 'date', half: true },
  { key: 'arrivedInIndia', label: 'Arrived in India on', type: 'date', half: true },
  { key: 'arrivedFrom', label: 'Arrived from (city, country)', half: true },
  { key: 'nextDestination', label: 'Next destination', half: true },
  { key: 'purpose', label: 'Purpose of visit', half: true },
  { key: 'idImage', label: 'Passport / visa photo', type: 'image' },
];
export const ID_FIELDS = [
  { key: 'idType', label: 'ID proof', type: 'select', options: ['Aadhaar', 'Passport', 'Driving licence', 'Voter ID', 'PAN', 'Other'], half: true },
  { key: 'idNumber', label: 'ID number', half: true, hint: 'For Aadhaar, store only the last 4 digits.' },
  { key: 'idImage', label: 'ID photo', type: 'image' },
];

export default function RoomBoard() {
  const { rooms, settings } = useData();
  const t = today();
  const bills = useLive('bills', { where: [['checkOut', '>=', addDays(t, -2)]] });
  const bookings = useLive('bookings', { where: [['checkIn', '==', t]] });
  const [cell, setCell] = useState(null);
  const [tab, setTab] = useState('board');
  const [formC, setFormC] = useState(null);
  const [groupBusy, setGroupBusy] = useState('');
  const toast = useToast();
  const nav = useNavigate();

  const inHouse = useMemo(() => (bills || []).filter((b) => b.paymentStatus !== 'CANCELLED' && !b.checkedOutAt && b.checkIn <= t && b.checkOut >= t), [bills, t]);
  const departures = inHouse.filter((b) => b.checkOut <= t);
  const arrivals = (bookings || []).filter((b) => ['Confirmed', 'Requested', 'Enquiry'].includes(b.status));
  const cells = rooms.filter((r) => r.status !== 'inactive').map((room) => {
    const bill = inHouse.find((b) => b.roomNumber === room.roomNumber);
    const arrival = arrivals.find((b) => b.roomNumber === room.roomNumber);
    let state = room.hkStatus || 'clean';
    if (bill) state = bill.checkOut <= t ? 'due_out' : 'occupied';
    else if (state !== 'out_of_order' && arrival) state = 'arriving';
    return { room, bill, arrival, state };
  });
  const freeRooms = cells.filter((c) => !c.bill && ['clean', 'inspected'].includes(c.state)).map((c) => c.room);
  const count = (s) => cells.filter((c) => c.state === s).length;
  const occ = cells.filter((c) => c.bill).length;
  const STATE = {
    occupied: { label: 'Occupied', cls: 'bg-primary-container text-on-primary' },
    due_out: { label: 'Due out', cls: 'bg-secondary-container text-on-secondary-container ring-2 ring-secondary' },
    arriving: { label: 'Arriving', cls: 'bg-surface-container-high text-on-surface ring-2 ring-dashed ring-secondary' },
    clean: { label: 'Vacant clean', cls: 'bg-ok-container text-on-ok-container' },
    inspected: { label: 'Inspected', cls: 'bg-ok-container text-on-ok-container' },
    dirty: { label: 'Vacant dirty', cls: 'bg-warn-container text-on-warn-container' },
    out_of_order: { label: 'Out of order', cls: 'bg-error-container text-on-error-container' },
  };
  const foreign = inHouse.filter((b) => b.guest?.nationality && !/^(indian|india)$/i.test(b.guest.nationality));
  const groups = useMemo(() => {
    const m = new Map();
    (bills || []).filter((b) => b.groupName && b.paymentStatus !== 'CANCELLED').forEach((b) => { if (!m.has(b.groupName)) m.set(b.groupName, []); m.get(b.groupName).push(b); });
    return [...m.entries()].map(([name, list]) => ({ name, list, total: list.reduce((a, b) => a + b.grandTotal, 0), balance: list.reduce((a, b) => a + b.balanceAmount, 0) }));
  }, [bills]);

  return (
    <ModulePage crumb={['Front desk', 'Room board']} title="Room board" subtitle={`Today, ${fmtShort(t)} · ${occ} of ${cells.length} rooms occupied`}
      tabs={[{ id: 'board', label: 'Rooms', icon: 'grid_view' }, { id: 'lists', label: 'Arrivals & departures', icon: 'swap_vert' }, { id: 'groups', label: 'Groups', icon: 'groups', count: groups.length }, { id: 'formc', label: 'Form C register', icon: 'badge', count: foreign.length }]} tab={tab} onTab={setTab}>
      <Stats items={[
        { label: 'Occupied', value: `${occ}/${cells.length}`, icon: 'bed', sub: cells.length ? `${Math.round((occ / cells.length) * 100)}% occupancy` : '' },
        { label: 'Arrivals today', value: arrivals.length, icon: 'flight_land', sub: `${arrivals.filter((b) => !b.roomNumber).length} without a room yet` },
        { label: 'Departures today', value: departures.length, icon: 'flight_takeoff', tone: departures.some((b) => b.balanceAmount > 0) ? 'error' : undefined, sub: `${money(departures.reduce((a, b) => a + b.balanceAmount, 0))} to collect` },
        { label: 'To clean / out of order', value: `${count('dirty')} / ${count('out_of_order')}`, icon: 'cleaning_services', sub: `${count('clean') + count('inspected')} ready to sell` },
      ]} />
      {tab === 'board' && (
        <Panel title="All rooms" icon="grid_view" actions={<div className="flex flex-wrap gap-1.5">{Object.entries(STATE).map(([k, s]) => <span key={k} className={cx('rounded-full px-2 py-0.5 text-label-sm', s.cls)}>{s.label} {count(k)}</span>)}</div>}>
          {cells.length === 0 ? <p className="text-body-md text-on-surface-variant">Add rooms under Rooms & Tariffs.</p> : (
            <div className="grid grid-cols-2 gap-space-sm sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
              {cells.map((c) => (
                <button key={c.room.id} type="button" onClick={() => setCell(c)} className={cx('rounded-xl p-3 text-left transition-transform hover:-translate-y-0.5', STATE[c.state].cls)}>
                  <div className="flex items-center justify-between"><span className="font-headline text-headline-sm">{c.room.roomNumber}</span>{c.bill?.balanceAmount > 0 && <Icon name="currency_rupee" size={14} />}</div>
                  <div className="truncate text-label-sm opacity-80">{c.room.roomType}</div>
                  <div className="mt-1 truncate text-label-md font-semibold">{c.bill ? c.bill.guestName : c.arrival ? c.arrival.guestName : STATE[c.state].label}</div>
                  <div className="truncate text-label-sm opacity-80">{c.bill ? `until ${fmtShort(c.bill.checkOut)}` : c.state === 'out_of_order' ? c.room.oooReason || 'Out of order' : c.arrival ? 'Arriving today' : ''}</div>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}
      {tab === 'lists' && (
        <div className="grid gap-space-md lg:grid-cols-2">
          <Panel title={`Arrivals today (${arrivals.length})`} icon="flight_land">
            {arrivals.length === 0 ? <p className="text-body-md text-on-surface-variant">No bookings arriving today.</p> : arrivals.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 border-b border-surface-container py-2 last:border-0">
                <div><div className="font-semibold">{b.guestName}</div><div className="text-label-md text-on-surface-variant">{b.number} · {b.roomType}{b.roomNumber ? ` · room ${b.roomNumber}` : ''} · {b.source}</div></div>
                <Button size="sm" icon="login" onClick={() => nav(`/bills/new?booking=${b.id}`)}>Check in</Button>
              </div>
            ))}
          </Panel>
          <Panel title={`Departures today (${departures.length})`} icon="flight_takeoff">
            {departures.length === 0 ? <p className="text-body-md text-on-surface-variant">Nobody is due to check out today.</p> : departures.map((b) => (
              <button type="button" key={b.id} onClick={() => setCell(cells.find((c) => c.bill?.id === b.id))} className="flex w-full items-center justify-between gap-2 border-b border-surface-container py-2 text-left last:border-0">
                <div><div className="font-semibold">Room {b.roomNumber} · {b.guestName}</div><div className="text-label-md text-on-surface-variant">{b.invoiceNumber}</div></div>
                {b.balanceAmount > 0 ? <Chip tone="error">{money(b.balanceAmount)} due</Chip> : <Chip tone="ok">Settled</Chip>}
              </button>
            ))}
          </Panel>
          <div className="lg:col-span-2">
            <DataTable rows={bills ? inHouse : null} dense onRow={(b) => setCell(cells.find((c) => c.bill?.id === b.id))}
              search={(b) => `${b.roomNumber} ${b.guestName} ${b.invoiceNumber}`}
              columns={[
                { key: 'room', label: 'Room', render: (b) => <b>{b.roomNumber}</b> },
                { key: 'guest', label: 'In-house guest', render: (b) => b.guestName },
                { key: 'stay', label: 'Stay', render: (b) => `${fmtShort(b.checkIn)} → ${fmtShort(b.checkOut)}` },
                { key: 'bal', label: 'Balance', right: true, render: (b) => money(b.balanceAmount) },
              ]} empty="No guests in house." />
          </div>
        </div>
      )}
      {tab === 'groups' && (
        groups.length === 0 ? <Panel title="Groups"><p className="text-body-md text-on-surface-variant">Give bookings or bills a group / company name to bill them together here.</p></Panel> : groups.map((g) => (
          <Panel key={g.name} title={g.name} icon="groups" actions={<>
            <Chip tone={g.balance > 0 ? 'warn' : 'ok'}>{g.list.length} rooms · {money(g.total)} · {money(g.balance)} due</Chip>
            <Button size="sm" variant="secondary" icon="picture_as_pdf" loading={groupBusy === g.name} onClick={async () => {
              setGroupBusy(g.name);
              try { await downloadInvoicesPdf(g.list.map((bill) => ({ bill, payments: [] })), settings, `group-${g.name.replace(/\W+/g, '-')}.pdf`); } catch (e) { toast(errMsg(e), 'error'); }
              setGroupBusy('');
            }}>Group invoices PDF</Button>
          </>}>
            <div className="divide-y divide-surface-container">
              {g.list.map((b) => <div key={b.id} className="flex justify-between py-1.5 text-body-md"><span>Room {b.roomNumber} · {b.guestName} · {b.invoiceNumber}</span><span className="tabular-nums">{money(b.grandTotal)}{b.balanceAmount > 0 ? ` · ${money(b.balanceAmount)} due` : ''}</span></div>)}
            </div>
          </Panel>
        ))
      )}
      {tab === 'formc' && (
        <>
          <DataTable rows={bills ? foreign : null}
            toolbar={<Button size="sm" variant="secondary" icon="file_download" onClick={() => downloadCsv(`form-c-${t}.csv`, ['Guest', 'Nationality', 'Passport', 'Passport valid until', 'Visa', 'Visa type', 'Visa valid until', 'Arrived in India', 'Arrived from', 'Check-in', 'Check-out', 'Room', 'Next destination', 'Purpose'],
              foreign.map((b) => [b.guestName, b.guest?.nationality, b.guest?.passportNo, b.guest?.passportExpiry, b.guest?.visaNo, b.guest?.visaType, b.guest?.visaExpiry, b.guest?.arrivedInIndia, b.guest?.arrivedFrom, b.checkIn, b.checkOut, b.roomNumber, b.guest?.nextDestination, b.guest?.purpose]))}>Export CSV</Button>}
            columns={[
              { key: 'g', label: 'Guest', render: (b) => <><b>{b.guestName}</b><div className="text-label-sm text-on-surface-variant">{b.guest?.nationality}</div></> },
              { key: 'p', label: 'Passport / visa', render: (b) => <>{b.guest?.passportNo || <Chip tone="error">Missing</Chip>}<div className="text-label-sm text-on-surface-variant">{b.guest?.visaType || ''} {b.guest?.visaNo || ''}</div></> },
              { key: 's', label: 'Stay', render: (b) => `${fmtShort(b.checkIn)} → ${fmtShort(b.checkOut)} · room ${b.roomNumber}` },
            ]}
            actions={(b) => <Button size="sm" variant="secondary" icon="edit" onClick={() => setFormC(b)}>Details</Button>}
            empty="No foreign guests in house. Set a guest's nationality on the guest page and their passport and visa details appear here." />
          <p className="text-label-md text-on-surface-variant">Submit Form C on the Bureau of Immigration portal (indianfrro.gov.in) within 24 hours of a foreign guest's arrival. Use the details here and the CSV.</p>
          {formC && <RecordModal open title={`Form C details: ${formC.guestName}`} icon="badge" wide collection="guests" label="FORM_C" fields={FORM_C}
            initial={{ id: formC.guestId, ...(formC.guest || {}) }} onClose={() => setFormC(null)}
            onSaved={async (_, data) => {
              const keys = ['nationality', 'passportNo', 'passportExpiry', 'visaNo', 'visaType', 'visaExpiry', 'arrivedInIndia', 'arrivedFrom', 'nextDestination', 'purpose'];
              await updateDoc(hdoc('bills', formC.id), { guest: { ...(formC.guest || {}), ...Object.fromEntries(keys.map((k) => [k, data[k] || ''])) } }).catch(() => {});
            }} />}
        </>
      )}
      <RoomActions cell={cell} onClose={() => setCell(null)} freeRooms={freeRooms} />
    </ModulePage>
  );
}
