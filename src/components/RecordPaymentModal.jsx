// "Record Folio Settlement" modal from the Stitch design, wired to Firestore.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { recordPayment } from '../lib/db';
import { money, currencySymbol } from '../lib/format';
import { Icon } from './icons';
import { Button, ChoiceGrid, Field, Input, Modal, Select, useToast, errMsg } from './ui';
import { PaymentMeter, celebrate } from '../motion/hotel';

export const METHOD_OPTIONS = [
  { value: 'Cash', label: 'Cash', icon: 'payments' },
  { value: 'UPI', label: 'UPI', icon: 'qr_code_2' },
  { value: 'Card', label: 'Card', icon: 'credit_card' },
  { value: 'Bank Transfer', label: 'Bank', icon: 'account_balance' },
  { value: 'Other', label: 'Other', icon: 'more_horiz' },
];
export const methodIcon = (m) => (m === 'Split' ? 'call_split' : METHOD_OPTIONS.find((o) => o.value === m)?.icon || 'payments');

/**
 * Record an additional payment against a bill (PRD §29–31, §41).
 * Pass `bill`, or pass `choices` (outstanding bills) to let the user pick one.
 */
export default function RecordPaymentModal({ bill: givenBill, choices, open, onClose, onDone, noCelebrate }) {
  const { user } = useAuth();
  const toast = useToast();
  const [pickedId, setPickedId] = useState('');
  const [p, setP] = useState({ amount: '', method: 'Cash', referenceNumber: '', notes: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const bill = useMemo(() => givenBill || (choices || []).find((b) => b.id === pickedId) || null, [givenBill, choices, pickedId]);

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (!givenBill) setPickedId('');
  }, [open, givenBill]);
  useEffect(() => {
    if (open && bill) setP({ amount: String(bill.balanceAmount), method: 'Cash', referenceNumber: '', notes: '' });
  }, [open, bill]);

  if (!open) return null;

  async function submit(e) {
    e?.preventDefault();
    if (!bill) return setErr('Select a bill first.');
    const amt = Number(p.amount);
    if (!(amt > 0)) return setErr('Enter an amount greater than zero.');
    if (amt > bill.balanceAmount + 0.001) return setErr(`Payment cannot exceed the outstanding balance of ${money(bill.balanceAmount)}.`);
    setBusy(true);
    try {
      await recordPayment(user, bill.id, { ...p, amount: amt });
      toast(`${money(amt)} received for ${bill.invoiceNumber}`);
      if (!noCelebrate && amt >= bill.balanceAmount - 0.001) celebrate(`${bill.invoiceNumber} is fully paid`, 'Bill settled');
      onDone?.();
      onClose();
    } catch (e2) {
      setErr(errMsg(e2));
    }
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={onClose} title="Record Payment" icon="account_balance_wallet"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={submit} loading={busy} icon="check_circle" disabled={!bill}>Confirm &amp; Record Payment</Button>
      </>}>
      <form onSubmit={submit} className="flex flex-col gap-space-md pb-space-sm">
        {!givenBill && (
          <Field label="Outstanding bill">
            <Select value={pickedId} onChange={(e) => setPickedId(e.target.value)} icon="receipt_long">
              <option value="">{(choices || []).length ? 'Select a bill to collect…' : 'No outstanding bills'}</option>
              {(choices || []).map((b) => <option key={b.id} value={b.id}>{b.invoiceNumber} · {b.guestName} · Room {b.roomNumber} · {money(b.balanceAmount)} due</option>)}
            </Select>
          </Field>
        )}
        {bill && (
          <>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-low p-space-md">
              <div className="min-w-0">
                <span className="text-label-sm font-bold uppercase tracking-wider text-secondary">{bill.invoiceNumber}</span>
                <div className="truncate text-label-lg font-semibold text-on-surface">{bill.guestName}</div>
                <div className="text-label-sm text-on-surface-variant">Room {bill.roomNumber}{bill.roomType ? ` — ${bill.roomType}` : ''} · Total {money(bill.grandTotal)} · Paid {money(bill.paidAmount)}</div>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-label-sm uppercase text-on-surface-variant">Due Amount</span>
                <div className="font-headline text-headline-sm font-bold tabular-nums text-error">{money(bill.balanceAmount, { decimals: 'always' })}</div>
              </div>
            </div>
            <div>
              <PaymentMeter total={bill.grandTotal} paid={Math.min(bill.grandTotal, bill.paidAmount + Math.max(0, Number(p.amount) || 0))} />
              <div className="mt-1.5 flex justify-between text-label-sm text-on-surface-variant">
                <span>After this payment: {money(Math.min(bill.grandTotal, bill.paidAmount + Math.max(0, Number(p.amount) || 0)))} paid</span>
                <span className="font-semibold text-on-surface">{Math.max(0, bill.balanceAmount - (Number(p.amount) || 0)) <= 0.001 ? 'Fully paid' : `${money(Math.max(0, bill.balanceAmount - (Number(p.amount) || 0)))} left`}</span>
              </div>
            </div>
            <Field label={`Payment amount (${currencySymbol().trim()})`} error={err}>
              <div className="relative flex items-center">
                <span className="absolute left-3 font-financial-tabular text-financial-tabular text-on-surface-variant">{currencySymbol().trim()}</span>
                <Input className="pl-8 font-financial-tabular" type="number" min="0" step="0.01" inputMode="decimal" value={p.amount}
                  onChange={(e) => setP({ ...p, amount: e.target.value })} autoFocus invalid={!!err} />
              </div>
            </Field>
            <div>
              <span className="mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant">Payment mode</span>
              <ChoiceGrid options={METHOD_OPTIONS} value={p.method} onChange={(m) => setP({ ...p, method: m })} />
            </div>
            {p.method !== 'Cash' && (
              <Field label="Transaction reference (optional)">
                <Input value={p.referenceNumber} onChange={(e) => setP({ ...p, referenceNumber: e.target.value })} placeholder="e.g. UPI ref 89218204 or card slip #12" />
              </Field>
            )}
            <Field label="Desk note (optional)">
              <Input value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} placeholder="e.g. Balance settled at checkout" />
            </Field>
          </>
        )}
        {!bill && err && <p className="flex items-center gap-1 text-label-md text-error"><Icon name="error" size={14} />{err}</p>}
      </form>
    </Modal>
  );
}
