// Channels & OTAs: commission per channel, calendar sync with Booking.com,
// Airbnb, Agoda, MakeMyTrip and others through iCal links, a rate sheet to
// upload to extranets, and this month's business per channel.
import { useMemo, useState } from 'react';
import { firebaseConfig, isConfigured } from '../../config';
import { useAuth } from '../../context/AuthContext';
import { useData } from '../../context/DataContext';
import { addDays } from '../../lib/dates';
import { downloadCsv } from '../../lib/csv';
import { Button, Input, Modal, Select, useToast, errMsg } from '../../components/ui';
import { Chip, DataTable, ModulePage, Panel, RecordModal, Stats, fmtShort, money, num, saveRecord, today, useLive } from '../kit';
import { OTA_SOURCES, bookingTotal, freeRooms } from './Bookings';
import { token } from '../billOps';

const REGION = 'asia-south1';
export const feedUrl = (hotelId, roomNumber, key) => (isConfigured
  ? `https://${REGION}-${firebaseConfig.projectId}.cloudfunctions.net/icalFeed?h=${encodeURIComponent(hotelId)}&room=${encodeURIComponent(roomNumber)}&k=${key}`
  : '');

const FIELDS = [
  { key: 'name', label: 'Channel', type: 'select', options: [...OTA_SOURCES, 'Travel agent', 'Corporate', 'Other'], required: true, half: true, placeholder: false },
  { key: 'commission', label: 'Commission %', type: 'number', step: '0.5', half: true },
  { key: 'markup', label: 'Rate markup %', type: 'number', step: '0.5', half: true, hint: 'Added to your room rate on this channel (covers commission).' },
  { key: 'active', label: 'Active', type: 'toggle' },
  { key: 'notes', label: 'Login / contact notes', type: 'textarea', hint: 'Do not store passwords here.' },
];

