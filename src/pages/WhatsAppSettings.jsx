// Settings → WhatsApp: how messages are sent, which go out automatically,
// the wording of each message, and the log of recent messages.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { saveSettings } from '../lib/db';
import { WA_KINDS, billVars, fillWa, recentWhatsApp, waSettings } from '../lib/whatsapp';
import { fmtDateTime } from '../lib/format';
import { Icon } from '../components/icons';
import { Button, Card, Field, Input, Loading, Table, Td, Textarea, Toggle, cx, useToast, errMsg } from '../components/ui';

const SAMPLE = { guestName: 'Asha Rao', invoiceNumber: 'INV-1024', roomNumber: '204', roomType: 'Deluxe', checkIn: '2026-11-02', checkOut: '2026-11-04', nights: 2, grandTotal: 6300, paidAmount: 2000, balanceAmount: 4300 };

export default function WhatsAppSettings() {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const w = waSettings(settings);
  const [tpl, setTpl] = useState(() => Object.fromEntries(WA_KINDS.map((k) => [k.id, w.templates[k.id] || k.text])));
  const [api, setApi] = useState({ phoneNumberId: '', businessId: '', ...w.api });
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { recentWhatsApp(40).then(setLog).catch(() => setLog([])); }, []);
  const save = async (patch, msg = 'Saved') => {
    try { await saveSettings(user, { whatsapp: { mode: w.mode, auto: w.auto, templates: w.templates, api: w.api, ...patch } }, 'WHATSAPP_SETTINGS_UPDATED'); toast(msg); } catch (e) { toast(errMsg(e), 'error'); }
  };
  async function saveTemplates() {
    setBusy(true);
    const changed = Object.fromEntries(Object.entries(tpl).filter(([k, v]) => v.trim() && v !== WA_KINDS.find((x) => x.id === k).text));
    await save({ templates: changed }, 'Messages saved');
    setBusy(false);
  }
  const vars = (kind) => ({ ...billVars(SAMPLE, settings, { feedback: 'https://…/feedback/…' }), ...(kind === 'reservation' ? { invoice: 'BK-0031', roomType: 'Deluxe' } : {}) });
  return (
    <div className="space-y-space-md">
      <Card className="p-4 sm:p-6">
        <h3 className="font-headline text-headline-sm text-on-surface">How messages are sent</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Sending mode">
          {[
            ['link', 'Open WhatsApp (free)', 'chat', 'StayBill opens WhatsApp on this computer or phone with the message typed in. Staff press Send. Works right away with your hotel’s WhatsApp number.'],
            ['api', 'WhatsApp Business API (automatic)', 'bolt', 'Messages go out by themselves when a bill is created, paid, a booking is confirmed or a guest checks out. Needs a Meta Business account, approved message templates and the sendWhatsApp function.'],
          ].map(([id, label, icon, desc]) => (
            <button key={id} type="button" role="radio" aria-checked={w.mode === id} onClick={() => save({ mode: id }, id === 'api' ? 'Automatic sending on' : 'Free mode on')}
              className={cx('rounded-xl p-4 text-left ring-2 transition-colors', w.mode === id ? 'bg-surface-container-low ring-primary' : 'ring-outline-variant/40 hover:bg-surface-container-low')}>
              <div className="flex items-center gap-2 font-semibold text-on-surface"><Icon name={icon} size={18} />{label}{w.mode === id && <span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-label-sm text-on-primary">In use</span>}</div>
              <p className="mt-1 text-body-sm text-on-surface-variant">{desc}</p>
            </button>
          ))}
        </div>
        {w.mode === 'api' && (
          <div className="mt-4 space-y-3 rounded-xl bg-surface-container-low p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone number ID" hint="Meta Business → WhatsApp → API setup"><Input className="!bg-surface-container-lowest ring-1 ring-outline-variant/50" value={api.phoneNumberId} onChange={(e) => setApi({ ...api, phoneNumberId: e.target.value.trim() })} placeholder="1234567890" /></Field>
              <Field label="WhatsApp Business account ID"><Input className="!bg-surface-container-lowest ring-1 ring-outline-variant/50" value={api.businessId} onChange={(e) => setApi({ ...api, businessId: e.target.value.trim() })} /></Field>
            </div>
            <p className="text-label-md text-on-surface-variant">The access token is stored safely on the server, never here: <code>firebase functions:secrets:set WHATSAPP_TOKEN</code>. WhatsApp only lets businesses start a chat with an approved template: create one per message below in Meta (category Utility, one body variable), and enter its name.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {WA_KINDS.map((k) => (
                <Field key={k.id} label={`Template for “${k.label}”`}><Input className="!bg-surface-container-lowest ring-1 ring-outline-variant/50" value={api.templates?.[k.id]?.name || ''} placeholder={`e.g. staybill_${k.id}`} onChange={(e) => setApi({ ...api, templates: { ...(api.templates || {}), [k.id]: { name: e.target.value.trim(), lang: 'en' } } })} /></Field>
              ))}
            </div>
            <Button size="sm" onClick={() => save({ api }, 'WhatsApp Business details saved')}>Save Business details</Button>
            <div className="divide-y divide-surface-container">
              {WA_KINDS.filter((k) => k.auto).map((k) => <Toggle key={k.id} label={`Send automatically: ${k.label}`} description={k.when} checked={!!w.auto[k.id]} onChange={(v) => save({ auto: { ...w.auto, [k.id]: v } })} />)}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-headline text-headline-sm text-on-surface">Messages</h3>
          <Button size="sm" loading={busy} onClick={saveTemplates}>Save messages</Button>
        </div>
        <p className="mt-1 text-label-md text-on-surface-variant">Fields: {'{first} {name} {hotel} {phone} {invoice} {room} {roomType} {checkin} {checkout} {nights} {total} {paid} {due} {feedback}'}</p>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {WA_KINDS.map((k) => (
            <div key={k.id} className="rounded-xl ring-1 ring-outline-variant/40">
              <div className="flex items-center justify-between gap-2 px-3 pt-3"><b className="text-on-surface">{k.label}</b><span className="text-label-sm text-on-surface-variant">{k.when}</span></div>
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                <Textarea rows={6} value={tpl[k.id]} onChange={(e) => setTpl({ ...tpl, [k.id]: e.target.value })} aria-label={`${k.label} message`} />
                <div className="whitespace-pre-line rounded-lg bg-[#dcf8c6] p-3 text-body-sm text-[#111b21] shadow-inner" aria-label="Preview">{fillWa(tpl[k.id], vars(k.id))}</div>
              </div>
              {tpl[k.id] !== k.text && <button type="button" className="px-3 pb-3 text-label-md text-secondary hover:underline" onClick={() => setTpl({ ...tpl, [k.id]: k.text })}>Use the original wording</button>}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="px-4 pb-2 pt-4 font-headline text-headline-sm text-on-surface">Recent WhatsApp messages</h3>
        {!log ? <Loading /> : log.length === 0 ? <p className="px-4 pb-4 text-body-md text-on-surface-variant">None yet. Send one from a bill or a booking.</p> : (
          <Table head={['When', 'Guest', 'Message', 'To', 'Status']}>
            {log.map((m) => (
              <tr key={m.id} className="h-12">
                <Td className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</Td>
                <Td>{m.billId ? <Link to={`/bills/${m.billId}`} className="text-secondary hover:underline">{m.guestName || 'Open bill'}</Link> : m.guestName || '—'}</Td>
                <Td>{WA_KINDS.find((k) => k.id === m.kind)?.label || m.kind}{m.manual ? '' : ' (automatic)'}</Td>
                <Td>+{m.to}</Td>
                <Td>{{ opened: 'Opened in WhatsApp', queued: 'Sending…', sent: 'Sent', error: `Failed${m.error ? `: ${m.error}` : ''}`, skipped: `Skipped${m.reason ? `: ${m.reason}` : ''}` }[m.status] || m.status}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
