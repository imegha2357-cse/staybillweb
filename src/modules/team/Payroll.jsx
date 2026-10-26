// Payroll: salary structure per person, advances, monthly run from attendance
// (paid days), PF / ESI / professional tax, payslip PDFs and the salary register.
import { useMemo, useState } from 'react';
import { writeBatch, serverTimestamp, increment } from '../../backend/firestore';
import { db } from '../../firebase';
import { hdoc } from '../../lib/scope';
import { actor, saveSettings } from '../../lib/db';
import { downloadCsv } from '../../lib/csv';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { Button, Field, Input, Modal, Select, Toggle, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, FormFields, ModulePage, Panel, Stats, fmtDate, money, num, round2, saveRecord, setRecord, today, useLive, validate } from '../kit';
import { daysIn, monthDates, monthLabel, shiftMonth, useTeam } from './common';
import { monthSummary } from './Attendance';
import { buildDocPdf, docPdf, rs } from '../docPdf';
import { saveFile } from '../../platform';

export const PAY_DEFAULTS = { pfRate: 12, pfCap: 15000, esiRate: 0.75, esiEmployer: 3.25, esiLimit: 21000, pt: 200, ptFrom: 15000 };
export const payCfg = (s) => ({ ...PAY_DEFAULTS, ...(s.payroll || {}) });

const PROFILE = [
  { key: 'name', label: 'Name', required: true, half: true },
  { key: 'designation', label: 'Designation', half: true, placeholder: 'Receptionist, Housekeeper…' },
  { key: 'department', label: 'Department', type: 'select', half: true, options: ['Front office', 'Housekeeping', 'Restaurant', 'Kitchen', 'Maintenance', 'Security', 'Accounts', 'Management', 'Other'] },
  { key: 'joinDate', label: 'Joining date', type: 'date', half: true },
  { key: 'basic', label: 'Basic (monthly)', type: 'money', half: true, required: true },
  { key: 'hra', label: 'HRA (monthly)', type: 'money', half: true },
  { key: 'allowance', label: 'Other allowances (monthly)', type: 'money', half: true },
  { key: 'pt', label: 'Professional tax (monthly)', type: 'money', half: true, hint: 'Leave blank to use the hotel default' },
  { key: 'pf', label: 'PF applies', type: 'toggle', hint: '12% of basic, up to the ₹15,000 wage ceiling' },
  { key: 'esi', label: 'ESI applies', type: 'toggle', hint: 'Only when gross pay is ₹21,000 or less' },
  { key: 'uan', label: 'UAN', half: true }, { key: 'esiNo', label: 'ESI number', half: true },
  { key: 'pan', label: 'PAN', half: true, upper: true }, { key: 'bank', label: 'Bank account / UPI', half: true },
  { key: 'phone', label: 'Phone', type: 'tel', half: true },
];

/** One person's pay for the month. */
export function computePay(p, { paidDays, dim, bonus = 0, otherDed = 0, advance = 0, cfg }) {
  const f = dim ? Math.min(1, paidDays / dim) : 1;
  const basic = round2(num(p.basic) * f);
  const hra = round2(num(p.hra) * f);
  const allowance = round2(num(p.allowance) * f);
  const gross = round2(basic + hra + allowance + num(bonus));
  const fullGross = num(p.basic) + num(p.hra) + num(p.allowance);
  const pf = p.pf ? Math.round((Math.min(basic, cfg.pfCap) * cfg.pfRate) / 100) : 0;
  const esiOn = p.esi && fullGross <= cfg.esiLimit;
  const esi = esiOn ? Math.ceil((gross * cfg.esiRate) / 100) : 0;
  const pt = gross >= cfg.ptFrom ? (p.pt === '' || p.pt === undefined || p.pt === null ? num(cfg.pt) : num(p.pt)) : 0;
  const ded = round2(pf + esi + pt + num(advance) + num(otherDed));
  return {
    paidDays, dim, basic, hra, allowance, bonus: num(bonus), gross, pf, esi, pt, advance: num(advance), otherDed: num(otherDed), deductions: ded,
    net: round2(Math.max(0, gross - ded)), employerPf: pf, employerEsi: esiOn ? Math.ceil((gross * cfg.esiEmployer) / 100) : 0,
  };
}

