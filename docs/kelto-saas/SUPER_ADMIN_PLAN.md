# Kelto Super Admin & Master Data — architecture and plan

Written 2026-11-05 after a read-only inspection of `feature/syb-admissions` (see `FLOWONE_CURRENT_SYSTEM_ANALYSIS.md` for the full inventory). Facts are marked as such; everything else is a proposal.

## 1. Existing Super Admin (facts)

- **Accounts:**
  - `PlatformAdmin` (separate from `User`): name, unique email, bcrypt password, `isActive`, lockout.
  - Created only with `scripts/create-super-admin.js`.
  - No roles: every admin can do everything.
- **API:**
  - `/api/platform/*` (`platformController.js`), behind `requirePlatformAdmin` (`middleware/platformAuth.js`).
  - Console JWT: `kind: 'platform'`, `aud: 'platform'`, 8 hours, not revocable.
  - Endpoints: workspaces list/detail, people list, Admissions on/off, read-only view token, audit log.
- **Read-only view:**
  - Token `kind: 'platform-view'` (1 hour), not stored server-side, so it can't be ended early.
  - Always shows a synthetic owner (all records).
  - Global `platformViewGuard` blocks writes.
- **Audit:** `PlatformAuditLog` with 4 actions.
- **Frontend:** the console lives **inside the CRM app** (`sales-follow-up-web/src/app/platform`, `/platform/*`). The view session reuses the CRM's `auth_*` storage, with an orange banner.

## 2. Feature gap analysis

| Area (brief §) | Today | Gap |
|---|---|---|
| Dashboard (3) | Totals on the workspaces page | Aggregation APIs, charts, KPIs → M8 |
| Companies (4) | List, detail, people | Create wizard, edit, owner assignment, limits, usage → M2 |
| Lifecycle (5) | `Business.isActive` checked at login and in Admissions only | Status model, suspend/reactivate with reason, enforcement on every tenant request → **M1 (enforcement)**, M2 (archive, UI polish) |
| Impersonation (6) | Synthetic-owner read-only view | Owner view, view as a specific user, owner-approved support edit, revocable sessions, real-admin attribution → **M1** |
| Modules (7) | One boolean `features.admissions`, one gate (`requireAdmissions`) | Registry, entitlements, generic `requireModule` → M3 |
| Plans (8) | None | → M4 |
| Billing (9) | None (Admissions fees are tenant data, kept separate) | → M5 |
| Registration approval (10) | Open self-service registration | Plan-based approval, rate limiting → M5 |
| Platform admins (11) | CLI only, no roles | Roles, server-side permissions, management, session revocation, login history → **M1** |
| Master data (12) | Hard-coded enums (lead sources/status), per-tenant admissions config, `University` | Metadata-driven engine → M6–M7 |
| Navigation (13) | 3 tabs in the CRM | Separate admin app, permission-aware sidebar → **M1 (shell)**, items added per milestone |

## 3. Security issues found

| # | Issue | Fix |
|---|---|---|
| S1 | A suspended business (`isActive=false`) keeps API access with already-issued JWTs: `authMiddleware`/`loadAccess` never read the business | **M1**: business status loaded with access, `403 COMPANY_SUSPENDED` everywhere |
| S2 | 60-second signed file links (`/api/admissions/files/:token`) ignore company status | **M1** |
| S3 | Console tokens can't be revoked; every admin has full power | **M1**: `tokenVersion`, roles, `requirePlatformPermission` |
| S4 | View tokens aren't backed by a server record, so they can't be ended or revoked | **M1**: `SupportSession` collection, checked on every request |
| S5 | Admin passwords set by someone else are never forced to change | **M1**: `mustChangePassword` |
| S6 | Support view always sees everything (synthetic owner) | **M1**: modes A/B reproduce the real owner or user |
| S7 | JWTs in `localStorage` (CRM and console), exposed to any XSS | Document; consider httpOnly cookies + CSP in M8 |
| S8 | Rate limiting only on platform login, per process, in memory | Registration rate limit in M5; shared limiter in M8 |
| S9 | One `JWT_SECRET` for every token kind | Audiences separate the kinds today; a separate secret for platform tokens in M8 |
| S10 | Workspace users' JWTs live 1 day; only deactivation (via `loadAccess`) cuts them early | Acceptable; suspension now also cuts them (S1) |

