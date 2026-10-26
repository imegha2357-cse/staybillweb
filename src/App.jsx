import { Suspense, lazy, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { MODULES } from './modules/registry';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider, useData } from './context/DataContext';
import { AppearanceProvider } from './context/AppearanceContext';
import { ToastProvider, ConfirmProvider, Loading, Button } from './components/ui';
import Layout from './components/Layout';
import Login, { Setup, HostedSignedOut } from './pages/Login';
import AdminHome from './pages/AdminHome';
import Welcome from './pages/Welcome';
import Home from './pages/Home';
import Bills from './pages/Bills';
import BillForm from './pages/BillForm';
import BillDetail from './pages/BillDetail';
import Guests from './pages/Guests';
import GuestDetail from './pages/GuestDetail';
import Rooms from './pages/Rooms';
import BatchPrint from './pages/BatchPrint';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import NotFound from './pages/NotFound';
import { CelebrationLayer } from './motion/hotel';

// Modules load on first use, so the core billing app stays fast.
const M = {
  bookings: lazy(() => import('./modules/front/Bookings')),
  roomboard: lazy(() => import('./modules/front/RoomBoard')),
  nightaudit: lazy(() => import('./modules/front/NightAudit')),
  channels: lazy(() => import('./modules/front/Channels')),
  website: lazy(() => import('./modules/front/Website')),
  pos: lazy(() => import('./modules/fnb/Pos')),
  kitchen: lazy(() => import('./modules/fnb/Kitchen')),
  menu: lazy(() => import('./modules/fnb/Menu')),
  housekeeping: lazy(() => import('./modules/ops/Housekeeping')),
  maintenance: lazy(() => import('./modules/ops/Maintenance')),
  lostfound: lazy(() => import('./modules/ops/LostFound')),
  assets: lazy(() => import('./modules/ops/Assets')),
  inventory: lazy(() => import('./modules/stock/Inventory')),
  purchases: lazy(() => import('./modules/stock/Purchases')),
  suppliers: lazy(() => import('./modules/stock/Suppliers')),
  attendance: lazy(() => import('./modules/team/Attendance')),
  shifts: lazy(() => import('./modules/team/Shifts')),
  payroll: lazy(() => import('./modules/team/Payroll')),
  feedback: lazy(() => import('./modules/guests/Feedback')),
  campaigns: lazy(() => import('./modules/guests/Campaigns')),
  loyalty: lazy(() => import('./modules/guests/Loyalty')),
  accounts: lazy(() => import('./modules/finance/Accounts')),
  expenses: lazy(() => import('./modules/finance/Expenses')),
  gst: lazy(() => import('./modules/finance/Gst')),
  creditnotes: lazy(() => import('./modules/finance/CreditNotes')),
  analytics: lazy(() => import('./modules/insights/Analytics')),
};

const PublicBooking = lazy(() => import('./pages/public/PublicBooking'));
const PublicFeedback = lazy(() => import('./pages/public/PublicFeedback'));
const Signup = lazy(() => import('./pages/public/Signup'));
const AdminPlans = lazy(() => import('./pages/AdminPlans'));

/** Pages guests open without signing in. */
// (/feedback alone is the staff Feedback module; the guest link has three more parts.)
const PUBLIC = /^\/(book\/[^/]+|feedback\/[^/]+\/[^/]+\/[^/]+|signup)\/?$/;
function PublicRoutes() {
  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <Routes>
        <Route path="book/:hotelId" element={<PublicBooking />} />
        <Route path="feedback/:hotelId/:billId/:token" element={<PublicFeedback />} />
        <Route path="signup" element={<Signup />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

function Guard({ allow, children }) {
  return allow ? children : <NotFound locked />;
}

function AppRoutes() {
  const { fbUser, user, loading, profileMissing, setupDone, blocked, logout, isSiteAdmin, hotelId } = useAuth();
  const { can, ready, mods } = useData();
  const loc = useLocation();
  // Signed-out visitors see the public home page first; "Sign in" opens the form.
  const [signingIn, setSigningIn] = useState(false);

  if (PUBLIC.test(loc.pathname) && blocked !== 'signed-out') return <PublicRoutes />;
  if (blocked) return <HostedSignedOut reason={blocked} />;
  if (setupDone === null || fbUser === undefined) return <Loading label="Starting StayBill…" />;
  if (!setupDone && !fbUser) return <Setup />;
  if (!fbUser) return signingIn || loc.pathname === '/login' ? <Login onBack={() => setSigningIn(false)} /> : <Welcome onEnter={() => setSigningIn(true)} ctaLabel="Sign in" />;
  if (profileMissing) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <Loading label="Checking your login…" />
        <p className="max-w-sm text-body-md text-on-surface-variant">This login is not linked to a StayBill hotel. Ask your hotel owner or the site administrator to add you.</p>
        <Button variant="secondary" onClick={logout}>Sign out</Button>
      </div>
    );
  }
  if (loading || !user) return <Loading label="Opening StayBill…" />;

  // Site administrator, not inside a hotel: the administrator console.
  if (isSiteAdmin && !hotelId) {
    return (
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<AdminHome />} />
          <Route path="hotels" element={<AdminHome tab="hotels" />} />
          <Route path="people" element={<AdminHome tab="people" />} />
          <Route path="plans" element={<Suspense fallback={<Loading label="Opening plans…" />}><AdminPlans /></Suspense>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    );
  }
  if (!ready) return <Loading label="Loading hotel data…" />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="welcome" element={<Navigate to="/" replace />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="login" element={<Navigate to="/" replace />} />
        <Route path="bills" element={<Bills />} />
        <Route path="bills/new" element={<BillForm />} />
        <Route path="bills/:id" element={<BillDetail />} />
        <Route path="bills/:id/edit" element={<Guard allow={can.editBills}><BillForm /></Guard>} />
        <Route path="guests" element={<Guests />} />
        <Route path="guests/:id" element={<GuestDetail />} />
        <Route path="rooms" element={<Guard allow={can.manageRooms}><Rooms /></Guard>} />
        <Route path="payments" element={<Navigate to="/bills#collect" replace />} />
        <Route path="print" element={<BatchPrint />} />
        <Route path="reports" element={<Guard allow={can.viewReports}><Reports /></Guard>} />
        <Route path="settings" element={<Guard allow={can.settings}><Settings /></Guard>} />
        {MODULES.filter((m) => M[m.id]).map((m) => {
          const C = M[m.id];
          return <Route key={m.id} path={m.path.slice(1)} element={<Guard allow={mods[m.id]}><Suspense fallback={<Loading label={`Opening ${m.label}…`} />}><C /></Suspense></Guard>} />;
        })}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AppearanceProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <DataProvider>
              <AppRoutes />
              <CelebrationLayer />
            </DataProvider>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </AppearanceProvider>
  );
}
