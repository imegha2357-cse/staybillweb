// Demo data: 15 sample entries in every list of the current hotel, so every
// screen can be tried. Uses the same save functions as the forms, so the data
// follows the same rules. Nothing existing is changed or removed (rooms that
// already exist are reused).
import { doc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from '../backend/firestore';
import { db } from '../firebase';
import { hcol, hdoc } from './scope';
import { actor, createBill, createGuest, createRoom, getGuest, recordPayment, saveSettings } from './db';
import { computeBill, round2 } from './billing';
import { addDays, today } from './dates';

const N = 15;
const pick = (arr, i) => arr[i % arr.length];
const range = (n = N) => Array.from({ length: n }, (_, i) => i);

const FIRST = ['Aarav', 'Priya', 'Rohan', 'Ananya', 'Vikram', 'Meera', 'Arjun', 'Kavya', 'Rahul', 'Sneha', 'Karthik', 'Divya', 'Sanjay', 'Lakshmi', 'Imran'];
const LAST = ['Sharma', 'Iyer', 'Reddy', 'Nair', 'Menon', 'Gupta', 'Krishnan', 'Rao', 'Verma', 'Pillai', 'Subramanian', 'Joshi', 'Patel', 'Venkatesh', 'Khan'];
const CITIES = ['Chennai', 'Bengaluru', 'Hyderabad', 'Mumbai', 'Coimbatore', 'Kochi', 'Madurai', 'Pune', 'Delhi', 'Trichy', 'Mysuru', 'Vizag', 'Salem', 'Pondicherry', 'Kolkata'];
const PREFS = ['Non-smoking', 'High floor', 'Quiet room', 'King bed', 'Extra pillows', 'Vegetarian', 'Early check-in', 'Late check-out', 'Airport pickup'];
const ROOM_PLAN = [
  ['101', 'Standard'], ['102', 'Standard'], ['103', 'Standard'], ['104', 'Standard'], ['105', 'Standard'],
  ['201', 'Deluxe'], ['202', 'Deluxe'], ['203', 'Deluxe'], ['204', 'Deluxe'],
  ['301', 'Premium'], ['302', 'Premium'], ['303', 'Premium'],
  ['401', 'Suite'], ['402', 'Suite'], ['501', 'Family Room'],
];
const RATES = { Standard: 1500, Deluxe: 2500, Premium: 3200, Suite: 4000, 'Family Room': 3500 };
const METHODS = ['UPI', 'Cash', 'Card', 'Bank Transfer'];

const docs = async (name) => (await getDocs(hcol(name))).docs.map((d) => ({ id: d.id, ...d.data() }));
const stamp = (user) => ({ createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: actor(user), demo: true });

/** Numbers like PO-0001 for many records at once (one counter update). */
async function numbers(counter, prefix, n = N, pad = 4) {
  const ref = hdoc('counters', counter);
  const snap = await getDocs(hcol('counters'));
  const existing = snap.docs.find((d) => d.id === counter);
  const cur = existing?.data()?.next || 1;
  // security rules: a new counter must start at 2; after that the owner may move it on
  if (!existing) await setDoc(ref, { next: 2 });
  await setDoc(ref, { next: cur + n });
  return range(n).map((i) => `${prefix}-${String(cur + i).padStart(pad, '0')}`);
}

/** Writes many records of one list in a single batch. */
async function addMany(user, name, rows, idFor) {
  const b = writeBatch(db);
  const ids = rows.map((r, i) => {
    const ref = idFor ? hdoc(name, idFor(r, i)) : doc(hcol(name));
    b.set(ref, { ...r, ...stamp(user) });
    return ref.id;
  });
  await b.commit();
  return ids;
}

/**
 * Adds the demo data. progress(text) is called after each step.
 * Returns a summary: [{ label, count }].
 */
export async function loadDemoData(user, settings = {}, progress = () => {}) {
  const t = today();
  const done = [];
  const step = (label, count) => { done.push({ label, count }); progress(`${label}: ${count}`); };

  // ---- Room types, taxes, rooms ----
  const types = await docs('roomTypes');
  const missingTypes = Object.keys(RATES).filter((n) => !types.some((x) => x.name === n));
  if (missingTypes.length) await addMany(user, 'roomTypes', missingTypes.map((name) => ({ name, defaultRate: RATES[name], order: Object.keys(RATES).indexOf(name) })));
  let taxes = (await docs('taxes')).filter((x) => x.status === 'active');
  if (!taxes.length) {
    await addMany(user, 'taxes', [{ name: 'CGST', rate: 2.5, status: 'active' }, { name: 'SGST', rate: 2.5, status: 'active' }]);
    taxes = (await docs('taxes')).filter((x) => x.status === 'active');
  }
  let rooms = await docs('rooms');
  let madeRooms = 0;
  for (const [roomNumber, roomType] of ROOM_PLAN) { // eslint-disable-line no-restricted-syntax
    if (rooms.some((r) => String(r.roomNumber) === roomNumber)) continue; // eslint-disable-line no-continue
    await createRoom(user, { roomNumber, roomType, rate: RATES[roomType], taxMode: 'default', taxIds: [], status: 'active' }); // eslint-disable-line no-await-in-loop
    madeRooms += 1;
  }
  rooms = (await docs('rooms')).filter((r) => r.status !== 'inactive');
  step('Rooms', madeRooms);

  // ---- Guests ----
  const guestIds = [];
  for (const i of range()) { // eslint-disable-line no-restricted-syntax
    const name = `${FIRST[i]} ${LAST[i]}`;
    const id = await createGuest(user, { // eslint-disable-line no-await-in-loop
      name, phone: `98${String(41000000 + i * 137731).slice(0, 8)}`, email: `${FIRST[i].toLowerCase()}.${LAST[i].toLowerCase()}@example.com`,
      address: `${12 + i}, ${pick(['Anna Nagar', 'MG Road', 'Banjara Hills', 'Andheri West', 'RS Puram', 'Marine Drive'], i)}, ${CITIES[i]}`,
      gstin: i % 5 === 0 ? `33ABCDE${String(1000 + i)}F1Z${i % 10}` : '',
      notes: i % 4 === 0 ? 'Prefers ground-floor rooms' : '',
      birthday: `19${80 + (i % 18)}-${String((i % 12) + 1).padStart(2, '0')}-${String(5 + i).padStart(2, '0')}`,
      anniversary: i % 3 === 0 ? `20${10 + (i % 12)}-${String(((i + 4) % 12) + 1).padStart(2, '0')}-1${i % 9}` : '',
      company: i % 5 === 0 ? pick(['Infosys', 'TCS', 'Zoho', 'Wipro'], i) : '',
      nationality: 'Indian', idType: pick(['Aadhaar', 'Passport', 'Driving licence', 'Voter ID'], i), idNumber: `XXXX-XXXX-${String(4000 + i * 37)}`,
      preferences: [pick(PREFS, i), pick(PREFS, i + 3)], vip: i % 6 === 0, tags: i % 6 === 0 ? ['VIP'] : [],
    });
    guestIds.push(id);
  }
  const guests = await Promise.all(guestIds.map((id) => getGuest(id)));
  step('Guests', N);

  // ---- Bills and payments (one room each, spread over the last 3 weeks) ----
  const billIds = [];
  for (const i of range()) { // eslint-disable-line no-restricted-syntax
    const room = rooms[i % rooms.length];
    const g = guests[i];
    const nights = 1 + (i % 4);
    const checkIn = addDays(t, -20 + Math.round(i * 1.4));
    const checkOut = addDays(checkIn, nights);
    const items = [
      ...(i % 2 === 0 ? [{ description: 'Breakfast buffet', quantity: nights * 2, rate: 350 }] : []),
      ...(i % 3 === 0 ? [{ description: 'Laundry', quantity: 1, rate: 240 }] : []),
      ...(i % 5 === 0 ? [{ description: 'Airport pickup', quantity: 1, rate: 900 }] : []),
    ];
    const rate = Number(room.rate) || RATES[room.roomType] || 2000;
    const computed = computeBill({ nights, roomRate: rate, items, discountType: i % 7 === 3 ? 'percent' : 'none', discountValue: i % 7 === 3 ? 10 : 0, taxes });
    const form = {
      guestId: g.id, guest: g, roomId: room.id, roomNumber: room.roomNumber, roomType: room.roomType,
      checkIn, checkOut, nights, roomRate: rate, items: computed.items, notes: i % 4 === 1 ? 'Early check-in requested' : '',
      billDate: checkIn, source: pick(['Walk-in', 'Phone', 'Booking.com', 'MakeMyTrip', 'Website', 'Corporate'], i),
    };
    const kind = i % 3; // 0 paid at check-in, 1 part-paid, 2 nothing paid yet
    const first = kind === 0 ? computed.grandTotal : kind === 1 ? round2(computed.grandTotal * 0.4) : 0;
    const res = await createBill(user, form, computed, first ? { amount: first, method: pick(METHODS, i), referenceNumber: i % 2 ? `UPI${7712000 + i}` : '', date: checkIn } : null, { quiet: true }); // eslint-disable-line no-await-in-loop
    billIds.push(res.id);
    // the rest paid at check-out for stays that are over
    if (checkOut < t && kind !== 0 && i % 2 === 0) {
      await recordPayment(user, res.id, { amount: round2(computed.grandTotal - first), method: pick(METHODS, i + 1), date: checkOut }, { quiet: true }); // eslint-disable-line no-await-in-loop
    }
  }
  const bills = (await docs('bills')).filter((b) => billIds.includes(b.id));
  // checked out, and loyalty points for paid stays
  const { earnPoints, token } = await import('../modules/billOps');
  for (const b of bills) { // eslint-disable-line no-restricted-syntax
    if (b.checkOut < t) await updateDoc(hdoc('bills', b.id), { checkedOutAt: serverTimestamp(), checkedOutOn: b.checkOut, checkedOutBy: actor(user), feedbackToken: token() }); // eslint-disable-line no-await-in-loop
    if (b.paymentStatus === 'PAID') await earnPoints(user, b, settings); // eslint-disable-line no-await-in-loop
  }
  step('Bills (with payments)', N);

  // ---- Bookings (upcoming) ----
  const bkNo = await numbers('booking', 'BK');
  await addMany(user, 'bookings', range().map((i) => {
    const roomType = pick(Object.keys(RATES), i);
    const checkIn = addDays(t, 2 + i * 2);
    const nights = 1 + (i % 3);
    const rate = RATES[roomType];
    const roomsN = i % 7 === 0 ? 2 : 1;
    const g = guests[(i + 5) % N];
    return {
      number: bkNo[i], guestId: g.id, guestName: g.name, guestNameLower: g.name.toLowerCase(), phone: g.phone, email: g.email,
      checkIn, checkOut: addDays(checkIn, nights), nights, roomType, rooms: roomsN, adults: 2, children: i % 4 === 0 ? 1 : 0,
      rate, total: round2(rate * nights * roomsN), source: pick(['Phone', 'Booking.com', 'MakeMyTrip', 'Website', 'Walk-in', 'Agoda', 'Travel agent'], i),
      status: pick(['Confirmed', 'Confirmed', 'Confirmed', 'Requested', 'Enquiry'], i), advance: i % 3 === 0 ? 1000 : 0, advanceMethod: i % 3 === 0 ? 'UPI' : '',
      groupName: roomsN > 1 ? `${LAST[i]} family` : '', nationality: 'Indian', notes: i % 4 === 2 ? 'Anniversary — cake in room' : '',
    };
  }));
  step('Bookings', N);

  // ---- Channels (one per channel name) ----
  const chNames = ['Booking.com', 'MakeMyTrip', 'Goibibo', 'Agoda', 'Airbnb', 'Expedia', 'Travel agent', 'Corporate', 'Other'];
  const haveCh = await docs('channels');
  const newCh = chNames.filter((n) => !haveCh.some((c) => c.name === n));
  if (newCh.length) await addMany(user, 'channels', newCh.map((name, i) => ({ name, commission: [18, 20, 18, 17, 15, 18, 10, 0, 5][chNames.indexOf(name)], markup: i % 2 ? 10 : 0, active: true, notes: 'Demo channel' })));
  step('Channels', newCh.length);

  // ---- Restaurant ----
  const MENU = [
    ['Idli (2) with sambar', 'Breakfast', 80, 'Veg'], ['Masala Dosa', 'Breakfast', 120, 'Veg'], ['Ghee Pongal', 'Breakfast', 110, 'Veg'],
    ['Paneer Tikka', 'Starters', 260, 'Veg'], ['Chicken 65', 'Starters', 280, 'Non-veg'], ['Tomato Soup', 'Soups', 120, 'Veg'],
    ['Veg Meals', 'Main course', 220, 'Veg'], ['Butter Chicken', 'Main course', 340, 'Non-veg'], ['Butter Naan', 'Breads', 60, 'Veg'],
    ['Chicken Biryani', 'Rice & biryani', 300, 'Non-veg'], ['Veg Biryani', 'Rice & biryani', 240, 'Veg'], ['Gulab Jamun', 'Desserts', 90, 'Veg'],
    ['Filter Coffee', 'Beverages', 50, 'Veg'], ['Fresh Lime Soda', 'Beverages', 80, 'Veg'], ['Egg Omelette', 'Room service', 90, 'Egg'],
  ];
  const menuIds = await addMany(user, 'menuItems', MENU.map(([name, category, price, veg], i) => ({ name, category, price, gst: 5, veg, prepTime: 10 + (i % 4) * 5, hsn: '996331', available: true, description: '', cost: round2(price * 0.35), recipe: [] })));
  step('Menu items', N);
  const { orderTotals } = await import('../modules/fnb/Pos');
  const kot = await numbers(`kot-${t}`, `KOT-${t.slice(5).replace('-', '')}`, N, 3);
  await addMany(user, 'orders', range().map((i) => {
    const lines = [0, 1, 2].slice(0, 1 + (i % 3)).map((k) => { const m = MENU[(i + k * 4) % N]; return { menuId: menuIds[(i + k * 4) % N], name: m[0], price: m[2], gst: 5, qty: 1 + ((i + k) % 2), kot: 1 }; });
    const status = pick(['Settled', 'Settled', 'Settled', 'Served', 'Ready', 'Cooking', 'New'], i);
    const tt = orderTotals(lines, 0);
    return {
      number: kot[i], date: t, time: `${String(8 + (i % 13)).padStart(2, '0')}:${String((i * 7) % 60).padStart(2, '0')}`, type: i % 4 === 3 ? 'Takeaway' : 'Table',
      table: i % 4 === 3 ? '' : `T${(i % 8) + 1}`, billId: '', roomNumber: '', guestName: '', customer: i % 4 === 3 ? FIRST[i] : '',
      lines, kots: 1, status, ...tt, discount: 0, waiter: user.name || 'Staff',
      ...(status === 'Settled' ? { payments: [{ method: pick(['Cash', 'UPI', 'Card'], i), amount: tt.total }], settledAt: serverTimestamp() } : {}),
    };
  }));
  step('Restaurant orders', N);

  // ---- Stock, suppliers, purchases ----
  const STOCK = [
    ['Rice (Ponni)', 'Kitchen', 'kg', 60, 52], ['Toor dal', 'Kitchen', 'kg', 25, 140], ['Sunflower oil', 'Kitchen', 'litre', 30, 135], ['Milk', 'Kitchen', 'litre', 20, 56],
    ['Coffee powder', 'Kitchen', 'kg', 5, 620], ['Mineral water 1L', 'Bar / minibar', 'bottle', 120, 14], ['Soft drink can', 'Bar / minibar', 'pcs', 48, 30], ['Chips packet', 'Bar / minibar', 'pack', 40, 18],
    ['Shampoo sachet', 'Toiletries & amenities', 'pcs', 300, 3], ['Soap bar', 'Toiletries & amenities', 'pcs', 250, 6], ['Dental kit', 'Toiletries & amenities', 'pcs', 150, 9],
    ['Bath towel', 'Linen', 'pcs', 80, 320], ['Bedsheet (king)', 'Linen', 'pcs', 60, 650], ['Floor cleaner', 'Cleaning', 'litre', 25, 95], ['Printer paper A4', 'Stationery', 'box', 6, 280],
  ];
  const stockIds = await addMany(user, 'stockItems', STOCK.map(([name, category, unit, qty, cost], i) => ({
    name, category, unit, qty, reorderLevel: Math.round(qty * 0.3), reorderQty: Math.round(qty * 0.8), costPrice: cost, gst: category === 'Kitchen' ? 5 : 18,
    minibar: category === 'Bar / minibar', sellPrice: category === 'Bar / minibar' ? round2(cost * 2.5) : 0, location: pick(['Main store', 'Kitchen store', 'Linen room', 'Minibar store'], i), supplierName: '',
  })));
  const { addMove } = await import('../modules/stock/Inventory');
  for (const i of range()) { // eslint-disable-line no-restricted-syntax
    const [name, , unit, qty, cost] = STOCK[i];
    const type = pick(['Issue to department', 'Wastage / spoilage', 'Returned to store', 'Purchase received'], i);
    const q = type === 'Issue to department' || type === 'Wastage / spoilage' ? -Math.max(1, Math.round(qty * 0.1)) : Math.max(1, Math.round(qty * 0.2));
    await addMove(user, { id: stockIds[i], name, unit, costPrice: cost }, type, q, type === 'Issue to department' ? pick(['Kitchen', 'Housekeeping', 'Restaurant'], i) : '', 'Demo entry'); // eslint-disable-line no-await-in-loop
  }
  step('Stock items', N);
  step('Stock movements', N);

  const SUP = [
    ['Sri Murugan Traders', 'Groceries & vegetables'], ['Aavin Milk Agency', 'Meat & dairy'], ['Fresh Farm Vegetables', 'Groceries & vegetables'], ['Coastal Seafoods', 'Meat & dairy'],
    ['Bisleri Distributors', 'Beverages'], ['CleanPro Supplies', 'Cleaning'], ['Hotel Linen House', 'Linen & laundry'], ['Amenity World', 'Toiletries & amenities'],
    ['Quick Fix Electricals', 'Maintenance'], ['CoolAir AC Services', 'Services'], ['Paper Point Stationers', 'Stationery'], ['Green Laundry Services', 'Linen & laundry'],
    ['Royal Meat Mart', 'Meat & dairy'], ['Spice Route Wholesale', 'Groceries & vegetables'], ['SafeGuard Pest Control', 'Services'],
  ];
  const supIds = await addMany(user, 'suppliers', SUP.map(([name, category], i) => ({
    name, category, contact: `${pick(FIRST, i + 3)} ${pick(LAST, i + 7)}`, phone: `94440${String(10000 + i * 731).slice(0, 5)}`, email: `orders${i + 1}@example.com`,
    gstin: `33AAB${String.fromCharCode(65 + i)}${String(1000 + i * 7)}A1Z${i % 10}`.toUpperCase().slice(0, 15), terms: pick([0, 7, 15, 30], i), upi: `supplier${i + 1}@okaxis`,
    address: `${20 + i}, Industrial Estate, ${pick(CITIES, i)}`, notes: '',
  })));
  step('Suppliers', N);
  const poNo = await numbers('purchaseOrder', 'PO');
  await addMany(user, 'purchaseOrders', range().map((i) => {
    const lines = [0, 1].slice(0, 1 + (i % 2)).map((k) => { const s = STOCK[(i + k * 5) % N]; return { itemId: stockIds[(i + k * 5) % N], name: s[0], unit: s[2], qty: Math.round(s[3] * 0.5), rate: s[4], gst: s[1] === 'Kitchen' ? 5 : 18 }; });
    const sub = round2(lines.reduce((a, l) => a + l.qty * l.rate, 0));
    const gst = round2(lines.reduce((a, l) => a + (l.qty * l.rate * l.gst) / 100, 0));
    const status = pick(['Received', 'Approved', 'Ordered', 'Requested', 'Received', 'Rejected'], i);
    const date = addDays(t, -14 + i);
    return {
      number: poNo[i], supplierId: supIds[i], supplierName: SUP[i][0], date, expected: addDays(date, 3), notes: '', lines, sub, gst, total: round2(sub + gst),
      status, requestedBy: user.name || '', approvedBy: ['Approved', 'Ordered', 'Received'].includes(status) ? user.name || '' : '',
      ...(status === 'Received' ? { invoiceNo: `INV-${5100 + i}`, invoiceDate: addDays(date, 2), receivedOn: addDays(date, 2), receivedBy: user.name || '', short: false } : {}),
    };
  }));
  step('Purchase orders', N);
  await addMany(user, 'supplierPayments', range().map((i) => ({ supplierId: supIds[i], supplierName: SUP[i][0], amount: 1500 + i * 450, method: pick(['Bank Transfer', 'UPI', 'Cash', 'Cheque'], i), ref: `TXN${88000 + i}`, date: addDays(t, -12 + i) })));
  step('Supplier payments', N);

  // ---- Operations ----
  const roomNo = (i) => rooms[i % rooms.length]?.roomNumber || '';
  await addMany(user, 'hkTasks', range().map((i) => {
    const type = pick(['Check-out clean', 'Daily service', 'Deep clean', 'Turndown', 'Inspection'], i);
    const list = type === 'Check-out clean' || type === 'Deep clean' ? ['Change linen', 'Clean bathroom', 'Vacuum floor', 'Restock amenities', 'Check minibar'] : ['Make bed', 'Replace towels', 'Clean bathroom', 'Empty bins'];
    const status = pick(['Open', 'In progress', 'Done', 'Inspected'], i);
    return { roomNumber: roomNo(i), type, priority: pick(['Normal', 'High', 'Low'], i), date: t, notes: i % 4 === 0 ? 'Guest asked for extra towels' : '', status, checklist: list.map((text) => ({ text, done: status === 'Done' || status === 'Inspected' })) };
  }));
  step('Housekeeping tasks', N);
  const tkNo = await numbers('ticket', 'MT');
  const tCats = ['AC', 'Plumbing', 'Electrical', 'TV / Wi-Fi', 'Furniture', 'Lock / key card', 'Hot water', 'Pest control', 'Painting', 'Other'];
  const tDesc = ['AC not cooling', 'Tap leaking in bathroom', 'Bedside lamp not working', 'Wi-Fi keeps dropping', 'Wardrobe door loose', 'Key card not opening', 'No hot water in shower', 'Ants near window', 'Paint peeling near window', 'Curtain rail broken'];
  await addMany(user, 'tickets', range().map((i) => {
    const status = pick(['Open', 'Assigned', 'In progress', 'Waiting for parts', 'Resolved'], i);
    return {
      number: tkNo[i], roomNumber: i % 5 === 4 ? '' : roomNo(i + 3), area: i % 5 === 4 ? pick(['Lobby', 'Kitchen', 'Lift', 'Restaurant'], i) : '', category: pick(tCats, i), priority: pick(['Normal', 'High', 'Urgent', 'Low'], i),
      description: pick(tDesc, i), outOfOrder: false, vendor: i % 3 === 0 ? 'Quick Fix Electricals' : '', status, cost: status === 'Resolved' ? 400 + i * 50 : 0,
      resolution: status === 'Resolved' ? 'Fixed and tested' : '', reportedOn: addDays(t, -i), reportedBy: user.name || '', ...(status === 'Resolved' ? { resolvedOn: t } : {}),
    };
  }));
  step('Repair tickets', N);
  const PM = ['AC servicing', 'Water tank cleaning', 'Generator service', 'Fire extinguisher check', 'Pest control', 'Lift AMC visit', 'CCTV check', 'Geyser descaling', 'Kitchen exhaust cleaning', 'RO filter change', 'Mattress flipping', 'Curtain dry-cleaning', 'Electrical panel check', 'Swimming pool chemicals', 'Painting touch-up'];
  await addMany(user, 'pmTasks', PM.map((task, i) => ({ task, area: i % 2 ? 'All rooms' : 'Common areas', everyDays: pick([30, 60, 90, 180], i), lastDone: addDays(t, -10 - i * 6), vendor: i % 3 === 0 ? 'CoolAir AC Services' : '', assetName: '', notes: '' })));
  step('Preventive maintenance', N);
  const lfNo = await numbers('lostfound', 'LF');
  const LF = ['Phone charger', 'Sunglasses', 'Wristwatch', 'Umbrella', 'Book', 'Earphones', 'Gold ring', 'Shirt', 'Water bottle', 'Laptop charger', 'Kids toy', 'Wallet', 'Power bank', 'Scarf', 'Spectacles'];
  await addMany(user, 'lostFound', LF.map((item, i) => {
    const status = pick(['Stored', 'Guest contacted', 'Returned', 'Stored', 'Disposed / donated'], i);
    return { number: lfNo[i], item, roomNumber: roomNo(i + 1), place: '', foundOn: addDays(t, -i * 2), guestName: `${FIRST[(i + 2) % N]} ${LAST[(i + 2) % N]}`, storedAt: 'Front desk locker', value: ['Gold ring', 'Wristwatch', 'Wallet'].includes(item) ? 'Yes – keep in safe' : 'No', status, returnedTo: status === 'Returned' ? 'Guest in person' : '', returnedOn: ['Returned', 'Disposed / donated'].includes(status) ? t : '', description: '' };
  }));
  step('Lost & found', N);
  const AS = [['Daikin 1.5 ton AC', 'Air conditioner'], ['Samsung 43" TV', 'Television'], ['Godrej minibar', 'Refrigerator / minibar'], ['Racold geyser 25L', 'Geyser'], ['King bed', 'Furniture'], ['Sleepwell mattress', 'Mattress'], ['Commercial mixer', 'Kitchen equipment'], ['IFB washing machine', 'Laundry equipment'], ['Kirloskar generator', 'Generator / UPS'], ['Johnson lift', 'Lift'], ['Hikvision CCTV set', 'CCTV / security'], ['HP laptop (front desk)', 'Computer / printer'], ['Canon printer', 'Computer / printer'], ['Office chair', 'Furniture'], ['Microwave oven', 'Kitchen equipment']];
  await addMany(user, 'assets', AS.map(([name, category], i) => ({ name, category, roomNumber: i < 6 ? roomNo(i) : '', location: i < 6 ? '' : pick(['Kitchen', 'Laundry', 'Basement', 'Front desk', 'Office'], i), serialNo: `SN${240100 + i * 13}`, vendor: pick(['Croma', 'Reliance Digital', 'Local dealer'], i), purchaseDate: addDays(t, -200 - i * 30), cost: 5000 + i * 3500, warrantyUntil: addDays(t, -60 + i * 40), condition: pick(['Good', 'Good', 'Fair', 'Needs repair'], i), notes: '' })));
  step('Assets', N);

  // ---- Team (workers without a login) ----
  const STAFF = [['Ravi Kumar', 'Receptionist', 'Front office'], ['Selvi M', 'Housekeeper', 'Housekeeping'], ['Murugan S', 'Housekeeper', 'Housekeeping'], ['Anitha R', 'Receptionist', 'Front office'], ['Joseph D', 'Chef', 'Kitchen'], ['Ganesh P', 'Cook', 'Kitchen'], ['Fathima B', 'Steward', 'Restaurant'], ['Suresh K', 'Waiter', 'Restaurant'], ['Ramesh V', 'Electrician', 'Maintenance'], ['Bala T', 'Plumber', 'Maintenance'], ['Kumar A', 'Security guard', 'Security'], ['Deepa N', 'Accountant', 'Accounts'], ['Prakash J', 'Night auditor', 'Front office'], ['Revathi L', 'Laundry attendant', 'Housekeeping'], ['Mani G', 'Driver', 'Other']];
  const staffIds = await addMany(user, 'payProfiles', STAFF.map(([name, designation, department], i) => ({
    name, designation, department, joinDate: addDays(t, -400 + i * 20), basic: 9000 + i * 600, hra: 2000 + i * 100, allowance: 1000, pt: null, pf: true, esi: 9000 + i * 600 + 3000 <= 21000,
    uan: `1009${String(1000000 + i * 4321).slice(0, 8)}`, esiNo: '', pan: '', bank: `staff${i + 1}@okhdfc`, phone: `90030${String(10000 + i * 913).slice(0, 5)}`, active: true, hasLogin: false,
  })));
  step('Staff (pay profiles)', N);
  await addMany(user, 'attendance', range().map((i) => {
    const status = pick(['Present', 'Present', 'Late', 'Present', 'Half day', 'Leave', 'Week off'], i);
    const working = ['Present', 'Late', 'Half day'].includes(status);
    const inT = status === 'Late' ? '09:25' : '08:55'; const outT = status === 'Half day' ? '13:00' : '17:30';
    return { personId: staffIds[i], name: STAFF[i][0], date: t, status, in: working ? inT : '', out: working ? outT : '', hours: working ? (status === 'Half day' ? 4.08 : status === 'Late' ? 8.08 : 8.58) : 0, note: '', by: 'owner' };
  }), (r) => `${r.date}_${r.personId}`);
  step('Attendance (today)', N);
  const SH = [{ name: 'Morning', start: '06:00', end: '14:00' }, { name: 'General', start: '09:00', end: '18:00' }, { name: 'Evening', start: '14:00', end: '22:00' }, { name: 'Night', start: '22:00', end: '06:00' }];
  await addMany(user, 'shifts', range().map((i) => { const s = pick(SH, i); return { date: t, personId: staffIds[i], name: STAFF[i][0], off: i % 7 === 6, shiftName: i % 7 === 6 ? 'Off' : s.name, start: i % 7 === 6 ? '' : s.start, end: i % 7 === 6 ? '' : s.end }; }), (r) => `${r.date}_${r.personId}`);
  step('Shifts (today)', N);
  await addMany(user, 'leaves', range().map((i) => {
    const from = addDays(t, -5 + i * 2); const days = 1 + (i % 3);
    return { personId: staffIds[i], name: STAFF[i][0], type: pick(['Casual leave', 'Sick leave', 'Earned leave', 'Unpaid leave', 'Comp off'], i), from, to: addDays(from, days - 1), days, reason: pick(['Family function', 'Fever', 'Travel to native', 'Personal work', 'Child’s school event'], i), status: pick(['Pending', 'Approved', 'Approved', 'Rejected'], i), requestedOn: addDays(from, -3) };
  }));
  step('Leave requests', N);
  await addMany(user, 'salaryAdvances', range().map((i) => ({ personId: staffIds[i], name: STAFF[i][0], amount: 2000 + i * 500, installment: 1000 + (i % 3) * 500, recovered: i % 3 === 0 ? 1000 : 0, date: addDays(t, -i * 3), note: pick(['Medical', 'Festival', 'School fees', 'Rent'], i) })));
  step('Salary advances', N);

  // ---- Guests: feedback, campaigns, loyalty ----
  const COMMENTS = ['Lovely stay, very clean room.', 'Staff were very helpful.', 'Breakfast could have more variety.', 'Great value for money!', 'AC was a bit noisy.', 'Will definitely come back.', 'Check-in was quick and smooth.', 'Room service was slow.', 'Excellent food at the restaurant.', 'Bathroom needed better cleaning.', 'Very comfortable beds.', 'Wi-Fi was weak in the room.', 'Friendly front desk team.', 'Good location, near the station.', 'Perfect for a business trip.'];
  await addMany(user, 'feedback', bills.map((b, i) => {
    const rating = pick([5, 4, 5, 3, 4, 5, 2, 4], i);
    return { billId: b.id, invoiceNumber: b.invoiceNumber, guestId: b.guestId || null, guestName: b.guestName, roomNumber: b.roomNumber, rating, topics: { cleanliness: Math.min(5, rating + (i % 2)), staff: 5, food: Math.max(1, rating - 1), comfort: rating, value: rating }, comment: COMMENTS[i % COMMENTS.length], source: i % 3 === 0 ? 'Guest link' : 'Front desk', date: b.checkOut <= t ? b.checkOut : t, status: pick(['New', 'Replied', 'Closed'], i) };
  }));
  step('Feedback', N);
  const CAMP = ['Monsoon getaway — 20% off', 'Diwali family package', 'Birthday wishes', 'Anniversary special', 'Weekend staycation', 'Corporate rates 2026', 'Come back soon', 'New restaurant menu', 'Pongal offer', 'Christmas & New Year', 'Summer holidays', 'Loyalty double points', 'Refer a friend', 'Wedding season blocks', 'Thank you for staying'];
  await addMany(user, 'campaigns', CAMP.map((name, i) => {
    const channel = pick(['email', 'whatsapp', 'sms'], i);
    const sent = i % 3 !== 2;
    return { name, channel, segment: pick(['all', 'vip', 'birthday', 'anniversary', 'recent', 'lapsed', 'repeat', 'points', 'corporate'], i), subject: channel === 'email' ? name : '', body: `Hello {first}, ${name.toLowerCase()} at {hotel}. Call us to book!`, status: sent ? 'Sent' : 'Draft', ...(sent ? { sentCount: 5 + i, sentAt: addDays(t, -i) } : {}) };
  }));
  step('Campaigns', N);
  const { adjustPoints } = await import('../modules/billOps');
  for (const i of range()) { // eslint-disable-line no-restricted-syntax
    await adjustPoints(user, guests[i], pick([50, 100, 25, 200, 75], i), pick(['Welcome bonus', 'Referral bonus', 'Birthday bonus', 'Feedback reward', 'Goodwill'], i)); // eslint-disable-line no-await-in-loop
  }
  step('Loyalty points', N);

  // ---- Finance ----
  const expNo = await numbers('expense', 'EXP');
  const EXP = [['Electricity', 'TNEB', 18500, 0], ['Water', 'Metro Water', 2400, 0], ['Gas / fuel', 'Indane', 6200, 5], ['Internet & phone', 'Airtel', 3500, 18], ['Rent', 'Building owner', 60000, 18], ['Repairs & maintenance', 'Quick Fix Electricals', 2800, 18], ['Laundry', 'Green Laundry Services', 5400, 18], ['Housekeeping supplies', 'CleanPro Supplies', 3900, 18], ['Kitchen & groceries', 'Sri Murugan Traders', 12500, 5], ['Marketing & OTA commission', 'Booking.com', 8800, 18], ['Travel & transport', 'Ola', 950, 5], ['Bank charges', 'HDFC Bank', 350, 18], ['Professional fees', 'CA firm', 7500, 18], ['Licences & taxes', 'Corporation', 4200, 0], ['Electricity', 'TNEB', 17900, 0]];
  await addMany(user, 'expenses', EXP.map(([category, vendor, amount, gstRate], i) => {
    const gstAmount = round2((amount * gstRate) / 100);
    return { number: expNo[i], date: addDays(t, -i * 2), category, vendor, invoiceNo: `B-${2200 + i}`, amount, gstRate, gstAmount, total: round2(amount + gstAmount), itc: gstRate > 0 && i % 4 !== 2, vendorGstin: gstRate > 0 ? `33AACC${String(1000 + i)}K1Z${i % 10}`.slice(0, 15) : '', method: pick(['Bank Transfer', 'UPI', 'Cash', 'Card'], i), description: '' };
  }));
  step('Expenses', N);
  const cnNo = await numbers('creditNote', 'CN');
  await addMany(user, 'creditNotes', bills.map((b, i) => {
    const rate = (b.taxes || []).reduce((a, x) => a + Number(x.rate || 0), 0);
    const total = round2(Math.min(b.grandTotal, Math.max(100, Math.round(b.grandTotal * 0.05))));
    let taxable = round2(total / (1 + rate / 100));
    const taxLines = (b.taxes || []).map((x) => ({ name: x.name, rate: Number(x.rate), amount: round2((taxable * Number(x.rate)) / 100) }));
    taxable = round2(total - taxLines.reduce((a, x) => a + x.amount, 0));
    const refund = i % 3 === 0 && Number(b.paidAmount) >= total;
    return {
      number: cnNo[i], date: t, billId: b.id, invoiceNumber: b.invoiceNumber, invoiceDate: b.billDate, guestId: b.guestId || null, guestName: b.guestName, guestGstin: b.guest?.gstin || '', roomNumber: b.roomNumber,
      reason: pick(['Overcharged', 'Service not provided', 'Early check-out', 'Discount after billing', 'Other'], i), note: 'Demo entry', taxable, taxLines, total, status: 'Issued',
      ...(refund ? { refundAmount: total, refundMethod: 'UPI', refundRef: `RF${3300 + i}`, refundDate: t } : {}),
    };
  }));
  step('Credit notes', N);

  await saveSettings(user, { demoLoadedAt: new Date().toISOString() }, 'DEMO_DATA_LOADED');
  return done;
}
