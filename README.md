# StayBill — Hotel Billing Software

A standalone hotel billing app built from the Levirix StayBill PRD v1.0.
**Frontend:** React 18 + Vite + Tailwind CSS + React Router, styled to the Google Stitch "Bills & Payments Ledger" design (Plus Jakarta Sans + Inter, Material Symbols, Stitch colour tokens in `tailwind.config.js`) · **Backend & database:** Firebase (Authentication + Cloud Firestore) · **Hosting:** Firebase Hosting.

> "Don't build a hotel management system. Build the simplest reliable hotel billing system."

---

## Two ways to run StayBill

| | Hosted on claude.ai | Firebase (this README's setup) |
|---|---|---|
| Setup | None: open the page and name the hotel | Create a Firebase project, fill `.env.local`, deploy |
| Data | The page's own claude.ai database | Your Firestore database |
| Sign-in | StayBill username + password (the viewer must also be signed in to claude.ai and have the page shared with them) | StayBill username + password (Firebase Authentication) |
| Roles enforced by | The app (fine for a trusted team; anyone the page is shared with can read the raw data) | Firestore security rules on Google's servers |
| Guest emails | Listed as *Waiting* (no mail server) | Sent through Gmail by the Cloud Function |
| Printing | Invoices are saved as PDF, then printed from the PDF | Print directly from the browser, or PDF |
| Limits | About 25,000 records in total | Firebase free tier limits |

Build the hosted version with `npm run build:hosted` (output in `dist-hosted/`). It is the same React app: the build swaps the three Firebase modules for `src/hosted/*`, which implement the same functions on the artifact database. `npm run build` still produces the Firebase version.

## Logins, roles and the three dashboards

One StayBill site can serve many hotels. Every login has a **username and password** and one role:

| Role | Who | Dashboard and powers |
|---|---|---|
| **Administrator** | Runs the StayBill site (created on first visit) | *Administrator console*: all hotels with this month's invoiced / collected / still-to-collect totals, owner logins, staff counts. Adds hotels (with the owner's username and password), adds logins of any role, sets new passwords, switches logins off, pauses or resumes a hotel, and can **Open** any hotel to see and work in it exactly as its owner. |
| **Hotel owner** | Runs one hotel | Owner home: night-city hero, today's figures, check-outs due, **Your team today** (bills and collections per person), recent bills, then the showcase sections. Full access to that hotel: rooms, reports, settings, **Settings → Staff logins** (adds employees with username + password, sets new passwords, switches logins off), **Permissions** for employees and **Guest emails**. |
| **Employee** | Front desk of one hotel | Front-desk home: *my bills today*, *I collected today*, check-outs to collect, rooms occupied tonight. Creates bills, records payments, manages guests. Editing or cancelling bills, reports and rooms only if the owner switches them on in **Settings → Permissions**. |

- Hotels never see each other's data: everything a hotel owns lives under `hotels/{hotelId}/…`.
- Anyone can change their own password from the menu under their name (*Change my password*). Forgotten passwords are reset by the owner (for employees) or the administrator (for anyone).
- Usernames are 3–30 letters, numbers, dots, dashes or underscores. In Firebase each username is stored as the sign-in id `username@staybill.app` (no email is ever sent there).
- A paused hotel's owner and employees cannot sign in; no data is removed.

## Guest emails (Gmail)

When a bill is created the guest gets a **booking confirmation** (room, dates, nights, charges, amount due). When the bill is **paid in full** they get a thank-you email with the **invoice PDF attached** (if the bill is fully paid when it is created, only this one is sent). The guest's email address must be on the bill. Owners can switch either email off in **Settings → Guest emails**, see the log of recent emails, and resend from any bill page.

How it works: the app writes a small request to `hotels/{hotelId}/mail`, and the `sendGuestEmail` Cloud Function (in `functions/`) reads the bill, builds the email and PDF, and sends it from your Gmail account, then marks the request *Sent*, *Failed* or *Skipped*. Staff cannot choose the recipient or the content: the function always uses the bill's own data.

### Set it up (once)

