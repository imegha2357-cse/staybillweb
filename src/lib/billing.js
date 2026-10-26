// Core billing logic (PRD §54). Pure functions — no Firebase imports — so they
// can be unit-tested and reused for both the live form and the stored bill.

export const PAYMENT_STATUS = {
  PAID: 'PAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  PENDING: 'PENDING',
  CANCELLED: 'CANCELLED',
};

export const STATUS_LABEL = {
  PAID: 'Paid',
  PARTIALLY_PAID: 'Partially Paid',
  PENDING: 'Pending',
  CANCELLED: 'Cancelled',
};

export const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer', 'Other'];

export const DEFAULT_ROOM_TYPES = ['Standard', 'Deluxe', 'Premium', 'Suite', 'Family Room'];

export const CHARGE_PRESETS = ['Food', 'Laundry', 'Extra Bed', 'Transport', 'Service Charge', 'Other'];

/** Round to 2 decimals, avoiding binary float drift (e.g. 432.499999). */
export function round2(n) {
  const v = Number(n) || 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Parse 'YYYY-MM-DD' as a local calendar date at midnight. */
function parseDay(s) {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/**
 * Nights between check-in and check-out. Same-day stays count as 1 night
 * (hotels charge a minimum of one night). Returns null if invalid.
 */
export function calcNights(checkIn, checkOut) {
  const a = parseDay(checkIn);
  const b = parseDay(checkOut);
  if (!a || !b) return null;
  const diff = Math.round((b - a) / 86400000);
  if (diff < 0) return null;
  return Math.max(1, diff);
}

export function lineAmount(qty, rate) {
  return round2((Number(qty) || 0) * (Number(rate) || 0));
}

/**
 * Compute every figure on a bill.
 * @param {object} input
 *  - nights, roomRate
 *  - items: [{description, quantity, rate}]
 *  - discountType: 'none' | 'percent' | 'fixed'
 *  - discountValue
 *  - taxes: [{id, name, rate}] — taxes applied to this bill
 *  - paidAmount
 */
export function computeBill({
  nights = 0,
  roomRate = 0,
  items = [],
  discountType = 'none',
  discountValue = 0,
  taxes = [],
  paidAmount = 0,
}) {
  const roomAmount = lineAmount(nights, roomRate);
  const cleanItems = items
    .filter((it) => (it.description || '').trim() !== '' || Number(it.rate) > 0)
    .map((it) => ({
      description: (it.description || '').trim(),
      quantity: Number(it.quantity) || 0,
      rate: round2(it.rate),
      amount: lineAmount(it.quantity, it.rate),
    }));
  const additionalTotal = round2(cleanItems.reduce((s, it) => s + it.amount, 0));
  const subtotal = round2(roomAmount + additionalTotal);

  let discountAmount = 0;
  const dv = Number(discountValue) || 0;
  if (discountType === 'percent') discountAmount = round2((subtotal * dv) / 100);
  else if (discountType === 'fixed') discountAmount = round2(dv);
  discountAmount = Math.min(Math.max(discountAmount, 0), subtotal);

  const taxableAmount = round2(subtotal - discountAmount);
  const taxLines = taxes.map((t) => ({
    id: t.id || null,
    name: t.name,
    rate: Number(t.rate) || 0,
    amount: round2((taxableAmount * (Number(t.rate) || 0)) / 100),
  }));
  const taxAmount = round2(taxLines.reduce((s, t) => s + t.amount, 0));
  const grandTotal = round2(taxableAmount + taxAmount);
  const paid = round2(paidAmount);
  const balanceAmount = round2(Math.max(grandTotal - paid, 0));

  return {
    roomAmount,
    items: cleanItems,
    additionalTotal,
    subtotal,
    discountType,
    discountValue: dv,
    discountAmount,
    taxableAmount,
    taxes: taxLines,
    taxAmount,
    grandTotal,
    paidAmount: paid,
    balanceAmount,
    paymentStatus: statusFor(grandTotal, paid),
  };
}

export function statusFor(grandTotal, paid) {
  if (paid <= 0) return grandTotal <= 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PENDING;
  if (round2(paid) >= round2(grandTotal)) return PAYMENT_STATUS.PAID;
  return PAYMENT_STATUS.PARTIALLY_PAID;
}

/** PRD §51 data validation. Returns {field: message}. */
export function validateBill(form, computed) {
  const e = {};
  if (!form.guest?.name?.trim()) e.guestName = 'Guest name cannot be empty.';
  if (form.guest?.phone && !/^[0-9+\-\s]{6,15}$/.test(form.guest.phone)) e.guestPhone = 'Enter a valid phone number.';
  if (form.guest?.email && !/^\S+@\S+\.\S+$/.test(form.guest.email)) e.guestEmail = 'Enter a valid email.';
  if (!form.roomId) e.room = 'Room number must be selected.';
  if (!form.checkIn) e.checkIn = 'Check-in date is required.';
  if (!form.checkOut) e.checkOut = 'Check-out date is required.';
  if (form.checkIn && form.checkOut && form.checkOut < form.checkIn)
    e.checkOut = 'Check-out date cannot be before check-in date.';
  if (Number(form.roomRate) < 0 || form.roomRate === '' || isNaN(Number(form.roomRate)))
    e.roomRate = 'Room rate cannot be negative.';
  (form.items || []).forEach((it, i) => {
    if (Number(it.quantity) < 0) e[`item${i}`] = 'Quantity cannot be negative.';
    else if (Number(it.rate) < 0) e[`item${i}`] = 'Rate cannot be negative.';
    else if ((it.description || '').trim() === '' && Number(it.rate) > 0) e[`item${i}`] = 'Description is required.';
  });
  const dv = Number(form.discountValue) || 0;
  if (dv < 0) e.discount = 'Discount cannot be negative.';
  if (form.discountType === 'percent' && dv > 100) e.discount = 'Discount cannot exceed 100%.';
  if (form.discountType === 'fixed' && computed && dv > computed.subtotal)
    e.discount = 'Discount cannot exceed the bill amount.';
  if (computed && form.initialPayment) {
    const p = Number(form.initialPayment) || 0;
    if (p < 0) e.payment = 'Payment cannot be negative.';
    if (p > computed.grandTotal + 0.001) e.payment = 'Payment cannot exceed the bill total.';
  }
  return e;
}

/** 'INV' or 'INV-' + 1001 → 'INV-1001'; 'HTL/' + 5 → 'HTL/5'. */
export function formatInvoiceNumber(prefix, seq) {
  const p = (prefix || 'INV').trim().toUpperCase();
  return /[-/]$/.test(p) ? `${p}${seq}` : `${p}-${seq}`;
}