## 4. Reusable components

- `Business` (tenant root, `features`), `requireAdmissions` (pattern for module gates).
- The access catalog, `Role`, `loadAccess`, `scopeFilter`, `requirePermission` (tenant RBAC).
- `PlatformAdmin`, `PlatformAuditLog`, `requirePlatformAdmin`, `platformController`, the platform console components (moved to the admin app).
- On the frontend, `PermissionService` + `*ktCan` + `permissionGuard`.
- Storage drivers, exporter (CSV/XLSX with formula-injection protection: `exporter.js#safeCell`), migrations runner, `dev-memory.js` demo server, test helpers.

## 5. Data model changes

**M1 (additive; no migration; missing fields fall back safely):**
- **`Business`:**
  - `status: ACTIVE|SUSPENDED|ARCHIVED`. Legacy documents fall back to `isActive`, and `isActive` stays in sync.
  - `statusReason`, `statusChangedAt`, `statusChangedBy`.
  - `supportAccess { editAllowedUntil, grantedBy, grantedAt }`, the owner's permission for support edits.
- **`PlatformAdmin`:** `role` (SUPER_ADMIN, PLATFORM_ADMIN, BILLING_ADMIN, SUPPORT_ADMIN, AUDITOR; missing = SUPER_ADMIN, which covers the single existing account), `tokenVersion`, `mustChangePassword`, `passwordChangedAt`, `createdBy`.
- **`SupportSession` (new):** admin, business, `mode` (VIEW_OWNER | VIEW_USER | SUPPORT_EDIT), target user, reason, allowed permissions (edit mode), status (ACTIVE/ENDED/REVOKED), `expiresAt`, single-use hashed hand-off code, start/end metadata.
- **`PlatformAuditLog`:** new actions plus `supportSessionId`, `targetAdminId`.

**Later (proposed):**
- **Module entitlements (M3):** a code-defined module registry plus `Business.modules[key] { enabled, source: PLAN|OVERRIDE, changedAt, changedBy }` and a `ModuleActivation` history collection.
- **Plans (M4):** `Plan { key, name, prices{monthly,yearly} in minor units, currency, trialDays, approvalPolicy, limits{users,storageMb,leads,students}, modules[], status, version }`.
- **Subscriptions and billing (M5):** `Subscription { businessId, planId, planSnapshot, status, period, trialEndsAt, currentPeriodEnd, history[] }`, `Invoice { number, businessId, lines (snapshot), totals (minor units), status, dueDate }`, `PaymentRecord { invoiceId, amountMinor, method, reference, idempotencyKey (unique) }`, `RegistrationRequest`.
- **Master data (M6–M7):** see §8.

## 6. API contracts

**M1** (all under `/api/platform` unless noted; `perm` = platform permission):

| Method & path | perm | Notes |
|---|---|---|
| POST `/auth/login` | — | Returns `{ token, admin{id,name,email,role,permissions,mustChangePassword} }` |
| GET `/auth/me` | any | Same admin shape |
| POST `/auth/change-password` | any | `{currentPassword,newPassword}`; returns a new token (old ones revoked) |
| GET `/workspaces`, `/workspaces/:id`, `/users` | companies.view | Now include `status`, `statusReason` |
| PATCH `/workspaces/:id/features` | modules.manage | Unchanged body |
| POST `/workspaces/:id/suspend`, `/reactivate` | companies.lifecycle | `{reason}` (≥5 chars), audited |
| POST `/workspaces/:id/support-sessions` | support.view (edit: support.edit) | `{mode, userId?, reason, allowedPermissions?, landingPath?}` → `{session, handoffCode, handoffExpiresAt}` |
| GET `/support-sessions` | sessions.view | `?status=&businessId=` |
| POST `/support-sessions/:id/revoke` | sessions.revoke (or own) | `{reason}` |
| GET `/support/edit-options` | support.edit | Permissions that may be granted in edit sessions |
| GET `/admins` · GET `/admins/:id/logins` | admins.view | |
| POST `/admins` · PATCH `/admins/:id` · POST `/admins/:id/reset-password` · POST `/admins/:id/revoke-sessions` | admins.manage | Temporary passwords are shown once; escalation guards |

