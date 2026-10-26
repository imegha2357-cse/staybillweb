// A4 invoice PDF for the "paid in full" email (PDFKit, built-in fonts).
const PDFDocument = require('pdfkit');
const { money, day } = require('./lib');

function invoicePdf(bill, settings = {}, payments = []) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${bill.invoiceNumber}`, Author: settings.hotelName || 'StayBill' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const cur = settings.currency || 'INR';
    const m = (n) => money(n, cur, { pdf: true });
    const W = doc.page.width - 96;
    const teal = '#0F5E66';

    doc.fillColor(teal).font('Helvetica-Bold').fontSize(18).text(settings.hotelName || 'Hotel', 48, 48);
    doc.fillColor('#45464d').font('Helvetica').fontSize(9)
      .text([settings.address, settings.city, settings.state].filter(Boolean).join(', '))
      .text([settings.phone, settings.email].filter(Boolean).join('  ·  '));
    if (settings.gstin) doc.text(`GSTIN ${settings.gstin}`);
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#9aa3a6').text('INVOICE', 48, 48, { width: W, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0b1c30').text(bill.invoiceNumber, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#45464d').text(`Date: ${day(bill.billDate)}`, { width: W, align: 'right' });

    let y = 140;
    doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#e3eeee').stroke();
    y += 12;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#76777d').text('BILLED TO', 48, y).text('STAY', 48, y, { width: W, align: 'right' });
    y += 12;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0b1c30').text(bill.guestName || bill.guest?.name || '', 48, y);
    doc.font('Helvetica').fontSize(9).fillColor('#45464d')
      .text([bill.guestPhone, bill.guest?.email].filter(Boolean).join('  ·  '), 48, y + 14)
      .text(bill.guest?.gstin ? `GSTIN ${bill.guest.gstin}` : '', 48, y + 26);
    doc.text(`Room ${bill.roomNumber}${bill.roomType ? ` (${bill.roomType})` : ''}`, 48, y, { width: W, align: 'right' })
      .text(`Check-in ${day(bill.checkIn)}  ·  Check-out ${day(bill.checkOut)}`, 48, y + 14, { width: W, align: 'right' })
      .text(`Nights: ${bill.nights || 0}`, 48, y + 26, { width: W, align: 'right' });

    y += 52;
    const cols = [48, 48 + W * 0.58, 48 + W * 0.7, 48 + W * 0.85];
    doc.rect(48, y, W, 20).fill('#f0f5f5');
    doc.fillColor('#45464d').font('Helvetica-Bold').fontSize(8)
      .text('DESCRIPTION', cols[0] + 6, y + 6).text('QTY', cols[1], y + 6, { width: 50, align: 'right' })
      .text('RATE', cols[2], y + 6, { width: 70, align: 'right' }).text('AMOUNT', cols[3], y + 6, { width: W * 0.15 - 6, align: 'right' });
    y += 26;
    const line = (desc, qty, rate, amt) => {
      doc.fillColor('#0b1c30').font('Helvetica').fontSize(9)
        .text(desc, cols[0] + 6, y, { width: W * 0.55 })
        .text(String(qty), cols[1], y, { width: 50, align: 'right' })
        .text(rate === '' ? '' : m(rate), cols[2], y, { width: 70, align: 'right' })
        .text(m(amt), cols[3], y, { width: W * 0.15 - 6, align: 'right' });
      y += 18;
    };
    line(`${bill.roomType ? `${bill.roomType} ` : ''}Room ${bill.roomNumber} (${bill.nights} night${bill.nights === 1 ? '' : 's'})`, bill.nights, bill.roomRate, bill.roomAmount);
    (bill.items || []).forEach((it) => line(it.description || 'Item', it.quantity, it.rate, it.amount));
    doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#e3eeee').stroke();
    y += 10;

    const totY = y;
    const tot = (label, val, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor('#0b1c30')
        .text(label, 48 + W * 0.55, y, { width: W * 0.25 })
        .text(val, 48 + W * 0.8, y, { width: W * 0.2, align: 'right' });
      y += bold ? 18 : 15;
    };
    tot('Subtotal', m(bill.subtotal));
    if (bill.discountAmount) tot('Discount', `-${m(bill.discountAmount)}`);
    (bill.taxes || []).forEach((t) => tot(`${t.name} @ ${t.rate}%`, m(t.amount)));
    tot('TOTAL', m(bill.grandTotal), true);
    tot('Paid', m(bill.paidAmount));
    tot('Balance', m(bill.balanceAmount), true);

    y += 6;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#76777d').text('PAYMENTS', 48, y);
    y += 12;
    (payments.length ? payments : [{ method: (bill.paymentMethods || []).join(', ') || '—', amount: bill.paidAmount }]).forEach((p) => {
      doc.font('Helvetica').fontSize(9).fillColor('#0b1c30').text(`${p.method || 'Payment'}${p.referenceNumber ? ` (ref ${p.referenceNumber})` : ''}${p.date ? ` · ${day(p.date)}` : ''}`, 48, y)
        .text(m(p.amount), 48, y, { width: W * 0.45, align: 'right' });
      y += 14;
    });

    if (bill.paymentStatus === 'PAID') {
      doc.save().rotate(-12, { origin: [120, totY + 30] }).roundedRect(66, totY + 10, 110, 40, 6).lineWidth(3).strokeColor('#1f9d6a').stroke()
        .font('Helvetica-Bold').fontSize(22).fillColor('#1f9d6a').text('PAID', 66, totY + 19, { width: 110, align: 'center' }).restore();
    }

    doc.font('Helvetica').fontSize(9).fillColor('#45464d').text(settings.invoiceFooter || 'Thank you for staying with us.', 48, doc.page.height - 90, { width: W, align: 'center' });
    doc.fontSize(7).fillColor('#9aa3a6').text('Generated by StayBill', 48, doc.page.height - 74, { width: W, align: 'center' });
    doc.end();
  });
}

module.exports = { invoicePdf };
