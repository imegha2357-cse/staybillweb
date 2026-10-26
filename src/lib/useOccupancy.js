// Which rooms have a guest staying tonight (a live bill whose stay covers today).
// Used by the dashboard facade, the key rack and the room tiles.
import { useEffect, useState } from 'react';
import { billsInRange } from './db';
import { addDays, today } from './dates';
import { useData } from '../context/DataContext';

export function useOccupancy() {
  const { outstanding } = useData();
  const [state, setState] = useState({ occupied: new Set(), guests: new Map(), ready: false });
  const key = outstanding.map((b) => `${b.id}:${b.paidAmount}`).join(',');
  useEffect(() => {
    let alive = true;
    const t = today();
    billsInRange(addDays(t, -45), t).then((bills) => {
      if (!alive) return;
      const occupied = new Set(); const guests = new Map();
      bills.filter((b) => b.paymentStatus !== 'CANCELLED' && b.checkIn <= t && b.checkOut > t)
        .forEach((b) => { occupied.add(b.roomNumber); guests.set(b.roomNumber, b.guestName); });
      setState({ occupied, guests, ready: true });
    }).catch(() => alive && setState((s) => ({ ...s, ready: true })));
    return () => { alive = false; };
  }, [key]);
  return state;
}
