// Attendance: everyone clocks in and out from their own login; the owner keeps
// the daily register (and marks people without a login), and gets a monthly
// late / absent report.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveSettings } from '../../lib/db';
import { downloadCsv } from '../../lib/csv';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Modal, Select, cx, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Panel, Stats, fmtDate, num, nowTime, setRecord, today, useLive } from '../kit';
import { ATT, attKey, hoursBetween, minutes, monthDates, monthLabel, shiftMonth, useTeam } from './common';

export const ATT_DEFAULTS = { start: '09:00', grace: 15, halfDayHours: 4, weekOff: 0 };
export const attSettings = (settings) => ({ ...ATT_DEFAULTS, ...(settings.attendance || {}) });

/** Present or Late from the clock-in time and the hotel's start time (or the person's shift). */
export function statusFor(inTime, start, grace) {
  const a = minutes(inTime); const b = minutes(start);
  if (a === null || b === null) return 'Present';
  return a > b + num(grace) ? 'Late' : 'Present';
}

function ClockCard({ me, row, cfg, shift }) {
  const { user } = useAuth();
  const toast = useToast();
  const [now, setNow] = useState(nowTime());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(nowTime()), 15000); return () => clearInterval(t); }, []);
  const start = shift?.start || cfg.start;
  async function clock(kind) {
    setBusy(true);
    try {
      const t = nowTime();
      if (kind === 'in') {
        await setRecord(user, 'attendance', attKey(today(), me.id), { personId: me.id, name: me.name, date: today(), in: t, status: statusFor(t, start, cfg.grace), shiftStart: start, by: 'self' }, 'CLOCK_IN');
        toast(`Clocked in at ${t}`);
      } else {
        const hrs = hoursBetween(row.in, t);
        await setRecord(user, 'attendance', attKey(today(), me.id), { out: t, hours: hrs, status: hrs < num(cfg.halfDayHours) && row.status !== 'Late' ? 'Half day' : row.status }, 'CLOCK_OUT');
        toast(`Clocked out at ${t} · ${hrs} h`);
      }
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-space-md rounded-xl bg-gradient-to-br from-primary to-primary-container p-space-lg text-on-primary shadow-sm">
      <div>
        <div className="text-label-md uppercase tracking-wider opacity-80">{fmtDate(today())}{shift ? ` · ${shift.name || 'Shift'} ${shift.start}–${shift.end}` : ` · Starts ${cfg.start}`}</div>
        <div className="font-headline text-[2.5rem] font-bold leading-tight tabular-nums">{now}</div>
        <div className="text-body-md opacity-90">
          {!row ? `Hello ${me.name.split(' ')[0]}, you haven’t clocked in yet.` : row.out ? `Done for today: ${row.in} – ${row.out} (${row.hours} h).` : `Clocked in at ${row.in}${row.status === 'Late' ? ' · late' : ''}.`}
        </div>
      </div>
      {!row && <Button size="lg" variant="secondary" icon="login" loading={busy} onClick={() => clock('in')}>Clock in</Button>}
      {row && !row.out && row.in && <Button size="lg" variant="secondary" icon="logout" loading={busy} onClick={() => clock('out')}>Clock out</Button>}
      {row?.out && <span className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-label-lg"><Icon name="task_alt" size={18} />Recorded</span>}
    </div>
  );
}

function MarkModal({ person, date, row, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ status: row?.status || 'Present', in: row?.in || '', out: row?.out || '', note: row?.note || '' });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const working = ['Present', 'Late', 'Half day'].includes(v.status);
      await setRecord(user, 'attendance', attKey(date, person.id), {
        personId: person.id, name: person.name, date, status: v.status, in: working ? v.in : '', out: working ? v.out : '',
        hours: working && v.in && v.out ? hoursBetween(v.in, v.out) : 0, note: v.note.trim(), by: 'owner',
      }, 'ATTENDANCE_MARKED');
      toast(`${person.name}: ${v.status}`); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} title={`${person.name} · ${fmtDate(date)}`} icon="how_to_reg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <div className="flex flex-wrap gap-1.5 sm:col-span-2">
          {Object.keys(ATT).map((s) => <button type="button" key={s} onClick={() => setV({ ...v, status: s })} className={cx('rounded-full px-3 py-1 text-label-md ring-1', v.status === s ? 'bg-primary text-on-primary ring-transparent' : 'text-on-surface-variant ring-outline-variant')}>{s}</button>)}
        </div>
        {['Present', 'Late', 'Half day'].includes(v.status) && <>
          <Field label="In"><Input type="time" value={v.in} onChange={(e) => setV({ ...v, in: e.target.value })} /></Field>
          <Field label="Out"><Input type="time" value={v.out} onChange={(e) => setV({ ...v, out: e.target.value })} /></Field>
        </>}
        <Field label="Note" className="sm:col-span-2"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Register({ team, date, setDate, isAdmin, shifts }) {
  const rows = useLive('attendance', { where: [['date', '==', date]] });
  const [mark, setMark] = useState(null);
  const by = Object.fromEntries((rows || []).map((r) => [r.personId, r]));
  const list = team.map((p) => ({ ...p, att: by[p.id], shift: shifts[`${date}_${p.id}`] }));
  const counts = (s) => list.filter((p) => p.att?.status === s).length;
  return (
    <>
      <Stats items={[
        { label: 'Present', value: counts('Present') + counts('Late') + counts('Half day'), icon: 'how_to_reg', sub: `of ${team.length}` },
        { label: 'Late', value: counts('Late'), icon: 'schedule', tone: counts('Late') ? 'error' : undefined },
        { label: 'On leave / off', value: counts('Leave') + counts('Week off') + counts('Holiday'), icon: 'beach_access' },
        { label: 'Not marked', value: list.filter((p) => !p.att).length, icon: 'help', tone: date < today() && list.some((p) => !p.att) ? 'error' : undefined },
      ]} />
      <DataTable rows={rows ? list : null} dense onRow={isAdmin ? (p) => setMark(p) : undefined}
        toolbar={<div className="w-44"><Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} aria-label="Date" /></div>}
        search={(p) => `${p.name} ${p.designation}`} empty="Add staff logins in Settings → Staff logins, or people without a login in Payroll."
        columns={[
          { key: 'n', label: 'Name', render: (p) => <><b>{p.name}</b><div className="text-label-sm text-on-surface-variant">{p.designation}{p.login ? '' : ' · no login'}</div></> },
          { key: 'sh', label: 'Shift', render: (p) => (p.shift ? `${p.shift.name || ''} ${p.shift.start}–${p.shift.end}` : '—') },
          { key: 'st', label: 'Status', render: (p) => (p.att ? <Chip tone={ATT[p.att.status]}>{p.att.status}</Chip> : <Chip>Not marked</Chip>) },
          { key: 'in', label: 'In', render: (p) => p.att?.in || '—' },
          { key: 'out', label: 'Out', render: (p) => p.att?.out || (p.att?.in ? <span className="text-on-surface-variant">working</span> : '—') },
          { key: 'h', label: 'Hours', right: true, render: (p) => (p.att?.hours ? p.att.hours : '—') },
        ]}
        actions={isAdmin ? (p) => <Button size="sm" variant="ghost" icon="edit" onClick={() => setMark(p)}>Mark</Button> : undefined} />
      {mark && <MarkModal person={mark} date={date} row={mark.att} onClose={() => setMark(null)} />}
    </>
  );
}

