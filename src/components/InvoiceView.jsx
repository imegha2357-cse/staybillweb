import { money, fmtDay, fmtDateTime } from '../lib/format';
import { STATUS_LABEL } from '../lib/billing';

/** Line items shown on the invoice: room first, then additional charges. */
export function invoiceLines(bill) {
  return [
    { description: `${bill.roomType ? `${bill.roomType} Room` : 'Room'} ${bill.roomNumber} (${bill.nights} night${bill.nights === 1 ? '' : 's'})`, quantity: bill.nights, rate: bill.roomRate, amount: bill.roomAmount },
    ...(bill.items || []),
  ];
}
export function paymentMethodsLabel(payments) {
  const set = [...new Set((payments || []).map((p) => p.method))];
  return set.length ? set.join(', ') : '—';
}

/** Printable A4 invoice (PRD §33–34). Rendered from stored bill data only. */
export default function InvoiceView({ bill, settings, payments }) {
  const cancelled = bill.paymentStatus === 'CANCELLED';
  const addr = [settings.address, settings.city, settings.state, settings.country].filter(Boolean).join(', ');
  return (
    <div className="invoice-sheet theme-light relative rounded-xl border border-slate-200 p-6 sm:p-10">
      {cancelled && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="-rotate-12 rounded-lg border-4 border-red-300 px-6 py-2 text-5xl font-bold tracking-widest text-red-300 opacity-70">CANCELLED</span>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
        <div className="flex items-start gap-4">
          {settings.logo && <img src={settings.logo} alt="" className="h-16 w-16 rounded-md object-contain" />}
          <div>
            <div className="text-xl font-bold text-slate-900">{settings.hotelName}</div>
            {addr && <div className="mt-0.5 max-w-xs text-slate-600">{addr}</div>}
            <div className="mt-1 space-y-0.5 text-slate-600">
              {settings.phone && <div>Phone: {settings.phone}</div>}
              {settings.email && <div>{settings.email}</div>}
              {settings.website && <div>{settings.website}</div>}
              {settings.gstin && <div className="font-medium text-slate-700">GSTIN: {settings.gstin}</div>}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tracking-wide text-slate-400">INVOICE</div>
          <div className="mt-2 text-base font-semibold text-slate-900">{bill.invoiceNumber}</div>
          <div className="text-slate-600">Date: {fmtDay(bill.billDate)}</div>
        </div>
      </div>

      <div className="grid gap-6 border-b border-slate-200 py-5 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Billed to</div>
          <div className="font-semibold text-slate-900">{bill.guest?.name || bill.guestName}</div>
          {bill.guest?.phone && <div className="text-slate-600">Phone: {bill.guest.phone}</div>}
          {bill.guest?.email && <div className="text-slate-600">{bill.guest.email}</div>}
          {bill.guest?.address && <div className="whitespace-pre-line text-slate-600">{bill.guest.address}</div>}
          {bill.guest?.gstin && <div className="text-slate-700">GSTIN: {bill.guest.gstin}</div>}
        </div>
        <div className="sm:text-right">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Stay</div>
          <div className="text-slate-700">Room: <b>{bill.roomNumber}</b>{bill.roomType ? ` (${bill.roomType})` : ''}</div>
          <div className="text-slate-700">Check-in: {fmtDay(bill.checkIn)}</div>
          <div className="text-slate-700">Check-out: {fmtDay(bill.checkOut)}</div>
          <div className="text-slate-700">Nights: {bill.nights}</div>
        </div>
      </div>

      <table className="mt-4 w-full">
        <thead>
          <tr className="border-b-2 border-slate-800 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
            <th className="py-2">Description</th>
            <th className="w-14 py-2 text-right">Qty</th>
            <th className="w-28 py-2 text-right">Rate</th>
            <th className="w-28 py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoiceLines(bill).map((l, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-2 text-slate-800">{l.description}</td>
              <td className="py-2 text-right tabular-nums">{l.quantity}</td>
              <td className="py-2 text-right tabular-nums">{money(l.rate)}</td>
              <td className="py-2 text-right tabular-nums">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 flex flex-wrap justify-between gap-6">
        <div className="text-slate-600">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Payment</div>
          <div>Method: {paymentMethodsLabel(payments)}</div>
          <div>Status: <b className="text-slate-900">{(STATUS_LABEL[bill.paymentStatus] || '').toUpperCase()}</b></div>
          {cancelled && bill.cancelReason && <div className="mt-1 text-error">Cancelled: {bill.cancelReason}</div>}
        </div>
        <table className="w-full max-w-xs text-sm">
          <tbody className="[&_td]:py-1">
            <tr><td className="text-slate-600">Subtotal</td><td className="text-right tabular-nums">{money(bill.subtotal)}</td></tr>
            {bill.discountAmount > 0 && <tr><td className="text-slate-600">Discount{bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}</td><td className="text-right tabular-nums">-{money(bill.discountAmount)}</td></tr>}
            {(bill.taxes || []).map((t, i) => <tr key={i}><td className="text-slate-600">{t.name} @ {t.rate}%</td><td className="text-right tabular-nums">{money(t.amount)}</td></tr>)}
            {(bill.taxes || []).length > 1 && <tr><td className="text-slate-600">Total Tax</td><td className="text-right tabular-nums">{money(bill.taxAmount)}</td></tr>}
            <tr className="border-t-2 border-slate-800 text-base font-bold"><td className="pt-2">TOTAL</td><td className="pt-2 text-right tabular-nums">{money(bill.grandTotal)}</td></tr>
            <tr><td className="text-slate-600">Paid</td><td className="text-right tabular-nums">{money(bill.paidAmount)}</td></tr>
            <tr className="font-semibold"><td>Balance</td><td className="text-right tabular-nums">{money(bill.balanceAmount)}</td></tr>
          </tbody>
        </table>
      </div>

      <div className="mt-10 border-t border-slate-200 pt-4 text-center text-slate-500">
        {settings.invoiceFooter && <div className="text-slate-700">{settings.invoiceFooter}</div>}
        <div className="mt-1 text-xs">Generated by StayBill · {fmtDateTime(bill.createdAt)}</div>
      </div>
    </div>
  );
}