1. **Firebase Blaze plan.** Cloud Functions need the pay-as-you-go plan (Firebase console → ⚙ → Usage and billing). A small hotel normally stays inside the free allowance; set a budget alert of ₹100 to be safe.
2. **Gmail app password.** On the Gmail account that will send the emails: Google Account → Security → turn on **2-Step Verification** → search for **App passwords** → create one named *StayBill* → copy the 16-character password.
3. **Store it as secrets** (never in the code):
   ```bash
   firebase functions:secrets:set GMAIL_USER          # e.g. frontdesk.seabreeze@gmail.com
   firebase functions:secrets:set GMAIL_APP_PASSWORD  # the 16-character app password, no spaces
   ```
4. **Deploy** the functions and the rules:
   ```bash
   cd functions && npm install && cd ..
   firebase deploy --only functions,firestore
   ```
5. In StayBill, put the hotel's email in **Settings → Hotel** (guests' replies go there), create a bill with your own email address as the guest, and check **Settings → Guest emails** shows *Sent*.

The same function also sends **reservation confirmations** (from Bookings), a **thank-you with the feedback link** after check-out, **campaign** emails (Guests → Campaigns) and the **automatic messages** below. Campaign and automatic emails carry an unsubscribe link, so add one more secret for signing it:

```bash
firebase functions:secrets:set UNSUB_SECRET   # any long random text
```

Gmail sends up to about 500 emails a day from a normal account. The functions run in `asia-south1` (Mumbai); change it with `STAYBILL_REGION` in `functions/.env` if you need to. `cd functions && npm test` checks the email and PDF builders.

Other functions in the same deploy:

| Function | What it does |
|---|---|
| `icalFeed` | Each room's busy dates as an iCal link that Booking.com, Airbnb, MakeMyTrip and others can import (Channels & OTAs → Calendar sync) |
| `icalImport` | Every 30 minutes, reads the travel sites' calendars and adds their bookings (and cancellations) to Bookings |
| `dailyAutomations` | 9 am India time: pre-arrival, post-stay, birthday, anniversary and win-back emails that the owner switched on, and pausing hotels whose subscription is overdue past the grace period |
| `unsubscribe` | The link at the bottom of marketing emails |
| `sendWhatsApp` | Sends WhatsApp messages through the WhatsApp Business Cloud API when the hotel chose automatic sending (Settings → WhatsApp). Needs `firebase functions:secrets:set WHATSAPP_TOKEN` (a permanent Meta system-user token) and one approved Utility template per message, each with a single body variable |

Scheduled functions need Cloud Scheduler, which the first deploy switches on for you (Blaze plan).

The same deploy adds `setUserPassword` (lets owners and the administrator set a new password for someone; without it they can only ask the person to change their own) and `syncLoginStatus` (switching a login off also disables it in Firebase Authentication).

## Appearance & welcome page

