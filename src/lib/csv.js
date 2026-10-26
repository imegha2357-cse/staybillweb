import { saveFile } from '../platform';

function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(head, rows) {
  return [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}
export function downloadText(content, filename, type = 'text/csv;charset=utf-8') {
  // BOM so Excel opens UTF-8 (₹, names) correctly
  const body = type.startsWith('text/csv') ? `﻿${content}` : content;
  return saveFile(filename, new Blob([body], { type }));
}
export function downloadCsv(filename, head, rows) {
  return downloadText(toCsv(head, rows), filename);
}
