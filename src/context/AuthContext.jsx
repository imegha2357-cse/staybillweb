// Who is signed in, their role and which hotel they are working in.
//   admin    – runs the StayBill site: adds hotels and their owners
//   owner    – runs one hotel: settings, rooms, reports and employee logins
//   employee – front desk of one hotel (what they may do is set by the owner)
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from '../backend/auth';
import { doc, onSnapshot } from '../backend/firestore';
import { auth, db } from '../firebase';
import { logAudit, loginEmail } from '../lib/db';
import { setHotelId } from '../lib/scope';
import { HOSTED, IN_CLAUDE, claudeUse } from '../platform';
import { getStore } from '../hosted/store';

const AuthCtx = createContext(null);
const ADMIN_HOTEL = 'staybill-admin-hotel';

export function AuthProvider({ children }) {
  const [fbUser, setFbUser] = useState(undefined); // undefined = loading
  const [profile, setProfile] = useState(null);
  const [setupDone, setSetupDone] = useState(null);
  const [hotel, setHotel] = useState(null);
  const [blocked, setBlocked] = useState(false); // claude.ai viewer signed out
  const [error, setError] = useState('');
  const [adminHotel, setAdminHotelState] = useState(() => { try { return sessionStorage.getItem(ADMIN_HOTEL) || null; } catch { return null; } });

  useEffect(() => {
    if (!HOSTED) return;
    getStore().catch((e) => { if (e?.code === 'signed-out') setBlocked('signed-out'); });
    // On claude.ai, reading and writing hotel data needs the page shared with you for contributing.
    if (IN_CLAUDE) {
      claudeUse('user').then(async (u) => {
        if (!u) return;
        let ok = null;
        try { ok = await u.can('data.write'); } catch { ok = null; }
        if (ok === false) setBlocked('no-access');
      });
    }
  }, []);

  useEffect(() => onAuthStateChanged(auth, (u) => {
    setFbUser(u);
    if (!u) { setProfile(null); setHotel(null); }
  }), []);

  // Has the site administrator been created yet?
  useEffect(() => onSnapshot(doc(db, 'meta', 'platform'), (s) => setSetupDone(s.exists()), (e) => {
    // On claude.ai a viewer the page is not shared with (for editing) cannot read the hotel data.
    if (HOSTED && e?.code === 'signed-out') setBlocked('signed-out');
    else setSetupDone(false);
  }), []);

  useEffect(() => {
    if (!fbUser) return undefined;
    setProfile(null);
    return onSnapshot(doc(db, 'users', fbUser.uid),
      (snap) => {
        if (!snap.exists()) { setProfile({ missing: true }); return; }
        const p = { uid: fbUser.uid, id: fbUser.uid, ...snap.data() };
        if (p.status !== 'active') {
          setError('Your login has been switched off. Please contact your hotel owner or the site administrator.');
          signOut(auth);
          return;
        }
        setProfile(p);
      },
      () => setProfile({ missing: true }));
  }, [fbUser]);

  const role = profile && !profile.missing ? profile.role : null;
  const hotelId = role === 'admin' ? adminHotel : profile?.hotelId || null;

  // The hotel record (name, suspended or not).
  useEffect(() => {
    if (!hotelId) { setHotel(null); return undefined; }
    return onSnapshot(doc(db, 'hotels', hotelId), (s) => setHotel(s.exists() ? { id: s.id, ...s.data() } : { id: hotelId, missing: true }), () => setHotel({ id: hotelId, missing: true }));
  }, [hotelId]);

  useEffect(() => {
    if (role && role !== 'admin' && hotel && (hotel.missing || hotel.status === 'suspended')) {
      setError(hotel.missing ? 'Your hotel could not be found. Please contact the site administrator.' : hotel.pausedForBilling ? 'This hotel’s StayBill subscription payment is overdue, so access is paused. Please pay or contact the site administrator to switch it back on.' : 'This hotel’s StayBill access is paused. Please contact the site administrator.');
      signOut(auth);
    }
  }, [role, hotel]);

  // Every hotel-scoped read and write uses this hotel.
  setHotelId(hotelId);

  const setAdminHotel = useCallback((hid) => {
    try { if (hid) sessionStorage.setItem(ADMIN_HOTEL, hid); else sessionStorage.removeItem(ADMIN_HOTEL); } catch { /* ignore */ }
    setAdminHotelState(hid || null);
  }, []);

  async function login(username, password) {
    setError('');
    const cred = await signInWithEmailAndPassword(auth, loginEmail(username), password);
    setTimeout(() => logAudit({ uid: cred.user.uid, name: username }, 'LOGIN', 'user', cred.user.uid, {}), 1500);
  }
  async function logout() {
    setAdminHotel(null);
    await signOut(auth);
  }

  const user = profile && !profile.missing ? profile : null;
  const loading = fbUser === undefined || setupDone === null || (fbUser && !profile) || (user && hotelId && !hotel);
  const value = useMemo(() => ({
    fbUser, user, loading, setupDone, blocked, profileMissing: !!profile?.missing, error, setError, login, logout,
    role,
    hotelId,
    hotel,
    isSiteAdmin: role === 'admin',
    isOwner: role === 'owner' || (role === 'admin' && !!hotelId),
    isEmployee: role === 'employee',
    // "Admin" inside a hotel = can manage it (its owner, or the site administrator visiting it).
    isAdmin: role === 'owner' || (role === 'admin' && !!hotelId),
    adminHotel, setAdminHotel,
  }), [fbUser, user, loading, setupDone, blocked, profile, error, role, hotelId, hotel, adminHotel, setAdminHotel]); // eslint-disable-line react-hooks/exhaustive-deps

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
