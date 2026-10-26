// The hotel's team: everyone with a login, plus workers without one (added in
// Payroll). Each person has one id used across attendance, shifts and payroll:
// the login's uid, or the pay profile's id for people without a login.
import { useMemo } from 'react';
import { useLive, useStaff } from '../kit';

export function useTeam({ includeOwner = false } = {}) {
  const staff = useStaff();
  const profiles = useLive('payProfiles');
  return useMemo(() => {
    const prof = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
    const out = staff
      .filter((s) => s.status !== 'disabled' && (includeOwner || s.role !== 'owner'))
      .map((s) => ({ id: s.id, uid: s.id, name: prof[s.id]?.name || s.name, designation: prof[s.id]?.designation || (s.role === 'owner' ? 'Owner' : 'Staff'), login: s.username, profile: prof[s.id] || null }));
    (profiles || []).filter((p) => !staff.some((s) => s.id === p.id) && p.active !== false)
      .forEach((p) => out.push({ id: p.id, uid: null, name: p.name, designation: p.designation || 'Staff', login: null, profile: p }));
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [staff, profiles, includeOwner]);
}

export const ATT = { Present: 'ok', Late: 'warn', 'Half day': 'warn', Absent: 'error', Leave: 'info', 'Week off': 'muted', Holiday: 'muted' };
export const LEAVE_TYPES = ['Casual leave', 'Sick leave', 'Earned leave', 'Unpaid leave', 'Comp off'];

export function minutes(t) { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; }
export function hoursBetween(a, b) {
  const x = minutes(a); let y = minutes(b);
  if (x === null || y === null) return 0;
  if (y < x) y += 24 * 60; // night shift past midnight
  return Math.round(((y - x) / 60) * 100) / 100;
}
export function attKey(date, personId) { return `${date}_${personId}`; }
export function daysIn(month) { const [y, m] = month.split('-').map(Number); return new Date(y, m, 0).getDate(); }
export function monthDates(month) { return Array.from({ length: daysIn(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`); }
export function shiftMonth(month, d) { const [y, m] = month.split('-').map(Number); const x = new Date(y, m - 1 + d, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; }
export const monthLabel = (month) => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
