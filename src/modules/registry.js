// Every StayBill module, how it groups in the top menu, and who may use it.
// staff: employees can use it by default; owners can change this per module in
// Settings → Modules. owner: owners (and the administrator) only, unless allowed.

export const GROUPS = [
  { id: 'front', label: 'Front desk', icon: 'concierge' },
  { id: 'fnb', label: 'Restaurant', icon: 'restaurant' },
  { id: 'ops', label: 'Operations', icon: 'cleaning_services' },
  { id: 'team', label: 'Team', icon: 'badge' },
  { id: 'guests', label: 'Guests', icon: 'favorite' },
  { id: 'finance', label: 'Finance', icon: 'account_balance' },
];

/** core: always on (the billing system itself). */
export const MODULES = [
  // Front desk
  { id: 'newbill', group: 'front', label: 'New Bill', icon: 'receipt_long', path: '/bills/new', core: true, staff: true, end: true },
  { id: 'bills', group: 'front', label: 'Bills & Payments', icon: 'payments', path: '/bills', core: true, staff: true },
  { id: 'bookings', group: 'front', label: 'Bookings', icon: 'event_available', path: '/bookings', staff: true, desc: 'Reservations, availability calendar, advance payments, groups, no-shows and cancellations.' },
  { id: 'roomboard', group: 'front', label: 'Room board', icon: 'grid_view', path: '/front-office', staff: true, desc: 'Live room status, arrivals, departures, in-house guests, room moves and the Form C register.' },
  { id: 'nightaudit', group: 'front', label: 'Night audit', icon: 'nightlight', path: '/night-audit', staff: false, desc: 'Close the day: summary, unpaid check-outs, and lock the day’s bills.' },
  { id: 'channels', group: 'front', label: 'Channels & OTAs', icon: 'travel_explore', path: '/channels', staff: false, desc: 'Booking.com, MakeMyTrip, Airbnb and others: commissions, calendar sync and rate sheets.' },
  { id: 'website', group: 'front', label: 'Booking website', icon: 'language', path: '/website', staff: false, desc: 'Your own booking page: guests choose dates and rooms and send a request, with no commission.' },
  { id: 'rooms', group: 'front', label: 'Rooms & Tariffs', icon: 'meeting_room', path: '/rooms', core: true, perm: 'receptionistCanManageRooms' },
  // Restaurant
  { id: 'pos', group: 'fnb', label: 'Restaurant POS', icon: 'point_of_sale', path: '/pos', staff: true, desc: 'Table, room-service and takeaway orders, KOTs, split bills and charge to room.' },
  { id: 'kitchen', group: 'fnb', label: 'Kitchen display', icon: 'soup_kitchen', path: '/kitchen', staff: true, desc: 'Live order queue for the kitchen: new, cooking, ready.' },
  { id: 'menu', group: 'fnb', label: 'Menu & recipes', icon: 'menu_book', path: '/menu', staff: false, desc: 'Menu items, prices, GST, recipe costing and margins.' },
  // Operations
  { id: 'housekeeping', group: 'ops', label: 'Housekeeping', icon: 'cleaning_services', path: '/housekeeping', staff: true, desc: 'Cleaning tasks created at check-out, room checklists, linen and room-ready sign-off.' },
  { id: 'maintenance', group: 'ops', label: 'Maintenance', icon: 'build', path: '/maintenance', staff: true, desc: 'Repair tickets per room, out-of-order rooms and the preventive schedule.' },
  { id: 'lostfound', group: 'ops', label: 'Lost & found', icon: 'search_check', path: '/lost-found', staff: true, desc: 'Items found in rooms and who they were returned to.' },
  { id: 'assets', group: 'ops', label: 'Assets', icon: 'chair', path: '/assets', staff: false, desc: 'Asset register with locations, costs and warranty dates.' },
  // Stock (shown under Operations)
  { id: 'inventory', group: 'ops', label: 'Inventory', icon: 'inventory_2', path: '/inventory', staff: true, desc: 'Stock items, issues, wastage, minibar, low-stock alerts and stock-taking.' },
  { id: 'purchases', group: 'ops', label: 'Purchases', icon: 'shopping_cart', path: '/purchases', staff: true, desc: 'Purchase requests and orders, owner approval, goods received and supplier invoices.' },
  { id: 'suppliers', group: 'ops', label: 'Suppliers', icon: 'local_shipping', path: '/suppliers', staff: false, desc: 'Supplier directory, payables, payments and price history.' },
  // Team
  { id: 'attendance', group: 'team', label: 'Attendance', icon: 'schedule', path: '/attendance', staff: true, desc: 'Clock in and out, daily register, late and absent report.' },
  { id: 'shifts', group: 'team', label: 'Shifts & leave', icon: 'calendar_month', path: '/shifts', staff: true, desc: 'Weekly roster, leave requests and approvals.' },
  { id: 'payroll', group: 'team', label: 'Payroll', icon: 'request_quote', path: '/payroll', staff: false, desc: 'Salary structures, advances, PF/ESI, monthly payslips and the salary register.' },
  // Guests
  { id: 'guests', group: 'guests', label: 'Guest CRM', icon: 'hotel', path: '/guests', core: true, staff: true },
  { id: 'feedback', group: 'guests', label: 'Feedback', icon: 'reviews', path: '/feedback', staff: true, desc: 'Ratings and comments after check-out.' },
  { id: 'campaigns', group: 'guests', label: 'Campaigns', icon: 'campaign', path: '/campaigns', staff: false, desc: 'Email, WhatsApp and SMS campaigns to guest segments, plus automatic messages.' },
  { id: 'loyalty', group: 'guests', label: 'Loyalty', icon: 'loyalty', path: '/loyalty', staff: true, desc: 'Points, tiers, redemption on bills and referral codes.' },
  // Finance
  { id: 'reports', group: 'finance', label: 'Sales reports', icon: 'bar_chart', path: '/reports', core: true, perm: 'receptionistCanViewReports' },
  { id: 'accounts', group: 'finance', label: 'Accounts', icon: 'account_balance', path: '/accounts', staff: false, desc: 'Ledger, trial balance, profit & loss, balance sheet and cash book.' },
  { id: 'expenses', group: 'finance', label: 'Expenses', icon: 'receipt', path: '/expenses', staff: false, desc: 'Day-to-day expenses with GST input credit.' },
  { id: 'gst', group: 'finance', label: 'GST & e-invoice', icon: 'gavel', path: '/gst', staff: false, desc: 'GSTR-1, GSTR-3B, e-invoice JSON and Tally / Zoho exports.' },
  { id: 'creditnotes', group: 'finance', label: 'Credit notes & refunds', icon: 'assignment_return', path: '/credit-notes', staff: false, desc: 'Credit notes against bills and refunds to guests.' },
  // Insights
  { id: 'analytics', group: 'finance', label: 'Analytics', icon: 'insights', path: '/analytics', staff: false, desc: 'Occupancy, ADR, RevPAR, trends, channel mix, forecast and staff performance.' },
];

export const MODULE_IDS = MODULES.filter((m) => !m.core).map((m) => m.id);
export const moduleById = (id) => MODULES.find((m) => m.id === id);

/**
 * What this person can open.
 * settings.modules: { [id]: false } switches a module off for the hotel.
 * settings.staffAccess: { [id]: true|false } overrides the employee default.
 * planModules: list from the hotel's subscription plan (null = everything).
 */
export function moduleAccess({ role, isAdmin, settings = {}, planModules = null, can = {} }) {
  const on = settings.modules || {};
  const staffAccess = settings.staffAccess || {};
  const allowedByPlan = (m) => m.core || !planModules || planModules.includes(m.id);
  const enabled = (m) => m.core || on[m.id] !== false;
  const out = {};
  MODULES.forEach((m) => {
    let ok = allowedByPlan(m) && enabled(m);
    if (ok && !isAdmin) {
      if (m.id === 'rooms') ok = !!can.manageRooms;
      else if (m.id === 'reports') ok = !!can.viewReports;
      else ok = staffAccess[m.id] ?? !!m.staff;
    }
    out[m.id] = ok;
  });
  out._role = role;
  return out;
}