function slipSpec(s, settings) {
  return {
    settings, title: 'Payslip', number: monthLabel(s.month), filename: `payslip-${s.month}-${s.name.replace(/\s+/g, '-')}.pdf`,
    left: [['Employee', s.name], ['Designation', [s.designation, s.department].filter(Boolean).join(' · ')], ['UAN', s.uan], ['PAN', s.pan]],
    right: [['Pay period', monthLabel(s.month)], ['Paid days', `${s.paidDays} of ${s.dim}`], ['Bank / UPI', s.bank], ['Paid on', s.paidOn ? `${fmtDate(s.paidOn)} · ${s.method || ''}` : 'Not yet paid']],
    head: ['Earnings', 'Amount', 'Deductions', 'Amount'],
    body: [
      ['Basic', rs(s.basic), 'Provident fund', rs(s.pf)],
      ['HRA', rs(s.hra), 'ESI', rs(s.esi)],
      ['Other allowances', rs(s.allowance), 'Professional tax', rs(s.pt)],
      ['Bonus / overtime', rs(s.bonus), 'Advance recovery', rs(s.advance)],
      ['', '', 'Other deductions', rs(s.otherDed)],
      ['Gross earnings', rs(s.gross), 'Total deductions', rs(s.deductions)],
    ],
    columnStyles: { 1: { halign: 'right' }, 3: { halign: 'right' } },
    totals: [['Net pay', rs(s.net), true]],
    notes: `Employer contributions (not deducted): PF ${rs(s.employerPf)} · ESI ${rs(s.employerEsi)}.`,
    sign: 'Authorised signatory',
  };
}
export const payslipPdf = (s, settings) => docPdf(slipSpec(s, settings));