- **Home page** (one continuous page inside the app, no separate intro screen): night-city hero with the key-card tap, then the live front desk (today's figures, check-outs due, recent bills), then features, how it works, pillars, gallery and a closing section. Signed-out visitors in Firebase mode see the same showcase as a public landing page with a Sign in button. Original welcome-page details: intro with a glowing horizon and *Skip intro*, neon skyline hero with parallax and moving light streaks, count-up stats, a sliding features strip, a pinned "How it works" section that builds a bill as you scroll, a blur-in photo gallery (add your own photos in **Settings → Gallery**), a glowing cursor trail and a giant footer word.
- **Appearance menu** (palette icon in the top bar, saved per device):
  - Theme: **Light** or **Night** (deep night sky, glass cards, glowing brand colours). Invoices always print on white.
  - Animations: **Off**, **Light** (page transitions, count-up totals, soft fade-ins) or **Full** (adds blur-in reveals, cursor trail, shooting stars).
  - Welcome page on open: on/off.
- **Pause motion** button (bottom bar / bottom-left on the welcome page). Animations also switch off automatically when the device asks for reduced motion.
- **Brand colours** (Settings → Hotel, admins, applies to everyone): Ocean Teal & Coral (default), Royal Navy & Gold, Emerald & Brass, Terracotta & Sand, or *Your hotel colours* (primary, accent, background and night colour). Choosing one previews it live; *Save brand colours* applies it hotel-wide, including the night theme and the welcome page. Bill status colours (paid / partial / pending) never change.
- Built with Framer Motion and Lenis (smooth scrolling). Every colour is derived from the four brand colours in `src/lib/palettes.js`; `src/theme.css` holds the generated default.

### Hotel animations (motion picks)

All follow the brand colours and the Animations setting (Off shows a still version).

| Where | Animation |
|---|---|
| Sign-in / setup, welcome intro | Key-card tap (01), pool light (33) also behind the welcome gallery |
| Every success message | Concierge bell icon (02), optional ding sound (Appearance → Concierge bell sound) |
| New invoice page | Receipt printer feed (03), first invoice or paid-in-full petals (32) |
| Dashboard | Sunrise-to-night sky greeting (06) with lit hotel facade for tonight's occupancy (05), check-out ticker (23), rolling odometer totals (24), split-flap invoice numbers and status (04), monthly goal petals (set the goal in Settings → Invoice) |
| Top bar | Ringing alert bell with a list of check-outs still owing (25), ripple buttons (27) |
| Page changes | Elevator doors with the floor number (10) (Appearance → Page change: Elevator / Fade) |
| Loading | Luggage trolley (08) |
| Ledger & search | Search spotlight (26), ticker (23) |
| Bill page | Door-hanger status (13), cloche reveal of the grand total (14), coin payment meter (09), PAID rubber stamp (15) |
| Record payment | Payment meter preview with coins (09), petals when a bill is settled (32) |
| New bill form | Nights strip with moons (16), check-in checklist (19), "occupied" rooms marked |
| Rooms | Front-desk key rack (12), room tiles that sparkle when ready (34) |
| Guests | Flip cards showing stay history (18) |
| Wrong link / no access | Door-ajar 404 and locked staff door (30) |

## Features (PRD coverage)

| PRD section | Where in the app |
|---|---|
| Login, roles (Admin / Receptionist), first-run admin setup | Login screen, `firestore.rules` |
| Dashboard: today's bills, revenue, collected, pending, recent bills, quick actions | Dashboard |
| Room management, room types with default rates, per-room tax config, active/inactive | Rooms |
| Guest management + guest billing history | Guests → guest page |
| New Bill: new/existing guest, room, dates, auto nights × rate, additional charges (+ Add Charge, presets), % or fixed discount, configurable taxes, live totals | New Bill |
| Payment at checkout: full / partial / pending, Cash · UPI · Card · Bank Transfer · Other | New Bill → Payment |
| Multiple payments, payment history (ID, invoice, guest, amount, method, date, time, user) | Bill page, Bills & Payments |
| Invoice: A4 preview, Print, Download PDF (generated from stored bill data), Share | Bill page |
| Bills & Payments ledger: metric cards, status tabs, search (invoice no., guest, phone, room), filters (date, room type, payment method, staff), batch print, CSV export, pagination | Bills & Payments |
| Edit eligible bills (settled/PAID bills are locked), cancel with reason (never deleted) | Bill page, ledger row menu |
| Outstanding fast-collect queue + collections by method + payment history | Bills & Payments |
| Reports: Daily Sales, Payment, Bill — with Today / Yesterday / This week / This month / Custom range — PDF & Excel/CSV export | Reports |
| Hotel settings (logo, address, GSTIN…), invoice prefix/start number/currency/footer, tax settings | Settings |
| User management (add, role, deactivate, password reset email) | Settings → Users |
| Receptionist permissions (edit / cancel bills, view reports, manage rooms) | Settings → Permissions |
| Audit information (who created/edited/cancelled/paid, when) | Bill page → Activity, Settings → Audit Log |
| Backup & restore (JSON), transaction-safe billing writes | Settings → Backup |
| Validation rules (§51) | `src/lib/billing.js` + Firestore rules |
| Automatic invoice numbering (INV-1001, INV-1002 …) | Firestore transaction + counter |

## Hotel modules

Everything beyond billing is a module. Owners switch modules on or off and choose which ones employees may use in **Settings → Modules**; on a subscription plan, only the plan's modules appear. The top menu groups them:

| Menu | Modules |
|---|---|
| Front desk | Bookings (calendar, advances, groups, no-shows), Room board (live status, room moves, Form C register), Night audit (closes the day and locks its bills), Channels & OTAs (commissions, iCal calendar sync, rate sheets), **Booking website** (your own commission-free booking page) |
| Restaurant | POS (table, room service, takeaway, KOTs, split bills, charge to room), Kitchen display, Menu & recipes (food cost and margin) |
| Operations | Housekeeping (tasks from check-out, checklists, linen), Maintenance (tickets, out-of-order rooms, preventive schedule), Lost & found, Assets |
| Stock | Inventory (issues, wastage, minibar, stock take), Purchases (request → owner approval → order on WhatsApp → receive into stock), Suppliers (payables, payments, price history) |
| Team | Attendance (clock in/out, register, monthly report), Shifts & leave (roster, leave approval, balances), Payroll (PF, ESI, professional tax, advances, payslip PDFs, salary register) |
| Guests | Guest CRM (birthdays, ID, preferences, VIP / blacklist, marketing opt-out), Feedback (guest link after check-out, replies, review link), Campaigns (email, WhatsApp, SMS; segments; automatic messages), Loyalty (points, tiers, redemption on bills, referrals) |
| Finance | Accounts (P&L, balance sheet, cash book, ledger, trial balance, day book — built automatically), Expenses (with GST input credit), GST & e-invoice (GSTR-1, GSTR-3B, GSTN CSVs, NIC e-invoice JSON, Tally XML, Zoho CSV), Credit notes & refunds, Analytics (occupancy, ADR, RevPAR, channel mix, forecast, staff performance) |

**Public pages** (no sign-in): `/book/<hotelId>` booking page, `/feedback/<hotel>/<bill>/<token>` feedback form, `/signup` for new hotels.

**Running StayBill for many hotels:** the administrator's **Plans & billing** page holds plans (price, modules, room limit, trial), each hotel's plan and status, subscription payments with invoice PDFs, sign-up requests (approve → hotel + owner login created), and pausing overdue hotels.

### Parts that need your own accounts

These are built and ready, but need an account only you can open:

- **Razorpay checkout** for subscriptions: put a Razorpay payment link on each plan now (owners see a Pay button); automatic card/UPI checkout needs a small server step with your Razorpay secret.
- **Live OTA channel manager APIs** (instant rate and inventory push): StayBill syncs through iCal calendars, which every major travel site supports; two-way rate push needs a channel-manager partner account.
- **WhatsApp:** guests get bill details, payment reminders, receipts, booking confirmations and the feedback link on WhatsApp. In the free mode StayBill opens WhatsApp with the message typed in; in the Business API mode (Settings → WhatsApp) they go out automatically through the `sendWhatsApp` function once you add your Meta account details.
- **E-invoice IRN**: StayBill produces the NIC JSON; upload it on the IRP or through your GST Suvidha Provider to get the IRN and QR code.

## 1. Create the Firebase project (one time)

1. Go to <https://console.firebase.google.com> → **Add project**.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** → choose a location near you (e.g. `asia-south1` Mumbai) → *Production mode*.
4. **Project settings (gear) → General → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig` values.

## 2. Run locally

```bash
npm install
cp .env.example .env.local      # then paste your firebaseConfig values into .env.local
npm run dev                     # open http://localhost:5173
```

The first time you open the app it shows **Set up StayBill**: create the **administrator** login (your name, a username and a password). Then, in the administrator console, **Add a hotel**: its name, city and the owner's name, username and password. Each new hotel starts with CGST/SGST 2.5% each (edit in Settings → Taxes), the five room types, and invoice numbering from INV-1001. The owner signs in, adds rooms under **Rooms** and employees under **Settings → Staff logins**.

## 3. Deploy security rules (required)

```bash
npm install -g firebase-tools
firebase login
firebase use --add                # pick your project
firebase deploy --only firestore  # deploys firestore.rules + indexes
```

The rules keep every hotel's data separate, enforce the three roles, stop anyone deleting bills or payments, make the audit log append-only, and guarantee every bill takes the next invoice number exactly once. No composite indexes are needed.

## 4. Deploy the website

```bash
npm run build
firebase deploy --only hosting
```

Your app is then live at `https://<project-id>.web.app`.

## Backups

- **In-app:** Settings → Backup → *Download backup* (JSON of every collection) and *Restore backup*.
- **Automatic (recommended):** Google Cloud console → Firestore → *Disaster recovery* → set up a daily backup schedule (or `gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=14d`). Requires the Blaze plan.

## Data model (Firestore)

| Collection | Contents |
|---|---|
| `users/{uid}` | name, username, role (`admin` / `owner` / `employee`), hotelId, phone, status |
| `meta/platform` | set when the administrator has been created |
| `hotels/{hotelId}` | name, city, status (`active` / `suspended`), owner |
| `hotels/{hotelId}/settings/hotel` | hotel info, logo (data URL), invoice prefix/start/footer, currency, employee permissions, brand colours, guest-email switches |
| `hotels/{hotelId}/counters/invoice` | `next` invoice sequence |
| `hotels/{hotelId}/taxes`, `roomTypes`, `rooms`, `gallery` | master data |
| `hotels/{hotelId}/guests` | name, phone, email, address, GSTIN, notes |
| `hotels/{hotelId}/bills` | invoice number, guest snapshot, room, stay, `items[]`, subtotal, discount, `taxes[]`, grand total, paid, balance, status, created/updated/cancelled by |
| `hotels/{hotelId}/payments` | bill, amount, method, reference, received by, date, time |
| `hotels/{hotelId}/mail` | guest email requests and their result (sent / failed / skipped) |
| `hotels/{hotelId}/auditLogs` | action, entity, details, user, timestamp |
| `hotels/{hotelId}/bookings`, `channels`, `nightAudits` | reservations (incl. website requests and calendar imports), travel-site channels, closed days |
| `hotels/{hotelId}/menuItems`, `orders` | restaurant menu with recipes, POS orders and KOTs |
| `hotels/{hotelId}/hkTasks`, `tickets`, `pmTasks`, `lostFound`, `assets` | operations |
| `hotels/{hotelId}/stockItems`, `stockMoves`, `purchaseOrders`, `suppliers`, `supplierPayments` | stock and purchasing |
| `hotels/{hotelId}/attendance`, `shifts`, `leaves`, `payProfiles`, `payslips`, `salaryAdvances` | team and payroll |
| `hotels/{hotelId}/feedback`, `campaigns`, `loyaltyTx` | guest relations |
| `hotels/{hotelId}/expenses`, `creditNotes` | finance (accounts and GST are computed, not stored) |
| `hotels/{hotelId}/counters/*` | numbering for invoices, bookings, KOTs, POs, credit notes, expenses |
| `publicHotels/{hotelId}`, `publicFeedback/{hotel_bill}` | the only data the public pages can read |
| `plans`, `subscriptionPayments`, `signupRequests`, `meta/billing` | subscriptions (administrator) |

Bill items are stored inside the bill document (instead of a separate table) so a bill is always read and written atomically. Bills store a snapshot of guest details and tax rates, so old invoices never change when settings change.

## Billing logic

```
Room charge   = room rate × nights            (same-day stay = 1 night)
Subtotal      = room charge + additional charges
Taxable       = subtotal − discount           (discount ≤ subtotal)
Tax           = taxable × each active tax %
Grand total   = taxable + tax
Balance       = grand total − payments
Status        = PAID | PARTIALLY_PAID | PENDING | CANCELLED
```

`npm test` runs unit tests, including the PRD §55 worked example (₹9,515).

## Notes

- The PRD's tax example (₹865 on ₹8,650) implies 5% CGST + 5% SGST, while §47 lists 2.5% each. Setup seeds 2.5% each; change the rates in Settings → Taxes to whatever applies to your tariff.
- PDFs use "Rs." instead of the ₹ symbol, because the built-in PDF fonts have no ₹ glyph. The on-screen and printed invoice uses ₹.
- Receptionist accounts are created from the admin's browser; no Cloud Functions or paid plan are needed for the app itself.
- The PRD's original out-of-scope list (online booking, POS, inventory, payroll, CRM, accounting, multi-tenant SaaS…) is now covered by the modules above.
- GST and accounting figures are worked out from your records; have your accountant review the first month before filing.
