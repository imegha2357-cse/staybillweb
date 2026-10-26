// GST return data from StayBill records: GSTR-1 (B2B, B2C, credit notes, HSN),
// GSTR-3B summary, NIC e-invoice JSON and Tally XML.
import { num, round2 } from '../kit';

export const STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh', 13: 'Nagaland', 14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal',
  20: 'Jharkhand', 21: 'Odisha', 22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 26: 'Dadra and Nagar Haveli and Daman and Diu', 27: 'Maharashtra', 29: 'Karnataka',
  30: 'Goa', 31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 35: 'Andaman and Nicobar Islands', 36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh', 97: 'Other Territory',
};
export const validGstin = (g) => /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(String(g || '').toUpperCase());
export const stateOf = (gstin, fallback = '') => { const c = String(gstin || '').slice(0, 2); return STATES[c] ? `${c}-${STATES[c]}` : fallback; };
export const SAC_ROOM = '996311';
export const SAC_FOOD = '996331';

const split = (b) => {
  const t = { igst: 0, cgst: 0, sgst: 0, other: 0 };
  (b.taxes || b.taxLines || []).forEach((x) => {
    const n = String(x.name || '').toUpperCase();
    if (n.includes('IGST')) t.igst += num(x.amount); else if (n.includes('SGST') || n.includes('UTGST')) t.sgst += num(x.amount); else if (n.includes('CGST')) t.cgst += num(x.amount); else t.other += num(x.amount);
  });
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, round2(v)]));
};
const rateOf = (b) => round2((b.taxes || b.taxLines || []).reduce((a, x) => a + num(x.rate), 0));
const inRange = (d, from, to) => d && d >= from && d <= to;

