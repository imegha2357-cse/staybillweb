// Runtime environment helpers.
// HOSTED = the build published on claude.ai (vite --mode hosted). There the
// app runs inside a sandboxed frame: data lives in the artifact database,
// sign-in is the viewer's Claude account, files are offered through the
// `downloads` capability and the browser print dialog is unavailable.

import { isConfigured } from './config';

/** Built for claude.ai (vite --mode hosted): runs inside the artifact frame. */
export const IN_CLAUDE = import.meta.env.VITE_HOSTED === '1';
/** No Firebase settings: built-in store + Claude/local identity instead of Firebase. */
export const HOSTED = IN_CLAUDE || !isConfigured;
/** Built-in store outside claude.ai: data stays in this browser (demo mode). */
export const DEMO = HOSTED && !IN_CLAUDE;
/** The print dialog works everywhere except inside the claude.ai frame. */
export const CAN_PRINT = !IN_CLAUDE;

export async function claudeUse(name) {
  try {
    if (typeof window === 'undefined' || !window.claude?.use) return null;
    return (await window.claude.use(name)) || null;
  } catch {
    return null;
  }
}

/** Report an error to the toast system from non-React code. */
export function reportError(message) {
  try { window.dispatchEvent(new CustomEvent('staybill:error', { detail: message })); } catch { /* ignore */ }
}

function anchorDownload(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Save a generated file for the user. Returns true when handed over,
 * false when the user declined. Never throws — problems are reported as toasts.
 */
export async function saveFile(filename, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (HOSTED) {
    const downloads = await claudeUse('downloads');
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
        return true;
      } catch (e) {
        if (e?.code === 'declined') return false;
        reportError(e?.code === 'rate_limited' ? 'Another download is waiting for your confirmation.' : `Could not save ${filename}. ${e?.message || ''}`.trim());
        return false;
      }
    }
  }
  try {
    anchorDownload(filename, blob);
    return true;
  } catch (e) {
    reportError(`Could not save ${filename}.`);
    return false;
  }
}
