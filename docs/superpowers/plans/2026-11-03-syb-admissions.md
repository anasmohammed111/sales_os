# SYB Student Admissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admissions module that tracks each SYB student from enquiry to visa result inside the existing CRM.

**Architecture:** New Mongoose models and `/api/admissions/*` routes in the Express backend, reusing `Lead` as the student, `FollowUp` as tasks, JWT auth and role scoping. Business rules (checklist, stage moves, payments, reminders) live in small pure-ish services under `src/services/admissions/` so they can be unit-tested. The Angular frontend adds an `admissions/` feature area rendered inside the existing shell via a child `router-outlet`.

**Tech Stack:** Node 24, Express 5, Mongoose 9, multer, exceljs, @aws-sdk/client-s3 (+ presigner); tests with `node:test`, supertest, mongodb-memory-server. Angular 22 (standalone, signals, zoneless), SCSS.

**Spec:** `docs/superpowers/specs/2026-11-03-syb-admissions-design.md` (decisions) and `docs/superpowers/specs/2026-11-03-syb-admissions-requirements.md` (full brief).

## Global Constraints

- Every query on a new model filters by `businessId` from the JWT; never from the request body.
- Every admissions route: `authMiddleware` → `requireAdmissions` (404 `Admissions module is not enabled` when `Business.features.admissions !== true`).
- Record access uses `getApplicationScope(req)`; a record outside scope returns **404** (not 403) so existence isn't leaked.
- Only `OWNER` may: change settings, override stage validation, unassign. `SALES_MANAGER` may assign to self or own salespeople. `SALESPERSON` may not reassign.
- Response envelope matches the codebase: `{ success, message?, data?, code? }`.
- Money stored as integer minor units; API accepts decimal strings/numbers with ≤ 2 decimals, > 0.
- Currencies: `INR`, `EUR`, `CZK`, `USD`. Totals always grouped by currency.
- Uploads: ≤ 10 MB (`UPLOAD_MAX_MB`), PDF/JPEG/PNG/WEBP verified by magic bytes, stored as `<businessId>/<applicationId>/<uuid>.<ext>`. Never log file contents or signed URLs.
- Signed download links live 60 seconds.
- Timestamps stored UTC; UI formats with `config.timezone` (default `Asia/Kolkata`).
- Stuck default 7 days per stage. Closed/withdrawn applications never stuck.
- No destructive migrations; config entries are archived, never deleted, once created.
- Do not seed sample students into any real database. Demo data only via the in-memory dev server.

## Review Focus

1. **Double-submitted stage move** (double click, two tabs): the client sends `fromStageKey`; a move whose `fromStageKey` ≠ current stage returns 409 and writes nothing. Test in Task 6.
2. **Applications sitting in a stage the admin later archives** must still appear (board shows the column marked archived) and can be moved out. Test in Task 16.
3. **Student edited from the old Leads screen** (name/phone/email) must update the application's search snapshot. Test in Task 5.
4. **Counsellor reassignment:** the old counsellor loses access immediately and future reminders go to the new counsellor. Test in Task 10.
5. **Money input** like `"1,500"`, `"10.555"`, `0`, `-5`, `"abc"` is rejected with a clear message; `"1500.5"` stores 150050. Test in Task 13.

---

## File map

Backend (`sales-follow-up-backend/`):
- `src/app.js` (new: Express app, exported) · `src/server.js` (connect, migrate, start jobs, listen)
- Models: `src/models/AdmissionConfig.js`, `AdmissionApplication.js`, `AdmissionDocument.js`, `AdmissionFee.js`, `AdmissionActivity.js`, `University.js`, `Reminder.js`, `Notification.js`, `Migration.js`; modified `Business.js`, `Leads.js`, `FollowUp.js`
- Services `src/services/admissions/`: `defaultConfig.js`, `configService.js`, `access.js`, `checklist.js`, `stageService.js`, `payments.js`, `reminders.js`, `activity.js`, `filters.js`, `exporter.js`, `phone.js`, `money.js`
- Storage `src/services/storage/`: `index.js`, `localDriver.js`, `s3Driver.js`, `fileValidation.js`
- Controllers `src/controllers/admissions/`: `contextController.js`, `applicationController.js`, `workflowController.js`, `documentController.js`, `paymentController.js`, `taskController.js`, `dashboardController.js`, `settingsController.js`; `src/controllers/notificationController.js`
- Routes: `src/routes/admissionRoutes.js`, `src/routes/notificationRoutes.js`
- Jobs/migrations: `src/jobs/admissionsReminderJob.js`, `src/migrations/index.js`, `src/migrations/001-lead-phone-digits.js`
- Scripts: `scripts/admissions-enable.js`, `scripts/dev-memory.js`
- Tests: `test/helpers.js`, `test/*.test.js`