function ProfileModal({ person, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState(() => ({ name: person?.name || '', designation: person?.designation === 'Staff' ? '' : person?.designation || '', pf: true, esi: true, ...(person?.profile || {}) }));
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  async function save() {
    const e = validate(PROFILE, v); setErr(e); if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const body = { ...v, basic: num(v.basic), hra: num(v.hra), allowance: num(v.allowance), pt: v.pt === '' || v.pt === undefined ? null : num(v.pt), pan: (v.pan || '').toUpperCase(), active: true, hasLogin: !!person?.uid };
      if (person?.id) await setRecord(user, 'payProfiles', person.id, body, 'PAY_PROFILE_SAVED');
      else await saveRecord(user, 'payProfiles', null, body, 'PAY_PROFILE_CREATED');
      toast('Salary details saved'); onClose();
    } catch (e2) { toast(errMsg(e2), 'error'); }
    setBusy(false);
  }
  return (
    <Modal open onClose={onClose} wide icon="badge" title={person?.id ? `${person.name} · salary` : 'Add a worker without a login'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="pb-space-sm"><FormFields fields={PROFILE} value={v} onChange={setV} errors={err} /></div>
    </Modal>
  );
}

function AdvanceModal({ team, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const [v, setV] = useState({ personId: '', amount: '', installment: '', date: today(), note: '' });
  async function save() {
    const p = team.find((x) => x.id === v.personId);
    if (!p || !(num(v.amount) > 0)) return toast('Choose the person and the amount.', 'error');
    try {
      await saveRecord(user, 'salaryAdvances', null, { personId: p.id, name: p.name, amount: num(v.amount), installment: num(v.installment) || num(v.amount), recovered: 0, date: v.date, note: v.note.trim() }, 'ADVANCE_GIVEN');
      toast(`${money(v.amount)} advance to ${p.name}`); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title="Salary advance" icon="savings" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Staff" className="sm:col-span-2"><Select value={v.personId} onChange={(e) => setV({ ...v, personId: e.target.value })}><option value="">Choose…</option>{team.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
        <Field label="Amount"><Input type="number" min="0" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
        <Field label="Recover per month" hint="Blank = all next month"><Input type="number" min="0" value={v.installment} onChange={(e) => setV({ ...v, installment: e.target.value })} /></Field>
        <Field label="Date"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Note"><Input value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function Run({ team, month, setMonth }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const cfg = payCfg(settings);
  const dates = monthDates(month);
  const dim = daysIn(month);
  const att = useLive('attendance', { where: [['date', '>=', dates[0]], ['date', '<=', dates[dim - 1]]] });
  const slips = useLive('payslips', { where: [['month', '==', month]] });
  const advances = useLive('salaryAdvances') || [];
  const [extra, setExtra] = useState({});
  const [useAtt, setUseAtt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pay, setPay] = useState(null);
  const slipBy = Object.fromEntries((slips || []).map((s) => [s.personId, s]));
  const paid = team.filter((p) => p.profile);
  const rows = useMemo(() => paid.map((p) => {
    const existing = slipBy[p.id];
    if (existing && existing.status === 'Paid') return { ...p, calc: existing, slip: existing };
    const s = monthSummary(att || [], p.id, dates);
    const hasAtt = (att || []).some((r) => r.personId === p.id);
    const paidDays = useAtt && hasAtt ? s.paidDays : dim;
    const adv = advances.filter((a) => a.personId === p.id && num(a.recovered) < num(a.amount) && a.date <= dates[dim - 1]);
    const advDue = adv.reduce((a, x) => a + Math.min(num(x.installment) || num(x.amount), num(x.amount) - num(x.recovered)), 0);
    const e = extra[p.id] || {};
    const calc = computePay(p.profile, { paidDays, dim, bonus: e.bonus, otherDed: e.otherDed, advance: e.advance ?? advDue, cfg });
    return { ...p, calc, slip: existing, hasAtt, s, adv };
  }), [paid, att, advances, extra, useAtt, slipBy, dates, dim, cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const tot = rows.reduce((a, r) => ({ gross: a.gross + r.calc.gross, net: a.net + r.calc.net, pf: a.pf + r.calc.pf + r.calc.employerPf, esi: a.esi + r.calc.esi + r.calc.employerEsi }), { gross: 0, net: 0, pf: 0, esi: 0 });
  const setX = (id, k, val) => setExtra({ ...extra, [id]: { ...(extra[id] || {}), [k]: val } });

  async function generate() {
    setBusy(true);
    try {
      const b = writeBatch(db);
      rows.filter((r) => r.slip?.status !== 'Paid').forEach((r) => {
        const p = r.profile;
        b.set(hdoc('payslips', `${month}_${r.id}`), {
          month, personId: r.id, name: r.name, designation: p.designation || r.designation, department: p.department || '', uan: p.uan || '', pan: p.pan || '', bank: p.bank || '',
          ...r.calc, advanceIds: (r.adv || []).map((a) => a.id), status: 'Draft', updatedAt: serverTimestamp(), createdBy: actor(user),
        });
      });
      await b.commit();
      toast(`Payslips ready for ${monthLabel(month)}`);
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  async function markPaid(list, method, date) {
    try {
      const b = writeBatch(db);
      list.forEach((s) => {
        b.update(hdoc('payslips', s.id), { status: 'Paid', method, paidOn: date, updatedAt: serverTimestamp() });
        // Recover advances in order, oldest first.
        let left = num(s.advance);
        advances.filter((a) => (s.advanceIds || []).includes(a.id)).sort((x, y) => (x.date < y.date ? -1 : 1)).forEach((a) => {
          const take = Math.min(left, num(a.amount) - num(a.recovered));
          if (take > 0) { b.update(hdoc('salaryAdvances', a.id), { recovered: increment(take) }); left -= take; }
        });
      });
      await b.commit();
      toast(`${list.length} salar${list.length === 1 ? 'y' : 'ies'} marked paid`); setPay(null);
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function register(kind) {
    const list = (slips || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) return toast('Generate payslips first.', 'error');
    const head = ['Name', 'Designation', 'Days', 'Basic', 'HRA', 'Allow.', 'Bonus', 'Gross', 'PF', 'ESI', 'PT', 'Advance', 'Other', 'Net', 'Status'];
    const body = list.map((s) => [s.name, s.designation, s.paidDays, s.basic, s.hra, s.allowance, s.bonus, s.gross, s.pf, s.esi, s.pt, s.advance, s.otherDed, s.net, s.status]);
    if (kind === 'csv') return downloadCsv(`salary-register-${month}.csv`, head, body);
    const doc = await buildDocPdf({
      settings, landscape: true, title: 'Salary register', number: monthLabel(month), head, body: body.map((r) => r.map((c, i) => (i >= 3 && i <= 13 ? Number(c).toLocaleString('en-IN') : c))),
      totals: [['Gross', rs(list.reduce((a, s) => a + num(s.gross), 0))], ['Net paid', rs(list.reduce((a, s) => a + num(s.net), 0)), true]], sign: 'Approved by',
    });
    return saveFile(`salary-register-${month}.pdf`, doc.output('blob'), 'application/pdf');
  }
  const drafts = (slips || []).filter((s) => s.status === 'Draft');
  return (
    <>
      <Stats items={[
        { label: 'Gross pay', value: money(tot.gross), icon: 'payments', sub: `${rows.length} people` },
        { label: 'Net pay', value: money(tot.net), icon: 'account_balance_wallet' },
        { label: 'PF (both shares)', value: money(tot.pf), icon: 'savings' },
        { label: 'ESI (both shares)', value: money(tot.esi), icon: 'health_and_safety' },
      ]} />
      <Panel title={monthLabel(month)} icon="request_quote"
        actions={<>
          <Button size="sm" variant="ghost" icon="chevron_left" aria-label="Previous month" onClick={() => { setMonth(shiftMonth(month, -1)); setExtra({}); }} />
          <Button size="sm" variant="ghost" icon="chevron_right" aria-label="Next month" onClick={() => { setMonth(shiftMonth(month, 1)); setExtra({}); }} />
          <Toggle label="Pay by attendance" checked={useAtt} onChange={setUseAtt} />
          <Button size="sm" icon="receipt_long" loading={busy} onClick={generate} disabled={!rows.length}>{slips?.length ? 'Update payslips' : 'Generate payslips'}</Button>
          {drafts.length > 0 && <Button size="sm" variant="secondary" icon="done_all" onClick={() => setPay(drafts)}>Mark all paid</Button>}
          <Button size="sm" variant="ghost" icon="file_download" onClick={() => register('csv')}>CSV</Button>
          <Button size="sm" variant="ghost" icon="picture_as_pdf" onClick={() => register('pdf')}>Register</Button>
        </>}>
        {rows.length === 0 ? <p className="text-body-md text-on-surface-variant">Add salary details for your staff in the “Staff & salaries” tab first.</p> : (
          <div className="thin-scroll overflow-x-auto">
            <table className="w-full min-w-[980px] text-body-sm">
              <thead><tr className="text-left text-label-sm uppercase tracking-wider text-on-surface-variant">
                <th className="px-2 py-2">Staff</th><th className="px-2">Days</th><th className="px-2 text-right">Earned</th><th className="px-2">Bonus / OT</th><th className="px-2 text-right">Gross</th><th className="px-2 text-right">PF</th><th className="px-2 text-right">ESI</th><th className="px-2 text-right">PT</th><th className="px-2">Advance</th><th className="px-2">Other ded.</th><th className="px-2 text-right">Net</th><th className="px-2" />
              </tr></thead>
              <tbody>
                {rows.map((r) => {
                  const c = r.calc; const locked = r.slip?.status === 'Paid';
                  return (
                    <tr key={r.id} className="border-t border-surface-container">
                      <td className="px-2 py-2"><b>{r.name}</b><div className="text-label-sm text-on-surface-variant">{r.profile?.designation || r.designation}</div></td>
                      <td className="px-2 tabular-nums">{c.paidDays}/{c.dim}{!locked && useAtt && r.s?.absent > 0 && <div className="text-label-sm text-error">{r.s.absent} absent</div>}</td>
                      <td className="px-2 text-right tabular-nums">{money(c.basic + c.hra + c.allowance)}</td>
                      <td className="px-2"><div className="w-24"><Input className="h-9" type="number" min="0" disabled={locked} value={locked ? c.bonus : extra[r.id]?.bonus ?? ''} onChange={(e) => setX(r.id, 'bonus', e.target.value)} aria-label={`Bonus ${r.name}`} /></div></td>
                      <td className="px-2 text-right tabular-nums">{money(c.gross)}</td>
                      <td className="px-2 text-right tabular-nums">{c.pf || '—'}</td>
                      <td className="px-2 text-right tabular-nums">{c.esi || '—'}</td>
                      <td className="px-2 text-right tabular-nums">{c.pt || '—'}</td>
                      <td className="px-2"><div className="w-24"><Input className="h-9" type="number" min="0" disabled={locked} value={locked ? c.advance : extra[r.id]?.advance ?? c.advance} onChange={(e) => setX(r.id, 'advance', e.target.value)} aria-label={`Advance ${r.name}`} /></div></td>
                      <td className="px-2"><div className="w-24"><Input className="h-9" type="number" min="0" disabled={locked} value={locked ? c.otherDed : extra[r.id]?.otherDed ?? ''} onChange={(e) => setX(r.id, 'otherDed', e.target.value)} aria-label={`Other deduction ${r.name}`} /></div></td>
                      <td className="px-2 text-right font-semibold tabular-nums">{money(c.net)}</td>
                      <td className="whitespace-nowrap px-2 text-right">
                        {r.slip ? <><Chip tone={locked ? 'ok' : 'warn'}>{r.slip.status}</Chip><Button size="sm" variant="ghost" icon="picture_as_pdf" aria-label="Payslip PDF" onClick={() => payslipPdf(r.slip, settings)} />{!locked && <Button size="sm" variant="ghost" onClick={() => setPay([r.slip])}>Pay</Button>}</> : <Chip>Not generated</Chip>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-label-md text-on-surface-variant">PF {cfg.pfRate}% of basic up to {money(cfg.pfCap)} · ESI {cfg.esiRate}% (employer {cfg.esiEmployer}%) when monthly gross ≤ {money(cfg.esiLimit)} · PT {money(cfg.pt)} from gross {money(cfg.ptFrom)}. Change in Rules. Paid days are the days in the month minus days marked absent (including unpaid leave); half days count as ½.</p>
      </Panel>
      {pay && <PayModal list={pay} onClose={() => setPay(null)} onPay={markPaid} />}
    </>
  );
}

function PayModal({ list, onClose, onPay }) {
  const [method, setMethod] = useState('Bank Transfer');
  const [date, setDate] = useState(today());
  return (
    <Modal open onClose={onClose} title={list.length === 1 ? `Pay ${list[0].name}` : `Pay ${list.length} salaries`} icon="payments"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onPay(list, method, date)}>Mark paid · {money(list.reduce((a, s) => a + num(s.net), 0))}</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)}>{['Bank Transfer', 'UPI', 'Cash', 'Cheque'].map((m) => <option key={m}>{m}</option>)}</Select></Field>
        <Field label="Paid on"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function RulesModal({ onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [v, setV] = useState(payCfg(settings));
  const F = [['pfRate', 'PF % (employee & employer)'], ['pfCap', 'PF wage ceiling'], ['esiRate', 'ESI % employee'], ['esiEmployer', 'ESI % employer'], ['esiLimit', 'ESI applies up to gross'], ['pt', 'Professional tax / month'], ['ptFrom', 'PT applies from gross']];
  async function save() { try { await saveSettings(user, { payroll: Object.fromEntries(F.map(([k]) => [k, num(v[k])])) }); toast('Payroll rules saved'); onClose(); } catch (e) { toast(errMsg(e), 'error'); } }
  return (
    <Modal open onClose={onClose} title="Payroll rules" icon="tune" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        {F.map(([k, l]) => <Field key={k} label={l}><Input type="number" min="0" step="0.01" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>)}
        <p className="text-label-md text-on-surface-variant sm:col-span-2">Professional tax differs by state — set your state’s slab amount here, or per person on their salary details.</p>
      </div>
    </Modal>
  );
}

export default function Payroll() {
  const team = useTeam({ includeOwner: false });
  const advances = useLive('salaryAdvances');
  const [tab, setTab] = useState('run');
  const [month, setMonth] = useState(shiftMonth(today().slice(0, 7), new Date().getDate() < 15 ? -1 : 0));
  const [edit, setEdit] = useState(null);
  const [adv, setAdv] = useState(false);
  const [rules, setRules] = useState(false);
  const open = (advances || []).filter((a) => num(a.recovered) < num(a.amount));
  return (
    <ModulePage crumb={['Team', 'Payroll']} title="Payroll" subtitle="Salaries, statutory deductions and payslips"
      tabs={[{ id: 'run', label: 'Monthly run', icon: 'request_quote' }, { id: 'staff', label: 'Staff & salaries', icon: 'badge', count: team.length }, { id: 'adv', label: 'Advances', icon: 'savings', count: open.length || undefined }]} tab={tab} onTab={setTab}
      actions={<><Button variant="secondary" icon="tune" onClick={() => setRules(true)}>Rules</Button>{tab === 'staff' && <Button icon="person_add" onClick={() => setEdit({})}>Worker without login</Button>}{tab === 'adv' && <Button icon="add" onClick={() => setAdv(true)}>Give advance</Button>}</>}>
      {tab === 'run' && <Run team={team} month={month} setMonth={setMonth} />}
      {tab === 'staff' && (
        <DataTable rows={team} onRow={(p) => setEdit(p)} search={(p) => `${p.name} ${p.designation}`} empty="No staff yet."
          columns={[
            { key: 'n', label: 'Name', render: (p) => <><b>{p.name}</b><div className="text-label-sm text-on-surface-variant">{p.profile?.designation || p.designation}{p.login ? ` · @${p.login}` : ' · no login'}</div></> },
            { key: 'd', label: 'Department', render: (p) => p.profile?.department || '—' },
            { key: 'g', label: 'Monthly gross', right: true, render: (p) => (p.profile ? money(num(p.profile.basic) + num(p.profile.hra) + num(p.profile.allowance)) : <Chip tone="warn">Salary not set</Chip>) },
            { key: 's', label: 'Statutory', render: (p) => (p.profile ? [p.profile.pf && 'PF', p.profile.esi && 'ESI'].filter(Boolean).join(' · ') || '—' : '') },
          ]}
          actions={(p) => <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(p)}>{p.profile ? 'Edit' : 'Set salary'}</Button>} />
      )}
      {tab === 'adv' && (
        <DataTable rows={advances ? advances.slice().sort((a, b) => (a.date < b.date ? 1 : -1)) : null} empty="No salary advances."
          filters={[{ id: 'open', label: 'Being recovered', test: (a) => num(a.recovered) < num(a.amount) }, { id: 'all', label: 'All' }]}
          columns={[
            { key: 'n', label: 'Staff', render: (a) => <><b>{a.name}</b><div className="text-label-sm text-on-surface-variant">{fmtDate(a.date)}{a.note ? ` · ${a.note}` : ''}</div></> },
            { key: 'a', label: 'Amount', right: true, render: (a) => money(a.amount) },
            { key: 'i', label: 'Per month', right: true, render: (a) => money(a.installment) },
            { key: 'r', label: 'Recovered', right: true, render: (a) => money(a.recovered) },
            { key: 'b', label: 'Balance', right: true, render: (a) => <b>{money(num(a.amount) - num(a.recovered))}</b> },
          ]} />
      )}
      {edit && <ProfileModal person={edit.id ? edit : null} onClose={() => setEdit(null)} />}
      {adv && <AdvanceModal team={team} onClose={() => setAdv(false)} />}
      {rules && <RulesModal onClose={() => setRules(false)} />}
    </ModulePage>
  );
}
