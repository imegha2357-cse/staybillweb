// Campaigns: write a message once, pick a guest segment and a channel.
// Email goes through the mail queue (sent by the Cloud Function); WhatsApp and
// SMS open a ready-filled message per guest, with a CSV for bulk tools.
// Automatic messages (pre-arrival, post-stay, birthdays…) are switched on here.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveSettings } from '../../lib/db';
import { downloadCsv } from '../../lib/csv';
import { isLocalBackend } from '../../backend/auth';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Modal, Select, Textarea, Toggle, cx, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Panel, Stats, fmtDate, saveRecord, today, useLive } from '../kit';
import { AUTOMATIONS, SEGMENTS, audience, fill, queueCampaignEmail, smsLink, waLink } from './messaging';

const CHANNELS = [
  { id: 'email', label: 'Email', icon: 'mail' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'chat' },
  { id: 'sms', label: 'SMS', icon: 'sms' },
];
const TEMPLATES = [
  { name: 'Festive offer', subject: 'A festive treat from {hotel}', body: 'Hello {first},\n\nCelebrate the season with us! Book a stay this month and enjoy 15% off plus complimentary breakfast. Call {phone} or reply to this message.\n\n{hotel}' },
  { name: 'Weekend getaway', subject: 'Your weekend escape is ready', body: 'Hi {first}, plan a relaxing weekend at {hotel} — late check-out on us when you book direct. Call {phone}.' },
  { name: 'Points reminder', subject: 'You have {points} points with us', body: 'Hello {first}, you have {points} loyalty points at {hotel}. Use them on your next stay!' },
];