export function gstr1({ bills, orders, creditNotes, menu = [] }, from, to, hotelState) {
  const live = bills.filter((b) => b.paymentStatus !== 'CANCELLED' && inRange(b.billDate, from, to));
  const b2b = live.filter((b) => validGstin(b.guest?.gstin)).map((b) => ({
    gstin: b.guest.gstin.toUpperCase(), name: b.guestName, number: b.invoiceNumber, date: b.billDate, value: b.grandTotal, pos: hotelState || stateOf(b.guest.gstin), rate: rateOf(b), taxable: b.taxableAmount, ...split(b), bill: b,
  }));
  const b2cMap = {};
  const addB2c = (rate, taxable, t) => {
    const k = `${hotelState}|${rate}`;
    b2cMap[k] = b2cMap[k] || { pos: hotelState, rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    const r = b2cMap[k]; r.taxable = round2(r.taxable + taxable); r.igst = round2(r.igst + t.igst); r.cgst = round2(r.cgst + t.cgst); r.sgst = round2(r.sgst + t.sgst);
  };
  live.filter((b) => !validGstin(b.guest?.gstin)).forEach((b) => addB2c(rateOf(b), b.taxableAmount, split(b)));
  const hsn = {};
  const addHsn = (code, desc, qty, taxable, t, rate) => {
    const k = `${code}|${rate}`;
    hsn[k] = hsn[k] || { code, desc, uqc: 'OTH', qty: 0, rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
    const h = hsn[k]; h.qty += qty; h.taxable = round2(h.taxable + taxable); h.igst = round2(h.igst + t.igst); h.cgst = round2(h.cgst + t.cgst); h.sgst = round2(h.sgst + t.sgst);
  };
  live.forEach((b) => addHsn(SAC_ROOM, 'Room accommodation and services', num(b.nights) || 1, b.taxableAmount, split(b), rateOf(b)));
  const fnb = orders.filter((o) => inRange(o.date, from, to));
  fnb.forEach((o) => {
    const ratio = num(o.sub) ? (num(o.sub) - num(o.disc)) / num(o.sub) : 0;
    (o.lines || []).forEach((l) => {
      const taxable = round2(num(l.qty) * num(l.price) * ratio);
      const tax = round2((taxable * num(l.gst)) / 100);
      const t = { igst: 0, cgst: round2(tax / 2), sgst: round2(tax - round2(tax / 2)) };
      addB2c(num(l.gst), taxable, t);
      const m = menu.find((x) => x.id === l.menuId);
      addHsn(m?.hsn || SAC_FOOD, 'Restaurant food and beverages', num(l.qty), taxable, t, num(l.gst));
    });
  });
  const cns = creditNotes.filter((c) => c.status !== 'Cancelled' && inRange(c.date, from, to));
  const cdnr = cns.filter((c) => validGstin(c.guestGstin)).map((c) => ({ gstin: c.guestGstin, name: c.guestName, number: c.number, date: c.date, invoice: c.invoiceNumber, invoiceDate: c.invoiceDate, value: c.total, rate: rateOf(c), taxable: c.taxable, ...split(c) }));
  const cdnur = cns.filter((c) => !validGstin(c.guestGstin)).map((c) => ({ name: c.guestName, number: c.number, date: c.date, invoice: c.invoiceNumber, value: c.total, rate: rateOf(c), taxable: c.taxable, ...split(c) }));
  const seqs = live.map((b) => b.invoiceNumber).sort();
  return {
    b2b, b2cs: Object.values(b2cMap).filter((r) => r.taxable), cdnr, cdnur, hsn: Object.values(hsn).filter((h) => h.taxable),
    docs: { from: seqs[0] || '', to: seqs[seqs.length - 1] || '', total: bills.filter((b) => inRange(b.billDate, from, to)).length, cancelled: bills.filter((b) => b.paymentStatus === 'CANCELLED' && inRange(b.billDate, from, to)).length },
  };
}

export function gstr3b(data, from, to, hotelState) {
  const r1 = gstr1(data, from, to, hotelState);
  const sum = (rows, k) => round2(rows.reduce((a, r) => a + num(r[k]), 0));
  const out = ['taxable', 'igst', 'cgst', 'sgst'].reduce((m, k) => ({ ...m, [k]: round2(sum(r1.b2b, k) + sum(r1.b2cs, k) - sum(r1.cdnr, k) - sum(r1.cdnur, k)) }), {});
  const itc = { igst: 0, cgst: 0, sgst: 0 };
  data.expenses.filter((e) => inRange(e.date, from, to) && e.itc !== false && num(e.gstAmount)).forEach((e) => { const h = round2(num(e.gstAmount) / 2); itc.cgst += h; itc.sgst += round2(num(e.gstAmount) - h); });
  data.pos.filter((p) => inRange(p.receivedOn || p.date, from, to) && num(p.tax)).forEach((p) => { const h = round2(num(p.tax) / 2); itc.cgst += h; itc.sgst += round2(num(p.tax) - h); });
  Object.keys(itc).forEach((k) => { itc[k] = round2(itc[k]); });
  const payable = Object.fromEntries(['igst', 'cgst', 'sgst'].map((k) => [k, round2(Math.max(0, out[k] - itc[k]))]));
  return { out, itc, payable, totalPayable: round2(payable.igst + payable.cgst + payable.sgst), r1 };
}

const ddmmyyyy = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** NIC e-invoice schema 1.1 JSON for one B2B bill (review before uploading to the IRP / your GSP). */
export function eInvoice(bill, settings) {
  const sellerState = String(settings.gstin || '').slice(0, 2);
  const buyerState = String(bill.guest?.gstin || '').slice(0, 2);
  // Hotel stays are supplied where the property is (IGST Act s.12(3)), so tax follows what the bill charged.
  const t = split(bill); const inter = t.igst > 0;
  const items = [{ desc: `Room ${bill.roomNumber} (${bill.roomType || 'room'}) · ${bill.nights} night(s)`, qty: num(bill.nights) || 1, price: num(bill.roomRate), amt: num(bill.roomAmount) }, ...(bill.items || []).map((i) => ({ desc: i.description, qty: num(i.quantity), price: num(i.rate), amt: num(i.amount) }))].filter((i) => i.amt);
  const disc = num(bill.discountAmount); const rate = rateOf(bill);
  let left = disc;
  const list = items.map((i, n) => {
    const d = n === items.length - 1 ? round2(left) : round2((disc * i.amt) / (num(bill.subtotal) || 1)); left = round2(left - d);
    const ass = round2(i.amt - d); const tax = round2((ass * rate) / 100);
    return { SlNo: String(n + 1), PrdDesc: i.desc.slice(0, 300), IsServc: 'Y', HsnCd: SAC_ROOM, Qty: i.qty, Unit: 'OTH', UnitPrice: round2(i.price), TotAmt: round2(i.amt), Discount: d, AssAmt: ass, GstRt: rate, IgstAmt: inter ? tax : 0, CgstAmt: inter ? 0 : round2(tax / 2), SgstAmt: inter ? 0 : round2(tax - round2(tax / 2)), TotItemVal: round2(ass + tax) };
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: 'INV', No: bill.invoiceNumber, Dt: ddmmyyyy(bill.billDate) },
    SellerDtls: { Gstin: settings.gstin || '', LglNm: settings.legalName || settings.hotelName || '', Addr1: (settings.address || '').slice(0, 100) || 'Address', Loc: settings.city || '', Pin: Number(settings.pincode) || 0, Stcd: sellerState, Ph: (settings.phone || '').replace(/\D/g, '') || undefined, Em: settings.email || undefined },
    BuyerDtls: { Gstin: bill.guest.gstin.toUpperCase(), LglNm: bill.guest.company || bill.guestName, Pos: sellerState || buyerState, Addr1: (bill.guest.address || 'Address').slice(0, 100), Loc: settings.city || '', Pin: Number(bill.guest.pincode) || Number(settings.pincode) || 0, Stcd: buyerState },
    ItemList: list,
    ValDtls: { AssVal: round2(list.reduce((a, i) => a + i.AssAmt, 0)), CgstVal: inter ? 0 : t.cgst, SgstVal: inter ? 0 : t.sgst, IgstVal: inter ? round2(t.cgst + t.sgst + t.igst) : t.igst, TotInvVal: bill.grandTotal },
  };
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const VTYPE = { Sales: 'Sales', Receipt: 'Receipt', Payment: 'Payment', Purchase: 'Purchase', 'Credit note': 'Credit Note', Payroll: 'Journal', Opening: 'Journal' };
/** Tally Prime / ERP 9 XML import of journal entries (ledgers must exist in Tally with the same names). */
export function tallyXml(J, from, to, company = '') {
  const v = J.filter((e) => e.date >= from && e.date <= to).map((e) => `
   <TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="${VTYPE[e.kind] || 'Journal'}" ACTION="Create">
     <DATE>${e.date.replace(/-/g, '')}</DATE>
     <VOUCHERTYPENAME>${VTYPE[e.kind] || 'Journal'}</VOUCHERTYPENAME>
     <VOUCHERNUMBER>${esc(e.ref)}</VOUCHERNUMBER>
     <NARRATION>${esc(e.narration)}</NARRATION>${e.lines.map((l) => `
     <ALLLEDGERENTRIES.LIST>
      <LEDGERNAME>${esc(l.account.replace(/^Expense: /, ''))}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>${l.dr ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
      <AMOUNT>${l.dr ? -l.dr : l.cr}</AMOUNT>
     </ALLLEDGERENTRIES.LIST>`).join('')}
    </VOUCHER>
   </TALLYMESSAGE>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
 <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ''}</REQUESTDESC>
   <REQUESTDATA>${v}
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>
`;
}