Frontend (`sales-follow-up-web/src/app/`):
- `core/services/admissions.service.ts`, `core/services/notification.service.ts`
- `admissions/admissions.models.ts`, `admissions/admissions.utils.ts`, `admissions/admissions.routes.ts`, `admissions/_admissions.scss`
- Screens: `admissions/overview/`, `admissions/pipeline-board/`, `admissions/students/`, `admissions/student-profile/` (+ `profile-checklist/`, `profile-documents/`, `profile-payments/`, `profile-tasks/`, `profile-activity/`), `admissions/my-tasks/`, `admissions/payment-tracker/`, `admissions/settings/`
- `shared/notification-bell/`
- Modified: `app.routes.ts`, `dashboard/dashboard.{ts,html,scss}` (nav + outlet), `follow-ups/follow-ups.ts` (labels), `core/services/follow-up.service.ts` (types)

## API surface (`/api/admissions`)

| Method & path | Purpose |
|---|---|
| `GET /context` | enabled flag, role, config, counsellors in scope, universities |
| `GET /applications` · `GET /applications/export?format=csv\|xlsx` | list/search/filter (see `filters.js`) |
| `POST /applications/check-duplicates` · `POST /applications` | duplicate warning; create student (or reuse `studentId`) + application |
| `GET /applications/:id` · `PATCH /applications/:id` | profile; edit student/admission/assessment/visa-appointment fields |
| `PATCH /applications/:id/assign` · `PATCH /applications/:id/status` | reassign; withdraw/reactivate |
| `PATCH /applications/:id/checklist/:itemId` | set item status |
| `POST /applications/:id/stage` | move stage `{ toStageKey, fromStageKey, reason?, override? }` |
| `POST /applications/:id/visa-outcome` | `{ outcome: APPROVED\|REJECTED }` closes application |
| `GET /applications/:id/activity` · `POST /applications/:id/notes` | timeline, notes |
| `GET /applications/:id/documents` · `POST /applications/:id/documents` | list (types merged), create record |
| `POST /documents/:docId/file` · `PATCH /documents/:docId/review` · `GET /documents/:docId/download-url` · `GET /files/:token` | upload, verify/reject, signed link, file stream |
| `GET /applications/:id/fees` · `POST /applications/:id/fees` · `PATCH /fees/:feeId` | fees |
| `POST /fees/:feeId/transactions` · `PATCH /fees/:feeId/transactions/:txId/void` | payments |
| `GET /payments` · `GET /payments/export` | tracker |
| `GET /tasks` · `POST /applications/:id/tasks` · `PATCH /tasks/:id` | tasks |
| `GET /dashboard` | metrics |
| `GET /settings` · `PUT /settings` · `GET/POST /universities` · `PATCH /universities/:id` | owner configuration |

`/api/notifications`: `GET /`, `GET /unread-count`, `PATCH /:id/read`, `PATCH /read-all`.

---

## Phase 1 — Foundation

### Task 1: Test harness and app split

**Files:** Create `src/app.js`, `test/helpers.js`, `test/health.test.js`; modify `src/server.js`, `package.json`, `.gitignore`.

**Interfaces — Produces:** `require('../src/app')` → Express app. `helpers.startDb()`, `helpers.stopDb()`, `helpers.resetDb()`, `helpers.makeBusiness({ admissions = true })`, `helpers.makeUser(business, { role, managerId })`, `helpers.auth(user)` → `{ Authorization: 'Bearer …' }`.

- [ ] Move app construction (CORS, json, routes, error handler) from `server.js` into `app.js`; `server.js` keeps `connectDB`, migrations, jobs, `listen`.
- [ ] Add dev deps `supertest mongodb-memory-server`; script `"test": "node --test --test-concurrency=1 test/"`.
- [ ] `health.test.js`: `GET /api/health` → 200 `{ success: true }`; `POST /api/auth/login` with a helper-made user and password `Password123` → 200 with token.
- [ ] Run `npm test` → PASS. Commit.