function Compose({ guests, initial, onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [v, setV] = useState({ name: '', channel: 'email', segment: 'all', subject: '', body: '', ...(initial || {}) });
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(null); // whatsapp / sms list
  const list = useMemo(() => audience(guests, v.segment, v.channel), [guests, v.segment, v.channel]);
  const sample = list[0] || { name: 'Asha Rao', points: 120 };
  async function save(send) {
    if (!v.name.trim() || !v.body.trim() || (v.channel === 'email' && !v.subject.trim())) return toast('Give the campaign a name, a message' + (v.channel === 'email' ? ' and a subject.' : '.'), 'error');
    if (send && !list.length) return toast('Nobody in this segment can be reached on this channel.', 'error');
    setBusy(true);
    try {
      const body = { name: v.name.trim(), channel: v.channel, segment: v.segment, subject: v.subject.trim(), body: v.body, status: v.status || 'Draft' };
      const id = await saveRecord(user, 'campaigns', initial?.id, body, initial?.id ? 'CAMPAIGN_UPDATED' : 'CAMPAIGN_CREATED');
      if (send && v.channel === 'email') {
        for (const g of list) await queueCampaignEmail(user, { ...body, id }, g, settings); // eslint-disable-line no-await-in-loop
        await saveRecord(user, 'campaigns', id, { status: 'Sent', sentCount: list.length, sentAt: today() }, 'CAMPAIGN_SENT');
        toast(isLocalBackend ? `${list.length} emails queued (demo mode does not send)` : `${list.length} emails queued for sending`);
        onClose();
      } else if (send) {
        setSending({ id, body });
      } else { toast('Draft saved'); onClose(); }
    } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  async function markSent() {
    try { await saveRecord(user, 'campaigns', sending.id, { status: 'Sent', sentCount: list.length, sentAt: today() }, 'CAMPAIGN_SENT'); toast('Campaign marked as sent'); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  if (sending) {
    return (
      <Modal open onClose={onClose} wide title={`Send on ${v.channel === 'sms' ? 'SMS' : 'WhatsApp'} · ${list.length} guests`} icon={v.channel === 'sms' ? 'sms' : 'chat'}
        footer={<><Button variant="secondary" icon="file_download" onClick={() => downloadCsv(`${v.name}-${v.channel}.csv`, ['Name', 'Phone', 'Message'], list.map((g) => [g.name, g.phone, fill(v.body, g, settings)]))}>CSV for bulk tools</Button><Button onClick={markSent}>Done — mark as sent</Button></>}>
        <p className="mb-2 text-body-md text-on-surface-variant">Each button opens {v.channel === 'sms' ? 'your phone’s messages app' : 'WhatsApp'} with the message filled in. For hundreds of guests, upload the CSV to the WhatsApp Business API or your SMS provider.</p>
        <div className="max-h-[50vh] divide-y divide-surface-container overflow-y-auto rounded-lg ring-1 ring-surface-container">
          {list.map((g) => (
            <div key={g.id} className="flex items-center justify-between gap-2 p-2">
              <div className="min-w-0"><b>{g.name}</b><div className="truncate text-label-md text-on-surface-variant">{g.phone}</div></div>
              <a className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-label-md text-on-primary" href={v.channel === 'sms' ? smsLink(g.phone, fill(v.body, g, settings)) : waLink(g.phone, fill(v.body, g, settings))} target="_blank" rel="noopener noreferrer"><Icon name="send" size={14} />Open</a>
            </div>
          ))}
        </div>
      </Modal>
    );
  }
  return (
    <Modal open onClose={onClose} wide icon="campaign" title={initial?.id ? `Edit ${initial.name}` : 'New campaign'}
      footer={<><span className="mr-auto text-label-lg">{list.length} guest{list.length === 1 ? '' : 's'} will get this</span><Button variant="secondary" onClick={() => save(false)} loading={busy}>Save draft</Button><Button icon="send" onClick={() => save(true)} loading={busy}>Send now</Button></>}>
      <div className="grid gap-3 pb-space-sm sm:grid-cols-2">
        <Field label="Campaign name" required><Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Diwali 2026 offer" autoFocus /></Field>
        <Field label="Send to"><Select value={v.segment} onChange={(e) => setV({ ...v, segment: e.target.value })}>{SEGMENTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        <div className="flex gap-1.5 sm:col-span-2">
          {CHANNELS.map((c) => <button type="button" key={c.id} onClick={() => setV({ ...v, channel: c.id })} className={cx('flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label-lg ring-1', v.channel === c.id ? 'bg-primary text-on-primary ring-transparent' : 'text-on-surface-variant ring-outline-variant')}><Icon name={c.icon} size={16} />{c.label}</button>)}
          <Select className="ml-auto w-44" value="" onChange={(e) => { const t = TEMPLATES[Number(e.target.value)]; if (t) setV({ ...v, subject: t.subject, body: t.body, name: v.name || t.name }); }} aria-label="Use a template">
            <option value="">Use a template…</option>{TEMPLATES.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}
          </Select>
        </div>
        {v.channel === 'email' && <Field label="Subject" className="sm:col-span-2"><Input value={v.subject} onChange={(e) => setV({ ...v, subject: e.target.value })} /></Field>}
        <Field label="Message" className="sm:col-span-2" hint="Fields: {first} {name} {hotel} {phone} {points} {code}"><Textarea rows={6} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} /></Field>
        <div className="rounded-lg bg-surface-container-low p-3 text-body-md sm:col-span-2">
          <div className="mb-1 text-label-sm uppercase tracking-wider text-on-surface-variant">Preview for {sample.name}</div>
          {v.channel === 'email' && <div className="font-semibold">{fill(v.subject, sample, settings)}</div>}
          <div className="whitespace-pre-line">{fill(v.body, sample, settings) || '—'}</div>
        </div>
      </div>
    </Modal>
  );
}

function Automations() {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const auto = settings.automations || {};
  const [edit, setEdit] = useState(null);
  async function save(id, patch) {
    try { await saveSettings(user, { automations: { ...auto, [id]: { ...(auto[id] || {}), ...patch } } }, 'AUTOMATION_UPDATED'); toast('Saved'); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <div className="grid gap-space-md md:grid-cols-2">
      {AUTOMATIONS.map((a) => {
        const cfg = { subject: a.subject, body: a.body, ...(auto[a.id] || {}) };
        return (
          <Panel key={a.id} title={a.label} icon="bolt" actions={<Toggle label={cfg.on ? 'On' : 'Off'} checked={!!cfg.on} onChange={(v) => save(a.id, { on: v })} />}>
            <p className="text-label-md text-on-surface-variant">{a.when} · by email to guests who have not opted out.</p>
            <div className="mt-2 rounded-lg bg-surface-container-low p-3 text-body-sm"><b>{cfg.subject}</b><div className="line-clamp-3 whitespace-pre-line">{cfg.body}</div></div>
            <Button size="sm" variant="ghost" icon="edit" className="mt-2" onClick={() => setEdit({ ...a, ...cfg })}>Edit message</Button>
          </Panel>
        );
      })}
      <p className="text-label-md text-on-surface-variant md:col-span-2">Automatic messages are sent once a day by the <code>dailyAutomations</code> Cloud Function after you deploy it (see README). In demo mode they are not sent.</p>
      {edit && (
        <Modal open onClose={() => setEdit(null)} wide title={edit.label} icon="bolt" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={() => { save(edit.id, { subject: edit.subject, body: edit.body }); setEdit(null); }}>Save</Button></>}>
          <div className="grid gap-3 pb-space-sm">
            <Field label="Subject"><Input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /></Field>
            <Field label="Message" hint="Fields: {first} {name} {hotel} {phone} {points} {feedback}"><Textarea rows={7} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function Campaigns() {
  const guests = useLive('guests') || [];
  const campaigns = useLive('campaigns');
  const [tab, setTab] = useState('campaigns');
  const [edit, setEdit] = useState(null);
  const reach = (ch) => audience(guests, 'all', ch).length;
  return (
    <ModulePage crumb={['Guests', 'Campaigns']} title="Campaigns" subtitle="Bring guests back with offers, wishes and reminders"
      tabs={[{ id: 'campaigns', label: 'Campaigns', icon: 'campaign' }, { id: 'auto', label: 'Automatic messages', icon: 'bolt' }, { id: 'segments', label: 'Segments', icon: 'groups' }]} tab={tab} onTab={setTab}
      actions={tab === 'campaigns' && <Button icon="add" onClick={() => setEdit({})}>New campaign</Button>}>
      {tab === 'campaigns' && (
        <>
          <Stats items={[
            { label: 'Guests', value: guests.length, icon: 'groups', sub: `${guests.filter((g) => g.marketingOptOut).length} opted out` },
            { label: 'Reachable by email', value: reach('email'), icon: 'mail' },
            { label: 'Reachable by phone', value: reach('whatsapp'), icon: 'chat' },
            { label: 'Campaigns sent', value: (campaigns || []).filter((c) => c.status === 'Sent').length, icon: 'send' },
          ]} />
          <DataTable rows={campaigns ? campaigns.slice().sort((a, b) => ((a.sentAt || '9') < (b.sentAt || '9') ? 1 : -1)) : null} onRow={(c) => setEdit(c)} empty="No campaigns yet. Start with a festive offer or a points reminder."
            columns={[
              { key: 'n', label: 'Campaign', render: (c) => <><b>{c.name}</b><div className="line-clamp-1 max-w-md text-label-sm text-on-surface-variant">{c.subject || c.body}</div></> },
              { key: 'c', label: 'Channel', render: (c) => CHANNELS.find((x) => x.id === c.channel)?.label },
              { key: 's', label: 'Segment', render: (c) => SEGMENTS.find((x) => x.id === c.segment)?.label },
              { key: 'st', label: 'Status', render: (c) => <Chip tone={c.status === 'Sent' ? 'ok' : 'muted'}>{c.status}{c.sentCount ? ` · ${c.sentCount}` : ''}</Chip> },
              { key: 'd', label: 'Sent', render: (c) => (c.sentAt ? fmtDate(c.sentAt) : '—') },
            ]}
            actions={(c) => <Button size="sm" variant="ghost" icon="content_copy" onClick={() => setEdit({ ...c, id: undefined, status: 'Draft', name: `${c.name} (copy)` })}>Copy</Button>} />
        </>
      )}
      {tab === 'auto' && <Automations />}
      {tab === 'segments' && (
        <DataTable rows={SEGMENTS.map((s) => ({ ...s, n: guests.filter((g) => s.test(g)).length, e: audience(guests, s.id, 'email').length, w: audience(guests, s.id, 'whatsapp').length }))} dense
          columns={[{ key: 'label', label: 'Segment' }, { key: 'n', label: 'Guests', right: true }, { key: 'e', label: 'Email', right: true }, { key: 'w', label: 'WhatsApp / SMS', right: true }]}
          actions={(s) => <Button size="sm" variant="ghost" icon="send" onClick={() => { setTab('campaigns'); setEdit({ segment: s.id }); }}>Message</Button>} />
      )}
      {edit && <Compose guests={guests} initial={edit} onClose={() => setEdit(null)} />}
    </ModulePage>
  );
}