Tenant side (CRM): POST `/api/support/exchange {code}` (public, single-use) → `{token, expiresAt, session, user, access, business}`; POST `/api/support/end` (support token); GET/PUT `/api/settings/support-access` (workspace owner only).

**Later:** `/api/platform/companies` (create wizard, `Idempotency-Key` header), `/api/platform/modules`, `/plans`, `/subscriptions`, `/invoices`, `/payments`, `/registrations`, `/master-data/*` as listed in the brief §12.9; tenant `/api/master-data/:categoryKey`. All new list endpoints should use one envelope: `{ success, data: { items, total, page, limit } }`.

## 7. Angular structure

- **New project** `sales-follow-up-web/projects/kelto-admin` (same workspace and `node_modules`, separate build `ng build kelto-admin` → `dist/kelto-admin`, separate Vercel project; dev server `ng serve kelto-admin --port 4400`).
  ```
  projects/kelto-admin/src/
    app/core/      admin-api.service, admin session (token + permissions), interceptor, guards
    app/shell/     sidebar (permission-aware, only built sections), top bar
    app/pages/     login, change-password, companies, company-detail, people, admins, support-sessions, audit
    environments/  apiUrl, crmUrl
  ```
- **CRM app keeps** only the tenant side of support: `/support/enter` (exchanges the hand-off code), `/support/ended`, and the support banner. `/platform/*` in the CRM redirects to the admin app.
- **Later milestones** add `pages/` folders: plans, subscriptions, billing, modules, master-data/* (overview, categories, entries, builder, templates, import-export).

## 8. Master Data architecture (M6–M7, proposed)

- **`MasterDataDefinition`:**
  - Fields: `key` (unique, immutable), `name`, `description`, `scope` GLOBAL|MODULE|TENANT, `moduleKey`, `fieldSchema` (validated metadata: text, number, decimal, boolean, date, dropdown, reference→definition key; required/default/unique/order; no code execution), `customization` (NONE | ADD | ADD_AND_RELABEL), `protected`, `status` DRAFT|PUBLISHED|ARCHIVED, `version`, `sortOrder`.
  - Publishing creates a new version; entries record the version they were validated against.
- **`MasterDataEntry`:**
  - Fields: `definitionId`, `businessId` (null = global/module), `code` (immutable), `label`, `translations{en,ar}`, `attributes` (validated against `fieldSchema`), `parentId`, `sortOrder`, `status` ACTIVE|INACTIVE|ARCHIVED, `overridesEntryId` (tenant relabel of a global entry), `usageCount` (maintained), audit fields.
  - Unique index `{definitionId, businessId, code}`.
- **Resolution for a tenant** (deterministic):
  1. protected system entries;
  2. global/module entries;
  3. template-applied tenant entries;
  4. tenant additions;
  5. tenant overrides replace only the `label`/`translations` of the entry they override, never its `code`.

  Disabled-for-tenant is an override with `status: INACTIVE`. Another tenant's entries never match because every tenant query includes its own `businessId`.
- **`MasterDataTemplate`:** `name`, `industry`, `version`, `status`, `definitions[]`, `entries[]`. Applying a template is recorded per business (`appliedTemplates[{templateId, version, appliedAt}]`) and only **adds** missing entries; it never overwrites customised ones.
- **`MasterDataAudit`:** actor (platform admin or user), businessId, definitionId, entryId, action, before/after, time.
- **Usage protection:** before archiving, check references (`usageCount`, plus a registry of which models reference which definition). Referenced entries can be archived, never deleted.
- **Import/export:** reuse `exporter.js` (`safeCell` already neutralises `= + - @` formulas); imports are validated row by row with a dry-run preview.
- **Integrating with today's CRM:**
  - Keep the `Lead.source` / `Lead.status` enums.
  - First expose them as **protected** definitions whose entry codes equal the enum values. The UI reads labels from master data and the API still validates the enum.
  - Allowing tenant-added codes comes later and needs relaxing the enum together with a compatibility layer.
  - Admissions lead sources, document types and universities move behind the same API with a read-through adapter, then a migration (needs explicit approval).

## 9. Dependencies

- **M1 → M2:** company status, platform roles and permissions, admin shell.
- **M2 → M3:** company detail page hosts the module toggles.
- **M3 → M4:** plans reference module keys.
- **M4 → M5:** subscriptions and invoices reference plans; registration approval uses the plan policy.
- **M3 → M6:** module-scoped definitions need the registry.
- **M6 → M7:** templates and builder sit on definitions and entries.
- **M2 + M7:** the company wizard step 4 needs templates. Until then it offers "no template".

## 10. Milestones

| Milestone | Scope | Key tests |
|---|---|---|
| **M1 Foundation** | Platform roles + server-side permissions, admin management (create/role/deactivate/reset/revoke/login history), forced password change, revocable console tokens, company suspension enforcement (all tenant APIs + file links) with suspend/reactivate, support sessions modes A/B/C with hand-off code, owner authorisation, revocation, real-admin attribution and write audit, separate `kelto-admin` app shell with the existing console moved into it | Roles and escalation, revocation, suspension blocks existing tokens across modules and file links, each impersonation mode, read-only enforcement, allowed operations, owner withdrawal, nested prevention, regression suites |
| M2 Companies | Directory filters, detail, edit, create wizard (idempotent provisioning, owner must change password), archive, usage | Provisioning idempotency, lifecycle |
| M3 Modules | Registry, tenant entitlements, `requireModule`, activation history, permission-aware CRM navigation | Gate order (company → module → entitlement → tenant → permission) |
| M4 Plans | Plans CRUD/duplicate/archive, limits, subscription assignment and lifecycle | Historical prices preserved |
| M5 Registration & billing | Approval queue, invoices, manual payments (idempotent), renewal/expiry jobs, invoice PDF | Duplicate payment prevention, state machine |
| M6 Master data foundation | Definitions, global entries, validation, audit, admin UI | Schema validation, protection |
| M7 Advanced master data | Tenant entries/overrides, resolution, templates, builder (draft/preview/publish), import/export, CRM integration | Inheritance, isolation |
| M8 Finalisation | Dashboard aggregation APIs and charts, monitoring, security review (S7–S9), performance, deployment docs | Load and regression |

---

## Milestone 1: delivered (2026-11-05)

**Backend:**
- **Platform roles:** `services/platform/roles.js` defines the roles and `requirePlatformPermission` enforces them on every `/api/platform` route.
- **Revocable sign-in:** console tokens carry `tokenVersion`; a role change, deactivation, password reset or "sign out everywhere" ends existing sessions.
- **Temporary passwords:** `mustChangePassword` blocks everything except `/auth/me` and `/auth/change-password`.
- **Administrator management:** `controllers/platformAdminController.js`.
- **Company suspension:**
  - `services/businessStatus.js`; `loadAccess` carries the company status, so `authMiddleware` answers `403 COMPANY_SUSPENDED` on every tenant route.
  - Signed file links and login refuse too.
  - Suspend/reactivate need a reason and are audited.
- **Support sessions:**
  - `models/SupportSession.js`, single-use hand-off code `POST /api/support/exchange`, `POST /api/support/end`.
  - The global `supportSessionGuard` blocks writes in read-only modes and blocks sign-in/account/people/role changes in every mode.
  - Support edit acts under the administrator's id; every write is logged as `SUPPORT_ACTION`.
  - The owner controls access at `GET/PUT /api/settings/support-access`.
- **Removed:** the old `platform-view` token and `POST /workspaces/:id/view`.

**Frontend:**
- New Angular project `sales-follow-up-web/projects/kelto-admin`: sign-in, forced password change, companies, company detail (status, modules, support), company users ("View as…"), platform administrators, support sessions, audit log.
- The CRM keeps only `/support/enter`, `/support/ended`, the support banner and the owner's "Kelto support access" card. `/platform/*` in the CRM points to the admin app (`environment.adminUrl`).

**Verify locally** (in-memory demo data, nothing real touched):
1. Stop the normal API, then start the optional demo API: `cd sales-follow-up-backend` and run `node scripts/dev-memory.js` (port 5001).
2. Start the CRM: `cd sales-follow-up-web` and run `npx ng serve` (http://localhost:4200; its development environment points to 5001).
3. Start the admin app: `npx ng serve kelto-admin` (http://localhost:4400). Sign in as `superadmin@kelto.test`; the password is printed by the demo server.
4. Open a company → **Open as support…** → view as owner or as a person. A CRM tab opens with the support banner; **Exit** ends the session.
5. For support edit, sign in to the CRM as the demo owner (`admin@syb.test`) → Settings → **Kelto support access** → Allow. Then start a **Support edit** session from the admin app.

**Deploying the admin app** (not done; needs your approval):
- Create a separate Vercel project from the same repository, with root `sales-follow-up-web`.
  - Build command: `npx ng build kelto-admin`.
  - Output directory: `dist/kelto-admin/browser`.
  - Add a rewrite of every path to `/index.html`.
- Then set `adminUrl` in the CRM's `src/environments/environment.ts` to the new address.
- `crmUrl` in `projects/kelto-admin/src/environments/environment.ts` already points to the live CRM.
- The API's CORS already allows `*.vercel.app`.
- On the live API, the existing super admin keeps full rights (accounts without a role are treated as `SUPER_ADMIN`).

**Known limitations, carried to later milestones:**
- Per-administrator permission overrides (roles are fixed sets).
- Support-edit sessions can't create records (by design for now, because new records would be assigned to the administrator).
- The access cache means a suspension reaches other API instances within 15 seconds.
- JWTs live in `localStorage` (S7).
- Historical trend charts and monitoring remain in M8; the current dashboard reports live operational and subscription KPIs.

---

## SaaS dashboard, plans and subscriptions: delivered (2026-11-05)

- **Plan catalog:** active/archive lifecycle, monthly and annual prices in minor units, currency, trial days, limits and included modules. Plan keys are immutable. A subscription stores a commercial snapshot, so later catalog edits do not rewrite an existing customer's contracted price.
- **Subscriptions:** one per company with `TRIALING`, `ACTIVE`, `PAST_DUE`, `CANCELLED` and `EXPIRED` states; monthly/annual cycles; trial and period dates; cancellation at period end; internal notes and append-only change history.
- **Dashboard:** company totals, active subscriptions, trials, past due, scheduled cancellations, plan mix, lifecycle distribution and MRR separated by currency (currencies are never added together).
- **Admin access:** `dashboard.*`, `plans.*` and `subscriptions.*` permissions are enforced by the API and reflected in the separate Kelto admin app navigation. Billing administrators can manage the catalog and subscriptions; auditors remain read-only.
- **Audit:** plan and subscription creation/updates appear in the platform audit log with the administrator, company, reason and commercial transition.
- **API:** `GET /platform/dashboard`, `GET/POST/PATCH /platform/plans`, `GET /platform/subscriptions`, and `PUT /platform/workspaces/:id/subscription`.
- **UI:** new SaaS dashboard, Plans & pricing, Subscriptions, company-directory subscription columns, and a subscription card on company details. The compact layout uses a scrollable mobile header instead of the desktop sidebar.

**Boundary:** this delivery is internal subscription administration. It does not charge cards, connect to a payment provider, apply tax rules, generate invoices or run renewal/expiry jobs. Those require the provider and accounting decisions planned for M5.