### Task 2: Models, feature flag, default config, migrations

**Files:** models listed in File map; `defaultConfig.js`, `configService.js`, `phone.js`, `money.js`, `src/migrations/*`, `scripts/admissions-enable.js`; test `test/config.test.js`.

**Interfaces — Produces:**
- `normalizePhone(raw) → string` digits only, last 10 digits when longer than 10 (`'+91 98765-43210'` → `'9876543210'`).
- `parseMoney(input) → { ok: true, minor } | { ok: false, message }`; `formatMinor(minor) → '1500.50'`.
- `ensureConfig(businessId) → AdmissionConfig` (creates from defaults once; idempotent).
- `getActiveStages(config) → stage[]` sorted by `order`, non-archived.
- `runMigrations() → string[]` applied ids.
- Default stage keys, in order: `lead_counselling`, `university_selection`, `apostille`, `university_application`, `pre_enrollment`, `nostrification`, `offer_letter`, `visa`. Items exactly as the requirements list; Stage 4 has separate interview and exam items with `condition: 'INTERVIEW_REQUIRED' | 'EXAM_REQUIRED'` and rules `ASSESSMENT_REQUIREMENTS_SET`, `INTERVIEW_DATE_SET`, `EXAM_DATE_SET`, `INTERVIEW_RESULT_SET`, `EXAM_RESULT_SET`; Stage 4 `gate: 'ASSESSMENT_PASSED'`; Stage 8 rules `VISA_APPOINTMENT_SET` (date recorded) and `VISA_OUTCOME_SET`; "Pending documents reminder sent" is optional.
- Default document types: passport, certificates, transcripts, apostilled_documents, pcc, offer_letter, accommodation_letter, visa_documents (passport/pcc/visa_documents `hasExpiry: true`). Lead sources: instagram, referral, website, walk_in, whatsapp, facebook, other.

- [ ] Tests: 8 stages in that order; stage 4 item conditions; `ensureConfig` twice → one doc; `normalizePhone` cases; `parseMoney` cases from Review Focus 5; migration 001 backfills `phoneDigits` on an existing lead and is recorded once.
- [ ] Implement; `Lead` gets `whatsapp`, `city`, `phoneDigits` (set in `pre('save')` and `pre('findOneAndUpdate')`), `INSTAGRAM` source; `Business.features.admissions` default false; `FollowUp` gets `applicationId`, `priority`, `title`, new types.
- [ ] `npm run admissions:enable -- <email>` sets the flag on the owner's business and calls `ensureConfig`. Commit.

### Task 3: Access layer and context

**Files:** `access.js`, `contextController.js`, `admissionRoutes.js` (mount in `app.js`); test `test/access.test.js`.

**Interfaces — Produces:** `requireAdmissions(req,res,next)` (sets `req.business`, `req.admissionsConfig`); `getApplicationScope(req) → filter`; `getScopedCounsellorIds(req) → ObjectId[] | null` (null = all); `validateCounsellor(req, id) → { counsellorId } | { status, error }`; `findApplicationInScope(req, id) → doc | null`; `isAdmin(req)`.

- [ ] Tests: business without flag → 404 on `/context`; owner sees all counsellors; manager sees self + own salespeople; salesperson sees self only.
- [ ] Implement mirroring `leadController.getLeadScope`. Commit.

## Phase 2 — Students, checklist, pipeline

### Task 4: Checklist engine

**Files:** `checklist.js`; test `test/checklist.test.js`.

**Interfaces — Produces:** `buildChecklist(config) → item[]`; `syncChecklist(application, config) → boolean changed`; `isApplicable(item, application) → boolean`; `checkRule(item, application) → null | message`; `evaluateStage(application, stageKey, config) → { satisfied, missing: [{ itemId, label, reason }], gateError? }`.

- [ ] Tests: required pending item → missing; N/A counts as satisfied; exam items not applicable when `examRequired === false`; `EXAM_DATE_SET` blocks completion without date; gate fails on `FAILED`; new config item added to un-passed stage only; archived pending item no longer required; completed item keeps its label after config rename.
- [ ] Implement. Commit.

### Task 5: Applications API

**Files:** `applicationController.js`, `filters.js`, `activity.js`; hooks in `Leads.js`; test `test/applications.test.js`.

