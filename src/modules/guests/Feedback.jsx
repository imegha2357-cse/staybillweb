// Feedback: ratings after check-out — from the guest's own feedback link, or
// entered at the desk. Averages by topic, replies, and a nudge to happy guests
// to post a public review.
import { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { saveSettings } from '../../lib/db';
import { downloadCsv } from '../../lib/csv';
import { Icon } from '../../components/icons';
import { Button, Field, Input, Modal, Select, Textarea, cx, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, MiniChart, ModulePage, Panel, Stats, fmtDate, num, saveRecord, today, useLive } from '../kit';
import { waLink } from './messaging';

export const TOPICS = [['cleanliness', 'Cleanliness'], ['staff', 'Staff'], ['food', 'Food'], ['comfort', 'Room comfort'], ['value', 'Value for money']];

export { feedbackUrl } from './publicLinks';

export function Stars({ value, onChange, size = 22 }) {
  return (
    <span className="inline-flex gap-0.5" role={onChange ? 'radiogroup' : undefined}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} onClick={() => onChange?.(n)} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={cx('leading-none transition-transform', onChange && 'hover:scale-110', n <= value ? 'text-warn' : 'text-outline-variant')} style={{ fontSize: size }}>★</button>
      ))}
    </span>
  );
}

function DeskModal({ onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  const bills = useLive('bills', { where: [['checkOut', '>=', new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)]] }) || [];
  const [v, setV] = useState({ billId: '', rating: 0, topics: {}, comment: '' });
  const bill = bills.find((b) => b.id === v.billId);
  async function save() {
    if (!bill) return toast('Choose the stay.', 'error');
    if (!v.rating) return toast('Choose an overall rating.', 'error');
    try {
      await saveRecord(user, 'feedback', null, { billId: bill.id, invoiceNumber: bill.invoiceNumber, guestId: bill.guestId || null, guestName: bill.guestName, roomNumber: bill.roomNumber, rating: v.rating, topics: v.topics, comment: v.comment.trim(), source: 'Front desk', date: today(), status: 'New' }, 'FEEDBACK_ADDED');
      toast('Feedback saved'); onClose();
    } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} title="Record feedback" icon="reviews" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3 pb-space-sm">
        <Field label="Stay"><Select value={v.billId} onChange={(e) => setV({ ...v, billId: e.target.value })}><option value="">Choose…</option>{bills.filter((b) => b.paymentStatus !== 'CANCELLED').sort((a, b) => (a.checkOut < b.checkOut ? 1 : -1)).map((b) => <option key={b.id} value={b.id}>{b.guestName} · Room {b.roomNumber} · {b.invoiceNumber}</option>)}</Select></Field>
        <div role="group" aria-label="Overall rating"><span className="mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant">Overall</span><Stars value={v.rating} onChange={(n) => setV({ ...v, rating: n })} size={28} /></div>
        <div className="grid gap-2 sm:grid-cols-2">
          {TOPICS.map(([k, l]) => <div key={k} className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-1.5 text-body-md"><span>{l}</span><Stars value={v.topics[k] || 0} onChange={(n) => setV({ ...v, topics: { ...v.topics, [k]: n } })} size={18} /></div>)}
        </div>
        <Field label="Comments"><Textarea rows={3} value={v.comment} onChange={(e) => setV({ ...v, comment: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ReplyModal({ f, onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [reply, setReply] = useState(f.response || '');
  const [action, setAction] = useState(f.action || '');
  async function save() {
    try { await saveRecord(user, 'feedback', f.id, { response: reply.trim(), action: action.trim(), status: 'Responded', respondedBy: user.name || '' }, 'FEEDBACK_RESPONDED'); toast('Saved'); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
  }
  return (
    <Modal open onClose={onClose} wide title={`${f.guestName} · Room ${f.roomNumber || '—'}`} icon="reviews"
      footer={<>{f.phone && reply && <a className="mr-auto inline-flex items-center gap-1 text-label-lg text-secondary" href={waLink(f.phone, reply)} target="_blank" rel="noopener noreferrer"><Icon name="chat" size={16} />Send reply on WhatsApp</a>}<Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-3 pb-space-sm text-body-md">
        <div className="flex items-center gap-3"><Stars value={f.rating} size={24} /><span className="text-on-surface-variant">{fmtDate(f.date)} · {f.source}</span></div>
        {f.topics && <div className="flex flex-wrap gap-1.5">{TOPICS.filter(([k]) => f.topics[k]).map(([k, l]) => <Chip key={k} tone={f.topics[k] >= 4 ? 'ok' : f.topics[k] <= 2 ? 'error' : 'warn'}>{l} {f.topics[k]}★</Chip>)}</div>}
        <p className="rounded-lg bg-surface-container-low p-3">{f.comment || <i className="text-on-surface-variant">No comment</i>}</p>
        <Field label="Reply to the guest"><Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={`Dear ${(f.guestName || '').split(' ')[0]}, thank you for…`} /></Field>
        <Field label="Action taken (staff only)"><Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Shower fixed in room 204" /></Field>
        {f.rating >= 4 && settings.reviewUrl && <p className="text-label-md text-on-surface-variant">Happy guest — they were shown your review link.</p>}
      </div>
    </Modal>
  );
}

function LinkSettings({ onClose }) {
  const { user } = useAuth();
  const { settings } = useData();
  const toast = useToast();
  const [url, setUrl] = useState(settings.reviewUrl || '');
  async function save() { try { await saveSettings(user, { reviewUrl: url.trim() }); toast('Saved'); onClose(); } catch (e) { toast(errMsg(e), 'error'); } }
  return (
    <Modal open onClose={onClose} title="Public review link" icon="link" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="space-y-2 pb-space-sm">
        <Field label="Google / TripAdvisor review link" hint="Guests who give 4 or 5 stars are invited to post a review here."><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://g.page/r/…/review" /></Field>
      </div>
    </Modal>
  );
}

export default function Feedback() {
  const rows = useLive('feedback');
  const [desk, setDesk] = useState(false);
  const [open, setOpen] = useState(null);
  const [cfg, setCfg] = useState(false);
  const { isAdmin } = useAuth();
  const list = useMemo(() => (rows || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [rows]);
  const avg = (fn) => { const xs = list.map(fn).filter((x) => x > 0); return xs.length ? (xs.reduce((a, x) => a + x, 0) / xs.length) : 0; };
  const promoters = list.filter((f) => f.rating >= 5).length; const detractors = list.filter((f) => f.rating <= 3).length;
  const nps = list.length ? Math.round(((promoters - detractors) / list.length) * 100) : 0;
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - 5 + i); return d.toISOString().slice(0, 7); });
  return (
    <ModulePage crumb={['Guests', 'Feedback']} title="Feedback" subtitle="What guests say after they check out"
      actions={<>{isAdmin && <Button variant="secondary" icon="link" onClick={() => setCfg(true)}>Review link</Button>}<Button variant="secondary" icon="file_download" onClick={() => downloadCsv(`feedback-${today()}.csv`, ['Date', 'Guest', 'Room', 'Rating', ...TOPICS.map((t) => t[1]), 'Comment', 'Source', 'Reply'], list.map((f) => [f.date, f.guestName, f.roomNumber, f.rating, ...TOPICS.map(([k]) => f.topics?.[k] || ''), f.comment, f.source, f.response || '']))}>CSV</Button><Button icon="add" onClick={() => setDesk(true)}>Record feedback</Button></>}>
      <Stats items={[
        { label: 'Average rating', value: list.length ? `${avg((f) => num(f.rating)).toFixed(1)} ★` : '—', icon: 'star', sub: `${list.length} responses` },
        { label: 'Net promoter', value: list.length ? nps : '—', icon: 'thumb_up', sub: '5★ minus ≤3★, as %' },
        { label: 'Need a reply', value: list.filter((f) => f.status !== 'Responded' && f.rating <= 3).length, icon: 'mark_chat_unread', tone: list.some((f) => f.status !== 'Responded' && f.rating <= 3) ? 'error' : undefined },
        { label: 'This month', value: list.filter((f) => (f.date || '').startsWith(today().slice(0, 7))).length, icon: 'calendar_month' },
      ]} />
      {list.length > 0 && (
        <div className="grid gap-space-md lg:grid-cols-[1fr_1fr]">
          <Panel title="Rating by topic" icon="analytics">
            {TOPICS.map(([k, l]) => { const a = avg((f) => num(f.topics?.[k])); return (
              <div key={k} className="flex items-center gap-3 py-1 text-body-md"><span className="w-32">{l}</span><div className="h-2 flex-1 rounded-full bg-surface-container"><div className={cx('h-2 rounded-full', a >= 4 ? 'bg-primary' : a >= 3 ? 'bg-warn' : 'bg-error')} style={{ width: `${(a / 5) * 100}%` }} /></div><span className="w-10 text-right tabular-nums">{a ? a.toFixed(1) : '—'}</span></div>
            ); })}
          </Panel>
          <Panel title="Average rating by month" icon="show_chart">
            <MiniChart height={150} labels={months.map((m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short' }))} format={(v) => v.toFixed(1)}
              series={[{ label: 'Rating', values: months.map((m) => { const xs = list.filter((f) => (f.date || '').startsWith(m)); return xs.length ? xs.reduce((a, f) => a + num(f.rating), 0) / xs.length : 0; }) }]} />
          </Panel>
        </div>
      )}
      <DataTable rows={rows ? list : null} onRow={(f) => setOpen(f)} search={(f) => `${f.guestName} ${f.roomNumber} ${f.comment}`}
        filters={[{ id: 'all', label: 'All' }, { id: 'low', label: '3★ or less', test: (f) => f.rating <= 3 }, { id: 'open', label: 'Not replied', test: (f) => f.status !== 'Responded' }]}
        empty="No feedback yet. Guests get a feedback link in their thank-you email after check-out, or record it here."
        columns={[
          { key: 'r', label: 'Rating', render: (f) => <Stars value={f.rating} size={16} /> },
          { key: 'g', label: 'Guest', render: (f) => <><b>{f.guestName}</b><div className="text-label-sm text-on-surface-variant">Room {f.roomNumber || '—'} · {f.source}</div></> },
          { key: 'c', label: 'Comment', render: (f) => <span className="line-clamp-2 max-w-md">{f.comment || '—'}</span> },
          { key: 'd', label: 'Date', render: (f) => fmtDate(f.date) },
          { key: 's', label: '', render: (f) => (f.status === 'Responded' ? <Chip tone="ok">Replied</Chip> : f.rating <= 3 ? <Chip tone="error">Reply</Chip> : null) },
        ]} />
      {desk && <DeskModal onClose={() => setDesk(false)} />}
      {open && <ReplyModal f={open} onClose={() => setOpen(null)} />}
      {cfg && <LinkSettings onClose={() => setCfg(false)} />}
    </ModulePage>
  );
}
