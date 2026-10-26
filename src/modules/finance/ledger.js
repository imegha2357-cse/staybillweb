// Double-entry books built from what the hotel already records: bills,
// payments, restaurant sales, credit notes, expenses, purchases, supplier
// payments, salaries and advances. Nothing is typed twice.
import { useMemo } from 'react';
import { useLive, num, round2 } from '../kit';

export const ACCOUNTS = {
  'Cash in hand': 'asset', 'Bank / UPI': 'asset', 'Guest receivables': 'asset', 'Input CGST': 'asset', 'Input SGST': 'asset', 'Input IGST': 'asset', 'Staff advances': 'asset',
  'Supplier payables': 'liability', 'Output CGST': 'liability', 'Output SGST': 'liability', 'Output IGST': 'liability', 'PF payable': 'liability', 'ESI payable': 'liability', 'Professional tax payable': 'liability', 'Advance from guests': 'liability',
  "Owner's capital": 'equity',
  'Room & service revenue': 'income', 'Food & beverage sales': 'income', 'Staff recoveries': 'income', 'Round off': 'income',
  'Sales returns': 'expense', Purchases: 'expense', 'Salaries & wages': 'expense', 'Employer PF & ESI': 'expense',
};
export const typeOf = (acc) => ACCOUNTS[acc] || (acc.startsWith('Expense: ') ? 'expense' : acc.startsWith('Output ') ? 'liability' : acc.startsWith('Input ') ? 'asset' : 'expense');
export const cashAcc = (method) => (String(method || 'Cash').toLowerCase() === 'cash' ? 'Cash in hand' : 'Bank / UPI');
const taxAcc = (name, side) => {
  const n = String(name || '').toUpperCase();
  const k = n.includes('IGST') ? 'IGST' : n.includes('SGST') || n.includes('UTGST') ? 'SGST' : n.includes('CGST') ? 'CGST' : null;
  return k ? `${side} ${k}` : `${side} tax: ${name}`;
};
/** Splits a GST amount into CGST/SGST halves (intra-state). */
const halves = (tax, side, lines, dir) => { const a = round2(tax / 2); lines.push({ account: `${side} CGST`, [dir]: a }, { account: `${side} SGST`, [dir]: round2(tax - a) }); };

/** All the records the books need (whole history; small hotels stay small). */
export function useBooksData() {
  const bills = useLive('bills');
  const payments = useLive('payments');
  const orders = useLive('orders', { where: [['status', '==', 'Settled']] });
  const creditNotes = useLive('creditNotes');
  const expenses = useLive('expenses');
  const pos = useLive('purchaseOrders', { where: [['status', '==', 'Received']] });
  const supplierPayments = useLive('supplierPayments');
  const payslips = useLive('payslips', { where: [['status', '==', 'Paid']] });
  const advances = useLive('salaryAdvances');
  const ready = [bills, payments, orders, creditNotes, expenses, pos, supplierPayments, payslips, advances].every((x) => x !== null);
  return { ready, bills: bills || [], payments: payments || [], orders: orders || [], creditNotes: creditNotes || [], expenses: expenses || [], pos: pos || [], supplierPayments: supplierPayments || [], payslips: payslips || [], advances: advances || [] };
}

