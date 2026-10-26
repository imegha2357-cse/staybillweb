// Public feedback form: /feedback/:hotelId/:billId/:token — opened from the
// thank-you email. One response per stay; happy guests are pointed to the
// hotel's public review page.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { addDoc, doc, getDoc, serverTimestamp, updateDoc } from '../../backend/firestore';
import { db } from '../../firebase';
import { hcol } from '../../lib/scope';
import { today } from '../../lib/dates';
import { Icon } from '../../components/icons';
import { Button, Textarea } from '../../components/ui';
import { Stars, TOPICS } from '../../modules/guests/Feedback';
import { PublicShell } from './PublicBooking';

export default function PublicFeedback() {
  const { hotelId, billId, token } = useParams();
  const [card, setCard] = useState(undefined);
  const [v, setV] = useState({ rating: 0, topics: {}, comment: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const ref = doc(db, 'publicFeedback', `${hotelId}_${billId}`);
  useEffect(() => { getDoc(ref).then((s) => setCard(s.exists() && s.data().token === token ? s.data() : null)).catch(() => setCard(null)); }, [hotelId, billId, token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send() {
    if (!v.rating) return setErr('Tap the stars to rate your stay.');
    setBusy(true); setErr('');
    try {
      await addDoc(hcol('feedback', hotelId), {
        billId, token, guestId: card.guestId || null, guestName: card.guestName, roomNumber: card.roomNumber, invoiceNumber: card.invoiceNumber,
        rating: v.rating, topics: v.topics, comment: v.comment.trim().slice(0, 2000), source: 'Guest link', date: today(), status: 'New', createdAt: serverTimestamp(),
      });
      await updateDoc(ref, { done: true, token }).catch(() => {});
      setDone(true);
    } catch (e) { setErr('Sorry, that did not go through. Please try again.'); }
    setBusy(false);
  }

  const shell = (children) => <PublicShell hotel={{ name: card?.hotelName || 'Your stay' }}>{children}</PublicShell>;
  if (card === undefined) return shell(<p className="py-20 text-center text-on-surface-variant">Loading…</p>);
  if (!card) return shell(<p className="py-20 text-center text-body-lg">This feedback link is not valid.</p>);
  if (done || card.done) {
    return shell(
      <div className="mx-auto max-w-md rounded-2xl bg-surface-container-lowest p-6 text-center shadow-sm">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ok-container text-on-ok-container"><Icon name="favorite" size={28} /></span>
        <h1 className="mt-3 font-headline text-headline-md">Thank you{card.firstName ? `, ${card.firstName}` : ''}!</h1>
        <p className="mt-1 text-body-md text-on-surface-variant">Your feedback goes straight to the {card.hotelName || 'hotel'} team.</p>
        {(v.rating >= 4 || card.done) && card.reviewUrl && <a href={card.reviewUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-2 text-label-lg text-on-primary"><Icon name="star" size={16} />Share it on Google too</a>}
      </div>,
    );
  }
  return shell(
    <div className="mx-auto max-w-lg space-y-4 rounded-2xl bg-surface-container-lowest p-6 shadow-sm">
      <div>
        <h1 className="font-headline text-headline-md">How was your stay{card.firstName ? `, ${card.firstName}` : ''}?</h1>
        <p className="text-body-md text-on-surface-variant">Room {card.roomNumber} · it takes 30 seconds.</p>
      </div>
      <div className="flex justify-center"><Stars value={v.rating} onChange={(n) => setV({ ...v, rating: n })} size={40} /></div>
      <div className="space-y-1.5">
        {TOPICS.map(([k, l]) => <div key={k} className="flex items-center justify-between rounded-lg bg-surface-container-low px-3 py-1.5 text-body-md"><span>{l}</span><Stars value={v.topics[k] || 0} onChange={(n) => setV({ ...v, topics: { ...v.topics, [k]: n } })} size={22} /></div>)}
      </div>
      <Textarea rows={4} value={v.comment} onChange={(e) => setV({ ...v, comment: e.target.value })} placeholder="What did you like? What could we do better?" aria-label="Comments" />
      {err && <p className="text-body-md text-error" role="alert">{err}</p>}
      <Button className="w-full" size="lg" loading={busy} onClick={send}>Send feedback</Button>
    </div>,
  );
}
