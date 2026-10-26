import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, BedDouble } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { calcNights, computeBill, validateBill, CHARGE_PRESETS, round2, PAYMENT_STATUS } from '../lib/billing';
import { createBill, updateBill, getBill } from '../lib/db';
import { today, addDays } from '../lib/dates';
import { money, currencySymbol } from '../lib/format';
import GuestPicker from '../components/GuestPicker';
import { METHOD_OPTIONS } from '../components/RecordPaymentModal';
import { ChoiceGrid, Button, Card, Field, Input, Select, Textarea, Loading, useToast, errMsg, cx } from '../components/ui';
import { NightsStrip, Checklist, celebrate } from '../motion/hotel';
import { getRecord, saveRecord } from '../modules/kit';
import { getGuest, loyaltyOf, redeemPoints } from '../modules/billOps';
import { useOccupancy } from '../lib/useOccupancy';

const emptyGuest = { name: '', phone: '', email: '', address: '', gstin: '' };
const blankItem = () => ({ key: Math.random().toString(36).slice(2), description: '', quantity: 1, rate: '' });

function Section({ n, title, children, aside }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2.5 font-headline text-headline-sm text-on-surface">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-container text-label-sm font-semibold text-on-primary">{n}</span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

export default function BillForm() {
  const { id } = useParams();
  const isEdit = !!id;
  const { user } = useAuth();
  const { rooms, activeTaxes, roomTypes, settings } = useData();
  const occ = useOccupancy();
  const nav = useNavigate();
  const toast = useToast();

  const [loaded, setLoaded] = useState(!isEdit);
  const [existing, setExisting] = useState(null);
  const [form, setForm] = useState({
    guestId: null, guest: emptyGuest, roomId: '', roomNumber: '', roomType: '',
    checkIn: addDays(today(), -1), checkOut: today(), roomRate: '', items: [],
    discountType: 'none', discountValue: '', notes: '',
  });
  const [taxIds, setTaxIds] = useState(() => activeTaxes.map((t) => t.id));
  const [storedTaxes, setStoredTaxes] = useState([]); // taxes saved on the bill being edited
  const [payment, setPayment] = useState({ amount: '', method: 'Cash', referenceNumber: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [params] = useSearchParams();
  const [booking, setBooking] = useState(null);
  const [guestInfo, setGuestInfo] = useState(null);
  const [redeem, setRedeem] = useState(0);
  const L = loyaltyOf(settings);

  // Check-in from a booking: fill guest, room, dates, rate and the advance.
  useEffect(() => {
    const bid = params.get('booking');
    if (isEdit || !bid) return;
    getRecord('bookings', bid).then((b) => {
      if (!b) return;
      setBooking(b);
      const room = b.roomNumber ? rooms.find((r) => r.roomNumber === b.roomNumber) : null;
      setForm((f) => ({
        ...f, bookingId: b.id, source: b.source || '', groupName: b.groupName || '',
        guestId: b.guestId || null, guest: { ...emptyGuest, name: b.guestName || '', phone: b.phone || '', email: b.email || '' },
        roomId: room?.id || '', roomNumber: room?.roomNumber || '', roomType: room?.roomType || b.roomType || '',
        checkIn: b.checkIn < today() ? b.checkIn : today(), checkOut: b.checkOut, roomRate: b.rate ?? '',
        notes: [b.number && `Booking ${b.number}`, b.notes].filter(Boolean).join(' · '),
      }));
      if (b.advance > 0) setPayment((p) => ({ ...p, amount: String(b.advance), method: ['Cash', 'UPI', 'Card', 'Bank Transfer'].includes(b.advanceMethod) ? b.advanceMethod : 'Other', referenceNumber: b.otaRef || '' }));
    }).catch(() => {});
  }, [params, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Returning guest: show loyalty points, VIP or blacklist.
  useEffect(() => {
    if (!form.guestId) { setGuestInfo(null); setRedeem(0); return; }
    getGuest(form.guestId).then(setGuestInfo).catch(() => setGuestInfo(null));
  }, [form.guestId]);

  useEffect(() => {
    if (!isEdit) return;
    getBill(id).then((b) => {
      if (!b) { toast('Bill not found', 'error'); nav('/bills'); return; }
      if (b.paymentStatus === PAYMENT_STATUS.CANCELLED) { toast('Cancelled bills cannot be edited.', 'error'); nav(`/bills/${id}`); return; }
      if (b.paymentStatus === PAYMENT_STATUS.PAID) { toast('Settled bills are locked. Cancel and re-issue if a correction is needed.', 'error'); nav(`/bills/${id}`); return; }
      setExisting(b);
      setForm({
        guestId: b.guestId, guest: { ...emptyGuest, ...b.guest }, roomId: b.roomId, roomNumber: b.roomNumber, roomType: b.roomType,
        checkIn: b.checkIn, checkOut: b.checkOut, roomRate: b.roomRate,
        items: (b.items || []).map((it) => ({ ...it, key: Math.random().toString(36).slice(2) })),
        discountType: b.discountType || 'none', discountValue: b.discountValue || '', notes: b.notes || '',
      });
      const st = (b.taxes || []).map((t, i) => ({ ...t, id: t.id || `stored-${i}` }));
      setStoredTaxes(st);
      setTaxIds(st.map((t) => t.id));
      setLoaded(true);
    }).catch((e) => toast(errMsg(e), 'error'));
  }, [id, isEdit, nav, toast]);

  // Tax options: active taxes, plus any tax saved on the bill (keeps its stored rate).
  const taxOptions = useMemo(() => {
    const map = new Map(activeTaxes.map((t) => [t.id, { id: t.id, name: t.name, rate: t.rate }]));
    storedTaxes.forEach((t) => map.set(t.id, { id: t.id, name: t.name, rate: t.rate }));
    return [...map.values()];
  }, [activeTaxes, storedTaxes]);

  const nights = calcNights(form.checkIn, form.checkOut) || 0;
  const selectedTaxes = taxOptions.filter((t) => taxIds.includes(t.id));
  const computed = useMemo(() => computeBill({
    nights, roomRate: form.roomRate, items: form.items,
    discountType: form.discountType, discountValue: form.discountValue,
    taxes: selectedTaxes, paidAmount: isEdit ? existing?.paidAmount || 0 : payment.amount,
  }), [nights, form.roomRate, form.items, form.discountType, form.discountValue, selectedTaxes, isEdit, existing, payment.amount]);

  const liveErrors = submitted ? validateBill({ ...form, initialPayment: isEdit ? 0 : payment.amount }, computed) : {};
  if (submitted && isEdit && existing && computed.grandTotal + 0.001 < existing.paidAmount)
    liveErrors.total = `Total cannot be less than the ${money(existing.paidAmount)} already paid.`;
  const errs = submitted ? liveErrors : errors;

  const update = (patch) => setForm((f) => ({ ...f, ...patch }));
  const activeRooms = rooms.filter((r) => r.status !== 'inactive' || r.id === form.roomId);

  function pickRoom(roomId) {
    const r = rooms.find((x) => x.id === roomId);
    if (!r) return update({ roomId: '', roomNumber: '', roomType: '' });
    const typeRate = roomTypes.find((t) => t.name === r.roomType)?.defaultRate;
    update({ roomId: r.id, roomNumber: r.roomNumber, roomType: r.roomType, roomRate: booking && booking.rate ? booking.rate : (r.rate ?? typeRate ?? '') });
    if (!isEdit) {
      // Room tax configuration: specific taxes for this room, else all active taxes.
      const ids = r.taxMode === 'none' ? [] : r.taxMode === 'custom' && r.taxIds?.length ? r.taxIds.filter((t) => activeTaxes.some((a) => a.id === t)) : activeTaxes.map((t) => t.id);
      setTaxIds(ids);
    }
  }

  const setItem = (key, patch) => update({ items: form.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) });
  const addItem = (description = '') => update({ items: [...form.items, { ...blankItem(), description }] });
  const removeItem = (key) => update({ items: form.items.filter((it) => it.key !== key) });

  async function save() {
    setSubmitted(true);
    const v = validateBill({ ...form, initialPayment: isEdit ? 0 : payment.amount }, computed);
    if (isEdit && existing && computed.grandTotal + 0.001 < existing.paidAmount)
      v.total = `Total cannot be less than the ${money(existing.paidAmount)} already paid.`;
    if (!isEdit && Number(payment.amount) > 0 && !payment.method) v.payment = 'Select a payment method.';
    setErrors(v);
    if (Object.keys(v).length) {
      toast(Object.values(v)[0], 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, nights };
      if (isEdit) {
        await updateBill(user, id, payload, computed);
        toast('Bill updated');
        nav(`/bills/${id}`);
      } else {
        const res = await createBill(user, { ...payload, loyaltyRedeemed: redeem || 0 }, computed, { ...payment, amount: Number(payment.amount) || 0 });
        if (redeem > 0 && form.guestId) await redeemPoints(user, form.guestId, form.guest.name, redeem, { billId: res.id, invoiceNumber: res.invoiceNumber }).catch(() => {});
        if (form.bookingId) await saveRecord(user, 'bookings', form.bookingId, { status: 'Checked in', billId: res.id, roomNumber: form.roomNumber }, 'BOOKING_CHECKED_IN').catch(() => {});
        toast(`Invoice ${res.invoiceNumber} created`);
        if (res.invoiceSeq === Number(settings.invoiceStartNumber)) setTimeout(() => celebrate(`${res.invoiceNumber} is your first invoice`, 'Grand opening'), 600);
        else if (computed.paymentStatus === 'PAID' && computed.grandTotal > 0) setTimeout(() => celebrate(`${res.invoiceNumber} paid in full`, 'Settled at check-in'), 600);
        nav(`/bills/${res.id}?created=1`);
      }
    } catch (e) {
      toast(errMsg(e), 'error');
      setSaving(false);
    }
  }

  if (!loaded) return <Loading />;

  const sym = currencySymbol();
  const roomTypeLabel = form.roomType ? `${form.roomType} Room` : 'Room';

  return (
    <div>
      <div className="mb-5">
        <Link to={isEdit ? `/bills/${id}` : '/bills'} className="mb-1 inline-flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface"><ArrowLeft className="h-3.5 w-3.5" />Back</Link>
        <div className="mb-1 flex items-center gap-space-xs text-label-sm uppercase tracking-wider text-on-surface-variant"><span>Billing</span><span>/</span><span className="font-semibold text-secondary">{isEdit ? 'Edit Bill' : 'New Bill'}</span></div>
        <h1 className="font-headline text-headline-lg tracking-tight text-on-surface">{isEdit ? `Edit ${existing?.invoiceNumber}` : booking ? `Check in: ${booking.guestName}` : 'New Bill'}</h1>
        {booking && <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-secondary-container px-3 py-1 text-label-md text-on-secondary-container">From booking {booking.number} · {booking.source}{booking.advance > 0 ? ` · advance ${money(booking.advance)} added as payment` : ''}</p>}
        <p className="mt-0.5 text-body-md text-on-surface-variant">Guest → Room → Stay → Charges → Discount → Tax → Payment → Invoice</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Section n={1} title="Guest Details">
            <GuestPicker guestId={form.guestId} guest={form.guest} errors={errs} onChange={({ guestId, guest }) => update({ guestId, guest })} />
          </Section>

          <Section n={2} title="Room & Stay">
            {rooms.length === 0 ? (
              <div className="rounded-lg bg-error-container px-3 py-2 text-sm text-on-error-container">No rooms configured yet. An administrator needs to add rooms first.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Room" required error={errs.room} className="sm:col-span-2 lg:col-span-1">
                  <Select value={form.roomId} onChange={(e) => pickRoom(e.target.value)} invalid={!!errs.room}>
                    <option value="">Select room…</option>
                    {activeRooms.map((r) => <option key={r.id} value={r.id}>{r.roomNumber} — {r.roomType}{occ.occupied.has(r.roomNumber) && r.id !== form.roomId ? ' · occupied' : ''}</option>)}
                  </Select>
                </Field>
                <Field label="Check-in" required error={errs.checkIn}><Input type="date" value={form.checkIn} onChange={(e) => update({ checkIn: e.target.value })} /></Field>
                <Field label="Check-out" required error={errs.checkOut}><Input type="date" value={form.checkOut} min={form.checkIn} onChange={(e) => update({ checkOut: e.target.value })} invalid={!!errs.checkOut} /></Field>
                <Field label={`Room rate (${sym}/night)`} required error={errs.roomRate} hint="Default from room; editable">
                  <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.roomRate} onChange={(e) => update({ roomRate: e.target.value })} invalid={!!errs.roomRate} />
                </Field>
              </div>
            )}
            {nights > 0 && <div className="mt-4"><NightsStrip checkIn={form.checkIn} checkOut={form.checkOut} /></div>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-4 py-3 text-sm">
              <span className="flex items-center gap-2 text-slate-600"><BedDouble className="h-4 w-4" />
                Room charges: <b className="text-slate-800">{money(form.roomRate || 0)} × {nights} night{nights === 1 ? '' : 's'}</b>
              </span>
              <span className="font-semibold tabular-nums text-slate-900">{money(computed.roomAmount)}</span>
            </div>
          </Section>

          <Section n={3} title="Additional Charges" aside={<Button size="sm" variant="secondary" onClick={() => addItem()}><Plus className="h-4 w-4" />Add Charge</Button>}>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {CHARGE_PRESETS.map((p) => (
                <button type="button" key={p} onClick={() => addItem(p === 'Other' ? '' : p)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-surface-container hover:text-on-surface">+ {p}</button>
              ))}
            </div>
            {form.items.length === 0 ? (
              <p className="text-sm text-slate-500">No additional charges. Use the buttons above to add food, laundry, extra bed and more.</p>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-[1fr_80px_110px_110px_36px] gap-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-500 sm:grid">
                  <span>Description</span><span>Qty</span><span>Rate</span><span className="text-right">Amount</span><span />
                </div>
                {form.items.map((it, i) => (
                  <div key={it.key}>
                    <div className="grid grid-cols-[1fr_36px] gap-2 rounded-lg border border-slate-100 p-2 sm:grid-cols-[1fr_80px_110px_110px_36px] sm:border-0 sm:p-0">
                      <Input placeholder="Description" value={it.description} onChange={(e) => setItem(it.key, { description: e.target.value })} list="charge-presets" />
                      <button type="button" onClick={() => removeItem(it.key)} className="flex items-center justify-center rounded-lg text-slate-400 hover:bg-error-container hover:text-error sm:order-last" aria-label="Remove charge"><Trash2 className="h-4 w-4" /></button>
                      <div className="col-span-2 grid grid-cols-3 gap-2 sm:col-span-3 sm:grid-cols-[80px_110px_110px] sm:contents">
                        <Input type="number" min="0" step="1" inputMode="numeric" value={it.quantity} onChange={(e) => setItem(it.key, { quantity: e.target.value })} aria-label="Quantity" />
                        <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="Rate" value={it.rate} onChange={(e) => setItem(it.key, { rate: e.target.value })} aria-label="Rate" />
                        <div className="flex h-10 items-center justify-end px-1 text-sm font-medium tabular-nums text-slate-800">{money(round2((Number(it.quantity) || 0) * (Number(it.rate) || 0)))}</div>
                      </div>
                    </div>
                    {errs[`item${i}`] && <span className="mt-1 block text-xs text-error">{errs[`item${i}`]}</span>}
                  </div>
                ))}
                <datalist id="charge-presets">{CHARGE_PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
              </div>
            )}
          </Section>

          <Section n={4} title="Discount & Tax">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-sm font-medium text-slate-700">Discount</div>
                <div className="flex gap-2">
                  <Select className="w-44" value={form.discountType} onChange={(e) => update({ discountType: e.target.value, discountValue: e.target.value === 'none' ? '' : form.discountValue })}>
                    <option value="none">No discount</option>
                    <option value="percent">Percentage (%)</option>
                    <option value="fixed">Fixed ({sym})</option>
                  </Select>
                  {form.discountType !== 'none' && (
                    <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder={form.discountType === 'percent' ? '10' : '500'} value={form.discountValue} onChange={(e) => update({ discountValue: e.target.value })} invalid={!!errs.discount} />
                  )}
                </div>
                {errs.discount && <span className="mt-1 block text-xs text-error">{errs.discount}</span>}
                {form.discountType !== 'none' && computed.discountAmount > 0 && <p className="mt-1 text-xs text-slate-500">Discount amount: {money(computed.discountAmount)}</p>}
              </div>
              <div>
                <div className="mb-1 text-sm font-medium text-slate-700">Taxes applied</div>
                {taxOptions.length === 0 ? <p className="text-sm text-slate-500">No active taxes configured.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {taxOptions.map((t) => {
                      const on = taxIds.includes(t.id);
                      return (
                        <button type="button" key={t.id} onClick={() => setTaxIds(on ? taxIds.filter((x) => x !== t.id) : [...taxIds, t.id])}
                          className={cx('rounded-lg border px-3 py-2 text-sm font-medium', on ? 'border-transparent bg-primary-container text-on-primary' : 'border-slate-200 text-slate-500 line-through')}>
                          {t.name} {t.rate}%
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            {guestInfo && (guestInfo.vip || guestInfo.blacklisted || (L.enabled && guestInfo.points > 0)) && (
              <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-surface-container-low px-3 py-2 text-body-md">
                {guestInfo.vip && <span className="rounded-full bg-secondary-container px-2 py-0.5 text-label-sm font-semibold text-on-secondary-container">VIP guest</span>}
                {guestInfo.blacklisted && <span className="rounded-full bg-error-container px-2 py-0.5 text-label-sm font-semibold text-on-error-container">Blacklisted{guestInfo.blacklistReason ? `: ${guestInfo.blacklistReason}` : ''}</span>}
                {L.enabled && guestInfo.points > 0 && !isEdit && (
                  <span className="flex flex-wrap items-center gap-2">
                    <span><b>{guestInfo.points}</b> loyalty points (worth {money(guestInfo.points * L.redeemValue)})</span>
                    {guestInfo.points >= L.minRedeem && (redeem > 0 ? (
                      <button type="button" className="text-secondary hover:underline" onClick={() => { update({ discountType: 'none', discountValue: '' }); setRedeem(0); }}>Remove redemption</button>
                    ) : (
                      <button type="button" className="font-semibold text-secondary hover:underline" onClick={() => {
                        const maxPts = Math.min(guestInfo.points, Math.floor(computed.subtotal / (L.redeemValue || 1)));
                        if (maxPts <= 0) return;
                        setRedeem(maxPts);
                        update({ discountType: 'fixed', discountValue: String((form.discountType === 'fixed' ? Number(form.discountValue) || 0 : 0) + maxPts * L.redeemValue) });
                      }}>Redeem as discount</button>
                    ))}
                    {redeem > 0 && <span className="text-on-ok-container">{redeem} points applied</span>}
                  </span>
                )}
              </div>
            )}
            <Field label="Notes (internal, optional)" className="mt-4"><Textarea rows={2} value={form.notes} onChange={(e) => update({ notes: e.target.value })} /></Field>
          </Section>
        </div>

        {/* Summary + payment */}
        <div className="space-y-4 lg:sticky lg:top-20">
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 font-headline text-headline-sm text-on-surface">Check-in checklist</h2>
            <Checklist items={[
              { label: 'Guest details', done: !!form.guest?.name?.trim() },
              { label: 'Room & dates', done: !!form.roomId && nights > 0 && Number(form.roomRate) > 0 },
              { label: 'Charges & tax', done: computed.grandTotal > 0 },
              isEdit ? { label: 'Changes reviewed', done: computed.grandTotal > 0 && !!form.roomId } : { label: 'Payment received', done: Number(payment.amount) > 0, optional: true },
            ]} />
          </Card>
          <Card className="p-4 sm:p-5">
            <h2 className="mb-3 font-headline text-headline-sm text-on-surface">Bill Summary</h2>
            <dl className="space-y-1.5 text-sm">
              <Row label={`${roomTypeLabel} (${nights} × ${money(form.roomRate || 0)})`} value={money(computed.roomAmount)} />
              {computed.items.map((it, i) => <Row key={i} label={`${it.description || 'Item'}${it.quantity !== 1 ? ` × ${it.quantity}` : ''}`} value={money(it.amount)} muted />)}
              <div className="my-2 border-t border-dashed border-slate-200" />
              <Row label="Subtotal" value={money(computed.subtotal)} />
              {computed.discountAmount > 0 && <Row label={`Discount${form.discountType === 'percent' ? ` (${form.discountValue}%)` : ''}`} value={`-${money(computed.discountAmount)}`} />}
              {computed.discountAmount > 0 && <Row label="Taxable amount" value={money(computed.taxableAmount)} muted />}
              {computed.taxes.map((t, i) => <Row key={i} label={`${t.name} @ ${t.rate}%`} value={money(t.amount)} muted />)}
              {computed.taxes.length > 0 && <Row label="Total tax" value={money(computed.taxAmount)} />}
            </dl>
            <div className="mt-3 flex items-baseline justify-between rounded-xl bg-primary-container px-4 py-3 text-on-primary">
              <span className="text-sm font-medium">Grand Total</span>
              <span className="text-2xl font-semibold tabular-nums">{money(computed.grandTotal)}</span>
            </div>
            {errs.total && <p className="mt-2 text-xs text-error">{errs.total}</p>}
          </Card>

          {isEdit ? (
            <Card className="p-4 text-sm sm:p-5">
              <Row label="Already paid" value={money(existing?.paidAmount)} />
              <Row label="New balance" value={money(computed.balanceAmount)} bold />
              <p className="mt-2 text-xs text-slate-500">Payments are recorded from the bill page, not here.</p>
            </Card>
          ) : (
            <Card className="p-4 sm:p-5">
              <h2 className="mb-3 font-headline text-headline-sm text-on-surface">Payment</h2>
              <div className="space-y-3">
                <ChoiceGrid options={METHOD_OPTIONS} value={payment.method} onChange={(m) => setPayment({ ...payment, method: m })} />
                <Field label="Amount received" error={errs.payment}>
                  <div className="flex gap-2">
                    <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} invalid={!!errs.payment} />
                    <Button type="button" variant="secondary" onClick={() => setPayment({ ...payment, amount: String(computed.grandTotal) })}>Full</Button>
                  </div>
                </Field>
                {payment.method !== 'Cash' && Number(payment.amount) > 0 && (
                  <Field label="Reference / Txn ID (optional)"><Input value={payment.referenceNumber} onChange={(e) => setPayment({ ...payment, referenceNumber: e.target.value })} /></Field>
                )}
                <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <Row label="Paid" value={money(computed.paidAmount)} />
                  <Row label="Balance" value={money(computed.balanceAmount)} bold />
                  <Row label="Status" value={computed.grandTotal <= 0 ? '—' : computed.paymentStatus === 'PAID' ? 'PAID' : computed.paymentStatus === 'PARTIALLY_PAID' ? 'PARTIALLY PAID' : 'PENDING'} />
                </div>
                <p className="text-xs text-slate-500">Leave amount empty to save as pending. More payments can be added later.</p>
              </div>
            </Card>
          )}

          <Button size="lg" className="w-full" loading={saving} onClick={save}>
            {isEdit ? 'Save changes' : 'Save & Generate Invoice'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, muted, bold }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={cx('truncate', muted ? 'text-slate-500' : 'text-slate-700')}>{label}</dt>
      <dd className={cx('tabular-nums', bold ? 'font-semibold text-slate-900' : 'text-slate-800')}>{value}</dd>
    </div>
  );
}