/** Journal entries: [{date, ref, narration, kind, lines:[{account, dr, cr}]}] */
export function buildJournal(d, opening = {}) {
  const J = [];
  const add = (date, ref, narration, kind, lines) => {
    const ls = lines.filter((l) => num(l.dr) || num(l.cr)).map((l) => ({ account: l.account, dr: round2(num(l.dr)), cr: round2(num(l.cr)) }));
    if (ls.length) J.push({ date, ref, narration, kind, lines: ls });
  };
  if (opening.date && (num(opening.cash) || num(opening.bank))) {
    add(opening.date, 'OPENING', 'Opening balances', 'Opening', [{ account: 'Cash in hand', dr: opening.cash }, { account: 'Bank / UPI', dr: opening.bank }, { account: "Owner's capital", cr: num(opening.cash) + num(opening.bank) }]);
  }
  d.bills.filter((b) => b.paymentStatus !== 'CANCELLED').forEach((b) => {
    const lines = [{ account: 'Guest receivables', dr: b.grandTotal }, { account: 'Room & service revenue', cr: b.taxableAmount ?? b.subtotal }];
    (b.taxes || []).forEach((t) => lines.push({ account: taxAcc(t.name, 'Output'), cr: t.amount }));
    add(b.billDate, b.invoiceNumber, `Bill · ${b.guestName} · Room ${b.roomNumber}`, 'Sales', lines);
  });
  const cancelled = new Set(d.bills.filter((b) => b.paymentStatus === 'CANCELLED').map((b) => b.id));
  d.payments.filter((p) => !cancelled.has(p.billId)).forEach((p) => {
    add(p.date, p.invoiceNumber, `Received from ${p.guestName} (${p.method})`, 'Receipt', [{ account: cashAcc(p.method), dr: p.amount }, { account: 'Guest receivables', cr: p.amount }]);
  });
  d.orders.forEach((o) => {
    const lines = [];
    let paid = 0;
    (o.payments || []).forEach((p) => { lines.push({ account: cashAcc(p.method), dr: p.amount }); paid += num(p.amount); });
    const net = round2(num(o.sub) - num(o.disc));
    lines.push({ account: 'Food & beverage sales', cr: net });
    halves(num(o.tax), 'Output', lines, 'cr');
    const diff = round2(paid - (net + num(o.tax)));
    if (diff) lines.push(diff > 0 ? { account: 'Round off', cr: diff } : { account: 'Round off', dr: -diff });
    add(o.date, o.number, `Restaurant ${o.type === 'Table' ? `table ${o.table}` : o.type || ''}`, 'Sales', lines);
  });
  d.creditNotes.filter((c) => c.status !== 'Cancelled').forEach((c) => {
    const lines = [{ account: 'Sales returns', dr: c.taxable }];
    (c.taxLines || []).forEach((t) => lines.push({ account: taxAcc(t.name, 'Output'), dr: t.amount }));
    lines.push({ account: 'Guest receivables', cr: c.total });
    add(c.date, c.number, `Credit note · ${c.guestName} · ${c.invoiceNumber}`, 'Credit note', lines);
    if (num(c.refundAmount)) add(c.refundDate || c.date, c.number, `Refund to ${c.guestName} (${c.refundMethod})`, 'Payment', [{ account: 'Guest receivables', dr: c.refundAmount }, { account: cashAcc(c.refundMethod), cr: c.refundAmount }]);
  });
  d.expenses.forEach((e) => {
    const itc = e.itc !== false && num(e.gstAmount) > 0;
    const lines = [{ account: `Expense: ${e.category || 'General'}`, dr: itc ? e.amount : num(e.amount) + num(e.gstAmount) }];
    if (itc) halves(num(e.gstAmount), 'Input', lines, 'dr');
    lines.push({ account: cashAcc(e.method), cr: num(e.amount) + num(e.gstAmount) });
    add(e.date, e.number || e.invoiceNo || 'EXP', `${e.category || 'Expense'}${e.vendor ? ` · ${e.vendor}` : ''}`, 'Payment', lines);
  });
  d.pos.forEach((p) => {
    const lines = [{ account: 'Purchases', dr: p.base }];
    halves(num(p.tax), 'Input', lines, 'dr');
    lines.push({ account: 'Supplier payables', cr: p.total });
    add(p.receivedOn || p.date, p.number, `Purchase · ${p.supplierName}${p.invoiceNo ? ` · inv ${p.invoiceNo}` : ''}`, 'Purchase', lines);
  });
  d.supplierPayments.forEach((p) => add(p.date, p.ref || 'PAY', `Paid ${p.supplierName} (${p.method})`, 'Payment', [{ account: 'Supplier payables', dr: p.amount }, { account: cashAcc(p.method), cr: p.amount }]));
  d.payslips.forEach((s) => add(s.paidOn, `SAL-${s.month}`, `Salary ${s.month} · ${s.name}`, 'Payroll', [
    { account: 'Salaries & wages', dr: s.gross }, { account: 'Employer PF & ESI', dr: num(s.employerPf) + num(s.employerEsi) },
    { account: cashAcc(s.method), cr: s.net }, { account: 'PF payable', cr: num(s.pf) + num(s.employerPf) }, { account: 'ESI payable', cr: num(s.esi) + num(s.employerEsi) },
    { account: 'Professional tax payable', cr: s.pt }, { account: 'Staff advances', cr: s.advance }, { account: 'Staff recoveries', cr: s.otherDed },
  ]));
  d.advances.forEach((a) => add(a.date, 'ADV', `Salary advance · ${a.name}`, 'Payment', [{ account: 'Staff advances', dr: a.amount }, { account: 'Cash in hand', cr: a.amount }]));
  return J.filter((e) => e.date).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Balances by account for entries between from and to (inclusive). dr − cr. */
export function balances(J, from = '0000', to = '9999') {
  const m = {};
  J.forEach((e) => { if (e.date < from || e.date > to) return; e.lines.forEach((l) => { m[l.account] = round2((m[l.account] || 0) + l.dr - l.cr); }); });
  return m;
}

export function profitAndLoss(J, from, to) {
  const b = balances(J, from, to);
  const income = Object.entries(b).filter(([a]) => typeOf(a) === 'income').map(([a, v]) => [a, round2(-v)]).filter(([, v]) => v);
  const expense = Object.entries(b).filter(([a]) => typeOf(a) === 'expense').map(([a, v]) => [a, v]).filter(([, v]) => v).sort((x, y) => y[1] - x[1]);
  const ti = round2(income.reduce((a, [, v]) => a + v, 0)); const te = round2(expense.reduce((a, [, v]) => a + v, 0));
  return { income, expense, totalIncome: ti, totalExpense: te, profit: round2(ti - te) };
}

export function balanceSheet(J, asOf) {
  const b = balances(J, '0000', asOf);
  const pick = (t, sign) => Object.entries(b).filter(([a]) => typeOf(a) === t).map(([a, v]) => [a, round2(sign * v)]).filter(([, v]) => v);
  const assets = pick('asset', 1); const liabilities = pick('liability', -1); const equity = pick('equity', -1);
  const profit = profitAndLoss(J, '0000', asOf).profit;
  equity.push(['Profit to date', profit]);
  const sum = (xs) => round2(xs.reduce((a, [, v]) => a + v, 0));
  return { assets, liabilities, equity, totalAssets: sum(assets), totalLiabilities: round2(sum(liabilities) + sum(equity)) };
}

export function useBooks(opening) {
  const data = useBooksData();
  const J = useMemo(() => (data.ready ? buildJournal(data, opening) : []), // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.ready, data.bills, data.payments, data.orders, data.creditNotes, data.expenses, data.pos, data.supplierPayments, data.payslips, data.advances, JSON.stringify(opening || {})]);
  return { ...data, J };
}
