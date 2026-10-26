// Accounts: profit & loss, balance sheet, trial balance, ledger and cash book —
// all built automatically from bills, payments, expenses, purchases and payroll.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveSettings } from '../../lib/db';
import { downloadCsv } from '../../lib/csv';
import { saveFile } from '../../platform';
import { Button, Field, Input, Modal, Select, cx, useToast, errMsg } from '../../components/ui';
import { DataTable, ModulePage, Panel, Stats, fmtDate, money, num, round2, today } from '../kit';
import { ACCOUNTS, balanceSheet, balances, profitAndLoss, typeOf, useBooks } from './ledger';
import { buildDocPdf, rs } from '../docPdf';

const firstOfMonth = () => `${today().slice(0, 7)}-01`;
const fyStart = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-04-01`; };
const PRESETS = [
  ['This month', () => [firstOfMonth(), today()]],
  ['Last month', () => { const e = addDay(firstOfMonth(), -1); return [`${e.slice(0, 7)}-01`, e]; }],
  ['This financial year', () => [fyStart(), today()]],
];

function Lines({ rows, total, label }) {
  return (
    <div className="text-body-md">
      {rows.length === 0 && <div className="py-1 text-on-surface-variant">None</div>}
      {rows.map(([a, v]) => <div key={a} className="flex justify-between border-b border-surface-container py-1.5"><span>{a.replace(/^Expense: /, '')}</span><span className="tabular-nums">{money(v)}</span></div>)}
      <div className="flex justify-between py-2 font-semibold"><span>{label}</span><span className="tabular-nums">{money(total)}</span></div>
    </div>
  );
}

function OpeningModal({ onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [v, setV] = useState({ date: firstOfMonth(), cash: '', bank: '', ...(settings.openingBalances || {}) });
  async function save() {
    try { await saveSettings(user, { openingBalances: { date: v.date, cash: num(v.cash), bank: num(v.bank) } }, 'OPENING_BALANCES'); toast('Opening balances saved'); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title="Opening balances" icon="account_balance" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-3">
        <Field label="As on"><Input type="date" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} /></Field>
        <Field label="Cash in hand"><Input type="number" min="0" value={v.cash} onChange={(e) => setV({ ...v, cash: e.target.value })} /></Field>
        <Field label="Bank / UPI balance"><Input type="number" min="0" value={v.bank} onChange={(e) => setV({ ...v, bank: e.target.value })} /></Field>
        <p className="text-label-md text-on-surface-variant sm:col-span-3">The money you had when you started using StayBill. It is shown as owner’s capital.</p>
      </div>
    </Modal>
  );
}

export default function Accounts() {
  const { settings } = useData();
  const books = useBooks(settings.openingBalances);
  const { J, ready } = books;
  const [tab, setTab] = useState('pl');
  const [[from, to], setRange] = useState([firstOfMonth(), today()]);
  const [acc, setAcc] = useState('Cash in hand');
  const [book, setBook] = useState('Cash in hand');
  const [opening, setOpening] = useState(false);
  const pl = useMemo(() => profitAndLoss(J, from, to), [J, from, to]);
  const bs = useMemo(() => balanceSheet(J, to), [J, to]);
  const tb = useMemo(() => Object.entries(balances(J, '0000', to)).filter(([, v]) => v).sort((a, b) => a[0].localeCompare(b[0])), [J, to]);
  const accounts = useMemo(() => [...new Set([...Object.keys(ACCOUNTS), ...J.flatMap((e) => e.lines.map((l) => l.account))])].sort(), [J]);

  function ledgerRows(account) {
    let bal = balances(J, '0000', addDay(from, -1))[account] || 0;
    const out = [{ id: 'open', date: from, narration: 'Opening balance', dr: 0, cr: 0, bal }];
    J.filter((e) => e.date >= from && e.date <= to).forEach((e, i) => e.lines.filter((l) => l.account === account).forEach((l, k) => {
      bal = round2(bal + l.dr - l.cr);
      out.push({ id: `${i}-${k}`, date: e.date, ref: e.ref, narration: e.narration, dr: l.dr, cr: l.cr, bal, kind: e.kind });
    }));
    return out;
  }
  const cash = balances(J, '0000', to);
  async function pdf() {
    const settingsPdf = settings;
    const spec = tab === 'bs'
      ? { title: 'Balance sheet', number: `As on ${fmtDate(to)}`, head: ['Liabilities & capital', 'Amount', 'Assets', 'Amount'], body: zip([...bs.liabilities, ...bs.equity], bs.assets).map(([l, a]) => [l?.[0] || '', l ? rs(l[1]) : '', a?.[0] || '', a ? rs(a[1]) : '']), totals: [['Total', rs(bs.totalAssets), true]] }
      : { title: 'Profit & loss', number: `${fmtDate(from)} – ${fmtDate(to)}`, head: ['Account', 'Amount'], body: [['INCOME', ''], ...pl.income.map(([a, v]) => [a, rs(v)]), ['Total income', rs(pl.totalIncome)], ['EXPENSES', ''], ...pl.expense.map(([a, v]) => [a.replace(/^Expense: /, ''), rs(v)]), ['Total expenses', rs(pl.totalExpense)]], totals: [[pl.profit >= 0 ? 'Net profit' : 'Net loss', rs(Math.abs(pl.profit)), true]], columnStyles: { 1: { halign: 'right' } } };
    const doc = await buildDocPdf({ settings: settingsPdf, ...spec });
    await saveFile(`${spec.title.toLowerCase().replace(/\W+/g, '-')}-${to}.pdf`, doc.output('blob'), 'application/pdf');
  }
  return (
    <ModulePage crumb={['Finance', 'Accounts']} title="Accounts" subtitle="Your books, kept automatically from everyday work"
      tabs={[{ id: 'pl', label: 'Profit & loss', icon: 'trending_up' }, { id: 'bs', label: 'Balance sheet', icon: 'account_balance' }, { id: 'cash', label: 'Cash book', icon: 'payments' }, { id: 'ledger', label: 'Ledger', icon: 'menu_book' }, { id: 'tb', label: 'Trial balance', icon: 'balance' }, { id: 'journal', label: 'Day book', icon: 'list_alt' }]} tab={tab} onTab={setTab}
      actions={<>
        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map(([l, f]) => <Button key={l} size="sm" variant="ghost" onClick={() => setRange(f())}>{l}</Button>)}
          <div className="w-40"><Input type="date" value={from} onChange={(e) => setRange([e.target.value || from, to])} aria-label="From" /></div>
          <div className="w-40"><Input type="date" value={to} onChange={(e) => setRange([from, e.target.value || to])} aria-label="To" /></div>
        </div>
        <Button variant="secondary" icon="tune" onClick={() => setOpening(true)}>Opening balances</Button>
        {(tab === 'pl' || tab === 'bs') && <Button variant="secondary" icon="picture_as_pdf" onClick={pdf}>PDF</Button>}
      </>}>
      {!ready ? <Panel><p className="text-body-md text-on-surface-variant">Loading your books…</p></Panel> : <>
        <Stats items={[
          { label: 'Income', value: money(pl.totalIncome), icon: 'trending_up', sub: `${fmtDate(from)} – ${fmtDate(to)}` },
          { label: 'Expenses', value: money(pl.totalExpense), icon: 'trending_down' },
          { label: pl.profit >= 0 ? 'Profit' : 'Loss', value: money(Math.abs(pl.profit)), icon: 'savings', tone: pl.profit < 0 ? 'error' : 'ok' },
          { label: 'Cash + bank', value: money(num(cash['Cash in hand']) + num(cash['Bank / UPI'])), icon: 'account_balance_wallet', sub: `Cash ${money(cash['Cash in hand'] || 0)}` },
        ]} />
        {tab === 'pl' && (
          <div className="grid gap-space-md lg:grid-cols-2">
            <Panel title="Income" icon="trending_up"><Lines rows={pl.income} total={pl.totalIncome} label="Total income" /></Panel>
            <Panel title="Expenses" icon="trending_down"><Lines rows={pl.expense} total={pl.totalExpense} label="Total expenses" /></Panel>
            <div className={cx('rounded-xl p-space-lg text-center font-headline text-headline-md lg:col-span-2', pl.profit >= 0 ? 'bg-ok-container text-on-ok-container' : 'bg-error-container text-on-error-container')}>
              {pl.profit >= 0 ? 'Net profit' : 'Net loss'} {money(Math.abs(pl.profit))}
              <div className="text-body-md">Margin {pl.totalIncome ? Math.round((pl.profit / pl.totalIncome) * 100) : 0}% · Purchases are expensed when received; stock on hand is not deducted.</div>
            </div>
          </div>
        )}
        {tab === 'bs' && (
          <div className="grid gap-space-md lg:grid-cols-2">
            <Panel title={`Liabilities & capital · ${fmtDate(to)}`} icon="account_balance"><Lines rows={[...bs.liabilities, ...bs.equity]} total={bs.totalLiabilities} label="Total" /></Panel>
            <Panel title="Assets" icon="savings"><Lines rows={bs.assets} total={bs.totalAssets} label="Total" /></Panel>
            {Math.abs(bs.totalAssets - bs.totalLiabilities) > 0.5 && <p className="text-error lg:col-span-2">The two sides differ by {money(bs.totalAssets - bs.totalLiabilities)}.</p>}
          </div>
        )}
        {(tab === 'cash' || tab === 'ledger') && (() => {
          const a = tab === 'cash' ? book : acc;
          const rows = ledgerRows(a);
          return (
            <DataTable rows={rows} dense rowKey="id"
              toolbar={<>
                {tab === 'cash'
                  ? <div className="flex gap-1">{['Cash in hand', 'Bank / UPI'].map((x) => <Button key={x} size="sm" variant={book === x ? 'primary' : 'ghost'} onClick={() => setBook(x)}>{x}</Button>)}</div>
                  : <div className="w-64"><Select value={acc} onChange={(e) => setAcc(e.target.value)} aria-label="Account">{accounts.map((x) => <option key={x}>{x}</option>)}</Select></div>}
                <Button size="sm" variant="ghost" icon="file_download" onClick={() => downloadCsv(`${a.replace(/\W+/g, '-')}-${from}-${to}.csv`, ['Date', 'Ref', 'Particulars', 'Debit', 'Credit', 'Balance'], rows.map((r) => [r.date, r.ref || '', r.narration, r.dr || '', r.cr || '', r.bal]))}>CSV</Button>
              </>}
              columns={[
                { key: 'd', label: 'Date', render: (r) => fmtDate(r.date) },
                { key: 'r', label: 'Ref', render: (r) => r.ref || '' },
                { key: 'n', label: 'Particulars', render: (r) => <span className={r.id === 'open' ? 'italic text-on-surface-variant' : ''}>{r.narration}</span> },
                { key: 'dr', label: typeOf(a) === 'asset' && tab === 'cash' ? 'In' : 'Debit', right: true, render: (r) => (r.dr ? money(r.dr) : '') },
                { key: 'cr', label: typeOf(a) === 'asset' && tab === 'cash' ? 'Out' : 'Credit', right: true, render: (r) => (r.cr ? money(r.cr) : '') },
                { key: 'b', label: 'Balance', right: true, render: (r) => <b>{money(Math.abs(r.bal))} {r.bal < 0 ? 'Cr' : 'Dr'}</b> },
              ]} />
          );
        })()}
        {tab === 'tb' && (
          <DataTable rows={tb.map(([a, v]) => ({ id: a, a, v }))} dense
            toolbar={<span className="text-label-md text-on-surface-variant">As on {fmtDate(to)} · Debits {money(tb.filter(([, v]) => v > 0).reduce((s, [, v]) => s + v, 0))} = Credits {money(-tb.filter(([, v]) => v < 0).reduce((s, [, v]) => s + v, 0))}</span>}
            columns={[
              { key: 'a', label: 'Account', render: (r) => r.a.replace(/^Expense: /, 'Expense · ') },
              { key: 't', label: 'Type', render: (r) => typeOf(r.a) },
              { key: 'dr', label: 'Debit', right: true, render: (r) => (r.v > 0 ? money(r.v) : '') },
              { key: 'cr', label: 'Credit', right: true, render: (r) => (r.v < 0 ? money(-r.v) : '') },
            ]} />
        )}
        {tab === 'journal' && (
          <DataTable rows={J.filter((e) => e.date >= from && e.date <= to).map((e, i) => ({ ...e, id: i })).reverse()} dense search={(e) => `${e.ref} ${e.narration} ${e.kind}`}
            toolbar={<Button size="sm" variant="ghost" icon="file_download" onClick={() => downloadCsv(`day-book-${from}-${to}.csv`, ['Date', 'Voucher', 'Ref', 'Narration', 'Account', 'Debit', 'Credit'], J.filter((e) => e.date >= from && e.date <= to).flatMap((e) => e.lines.map((l) => [e.date, e.kind, e.ref, e.narration, l.account, l.dr || '', l.cr || ''])))}>CSV</Button>}
            columns={[
              { key: 'd', label: 'Date', render: (e) => fmtDate(e.date) },
              { key: 'k', label: 'Voucher', render: (e) => <><b>{e.kind}</b><div className="text-label-sm text-on-surface-variant">{e.ref}</div></> },
              { key: 'n', label: 'Entry', render: (e) => <><div>{e.narration}</div><div className="text-label-sm text-on-surface-variant">{e.lines.map((l) => `${l.dr ? 'Dr' : 'Cr'} ${l.account.replace(/^Expense: /, '')} ${money(l.dr || l.cr)}`).join(' · ')}</div></> },
              { key: 'a', label: 'Amount', right: true, render: (e) => money(e.lines.reduce((s, l) => s + l.dr, 0)) },
            ]} />
        )}
      </>}
      {opening && <OpeningModal onClose={() => setOpening(false)} />}
    </ModulePage>
  );
}

function addDay(d, n) { const x = new Date(`${d}T00:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
function zip(a, b) { return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]]); }
