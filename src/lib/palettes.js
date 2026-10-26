// Brand colour palettes. Each palette is four colours (primary, accent, light
// background, night background); every theme token is derived from them so a
// hotel can also enter its own colours.

export const PALETTES = [
  { id: 'navy', name: 'Royal Navy & Gold', tagline: 'Classic, premium, trusted (default)', primary: '#0F2A4A', accent: '#C9A24B', background: '#F8F6F1', night: '#0A1628' },
  { id: 'ocean', name: 'Ocean Teal & Coral', tagline: 'Fresh, relaxed, friendly', primary: '#0F5E66', accent: '#F2785C', background: '#F5FAFA', night: '#06232A' },
  { id: 'emerald', name: 'Emerald & Brass', tagline: 'Calm, natural, heritage', primary: '#0E4D3C', accent: '#B08D57', background: '#F7F4EC', night: '#08201A' },
  { id: 'terracotta', name: 'Terracotta & Sand', tagline: 'Warm, homely, boutique', primary: '#A4502E', accent: '#E2C08D', background: '#FBF7F2', night: '#1E120D' },
];
export const DEFAULT_BRAND = { id: 'navy' };
const CACHE_KEY = 'staybill-brand-v2';

// ---------- colour maths ----------
const clamp = (n, a = 0, b = 1) => Math.min(b, Math.max(a, n));
export function isHex(s) { return /^#?[0-9a-f]{6}$/i.test(String(s || '').trim()); }
function hexToRgb(h) {
  const s = String(h).replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
function rgbToHex([r, g, b]) { return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`; }
function mix(a, b, t) { const x = hexToRgb(a); const y = hexToRgb(b); return rgbToHex(x.map((v, i) => v + (y[i] - v) * t)); }
function toHsl(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b); const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}
function hsl(h, s, l) {
  s = clamp(s); l = clamp(l);
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
}
function lum(hex) {
  const c = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** Darkens (or lightens) `fg` until it reaches `ratio` against `bg`. */
function readable(fg, bg, ratio = 4.5) {
  const towards = lum(bg) > 0.4 ? '#000000' : '#ffffff';
  let c = fg;
  for (let i = 0; i < 20 && contrast(c, bg) < ratio; i += 1) c = mix(c, towards, 0.08);
  return c;
}
const triplet = (hex) => hexToRgb(hex).join(' ');

/** Normalises a stored brand value ({id} or {id:'custom', primary, accent, ...}). */
export function resolveBrand(brand) {
  // Hotels that never picked colours themselves follow the default (navy).
  if (brand?.id === 'ocean' && !brand.chosen) return PALETTES[0];
  const preset = PALETTES.find((p) => p.id === brand?.id);
  if (preset) return preset;
  if (brand?.id === 'custom' && isHex(brand.primary) && isHex(brand.accent)) {
    const fix = (h) => (h.startsWith('#') ? h : `#${h}`);
    const primary = fix(brand.primary); const accent = fix(brand.accent);
    const [h] = toHsl(primary);
    return {
      id: 'custom', name: 'Your hotel colours', primary, accent,
      background: isHex(brand.background) ? fix(brand.background) : hsl(h, 0.3, 0.975),
      night: isHex(brand.night) ? fix(brand.night) : hsl(h, 0.6, 0.09),
    };
  }
  return PALETTES[0];
}

// ---------- token generation ----------
const ERR_LIGHT = { error: '#ba1a1a', 'on-error': '#ffffff', 'error-container': '#ffdad6', 'on-error-container': '#93000a' };
const ERR_DARK = { error: '#ff7a7a', 'on-error': '#ffffff', 'error-container': '#3d1418', 'on-error-container': '#ffb4ab' };
// Status colours stay the same whatever the brand, so PAID / PARTIAL / PENDING never blend in.
const STATUS_LIGHT = { 'ok-container': '#dcf3e4', 'on-ok-container': '#14532d', 'warn-container': '#fdefc8', 'on-warn-container': '#7a4b00' };
const STATUS_DARK = { 'ok-container': '#123a26', 'on-ok-container': '#9ee6b8', 'warn-container': '#3d2c0a', 'on-warn-container': '#ffd88a' };

export function lightTokens(p) {
  const P = p.primary; const A = p.accent; const B = p.background;
  const ink = mix(P, '#000000', 0.72);
  const t = (x) => mix(B, P, x);
  const low = t(0.05); const cont = t(0.09); const high = t(0.13); const highest = t(0.18);
  const onVar = mix(ink, B, 0.3);
  const outline = mix(ink, B, 0.52);
  const outlineVar = mix(ink, B, 0.8);
  const pc = mix(P, '#000000', 0.45);
  const sec = readable(A, '#ffffff', 4.5);
  const onSecCont = readable(mix(A, '#000000', 0.55), high, 5.5);
  const tok = {
    surface: B, background: B, 'surface-bright': B, 'surface-dim': t(0.24),
    'surface-container-lowest': '#ffffff', 'surface-container-low': low, 'surface-container': cont,
    'surface-container-high': high, 'surface-container-highest': highest, 'surface-variant': highest,
    'on-surface': ink, 'on-background': ink, 'on-surface-variant': onVar,
    outline, 'outline-variant': outlineVar,
    'inverse-surface': mix(P, '#000000', 0.6), 'inverse-on-surface': low,
    primary: P, 'on-primary': contrast('#ffffff', P) >= 3 ? '#ffffff' : ink,
    'primary-container': pc, 'on-primary-container': mix(P, '#ffffff', 0.6), 'primary-fixed': mix(P, '#ffffff', 0.86),
    secondary: sec, 'on-secondary': contrast('#ffffff', sec) >= 3 ? '#ffffff' : ink,
    'secondary-container': mix(A, '#ffffff', 0.45), 'on-secondary-container': onSecCont,
    'secondary-fixed': mix(A, '#ffffff', 0.85), 'secondary-fixed-dim': mix(A, '#ffffff', 0.6),
    'on-secondary-fixed': mix(A, '#000000', 0.75), 'on-secondary-fixed-variant': readable(mix(A, '#000000', 0.4), high, 4.5),
    accent: A,
    ...ERR_LIGHT, ...STATUS_LIGHT,
  };
  Object.assign(tok, {
    'slate-50': B, 'slate-100': low, 'slate-200': cont, 'slate-300': outlineVar, 'slate-400': outline,
    'slate-500': onVar, 'slate-600': onVar, 'slate-700': tok['inverse-surface'], 'slate-800': pc, 'slate-900': ink,
    'brand-50': low, 'brand-100': tok['secondary-fixed'], 'brand-200': tok['secondary-fixed-dim'],
    'brand-500': sec, 'brand-600': P, 'brand-700': pc, 'brand-800': onSecCont,
  });
  return tok;
}

export function darkTokens(p) {
  const N = p.night;
  const [h, s] = toHsl(p.primary);
  const [ha, sa] = toHsl(p.accent);
  const [hn, sn] = toHsl(N);
  const vivid = hsl(h, Math.max(s, 0.62), 0.4);
  const glow = hsl(ha, Math.max(sa, 0.75), 0.72);
  const lift = mix(vivid, '#ffffff', 0.15);
  const t = (x) => mix(N, lift, x);
  const lowest = t(0.06); const low = t(0.1); const cont = t(0.15); const high = t(0.2); const highest = t(0.26);
  const onSurf = hsl(hn, Math.min(0.5, sn + 0.2), 0.94);
  const onVar = hsl(hn, 0.28, 0.76);
  const outline = hsl(hn, 0.18, 0.6);
  const outlineVar = mix(N, onSurf, 0.22);
  const secCont = hsl(ha, 0.45, 0.3);
  const onSecCont = hsl(ha, 0.85, 0.88);
  const tok = {
    surface: N, background: N, 'surface-bright': low, 'surface-dim': mix(N, '#000000', 0.3),
    'surface-container-lowest': lowest, 'surface-container-low': low, 'surface-container': cont,
    'surface-container-high': high, 'surface-container-highest': highest, 'surface-variant': highest,
    'on-surface': onSurf, 'on-background': onSurf, 'on-surface-variant': onVar,
    outline, 'outline-variant': outlineVar,
    'inverse-surface': onSurf, 'inverse-on-surface': low,
    primary: vivid, 'on-primary': contrast('#ffffff', vivid) >= 2.6 ? '#ffffff' : hsl(h, 0.6, 0.1),
    'primary-container': hsl(h, s * 0.7 + 0.1, 0.24), 'on-primary-container': hsl(h, 0.6, 0.84), 'primary-fixed': high,
    secondary: glow, 'on-secondary': hsl(ha, 0.5, 0.12),
    'secondary-container': secCont, 'on-secondary-container': onSecCont,
    'secondary-fixed': high, 'secondary-fixed-dim': hsl(ha, 0.8, 0.8),
    'on-secondary-fixed': hsl(ha, 0.9, 0.95), 'on-secondary-fixed-variant': hsl(ha, 0.8, 0.84),
    accent: p.accent,
    ...ERR_DARK, ...STATUS_DARK,
  };
  Object.assign(tok, {
    'slate-50': N, 'slate-100': low, 'slate-200': cont, 'slate-300': outlineVar, 'slate-400': outline,
    'slate-500': onVar, 'slate-600': onVar, 'slate-700': mix(onVar, onSurf, 0.5), 'slate-800': onSurf, 'slate-900': hsl(hn, 0.5, 0.97),
    'brand-50': low, 'brand-100': high, 'brand-200': secCont, 'brand-500': glow, 'brand-600': vivid,
    'brand-700': mix(vivid, '#ffffff', 0.25), 'brand-800': onSecCont,
  });
  return tok;
}

/** Night-sky colours used by the welcome page, glows, cursor trail and stars. */
export function nightTokens(p) {
  const N = p.night;
  const [h, s] = toHsl(p.primary);
  const [ha, sa] = toHsl(p.accent);
  const [hn] = toHsl(N);
  const vivid = hsl(h, Math.max(s, 0.62), 0.48);
  return {
    'w-bg': mix(N, '#000000', 0.45), 'w-bg2': mix(N, '#000000', 0.15), 'w-bg3': mix(N, vivid, 0.14), 'w-deep': mix(N, vivid, 0.32),
    'w-vivid': vivid, 'w-vivid2': hsl(h, Math.max(s, 0.62), 0.38),
    'w-glow': hsl(ha, Math.max(sa, 0.75), 0.72), 'w-glow2': hsl(ha, Math.max(sa, 0.75), 0.64),
    'w-soft': hsl(h, 0.6, 0.9), 'w-star': hsl(h, 0.5, 0.94),
    'w-mist': hsl(hn, 0.3, 0.84), 'w-mist2': hsl(hn, 0.25, 0.75), 'w-mist3': hsl(hn, 0.18, 0.6),
    'w-warm': hsl(ha, 0.95, 0.84),
  };
}

const block = (sel, tok, extra = '') => `${sel} {\n${Object.entries(tok).map(([k, v]) => `  --c-${k}: ${triplet(v)};`).join('\n')}\n${extra}}\n`;

/** Full CSS for a palette (same selectors as theme.css, so it can override it). */
export function paletteCss(brand) {
  const p = resolveBrand(brand);
  const L = lightTokens(p); const D = darkTokens(p); const W = nightTokens(p);
  return block(':root, .theme-light', L, '  color-scheme: light;\n')
    + block("[data-theme='dark']", D, '  color-scheme: dark;\n')
    + block("[data-theme='dark'] .theme-light", L, '  color-scheme: light;\n')
    + block(':root', W);
}

/** Applies a palette to the page now (and remembers it for the next first paint). */
export function applyBrand(brand, { remember = true } = {}) {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('staybill-brand');
  if (!el) { el = document.createElement('style'); el.id = 'staybill-brand'; document.head.appendChild(el); }
  el.textContent = paletteCss(brand);
  const p = resolveBrand(brand);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', p.primary);
  try { window.dispatchEvent(new Event('staybill:brand')); } catch { /* ignore */ }
  if (remember) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(brand || DEFAULT_BRAND)); } catch { /* ignore */ } }
}
export function cachedBrand() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || DEFAULT_BRAND; } catch { return DEFAULT_BRAND; }
}
/** Reads a night colour (`w-glow`, …) as "r g b" for canvas drawing. */
export function cssTriplet(name, fallback = '255 255 255') {
  try { return getComputedStyle(document.documentElement).getPropertyValue(`--c-${name}`).trim() || fallback; } catch { return fallback; }
}
export const sameBrand = (a, b) => JSON.stringify(resolveBrand(a)) === JSON.stringify(resolveBrand(b));
