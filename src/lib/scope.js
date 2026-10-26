// Which hotel the signed-in person is working in. Every hotel's records live
// under hotels/{hotelId}/… so one StayBill site can serve many hotels.
import { collection, doc } from '../backend/firestore';
import { db } from '../firebase';

let hotelId = null;
const listeners = new Set();
export function setHotelId(id) {
  if ((id || null) === hotelId) return;
  hotelId = id || null;
  listeners.forEach((f) => f(hotelId));
}
export const getHotelId = () => hotelId;
export const onHotelChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

function need(hid) {
  const h = hid || hotelId;
  if (!h) { const e = new Error('Choose a hotel first.'); e.code = 'no-hotel'; throw e; }
  return h;
}
/** Collection inside the current (or given) hotel. */
export const hcol = (name, hid) => collection(db, 'hotels', need(hid), name);
/** Document inside the current (or given) hotel. */
export const hdoc = (name, id, hid) => doc(db, 'hotels', need(hid), name, id);
