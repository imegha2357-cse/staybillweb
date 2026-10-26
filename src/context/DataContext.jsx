// Live, small reference data shared by the whole app: hotel settings, taxes,
// room types and rooms. Kept in sync with Firestore via onSnapshot.
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onSnapshot, query, where } from '../backend/firestore';
import { hcol, hdoc } from '../lib/scope';
import { DEFAULT_SETTINGS } from '../lib/db';
import { setCurrency } from '../lib/format';
import { applyBrand, DEFAULT_BRAND } from '../lib/palettes';
import { useAuth } from './AuthContext';
import { moduleAccess } from '../modules/registry';

const DataCtx = createContext(null);

const sortRooms = (a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });

export function DataProvider({ children }) {
  const { user, isAdmin, hotelId, hotel, role } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [taxes, setTaxes] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [outstanding, setOutstanding] = useState([]);
  const [ready, setReady] = useState(false);

  // Hotel-wide brand colours.
  const brandKey = JSON.stringify(settings.brand || DEFAULT_BRAND);
  useEffect(() => { applyBrand(JSON.parse(brandKey)); }, [brandKey]);

  useEffect(() => {
    setReady(false);
    setSettings(DEFAULT_SETTINGS); setTaxes([]); setRoomTypes([]); setRooms([]); setOutstanding([]);
    if (!user || !hotelId) return undefined;
    let pending = 4;
    const done = () => { pending -= 1; if (pending <= 0) setReady(true); };
    const once = (fn) => { let called = false; return (...a) => { fn(...a); if (!called) { called = true; done(); } }; };
    const unsubs = [
      onSnapshot(hdoc('settings', 'hotel', hotelId), once((s) => {
        const data = { ...DEFAULT_SETTINGS, ...(s.data() || {}) };
        data.permissions = { ...DEFAULT_SETTINGS.permissions, ...(data.permissions || {}) };
        setCurrency(data.currency);
        setSettings(data);
      }), once(() => {})),
      onSnapshot(hcol('taxes', hotelId), once((s) => setTaxes(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name)))), once(() => {})),
      onSnapshot(hcol('roomTypes', hotelId), once((s) => setRoomTypes(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name)))), once(() => {})),
      onSnapshot(hcol('rooms', hotelId), once((s) => setRooms(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(sortRooms))), once(() => {})),
      // Live list of unpaid / partially paid bills (header bell + fast-collect queue)
      onSnapshot(query(hcol('bills', hotelId), where('paymentStatus', 'in', ['PENDING', 'PARTIALLY_PAID'])),
        (s) => setOutstanding(s.docs.map((d) => ({ id: d.id, ...d.data() }))), () => {}),
    ];
    return () => unsubs.forEach((u) => u());
  }, [user?.uid, hotelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const can = useMemo(() => {
    const p = settings.permissions || {};
    return {
      editBills: isAdmin || !!p.receptionistCanEditBills,
      cancelBills: isAdmin || !!p.receptionistCanCancelBills,
      viewReports: isAdmin || !!p.receptionistCanViewReports,
      manageRooms: isAdmin || !!p.receptionistCanManageRooms,
      settings: isAdmin,
      users: isAdmin,
    };
  }, [settings, isAdmin]);

  const activeTaxes = useMemo(() => taxes.filter((t) => t.status === 'active'), [taxes]);
  const mods = useMemo(() => moduleAccess({ role, isAdmin, settings, planModules: hotel?.planModules || null, can }), [role, isAdmin, settings, hotel, can]);

  return (
    <DataCtx.Provider value={{ settings, taxes, activeTaxes, roomTypes, rooms, outstanding, ready, can, mods }}>
      {children}
    </DataCtx.Provider>
  );
}

export const useData = () => useContext(DataCtx);
