# Real data, Settings and seed — Plan

Request (2026-11-03): remove dummy data, connect everything to the database, seed an admin and team, add a Settings option.
Decisions from the owner: seed the `.env` database; no sample students; admin login `admin@syb.local` with a generated password shown once.

## Tasks

1. **Settings API** — `GET /api/settings`, `PATCH /api/settings/profile` (own name/phone), `PATCH /api/settings/business` (owner: name, email, phone, address, GSTIN, currency), `POST /api/settings/password` (current password required unless the account has none, e.g. Google-only). `Business.currency` (default `USD` to keep today's display; seed sets `INR`). Tests: `test/settings-crm.test.js`.
2. **Password reset** — `POST /api/auth/forgot-password` (always the same answer; stores a SHA-256 hash of a random token, 1 hour), `POST /api/auth/reset-password`. Mail via SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `APP_URL`); without SMTP the link is logged only when `NODE_ENV !== 'production'`. Tests: `test/password-reset.test.js`.
3. **Home dashboard API** — `GET /api/dashboard/summary`: today's follow-ups (pending, overdue, completed, total), open pipeline (count, value, average), per-status counts and values, won this week, conversion (won ÷ closed in the last 90 days, defined), queue of overdue + today's follow-ups. Same scoping as leads/follow-ups. Tests: `test/home-dashboard.test.js`.
4. **Seed** — `npm run seed`: business "SYB Education" (INR, admissions on), owner `admin@syb.local`, a manager and two counsellors (`*@syb.local`), default admissions config, Czech universities (no invented courses). Idempotent: existing accounts are never changed; new passwords printed once. Tests: `test/seed.test.js`.
5. **Frontend** — Settings page (profile, password, business + currency, link to admissions settings) with nav entries; home dashboard on the summary API with real complete/quick-log actions; Leads/Pipeline money in the business currency; forgot/reset pages call the API.
6. **Run the seed** on the `.env` database and report the logins.