export function monthSummary(rows, personId, dates) {
  const mine = rows.filter((r) => r.personId === personId && dates.includes(r.date));
  const c = (s) => mine.filter((r) => r.status === s).length;
  return {
    present: c('Present') + c('Late'), late: c('Late'), half: c('Half day'), absent: c('Absent'), leave: c('Leave'), off: c('Week off') + c('Holiday'),
    hours: Math.round(mine.reduce((a, r) => a + num(r.hours), 0) * 10) / 10,
    // Everyone is paid for the month except days marked absent (half days count ½).
    paidDays: dates.length - c('Absent') - c('Half day') * 0.5,
  };
}

function Report({ team, month, setMonth }) {
  const dates = monthDates(month);
  const rows = useLive('attendance', { where: [['date', '>=', dates[0]], ['date', '<=', dates[dates.length - 1]]] }) || [];
  const by = {};
  rows.forEach((r) => { by[`${r.date}_${r.personId}`] = r; });
  const letter = { Present: 'P', Late: 'L', 'Half day': 'H', Absent: 'A', Leave: 'LV', 'Week off': 'WO', Holiday: 'HO' };
  const color = { P: 'bg-ok-container text-on-ok-container', L: 'bg-warn-container text-on-warn-container', H: 'bg-warn-container text-on-warn-container', A: 'bg-error-container text-on-error-container', LV: 'bg-surface-container-high text-secondary' };
  function csv() {
    downloadCsv(`attendance-${month}.csv`, ['Name', 'Designation', ...dates.map((d) => d.slice(8)), 'Present', 'Late', 'Half', 'Absent', 'Leave', 'Off', 'Hours', 'Paid days'],
      team.map((p) => { const s = monthSummary(rows, p.id, dates); return [p.name, p.designation, ...dates.map((d) => letter[by[`${d}_${p.id}`]?.status] || ''), s.present, s.late, s.half, s.absent, s.leave, s.off, s.hours, s.paidDays]; }));
  }
  return (
    <Panel title={monthLabel(month)} icon="calendar_month"
      actions={<><Button size="sm" variant="ghost" icon="chevron_left" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))} /><Button size="sm" variant="ghost" icon="chevron_right" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))} /><Button size="sm" variant="secondary" icon="file_download" onClick={csv}>CSV</Button></>}>
      <div className="thin-scroll overflow-x-auto">
        <table className="text-label-sm">
          <thead><tr><th className="sticky left-0 bg-surface-container-lowest px-2 py-1 text-left">Name</th>{dates.map((d) => <th key={d} className="w-7 px-0.5 text-center font-normal text-on-surface-variant">{Number(d.slice(8))}</th>)}<th className="px-2">P</th><th className="px-2">Late</th><th className="px-2">A</th><th className="px-2">Leave</th><th className="px-2">Hours</th></tr></thead>
          <tbody>
            {team.map((p) => {
              const s = monthSummary(rows, p.id, dates);
              return (
                <tr key={p.id} className="border-t border-surface-container">
                  <td className="sticky left-0 whitespace-nowrap bg-surface-container-lowest px-2 py-1 font-semibold">{p.name}</td>
                  {dates.map((d) => { const l = letter[by[`${d}_${p.id}`]?.status]; return <td key={d} className="px-0.5 py-1 text-center"><span className={cx('inline-block min-w-[22px] rounded px-0.5', color[l] || 'text-outline')}>{l || '·'}</span></td>; })}
                  <td className="px-2 text-center tabular-nums">{s.present}</td><td className="px-2 text-center tabular-nums">{s.late}</td><td className="px-2 text-center tabular-nums">{s.absent}</td><td className="px-2 text-center tabular-nums">{s.leave}</td><td className="px-2 text-center tabular-nums">{s.hours}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-label-md text-on-surface-variant">P present · L late · H half day · A absent · LV leave · WO week off · HO holiday</p>
    </Panel>
  );
}

function RulesModal({ onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [v, setV] = useState(attSettings(settings));
  async function save() {
    try { await saveSettings(user, { attendance: { start: v.start, grace: num(v.grace), halfDayHours: num(v.halfDayHours), weekOff: num(v.weekOff) } }); toast('Attendance rules saved'); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title="Attendance rules" icon="tune" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Day starts at" hint="Used when the person has no shift"><Input type="time" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></Field>
        <Field label="Grace minutes"><Input type="number" min="0" value={v.grace} onChange={(e) => setV({ ...v, grace: e.target.value })} /></Field>
        <Field label="Half day if fewer hours than"><Input type="number" min="0" value={v.halfDayHours} onChange={(e) => setV({ ...v, halfDayHours: e.target.value })} /></Field>
        <Field label="Weekly off"><Select value={v.weekOff} onChange={(e) => setV({ ...v, weekOff: e.target.value })}>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}

export default function Attendance() {
  const { user, isAdmin } = useAuth();
  const { settings } = useData();
  const cfg = attSettings(settings);
  const team = useTeam({ includeOwner: false });
  const [tab, setTab] = useState(isAdmin ? 'register' : 'me');
  const [date, setDate] = useState(today());
  const [month, setMonth] = useState(today().slice(0, 7));
  const [rules, setRules] = useState(false);
  const mine = useLive('attendance', { where: [['personId', '==', user?.uid || '-']] });
  const shiftRows = useLive('shifts', { where: [['date', '==', date]] }) || [];
  const shifts = useMemo(() => Object.fromEntries(shiftRows.map((s) => [`${s.date}_${s.personId}`, s])), [shiftRows]);
  const me = { id: user?.uid, name: user?.name || 'You' };
  const todayRow = (mine || []).find((r) => r.date === today());
  const myShift = shiftRows.find((s) => s.personId === user?.uid && s.date === today());
  const myMonth = (mine || []).filter((r) => r.date.startsWith(today().slice(0, 7)));
  const tabs = [{ id: 'me', label: 'My attendance', icon: 'person' }, ...(isAdmin ? [{ id: 'register', label: 'Daily register', icon: 'fact_check' }, { id: 'report', label: 'Monthly report', icon: 'calendar_month' }] : [])];
  return (
    <ModulePage crumb={['Team', 'Attendance']} title="Attendance" subtitle="Clock in, clock out, and see who is on duty"
      tabs={tabs} tab={tab} onTab={setTab} actions={isAdmin ? <Button variant="secondary" icon="tune" onClick={() => setRules(true)}>Rules</Button> : null}>
      {tab === 'me' && (
        <>
          <ClockCard me={me} row={todayRow} cfg={cfg} shift={myShift} />
          <DataTable rows={mine ? (mine || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)) : null} dense empty="Your attendance will appear here."
            toolbar={<span className="text-label-md text-on-surface-variant">This month: {myMonth.filter((r) => ['Present', 'Late', 'Half day'].includes(r.status)).length} days · {myMonth.filter((r) => r.status === 'Late').length} late</span>}
            columns={[
              { key: 'd', label: 'Date', render: (r) => fmtDate(r.date) },
              { key: 's', label: 'Status', render: (r) => <Chip tone={ATT[r.status]}>{r.status}</Chip> },
              { key: 'i', label: 'In', render: (r) => r.in || '—' }, { key: 'o', label: 'Out', render: (r) => r.out || '—' },
              { key: 'h', label: 'Hours', right: true, render: (r) => r.hours || '—' },
            ]} />
        </>
      )}
      {tab === 'register' && isAdmin && <Register team={team} date={date} setDate={setDate} isAdmin={isAdmin} shifts={shifts} />}
      {tab === 'report' && isAdmin && <Report team={team} month={month} setMonth={setMonth} />}
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </ModulePage>
  );
}