**Interfaces — Produces:** `logActivity({ req, application, type, message, meta })`; `buildApplicationQuery(req, query) → { filter, sort }` with params `search, stage, intakeYear, intakeMonth, universityId, counsellorId, studyLevel, overdue, stuck, paymentStatus, visaOutcome, status, createdFrom, createdTo, visaFrom, visaTo`; application JSON includes `student`, `counsellor`, `currentStage`, `daysInStage`, `isStuck`, `isFollowUpOverdue`, `warnings[]`.

- [ ] Tests: owner creates student + application assigned to counsellor A; A lists/gets it; counsellor B gets 404; duplicate check by email and by phone `+91 98765 43210` vs `9876543210` returns the match without merging; second application for the same student keeps the first; editing the Lead via `Lead.findOneAndUpdate` updates the application snapshot (Review Focus 3); search by name/phone/email.
- [ ] Implement. Commit.

### Task 6: Checklist and stage endpoints

**Files:** `stageService.js`, `workflowController.js`; test `test/workflow.test.js`.

**Interfaces — Produces:** `moveStage({ req, application, toStageKey, fromStageKey, reason, override }) → { ok } | { status, code, message, missing? }` codes `STAGE_REQUIREMENTS_MISSING` (422), `STAGE_CONFLICT` (409), `APPLICATION_CLOSED` (409), `OVERRIDE_NOT_ALLOWED` (403), `OVERRIDE_REASON_REQUIRED` (400).

- [ ] Tests: blocked move lists missing labels; N/A without reason → 400; salesperson override → 403; owner override with reason → stage history `override: true` + activity; backward move logged with exit/entry timestamps; failed exam blocks and sets `needsReview`; visa REJECTED → `CLOSED`, outcome rejected, further move 409; stale `fromStageKey` → 409 (Review Focus 1); full progression through all 8 stages ending APPROVED.
- [ ] Implement. Commit.

### Task 7: Frontend foundation and Students list

**Files:** `admissions.service.ts`, `admissions.models.ts`, `admissions.utils.ts`, `admissions.routes.ts`, `_admissions.scss`, `students/`; modify `app.routes.ts`, shell.

- [ ] Shell: `currentTab` gains `'admissions'`; render `<router-outlet>` for it; sidebar "Admissions" section (Overview, Pipeline, Students, My tasks, Payments, Settings for owner) shown only when `context.enabled`; mobile sheet entries.
- [ ] Students: search, filter chips from query params, table on desktop / cards on mobile, "Add student" dialog with live duplicate warning, export buttons.
- [ ] `ng build` passes. Commit.

### Task 8: Pipeline board and student profile

**Files:** `pipeline-board/`, `student-profile/`, `profile-checklist/`, `profile-activity/`.

- [ ] Board: columns per active stage + archived stages that still hold applications; counts; HTML5 drag-and-drop calling the stage endpoint; on 422 show the missing list in a dialog (owner sees "Override with reason"); mobile stage tabs with a "Move" sheet; loading/empty/error states.
- [ ] Profile header: stage, days in stage, next follow-up, pending requirement count, outstanding by currency, warnings. Tabs. Checklist tab with per-item status buttons, N/A reason prompt, "Move to next stage" when satisfied, assessment and visa panels. Activity tab with note composer.
- [ ] `ng build` passes. Commit.

## Phase 3 — Tasks, reminders, stuck alerts

### Task 9: Tasks API

**Files:** `taskController.js`; modify `followUpController.js` (`VALID_TYPES`), `FollowUp.js` (post hooks → `refreshNextFollowUp(applicationId)`); test `test/tasks.test.js`.

- [ ] Tests: task created for application appears in assignee's `GET /tasks`, not in another counsellor's; owner `?assignedTo=`; complete sets `completedAt`; reschedule updates `nextFollowUpAt`; overdue filter.
- [ ] Implement. Commit.

### Task 10: Reminders, notifications, stuck job

**Files:** `reminders.js`, `Reminder.js`, `Notification.js`, `notificationController.js`, `notificationRoutes.js`, `admissionsReminderJob.js`; test `test/reminders.test.js`.

**Interfaces — Produces:** `syncRemindersForApplication(applicationId)`, `syncRemindersForTask(task)`, `syncRemindersForFee(fee)`, `syncRemindersForDocument(doc)`; `processDueReminders(now) → count`; `runStuckCheck(now) → count`; `startAdmissionsReminderJob()`.

