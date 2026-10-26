import { saveFile } from '../platform';
// PDF generation (PRD §35, §44, §63). The invoice PDF is built from the stored
// bill document, never from in-progress form values.
import { moneyPdf, fmtDay, fmtDateTime, num2 } from './format';
import { STATUS_LABEL } from './billing';
import { invoiceLines, paymentMethodsLabel } from '../components/InvoiceView';

async function libs() {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  return { jsPDF, autoTable };
}

const DARK = [15, 23, 42];
const MUTED = [100, 116, 139];
const BRAND = [15, 42, 74]; // navy #0F2A4A

export async function buildInvoicePdf(bill, settings, payments, into) {
  const { jsPDF, autoTable } = await libs();
  const doc = into || new jsPDF({ unit: 'mm', format: 'a4' });
  if (into) doc.addPage();
  const W = doc.internal.pageSize.getWidth();
  const M = 15;
  let y = M;

  // Header: logo + hotel
  let textX = M;
  if (settings.logo) {
    try {
      const props = doc.getImageProperties(settings.logo);
      const h = 20;
      const w = Math.min((props.width / props.height) * h, 40);
      doc.addImage(settings.logo, props.fileType || 'PNG', M, y, w, h);
      textX = M + w + 5;
    } catch { /* ignore bad logo */ }
  }
  doc.setTextColor(...DARK).setFont('helvetica', 'bold').setFontSize(16).text(settings.hotelName || '', textX, y + 6);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
  const addr = [settings.address, settings.city, settings.state, settings.country].filter(Boolean).join(', ');
  const hotelLines = [
    ...(addr ? doc.splitTextToSize(addr, 95) : []),
    settings.phone && `Phone: ${settings.phone}`,
    settings.email,
    settings.gstin && `GSTIN: ${settings.gstin}`,
  ].filter(Boolean);
  doc.text(hotelLines, textX, y + 11);

  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(160, 170, 185).text('INVOICE', W - M, y + 6, { align: 'right' });
  doc.setFontSize(11).setTextColor(...DARK).text(bill.invoiceNumber, W - M, y + 13, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED).text(`Date: ${fmtDay(bill.billDate)}`, W - M, y + 18, { align: 'right' });

  y = Math.max(y + 24, y + 11 + hotelLines.length * 4) + 2;
  doc.setDrawColor(226, 232, 240).line(M, y, W - M, y);
  y += 6;

  // Guest + stay
  doc.setFontSize(8).setTextColor(...MUTED).setFont('helvetica', 'bold').text('BILLED TO', M, y);
  doc.text('STAY', W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...DARK).text(bill.guest?.name || bill.guestName, M, y + 5);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(51, 65, 85);
  const g = bill.guest || {};
  const guestLines = [
    g.phone && `Phone: ${g.phone}`, g.email, ...(g.address ? doc.splitTextToSize(g.address, 90) : []), g.gstin && `GSTIN: ${g.gstin}`,
  ].filter(Boolean);
  doc.text(guestLines, M, y + 10);
  const stay = [
    `Room: ${bill.roomNumber}${bill.roomType ? ` (${bill.roomType})` : ''}`,
    `Check-in: ${fmtDay(bill.checkIn)}`,
    `Check-out: ${fmtDay(bill.checkOut)}`,
    `Nights: ${bill.nights}`,
  ];
  doc.text(stay, W - M, y + 5, { align: 'right' });
  y += Math.max(guestLines.length * 4 + 10, stay.length * 4 + 6) + 2;

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: [['Description', 'Qty', 'Rate', 'Amount']],
    body: invoiceLines(bill).map((l) => [l.description, String(l.quantity), moneyPdf(l.rate), moneyPdf(l.amount)]),
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2.2, textColor: DARK },
    headStyles: { fontStyle: 'bold', textColor: [71, 85, 105], lineWidth: { bottom: 0.5 }, lineColor: DARK },
    bodyStyles: { lineWidth: { bottom: 0.1 }, lineColor: [226, 232, 240] },
    columnStyles: { 1: { halign: 'right', cellWidth: 16 }, 2: { halign: 'right', cellWidth: 32 }, 3: { halign: 'right', cellWidth: 34 } },
    didParseCell: (d) => { if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right'; },
  });
  y = doc.lastAutoTable.finalY + 6;

  // Totals
  const rows = [['Subtotal', moneyPdf(bill.subtotal)]];
  if (bill.discountAmount > 0) rows.push([`Discount${bill.discountType === 'percent' ? ` (${bill.discountValue}%)` : ''}`, `-${moneyPdf(bill.discountAmount)}`]);
  (bill.taxes || []).forEach((t) => rows.push([`${t.name} @ ${t.rate}%`, moneyPdf(t.amount)]));
  if ((bill.taxes || []).length > 1) rows.push(['Total Tax', moneyPdf(bill.taxAmount)]);
  const totalsX = W - M - 75;
  if (y > 240) { doc.addPage(); y = M; }
  doc.setFontSize(9);
  rows.forEach(([l, v]) => {
    doc.setTextColor(...MUTED).text(l, totalsX, y);
    doc.setTextColor(...DARK).text(v, W - M, y, { align: 'right' });
    y += 5;
  });
  doc.setDrawColor(...DARK).setLineWidth(0.5).line(totalsX, y - 2, W - M, y - 2);
  y += 4;
  doc.setFont('helvetica', 'bold').setFontSize(12).text('TOTAL', totalsX, y);
  doc.text(moneyPdf(bill.grandTotal), W - M, y, { align: 'right' });
  y += 6;
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED).text('Paid', totalsX, y);
  doc.setTextColor(...DARK).text(moneyPdf(bill.paidAmount), W - M, y, { align: 'right' });
  y += 5;
  doc.setFont('helvetica', 'bold').text('Balance', totalsX, y);
  doc.text(moneyPdf(bill.balanceAmount), W - M, y, { align: 'right' });

  // Payment block (left side, aligned with totals)
  const py = y - 22;
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MUTED).text('PAYMENT', M, py);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(51, 65, 85);
  doc.text(`Method: ${paymentMethodsLabel(payments)}`, M, py + 5);
  doc.text('Status: ', M, py + 10);
  doc.setFont('helvetica', 'bold').setTextColor(...(bill.paymentStatus === 'PAID' ? BRAND : DARK))
    .text((STATUS_LABEL[bill.paymentStatus] || '').toUpperCase(), M + doc.getTextWidth('Status: '), py + 10);
  if (bill.paymentStatus === 'CANCELLED' && bill.cancelReason) {
    doc.setFont('helvetica', 'normal').setTextColor(220, 38, 38).text(`Reason: ${bill.cancelReason}`, M, py + 15);
  }

  // Footer
  y += 18;
  doc.setDrawColor(226, 232, 240).setLineWidth(0.2).line(M, y, W - M, y);
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(51, 65, 85);
  if (settings.invoiceFooter) doc.text(settings.invoiceFooter, W / 2, y + 7, { align: 'center' });
  doc.setFontSize(7).setTextColor(...MUTED).text(`Generated by StayBill · ${fmtDateTime(bill.createdAt)}`, W / 2, y + 12, { align: 'center' });

  if (bill.paymentStatus === 'CANCELLED') {
    doc.setFontSize(60).setTextColor(252, 165, 165).setFont('helvetica', 'bold');
    doc.text('CANCELLED', W / 2, 160, { align: 'center', angle: 20 });
  }
  return doc;
}