function SyncModal({ channel, onClose }) {
  const { user, hotelId } = useAuth();
  const { rooms } = useData();
  const toast = useToast();
  const [imports, setImports] = useState(channel.icalImports || []);
  const [busy, setBusy] = useState(false);
  const key = channel.feedKey || '';
  const live = rooms.filter((r) => r.status !== 'inactive');
  async function save(extra = {}) {
    setBusy(true);
    try { await saveRecord(user, 'channels', channel.id, { icalImports: imports.filter((x) => x.url?.trim()), ...extra }, 'CHANNEL_SYNC_UPDATED'); toast('Calendar sync saved'); onClose(); } catch (e) { toast(errMsg(e), 'error'); }
    setBusy(false);
  }
  const urlFor = (room) => (key ? feedUrl(hotelId, room, key) : '');
  return (
    <Modal open onClose={onClose} title={`Calendar sync · ${channel.name}`} icon="sync" wide
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>{!key && <Button variant="secondary" onClick={() => save({ feedKey: token() })} loading={busy}>Create export links</Button>}<Button onClick={() => save()} loading={busy}>Save</Button></>}>
      <div className="space-y-space-md pb-space-sm text-body-md">
        <p className="text-on-surface-variant">Two-way calendar sync stops double bookings: StayBill publishes each room's booked dates, and reads the bookings {channel.name} has taken. Most channels refresh iCal every 30 minutes to a few hours.</p>
        {!isConfigured && <p className="rounded-lg bg-warn-container px-3 py-2 text-on-warn-container">Calendar sync runs in the Firebase version (it needs the StayBill Cloud Functions). You can still save the links here.</p>}
        <div>
          <div className="mb-1 text-label-sm uppercase tracking-wider text-on-surface-variant">1 · Export: paste into {channel.name} → Calendar → Import calendar</div>
          {!key ? <p className="text-on-surface-variant">Click <b>Create export links</b> to make one private link per room.</p> : (
            <div className="space-y-1.5">
              {live.map((r) => (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 font-semibold">{r.roomNumber}</span>
                  <Input readOnly value={urlFor(r.roomNumber) || 'Available in the Firebase version'} className="font-mono text-label-sm" onFocus={(e) => e.target.select()} />
                  <Button size="sm" variant="ghost" icon="content_copy" onClick={() => navigator.clipboard?.writeText(urlFor(r.roomNumber)).then(() => toast('Link copied'), () => {})} aria-label={`Copy link for room ${r.roomNumber}`} />
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="mb-1 text-label-sm uppercase tracking-wider text-on-surface-variant">2 · Import: paste {channel.name}'s "Export calendar" link for each room</div>
          <div className="space-y-1.5">
            {live.map((r) => {
              const cur = imports.find((x) => x.roomNumber === r.roomNumber) || { roomNumber: r.roomNumber, url: '' };
              return (
                <div key={r.id} className="flex items-center gap-2">
                  <span className="w-16 shrink-0 font-semibold">{r.roomNumber}</span>
                  <Input value={cur.url} placeholder="https://…/ical/…ics" className="font-mono text-label-sm"
                    onChange={(e) => setImports([...imports.filter((x) => x.roomNumber !== r.roomNumber), { roomNumber: r.roomNumber, url: e.target.value }])} />
                </div>
              );
            })}
          </div>
          {channel.lastImportAt && <p className="mt-1 text-label-md text-on-surface-variant">Last import: {new Date(channel.lastImportAt).toLocaleString('en-IN')} · {channel.lastImportResult || ''}</p>}
        </div>
        <p className="text-label-md text-on-surface-variant">Live rate and inventory pushing (not just blocked dates) needs a channel manager subscription such as STAAH, eZee Centrix or SiteMinder. Their bookings can be entered here with the source and reference.</p>
      </div>
    </Modal>
  );
}

function RateSheet({ channels }) {
  const { rooms, roomTypes } = useData();
  const bookings = useLive('bookings', { where: [['checkOut', '>=', today()]] });
  const bills = useLive('bills', { where: [['checkOut', '>=', today()]] });
  const [from, setFrom] = useState(today());
  const [ch, setCh] = useState('');
  const c = channels.find((x) => x.id === ch);
  const days = Array.from({ length: 30 }, (_, i) => addDays(from, i));
  function exportCsv() {
    const head = ['Date', ...roomTypes.flatMap((t) => [`${t.name} rate`, `${t.name} available`])];
    const rows = days.map((d) => [d, ...roomTypes.flatMap((t) => {
      const rate = Math.round(num(t.defaultRate) * (1 + num(c?.markup) / 100));
      const av = freeRooms({ rooms, bookings: bookings || [], bills: bills || [], roomType: t.name, checkIn: d, checkOut: addDays(d, 1) }).count;
      return [rate, av];
    })]);
    downloadCsv(`rate-sheet-${c?.name || 'base'}-${from}.csv`, head, rows);
  }
  return (
    <Panel title="Rate & availability sheet" icon="table_view" actions={<>
      <div className="w-44"><Select value={ch} onChange={(e) => setCh(e.target.value)} aria-label="Channel"><option value="">Base rates</option>{channels.map((x) => <option key={x.id} value={x.id}>{x.name}{x.markup ? ` (+${x.markup}%)` : ''}</option>)}</Select></div>
      <div className="w-40"><Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} aria-label="From" /></div>
      <Button size="sm" variant="secondary" icon="file_download" onClick={exportCsv}>CSV for 30 days</Button>
    </>}>
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full min-w-[700px] text-label-md">
          <thead><tr className="text-on-surface-variant"><th className="px-2 py-1 text-left">Room type</th>{days.slice(0, 14).map((d) => <th key={d} className="px-1 py-1 text-center">{fmtShort(d)}</th>)}</tr></thead>
          <tbody>
            {roomTypes.map((t) => (
              <tr key={t.id} className="border-t border-surface-container">
                <td className="px-2 py-1.5 font-semibold">{t.name}<div className="text-label-sm font-normal text-on-surface-variant">{money(Math.round(num(t.defaultRate) * (1 + num(c?.markup) / 100)))}</div></td>
                {days.slice(0, 14).map((d) => {
                  const av = freeRooms({ rooms, bookings: bookings || [], bills: bills || [], roomType: t.name, checkIn: d, checkOut: addDays(d, 1) }).count;
                  return <td key={d} className="px-1 py-1.5 text-center"><Chip tone={av === 0 ? 'error' : av < 2 ? 'warn' : 'ok'}>{av}</Chip></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-label-md text-on-surface-variant">Rooms free per night. Upload the CSV to an extranet's bulk rate tool, or use it to update rates by hand.</p>
    </Panel>
  );
}

export default function Channels() {
  const channels = useLive('channels');
  const month = today().slice(0, 7);
  const bookings = useLive('bookings', { where: [['checkIn', '>=', `${month}-01`]] });
  const [edit, setEdit] = useState(null);
  const [sync, setSync] = useState(null);
  const perChannel = useMemo(() => {
    const m = {};
    (bookings || []).filter((b) => !['Cancelled'].includes(b.status)).forEach((b) => {
      const k = b.source || 'Direct';
      m[k] = m[k] || { bookings: 0, nights: 0, revenue: 0 };
      m[k].bookings += 1; m[k].nights += num(b.nights); m[k].revenue += num(b.total) || bookingTotal(b);
    });
    return m;
  }, [bookings]);
  const otaRevenue = OTA_SOURCES.reduce((a, s) => a + (perChannel[s]?.revenue || 0), 0);
  const allRevenue = Object.values(perChannel).reduce((a, x) => a + x.revenue, 0);
  const commissionDue = (channels || []).reduce((a, c) => a + ((perChannel[c.name]?.revenue || 0) * num(c.commission)) / 100, 0);
  return (
    <ModulePage crumb={['Front desk', 'Channels & OTAs']} title="Channels & OTAs" subtitle="Online travel agencies, calendar sync and commissions"
      actions={<Button icon="add" onClick={() => setEdit({ active: true, commission: 15 })}>Add channel</Button>}>
      <Stats items={[
        { label: 'OTA share this month', value: allRevenue ? `${Math.round((otaRevenue / allRevenue) * 100)}%` : '—', icon: 'pie_chart', sub: `${money(otaRevenue)} of ${money(allRevenue)} booked` },
        { label: 'Commission due', value: money(commissionDue), icon: 'percent', sub: 'On this month’s OTA bookings' },
        { label: 'Direct bookings', value: Object.entries(perChannel).filter(([k]) => !OTA_SOURCES.includes(k)).reduce((a, [, x]) => a + x.bookings, 0), icon: 'handshake', sub: 'Phone, walk-in, website' },
        { label: 'Channels', value: (channels || []).filter((c) => c.active !== false).length, icon: 'travel_explore', sub: `${(channels || []).filter((c) => (c.icalImports || []).length).length} with calendar sync` },
      ]} />
      <DataTable rows={channels} onRow={(c) => setEdit(c)} empty="Add the OTAs you list on (Booking.com, MakeMyTrip, Airbnb…) to track their commission and sync calendars."
        columns={[
          { key: 'name', label: 'Channel', render: (c) => <b>{c.name}</b> },
          { key: 'comm', label: 'Commission', right: true, render: (c) => `${num(c.commission)}%` },
          { key: 'month', label: 'This month', right: true, render: (c) => { const x = perChannel[c.name]; return x ? `${x.bookings} bookings · ${money(x.revenue)}` : '—'; } },
          { key: 'due', label: 'Commission', right: true, render: (c) => money(((perChannel[c.name]?.revenue || 0) * num(c.commission)) / 100) },
          { key: 'sync', label: 'Calendar sync', render: (c) => ((c.icalImports || []).length ? <Chip tone="ok">{c.icalImports.length} rooms</Chip> : <Chip>Off</Chip>) },
          { key: 'active', label: 'Status', render: (c) => (c.active === false ? <Chip>Paused</Chip> : <Chip tone="info">Active</Chip>) },
        ]}
        actions={(c) => <Button size="sm" variant="secondary" icon="sync" onClick={() => setSync(c)}>Calendar sync</Button>} />
      <RateSheet channels={channels || []} />
      <RecordModal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : 'Add channel'} icon="travel_explore" fields={FIELDS} initial={edit} collection="channels" label="CHANNEL" />
      {sync && <SyncModal channel={sync} onClose={() => setSync(null)} />}
    </ModulePage>
  );
}