- [ ] Tests: syncing twice → one reminder; processing twice → one notification; reminder for exam fires `reminderDefaults.examDaysBefore` days before; stuck notification only after that stage's threshold, once per stage entry; closed application excluded; reassign moves pending reminders to the new counsellor and old counsellor gets 404 (Review Focus 4).
- [ ] Implement. Commit.

### Task 11: Frontend tasks and notifications

- [ ] My tasks: Overdue / Today / Upcoming grouped in config timezone, complete and reschedule, owner staff filter, links to profile. Profile Tasks tab. Notification bell in shell header (poll 60 s, mark read, link). `ng build`. Commit.

## Phase 4 — Documents and payments

### Task 12: Storage and documents

**Files:** storage files, `documentController.js`; test `test/documents.test.js`.

**Interfaces — Produces:** `storage.put(key, buffer, mime)`, `storage.getStream(key)`, `storage.remove(key)`, `storage.signedUrl(key, { filename, ttlSeconds }) → string | null` (null for local driver → API issues `/files/:token`); `detectFileType(buffer) → { ext, mime } | null`.

- [ ] Tests: `.exe` renamed `.pdf` rejected; > limit rejected 413; upload sets `UPLOADED` not `VERIFIED`; reject without reason 400; other counsellor download-url → 404; file token for another business or expired → 401; owner and assignee download OK.
- [ ] Implement. Commit.

### Task 13: Payments

**Files:** `payments.js`, `paymentController.js`; test `test/payments.test.js`.

**Interfaces — Produces:** `computeFee(fee) → { paidMinor, outstandingMinor, status }`; `summarize(fees) → [{ currency, dueMinor, paidMinor, outstandingMinor }]`; `refreshApplicationPayments(applicationId)`.

- [ ] Tests: 1000 due, pay 400 → PARTIALLY_PAID 600 outstanding; pay 600 → PAID; overpay → 400; void → recomputed; INR and EUR fees never summed together; checklist "University fee paid" completion leaves fee UNPAID; money input cases (Review Focus 5).
- [ ] Implement. Commit.

### Task 14: Frontend documents and payments

- [ ] Documents tab (types with status, upload, verify/reject, expiry, secure open via download-url). Payments tab (fees, add payment with optional receipt, void). Payment tracker page with filters, currency totals, export. `ng build`. Commit.

## Phase 5 — Dashboard, exports, settings

### Task 15: Dashboard and exports

**Files:** `dashboardController.js`, `exporter.js`; test `test/dashboard.test.js`.

**Interfaces — Produces:** `toCsv(columns, rows)`, `toXlsxBuffer(columns, rows, sheetName)`, `safeCell(value)` (prefixes `'` when a string starts with `= + - @` tab or CR).

- [ ] Tests: counsellor's dashboard counts only their applications and equal the list endpoint totals; owner sees all; export rows equal filtered list rows; `=HYPERLINK(...)` name exported as `'=HYPERLINK(...)`; conversion = approved ÷ created in period.
- [ ] Implement. Commit.

### Task 16: Settings

**Files:** `settingsController.js`; test `test/settings.test.js`.

- [ ] Tests: salesperson PUT → 403; removing an existing stage/item key → 400 "archive instead"; archived stage with applications still listed by the board query (Review Focus 2); reorder persists; threshold change affects stuck; new university/course and archive.
- [ ] Implement. Commit.

### Task 17: Frontend overview and settings

- [ ] Overview: filter bar, metric cards linking to Students with matching query params, per-stage bars, outstanding by currency, visa outcomes, conversion with definition. Settings: stages (rename, reorder, threshold, archive, add), items (label, required, condition), document types, lead sources, universities/courses, reminder defaults, timezone. `ng build`. Commit.

## Phase 6 — Delivery

### Task 18: Dev data, docs, verification

- [ ] `scripts/dev-memory.js`: starts an in-memory MongoDB, seeds an owner/manager/2 counsellors and ~25 synthetic students across stages, runs the API on 5001. `npm run dev:memory`.
- [ ] `sales-follow-up-backend/ADMISSIONS.md`: env vars (`STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `S3_*`, `UPLOAD_MAX_MB`, `ADMISSIONS_JOB_INTERVAL_SECONDS`), enable script, backups (Atlas snapshots + bucket versioning), limitations.
- [ ] `npm test` all pass; `ng build`; `ng test` (only the pre-existing `app.spec.ts` matchMedia failures allowed). Commit.