export async function downloadInvoicePdf(bill, settings, payments) {
  const doc = await buildInvoicePdf(bill, settings, payments);
  return saveFile(`${bill.invoiceNumber}.pdf`, doc.output('blob'));
}
/** Several invoices in one PDF, one per page (batch print). items: [{bill, payments}] */
export async function downloadInvoicesPdf(items, settings, filename) {
  let doc = null;
  for (const { bill, payments } of items) {
    // eslint-disable-next-line no-await-in-loop
    doc = await buildInvoicePdf(bill, settings, payments, doc || undefined);
  }
  if (!doc) return false;
  return saveFile(filename || `invoices-${items.length}.pdf`, doc.output('blob'));
}
export async function invoicePdfFile(bill, settings, payments) {
  const doc = await buildInvoicePdf(bill, settings, payments);
  const blob = doc.output('blob');
  return new File([blob], `${bill.invoiceNumber}.pdf`, { type: 'application/pdf' });
}

/**
 * Generic report PDF.
 * sections: [{ title, head: [..], body: [[..]], foot?: [..] }]
 */
export async function downloadReportPdf({ title, subtitle, hotelName, summary = [], sections = [], filename }) {
  const { jsPDF, autoTable } = await libs();
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(...DARK).text(title, M, 18);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
  doc.text([hotelName, subtitle].filter(Boolean).join('  ·  '), M, 24);
  doc.text(`Generated ${fmtDateTime(new Date())}`, W - M, 18, { align: 'right' });
  let y = 32;
  if (summary.length) {
    autoTable(doc, {
      startY: y, margin: { left: M, right: M }, theme: 'grid',
      body: summary.map(([k, v]) => [k, v]),
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 }, 1: { halign: 'right' } },
    });
    y = doc.lastAutoTable.finalY + 8;
  }
  sections.forEach((s) => {
    if (y > 260) { doc.addPage(); y = 18; }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...DARK).text(s.title, M, y);
    autoTable(doc, {
      startY: y + 3, margin: { left: M, right: M }, theme: 'striped',
      head: [s.head], body: s.body, foot: s.foot ? [s.foot] : undefined,
      styles: { fontSize: 8, cellPadding: 1.8 },
      headStyles: { fillColor: BRAND },
      footStyles: { fillColor: [241, 245, 249], textColor: DARK, fontStyle: 'bold' },
      didParseCell: (d) => { if (s.rightCols?.includes(d.column.index)) d.cell.styles.halign = 'right'; },
    });
    y = doc.lastAutoTable.finalY + 10;
  });
  return saveFile(filename || `${title.replace(/\s+/g, '-')}.pdf`, doc.output('blob'));
}

export { num2 };
