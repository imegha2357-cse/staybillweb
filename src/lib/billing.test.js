// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBill, calcNights, statusFor, validateBill, formatInvoiceNumber } from './billing.js';

const prdInput = {
  nights: 3,
  roomRate: 2500,
  items: [
    { description: 'Food', quantity: 2, rate: 425 },
    { description: 'Laundry', quantity: 1, rate: 300 },
    { description: 'Extra Bed', quantity: 1, rate: 500 },
  ],
  discountType: 'fixed',
  discountValue: 500,
  // PRD §25/§55 example: tax ₹865 on ₹8,650 => 10% total (5% CGST + 5% SGST)
  taxes: [
    { name: 'CGST', rate: 5 },
    { name: 'SGST', rate: 5 },
  ],
};

test('PRD §55 worked example', () => {
  const r = computeBill(prdInput);
  assert.equal(r.roomAmount, 7500);
  assert.equal(r.subtotal, 9150);
  assert.equal(r.taxableAmount, 8650);
  assert.equal(r.taxes[0].amount, 432.5);
  assert.equal(r.taxAmount, 865);
  assert.equal(r.grandTotal, 9515);
  assert.equal(r.paymentStatus, 'PENDING');
});

test('partial and full payment', () => {
  assert.equal(computeBill({ ...prdInput, paidAmount: 5000 }).balanceAmount, 4515);
  assert.equal(computeBill({ ...prdInput, paidAmount: 5000 }).paymentStatus, 'PARTIALLY_PAID');
  assert.equal(computeBill({ ...prdInput, paidAmount: 9515 }).paymentStatus, 'PAID');
});

test('percentage discount', () => {
  const r = computeBill({ ...prdInput, discountType: 'percent', discountValue: 10, taxes: [] });
  assert.equal(r.discountAmount, 915);
  assert.equal(r.grandTotal, 8235);
});

test('discount never exceeds subtotal', () => {
  const r = computeBill({ ...prdInput, discountValue: 99999, taxes: [] });
  assert.equal(r.discountAmount, 9150);
  assert.equal(r.grandTotal, 0);
});

test('nights', () => {
  assert.equal(calcNights('2026-09-15', '2026-09-18'), 3);
  assert.equal(calcNights('2026-09-15', '2026-09-15'), 1);
  assert.equal(calcNights('2026-09-18', '2026-09-15'), null);
  assert.equal(calcNights('2026-10-31', '2026-11-02'), 2); // month boundary
});

test('multiple payments total → PAID', () => {
  assert.equal(statusFor(10000, 3000 + 5000 + 2000), 'PAID');
});

test('validation', () => {
  const e = validateBill({ guest: { name: '' }, roomId: '', checkIn: '2026-09-18', checkOut: '2026-09-15', roomRate: -1, items: [{ description: 'x', quantity: -1, rate: 1 }] });
  assert.ok(e.guestName && e.room && e.checkOut && e.roomRate && e.item0);
});

test('invoice prefix with or without separator', () => {
  assert.equal(formatInvoiceNumber('INV', 1001), 'INV-1001');
  assert.equal(formatInvoiceNumber('INV-', 1001), 'INV-1001');
  assert.equal(formatInvoiceNumber('inv', 1002), 'INV-1002');
  assert.equal(formatInvoiceNumber('HTL/', 7), 'HTL/7');
  assert.equal(formatInvoiceNumber('', 1001), 'INV-1001');
});
