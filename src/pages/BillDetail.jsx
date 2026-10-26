import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { feedbackUrl } from '../modules/guests/publicLinks';
import { billVars, sendWhatsApp, validWaNumber, waForBill, waKind, waSettings } from '../lib/whatsapp';
import { useData } from '../context/DataContext';
import { getBill, paymentsForBill, listAudit, cancelBill, mailForBill, queueGuestEmail } from '../lib/db';
import MailStatus from '../components/MailStatus';
import { checkOutBill } from '../modules/billOps';
import { MinibarModal } from '../modules/stock/Inventory';
import { downloadInvoicePdf, invoicePdfFile } from '../lib/pdf';
import { CAN_PRINT } from '../platform';
import { money, fmtDay, fmtDateTime } from '../lib/format';
import InvoiceView from '../components/InvoiceView';
import RecordPaymentModal, { methodIcon } from '../components/RecordPaymentModal';
import { Icon } from '../components/icons';
import { Button, Field, Loading, Modal, PageHeader, StatusBadge, Textarea, Select, useToast, errMsg, cx } from '../components/ui';
import { Cloche, DoorHanger, PaidStamp, PaymentMeter, PrinterFeed, celebrate } from '../motion/hotel';

const AUDIT_LABEL = {
  BILL_CREATED: 'Bill created', BILL_EDITED: 'Bill edited', BILL_CANCELLED: 'Bill cancelled', PAYMENT_RECORDED: 'Payment recorded',
};
const AUDIT_ICON = { BILL_EDITED: 'edit', BILL_CANCELLED: 'block', PAYMENT_RECORDED: 'payments' };
const CANCEL_REASONS = ['Duplicate invoice', 'Guest did not stay', 'Wrong details entered', 'Other'];

function Panel({ title, icon, children, className }) {
  return (
    <div className={cx('rounded-xl bg-surface-container-lowest shadow-sm', className)}>
      <div className="flex items-center gap-space-xs px-space-md pt-space-md">
        {icon && <Icon name={icon} size={18} className="text-secondary" />}
        <h2 className="font-headline text-headline-sm text-on-surface">{title}</h2>
      </div>
      <div className="p-space-md">{children}</div>
    </div>
  );
}

