const CURRENCY_SYMBOLS = { INR: '₹', USD: '$', EUR: '€', GBP: '£', AED: 'AED ', LKR: 'Rs ', NPR: 'Rs ' };

let currentCurrency = 'INR';
export function setCurrency(c) {
  currentCurrency = c || 'INR';
}
export function currencySymbol(c = currentCurrency) {
  return CURRENCY_SYMBOLS[c] ?? `${c} `;
}
/** ASCII-safe prefix for PDFs (built-in PDF fonts have no ₹ glyph). */
export function pdfCurrencyPrefix(c = currentCurrency) {
  if (c === 'INR') return 'Rs. ';
  const s = CURRENCY_SYMBOLS[c];
  return s && /^[\x20-\x7E]+$/.test(s) ? s : `${c} `;
}

const nf2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** ₹9,515 or ₹432.50 */
export function money(n, { decimals = 'auto' } = {}) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const abs = Math.abs(v);
  const body = decimals === 'always' || (decimals === 'auto' && abs % 1 !== 0) ? nf2.format(abs) : nf0.format(abs);
  return `${neg ? '-' : ''}${currencySymbol()}${body}`;
}
export function moneyPdf(n) {
  const v = Number(n) || 0;
  return `${v < 0 ? '-' : ''}${pdfCurrencyPrefix()}${nf2.format(Math.abs(v))}`;
}
export function num2(n) {
  return nf2.format(Number(n) || 0);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** '2026-09-15' → '15 Sep 2026' */
export function fmtDay(s, long = false) {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}
export function fmtDayShort(s) {
  if (!s) return '—';
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function toDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  return new Date(ts);
}
/** Timestamp → '17 Sep 2026, 5:42 PM' */
export function fmtDateTime(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}
export function fmtTime(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}
