// PDF invoice for a StayBill subscription payment.
import { saveFile } from '../platform';
import { buildDocPdf, rs } from '../modules/docPdf';
import { fmtDate } from '../modules/kit';

export function subInvoicePdf(p, site = {}) {
  return buildDocPdf({
    settings: { hotelName: site.brand || 'StayBill', address: site.address || '', gstin: site.gstin || '', email: site.email || '' }, title: 'Subscription invoice', number: p.number,
    left: [['Billed to', p.hotelName], ['Plan', p.planName]], right: [['Date', fmtDate(p.date)], ['Period', `${fmtDate(p.from)} – ${fmtDate(p.to)}`], ['Paid by', `${p.method}${p.ref ? ` · ${p.ref}` : ''}`]],
    head: ['Description', 'Months', 'Amount'], body: [[`StayBill ${p.planName || ''} subscription`, String(p.months), rs(p.amount)]], columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    totals: [['Total paid', rs(p.amount), true]],
  }).then((d) => saveFile(`${p.number}.pdf`, d.output('blob'), 'application/pdf'));
}

