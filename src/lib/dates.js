// Local-calendar date helpers. All business dates are stored as 'YYYY-MM-DD'.

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function today() {
  return dayKey(new Date());
}
export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

export const RANGE_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

/** Returns {from, to} inclusive day keys for a preset (PRD §43). */
export function presetRange(id) {
  const now = new Date();
  const t = dayKey(now);
  switch (id) {
    case 'today':
      return { from: t, to: t };
    case 'yesterday': {
      const y = addDays(t, -1);
      return { from: y, to: y };
    }
    case 'week': {
      // Week starts Monday
      const dow = (now.getDay() + 6) % 7;
      return { from: addDays(t, -dow), to: t };
    }
    case 'month':
      return { from: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: t };
    default:
      return { from: t, to: t };
  }
}

export function eachDay(from, to) {
  const out = [];
  let k = from;
  let guard = 0;
  while (k <= to && guard++ < 1000) {
    out.push(k);
    k = addDays(k, 1);
  }
  return out;
}