export default function BillDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const { user, hotelId } = useAuth();
  const { settings, can, rooms, mods } = useData();
  const [minibar, setMinibar] = useState(false);
  const toast = useToast();
  const nav = useNavigate();
  const [bill, setBill] = useState(null);
  const [payments, setPayments] = useState([]);
  const [audit, setAudit] = useState([]);
  const [mail, setMail] = useState([]);
  const [wa, setWa] = useState([]);
  const [payOpen, setPayOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(params.get('cancel') === '1');
  const [reason, setReason] = useState(CANCEL_REASONS[0]);
  const [reasonText, setReasonText] = useState('');
  const [busy, setBusy] = useState('');
  const printed = useRef(false);
  const lastStatus = useRef(null);
  const [justPaid, setJustPaid] = useState(false);

  const load = useCallback(async () => {
    try {
      const b = await getBill(id);
      if (!b) { toast('Bill not found', 'error'); nav('/bills'); return; }
      if (lastStatus.current && lastStatus.current !== 'PAID' && b.paymentStatus === 'PAID') {
        setJustPaid(true);
        celebrate(`${b.invoiceNumber} is fully paid`, 'Bill settled');
      }
      lastStatus.current = b.paymentStatus;
      setBill(b);
      const [p, a, m] = await Promise.all([paymentsForBill(id), listAudit({ entityId: id }).catch(() => []), mailForBill(id).catch(() => [])]);
      setPayments(p);
      setAudit(a);
      setMail(m);
      waForBill(id).then(setWa).catch(() => setWa([]));
    } catch (e) { toast(errMsg(e), 'error'); }
  }, [id, nav, toast]);

  useEffect(() => { load(); }, [load]);
  // ?print=1 (from the ledger's print button) → open the print dialog once loaded
  useEffect(() => {
    if (bill && params.get('print') === '1' && !printed.current) {
      printed.current = true;
      if (CAN_PRINT) setTimeout(() => { window.print(); setParams({}, { replace: true }); }, 400);
      else { setParams({}, { replace: true }); downloadInvoicePdf(bill, settings, payments).catch((e) => toast(errMsg(e), 'error')); }
    }
  }, [bill, params, setParams, settings, payments, toast]);

  if (!bill) return <Loading />;
  const cancelled = bill.paymentStatus === 'CANCELLED';
  const paid = bill.paymentStatus === 'PAID';
  const created = params.get('created') === '1';
  const dayClosed = settings.closedThrough && bill.billDate <= settings.closedThrough && user.role === 'employee';
  const canEdit = can.editBills && !cancelled && !paid && !dayClosed;

  async function onCheckOut() {
    setBusy('checkout');
    try {
      await checkOutBill(user, bill, { rooms, settings });
      toast(bill.balanceAmount > 0 ? `${bill.guestName} checked out with ${money(bill.balanceAmount)} still due. Room ${bill.roomNumber} sent to housekeeping.` : `${bill.guestName} checked out. Room ${bill.roomNumber} sent to housekeeping.`);
      await load();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy('');
  }
  async function onPdf() {
    setBusy('pdf');
    try { await downloadInvoicePdf(bill, settings, payments); } catch (e) { toast(errMsg(e), 'error'); }
    setBusy('');
  }
  async function onShare() {
    setBusy('share');
    try {
      const file = await invoicePdfFile(bill, settings, payments);
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Invoice ${bill.invoiceNumber}`, text: `Invoice ${bill.invoiceNumber} from ${settings.hotelName} — ${money(bill.grandTotal)}` });
      } else {
        await downloadInvoicePdf(bill, settings, payments);
        toast('Sharing is not supported on this device — the PDF was downloaded instead.');
      }
    } catch (e) { if (e?.name !== 'AbortError') toast(errMsg(e), 'error'); }
    setBusy('');
  }
  async function onCancel() {
    const r = reason === 'Other' ? reasonText.trim() : reason;
    if (!r) return toast('Enter a reason for cancelling.', 'error');
    setBusy('cancel');
    try {
      await cancelBill(user, id, r);
      toast(`${bill.invoiceNumber} cancelled`);
      setCancelOpen(false);
      await load();
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy('');
  }
  // WhatsApp: opens WhatsApp straight from the click (browsers block it after a delay).
  function whatsapp(kind, extra = {}) {
    try {
      const p = sendWhatsApp(user, settings, { phone: bill.guest?.phone, kind, vars: billVars(bill, settings, extra), billId: bill.id, guestName: bill.guestName });
      if (waSettings(settings).mode === 'api') toast('WhatsApp message queued');
      Promise.resolve(p).then(() => waForBill(id)).then(setWa).catch(() => {});
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  async function resend(kind) {
    setBusy(`mail-${kind}`);
    try { await queueGuestEmail(user, bill, kind, { manual: true }); toast(`Email to ${bill.guest.email} queued`); setMail(await mailForBill(id)); } catch (e) { toast(errMsg(e), 'error'); }
    setBusy('');
  }
  const closeCancel = () => { setCancelOpen(false); if (params.get('cancel')) setParams({}, { replace: true }); };

  const rows = [
    ['Subtotal', money(bill.subtotal, { decimals: 'always' })],
    ['Discount', bill.discountAmount ? `-${money(bill.discountAmount, { decimals: 'always' })}` : '—'],
    ['Tax', money(bill.taxAmount, { decimals: 'always' })],
  ];

  return (
    <div>
      <div className="no-print">
        <PageHeader
          back={<Link to="/bills" className="mb-1 inline-flex items-center gap-1 text-label-md text-on-surface-variant hover:text-on-surface"><Icon name="arrow_back" size={14} />Bills &amp; Payments</Link>}
          crumbs={['Billing', 'Invoice']}
          title={<span className="flex flex-wrap items-center gap-space-sm">{bill.invoiceNumber} <StatusBadge status={bill.paymentStatus} long /></span>}
          subtitle={`${bill.guestName} · Room ${bill.roomNumber} · ${fmtDay(bill.checkIn)} → ${fmtDay(bill.checkOut)}${bill.checkedOutAt ? ' · checked out' : ''}${bill.loyaltyEarned ? ` · ${bill.loyaltyEarned} loyalty points earned` : ''}`}
          actions={<>
            {CAN_PRINT && <Button variant="secondary" icon="print" onClick={() => window.print()}>Print</Button>}
            <Button variant="secondary" icon="picture_as_pdf" onClick={onPdf} loading={busy === 'pdf'}>Download PDF</Button>
            <Button variant="secondary" icon="share" onClick={onShare} loading={busy === 'share'}>Share</Button>
            {!cancelled && !bill.checkedOutAt && !paid && mods?.inventory && <Button variant="secondary" icon="local_bar" onClick={() => setMinibar(true)}>Minibar</Button>}
            {!cancelled && !bill.checkedOutAt && <Button variant="secondary" icon="logout" loading={busy === 'checkout'} onClick={onCheckOut}>Check out</Button>}
            {bill.checkedOutAt && bill.feedbackToken && mods?.feedback && <Button variant="secondary" icon="reviews" onClick={() => { const u = feedbackUrl(hotelId, bill); if (validWaNumber(bill.guest?.phone)) whatsapp('thankyou', { feedback: u }); else navigator.clipboard?.writeText(u).then(() => toast('Feedback link copied')).catch(() => toast(u)); }}>{validWaNumber(bill.guest?.phone) ? 'Ask for feedback' : 'Copy feedback link'}</Button>}
            {!cancelled && bill.balanceAmount > 0 && <Button icon="add_card" onClick={() => setPayOpen(true)}>Record Payment</Button>}
          </>} />

        {created && (
          <div className="mb-space-md flex items-center gap-2 rounded-xl bg-surface-container-high px-space-md py-3 text-body-md text-on-secondary-container">
            <Icon name="check_circle" size={18} fill />Invoice {bill.invoiceNumber} saved. Print it or download the PDF for the guest.
          </div>
        )}
      </div>

      <div className="grid items-start gap-space-lg lg:grid-cols-[320px_1fr]">
        <div className="no-print space-y-space-md">
          {/* Balance card */}
          <div className="rounded-xl bg-surface-container-lowest p-space-md shadow-sm">
            <div className="flex items-start justify-between">
              <div className="pt-2">
                <span className="text-label-sm uppercase tracking-wider text-on-surface-variant">Grand Total</span>
                <div className={cx('font-headline text-headline-md font-bold tabular-nums', cancelled ? 'text-outline line-through' : 'text-on-surface')}><Cloche>{money(bill.grandTotal, { decimals: 'always' })}</Cloche></div>
              </div>
              <div className="-mr-1 -mt-2"><DoorHanger status={bill.paymentStatus} /></div>
            </div>
            <dl className="mt-space-sm space-y-1 text-body-md">
              {rows.map(([k, v]) => <div key={k} className="flex justify-between"><dt className="text-on-surface-variant">{k}</dt><dd className="font-financial-tabular tabular-nums">{v}</dd></div>)}
            </dl>
            {!cancelled && (
              <>
                <PaymentMeter className="mt-space-md" total={bill.grandTotal} paid={bill.paidAmount} />
                <div className="mt-space-sm grid grid-cols-2 gap-space-sm">
                  <div className="rounded-lg bg-surface-container-low p-space-sm">
                    <div className="text-label-sm text-on-surface-variant">Paid</div>
                    <div className="font-financial-tabular text-financial-tabular text-secondary">{money(bill.paidAmount, { decimals: 'always' })}</div>
                  </div>
                  <div className="rounded-lg bg-surface-container-low p-space-sm">
                    <div className="text-label-sm text-on-surface-variant">Balance Due</div>
                    <div className={cx('font-financial-tabular text-financial-tabular', bill.balanceAmount > 0 ? 'font-bold text-error' : 'text-secondary')}>{money(bill.balanceAmount, { decimals: 'always' })}</div>
                  </div>
                </div>
              </>
            )}
            {cancelled && (
              <div className="mt-space-md rounded-lg bg-surface-container-low p-space-sm text-label-md text-on-surface-variant">
                <div className="flex items-center gap-1 font-semibold text-on-surface"><Icon name="policy" size={14} />Cancelled</div>
                By {bill.cancelledBy?.name} · {fmtDateTime(bill.cancelledAt)}<br />Reason: {bill.cancelReason}
              </div>
            )}
            {bill.notes && <div className="mt-space-sm rounded-lg bg-surface-container-low p-space-sm text-label-md text-on-surface-variant">Note: {bill.notes}</div>}
            {!cancelled && (
              <div className="mt-space-md flex gap-space-sm">
                {can.editBills && (
                  canEdit ? <Button size="sm" variant="secondary" icon="edit" className="flex-1" onClick={() => nav(`/bills/${id}/edit`)}>Edit</Button>
                    : <Button size="sm" variant="secondary" icon="edit_off" className="flex-1" disabled title="Settled bills are locked">Locked</Button>
                )}
                {can.cancelBills && <Button size="sm" variant="danger-ghost" icon="block" className="flex-1" onClick={() => setCancelOpen(true)}>Cancel bill</Button>}
              </div>
            )}
          </div>

          {/* Guest */}
          <Panel title="Guest" icon="hotel">
            <Link to={`/guests/${bill.guestId}`} className="text-label-lg font-semibold text-on-surface hover:text-secondary">{bill.guestName}</Link>
            <div className="mt-0.5 space-y-0.5 text-label-md text-on-surface-variant">
              {bill.guestPhone && <div>{bill.guestPhone}</div>}
              {bill.guest?.email && <div>{bill.guest.email}</div>}
              {bill.guest?.gstin && <div>GSTIN {bill.guest.gstin}</div>}
            </div>
            <Link to={`/guests/${bill.guestId}`} className="mt-space-sm inline-flex items-center gap-1 text-label-md font-medium text-secondary hover:underline">Billing history<Icon name="chevron_right" size={14} /></Link>
          </Panel>

          {/* Payments */}
          <Panel title="Payment History" icon="history">
            {payments.length === 0 ? <p className="text-body-md text-on-surface-variant">No payments recorded.</p> : (
              <ul className="space-y-space-sm">
                {payments.map((p, i) => (
                  <li key={p.id} className="flex items-start gap-space-sm">
                    <div className="mt-0.5 rounded-lg bg-surface-container-low p-1.5 text-secondary"><Icon name={methodIcon(p.method)} size={14} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2">
                        <span className="text-label-lg font-semibold text-on-surface">Payment {i + 1} · {p.method}</span>
                        <span className="font-financial-tabular text-financial-tabular">{money(p.amount)}</span>
                      </div>
                      <div className="text-label-sm text-on-surface-variant">{fmtDateTime(p.createdAt)} · {p.receivedBy?.name}{p.referenceNumber ? ` · Ref ${p.referenceNumber}` : ''}</div>
                      {p.notes && <div className="text-label-sm text-on-surface-variant">{p.notes}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Guest emails */}
          <Panel title="Guest Emails" icon="mail">
            {!bill.guest?.email ? (
              <p className="text-body-md text-on-surface-variant">No email address on this bill. Add one to the guest to send confirmations and receipts.</p>
            ) : (
              <>
                <p className="text-label-md text-on-surface-variant">To <b className="text-on-surface">{bill.guest.email}</b>{settings.emailGuests === false ? ' · automatic emails are off for this hotel' : ''}</p>
                {mail.length > 0 && (
                  <ul className="mt-space-sm space-y-1.5">
                    {mail.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 text-label-md">
                        <span className="min-w-0 truncate text-on-surface">{m.kind === 'paid' ? 'Paid in full + PDF' : 'Booking confirmation'}<span className="text-on-surface-variant"> · {fmtDateTime(m.createdAt)}</span></span>
                        <MailStatus m={m} />
                      </li>
                    ))}
                  </ul>
                )}
                {!cancelled && (
                  <div className="mt-space-sm flex flex-wrap gap-space-sm">
                    <Button size="sm" variant="secondary" icon="send" loading={busy === 'mail-booking'} onClick={() => resend('booking')}>{mail.some((m) => m.kind === 'booking') ? 'Resend' : 'Send'} confirmation</Button>
                    {paid && <Button size="sm" variant="secondary" icon="send" loading={busy === 'mail-paid'} onClick={() => resend('paid')}>{mail.some((m) => m.kind === 'paid') ? 'Resend' : 'Send'} paid receipt</Button>}
                  </div>
                )}
              </>
            )}
          </Panel>

          {/* WhatsApp */}
          <Panel title="WhatsApp" icon="chat">
            {!validWaNumber(bill.guest?.phone) ? (
              <p className="text-body-md text-on-surface-variant">No mobile number on this bill. Add the guest’s number to send WhatsApp messages.</p>
            ) : (
              <>
                <p className="text-label-md text-on-surface-variant">To <b className="text-on-surface">{bill.guest.phone}</b> · {waSettings(settings).mode === 'api' ? 'sent automatically through WhatsApp Business' : 'opens WhatsApp with the message ready; press send'}</p>
                {!cancelled && (
                  <div className="mt-space-sm flex flex-wrap gap-space-sm">
                    <Button size="sm" variant="secondary" icon="chat" onClick={() => whatsapp('booking')}>Bill details</Button>
                    {bill.balanceAmount > 0 && <Button size="sm" variant="secondary" icon="notifications_active" onClick={() => whatsapp('reminder')}>Payment reminder</Button>}
                    {paid && <Button size="sm" variant="secondary" icon="task_alt" onClick={() => whatsapp('paid')}>Payment receipt</Button>}
                  </div>
                )}
                {wa.length > 0 && (
                  <ul className="mt-space-sm space-y-1.5">
                    {wa.slice(0, 6).map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2 text-label-md">
                        <span className="min-w-0 truncate text-on-surface">{waKind(m.kind)?.label || m.kind}<span className="text-on-surface-variant"> · {fmtDateTime(m.createdAt)}</span></span>
                        <span className={cx('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-label-sm font-semibold', m.status === 'sent' || m.status === 'delivered' || m.status === 'read' ? 'bg-ok-container text-on-ok-container' : m.status === 'error' ? 'bg-error-container text-on-error-container' : 'bg-surface-container-high text-on-surface-variant')}>{{ opened: 'Opened', queued: 'Sending…', sent: 'Sent', error: 'Failed', skipped: 'Skipped' }[m.status] || m.status}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Panel>

          {/* Audit */}
          <Panel title="Audit Trail" icon="verified_user">
            <ol className="relative space-y-space-sm border-l border-surface-container pl-space-md">
              <li className="relative text-label-md text-on-surface-variant">
                <span className="absolute -left-[17px] top-1 h-2.5 w-2.5 rounded-full bg-secondary" />
                <b className="text-on-surface">Created</b> by {bill.createdBy?.name}<br />{fmtDateTime(bill.createdAt)}
              </li>
              {audit.filter((a) => a.entityId === id && a.action !== 'BILL_CREATED').map((a) => (
                <li key={a.id} className="relative text-label-md text-on-surface-variant">
                  <span className={cx('absolute -left-[17px] top-1 h-2.5 w-2.5 rounded-full', a.action === 'BILL_CANCELLED' ? 'bg-error' : 'bg-outline-variant')} />
                  <b className="text-on-surface">{AUDIT_LABEL[a.action] || a.action}</b> by {a.user?.name}
                  {a.details?.amount ? ` · ${money(a.details.amount)} ${a.details.method || ''}` : ''}
                  {a.details?.newTotal !== undefined ? ` · ${money(a.details.previousTotal)} → ${money(a.details.newTotal)}` : ''}
                  {a.details?.reason ? ` · ${a.details.reason}` : ''}
                  <br />{fmtDateTime(a.createdAt)}
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="print-area overflow-x-auto">
          <PrinterFeed play={created}>
            <div className="relative min-w-[640px] rounded-xl shadow-sm">
              <InvoiceView bill={bill} settings={settings} payments={payments} />
              {paid && <PaidStamp key={justPaid ? 'pressed' : 'still'} press={justPaid || created} delay={created && !justPaid ? 2.5 : 0.2} date={bill.invoiceNumber} />}
            </div>
          </PrinterFeed>
        </div>
      </div>

      {minibar && <MinibarModal bill={bill} onClose={() => { setMinibar(false); load(); }} />}
      <RecordPaymentModal bill={bill} open={payOpen} onClose={() => setPayOpen(false)} onDone={load} noCelebrate />

      <Modal open={cancelOpen && !cancelled} onClose={closeCancel} title={`Cancel ${bill.invoiceNumber}`} icon="block"
        footer={<><Button variant="secondary" onClick={closeCancel}>Keep bill</Button><Button variant="danger" icon="block" onClick={onCancel} loading={busy === 'cancel'}>Cancel Bill</Button></>}>
        <div className="space-y-space-md pb-space-sm text-body-md">
          <div className="rounded-xl bg-surface-container-low p-space-md">
            <span className="text-label-sm font-bold uppercase tracking-wider text-secondary">{bill.invoiceNumber}</span>
            <div className="text-label-lg font-semibold">{bill.guestName} · Room {bill.roomNumber}</div>
            <div className="text-label-sm text-on-surface-variant">Total {money(bill.grandTotal)}</div>
          </div>
          <p className="text-on-surface-variant">The invoice will be marked <b className="text-on-surface">CANCELLED</b>. It is never deleted, and its invoice number stays reserved.</p>
          {bill.paidAmount > 0 && <p className="rounded-lg bg-error-container px-3 py-2 text-on-error-container">{money(bill.paidAmount)} has been paid on this bill. Payment records are kept; refunds are handled outside StayBill.</p>}
          <Field label="Reason"><Select value={reason} onChange={(e) => setReason(e.target.value)}>{CANCEL_REASONS.map((r) => <option key={r}>{r}</option>)}</Select></Field>
          {reason === 'Other' && <Field label="Describe the reason"><Textarea rows={2} value={reasonText} onChange={(e) => setReasonText(e.target.value)} /></Field>}
        </div>
      </Modal>
    </div>
  );
}
