# SYB Student Admissions — Design

Status: approved by the owner ("do as you would") on 2026-11-03.
Requirements: the owner's full brief is in `2026-11-03-syb-admissions-requirements.md` (same folder). This document records how it maps onto this CRM and the decisions taken.

## Intent

SYB places Bachelor's and Master's students in Czech universities. Staff need one place to see every student from first enquiry to visa result: what's done, what's pending, what's overdue and what's owed. Most staff are non-technical, so screens must be simple and work on a phone.

## Fit with the existing CRM

| Need | Existing piece reused | Change |
|---|---|---|
| Tenant isolation | `businessId` on every model | Same pattern on all new models |
| Admin vs counsellor | Roles `OWNER`, `SALES_MANAGER`, `SALESPERSON`; scope logic in `leadController.getLeadScope` | Admin = `OWNER`. Counsellor = `SALESPERSON` (own records). `SALES_MANAGER` sees own + their salespeople's records, like leads. Only `OWNER` configures or overrides. |
| Student identity | `Lead` (name, email, phone, source, assignedTo) | Student **is** a Lead. Add `whatsapp`, `city`, `phoneDigits` (normalised), `INSTAGRAM` source. No second contact table. |
| One application per attempt | — | New `AdmissionApplication` linked to the Lead (`studentId`). A returning student gets a new application; old ones stay. |
| Follow-ups / tasks | `FollowUp` (lead, assignee, scheduledAt, status, completedAt) | Add `applicationId`, `priority`, `title`, task types (`TASK`, `DOCUMENT`, `PAYMENT`, `EXAM`, `INTERVIEW`, `VISA`). Admissions tasks show in the existing Follow-ups page too. |
| Scheduler | `setInterval` job pattern (`quotationExpiryJob`) | New reminder job, same pattern, but state lives in Mongo so missed runs catch up. |
| Notifications, audit log, file storage, exports, backend tests | none exist | Built new (below). |

## Decisions (owner delegated these)

1. **Module on/off per business.** `Business.features.admissions` (default `false`). Turned on with `npm run admissions:enable -- <owner-email>`, which also seeds the default configuration. Other businesses never see the module; every admissions endpoint returns 404 for them.
2. **Document storage.** Storage driver interface with two drivers: `local` (private folder outside any web root, dev default) and `s3` (Cloudflare R2 recommended, any S3-compatible works). Downloads go through an authorised endpoint that returns a 60-second signed link. No public URLs.
3. **Reminders survive sleep.** Render's free plan sleeps; reminders are rows in Mongo with `remindAt`. The job runs every minute while awake and on startup sends everything now due, so nothing is lost, only late.
4. **Timezone.** Stored in UTC; displayed in the module's configured timezone, default `Asia/Kolkata`, editable in Admissions settings.
5. **Money.** Stored as integer minor units (paise/cents) per fee with its own currency (`INR`, `EUR`, `CZK`, `USD`). Totals are always grouped by currency; there is no conversion.
6. **No malware scanner exists.** Uploads are restricted by size (10 MB), extension and magic bytes (PDF, JPEG, PNG, WEBP), stored under random names. A `scanFile()` hook is left as the place to plug ClamAV or a cloud scanner later.

## Model

- **AdmissionConfig** (one per business): `stages[]` (key, name, order, stuckThresholdDays, isArchived, `items[]`), `documentTypes[]`, `leadSources[]`, `reminderDefaults`, `timezone`. Items: key, label, required, `condition` (when applicable), `rule` (data that must exist before completion), isArchived. Keys never change; archiving replaces deleting.
- **University** (per business): name, city, `courses[]` (name, level, isArchived), isArchived.
- **AdmissionApplication**: student link + snapshot (name/email/phone for search, kept in sync by Lead hooks), counsellor, study level, intake month/year, lead source, shortlist, final choice, `currentStageKey`, `stageEnteredAt`, `stageHistory[]` (entered/exited/by/direction/override reason), `checklist[]` (per-item status + history), `assessment` (interview/exam required, dates, results), `visa` (appointment, outcome), `status` (`ACTIVE`/`CLOSED`/`WITHDRAWN`), `needsReview` + reason, `nextFollowUpAt`, `paymentSummary`.
- **AdmissionDocument**: type key, status (`MISSING`/`UPLOADED`/`VERIFIED`/`REJECTED`), file metadata (storage key, original name, mime, size, sha256), uploader, reviewer, rejection reason, expiry.
- **AdmissionFee**: category (`AGENCY_FEE`/`UNIVERSITY_FEE`/`NOSTRIFICATION_FEE`), amountDue, currency, dueDate, `transactions[]` (amount, paidAt, reference, receipt, voided). Paid / outstanding / status derived on save.
- **AdmissionActivity**: one timeline for notes, stage moves, checklist, assignment, documents, payments, tasks.
- **Reminder** (dedupe key unique) and **Notification** (dedupe key unique, per recipient).
- **Migration**: names of applied startup migrations.

## Checklist and stage rules

- Item status: `PENDING`, `COMPLETED`, `NOT_APPLICABLE` (reason required). Completion records who and when; every change is appended to the item's history.
- Conditional items (`INTERVIEW_REQUIRED`, `EXAM_REQUIRED`) only count when the application says that assessment applies. When it says it doesn't, the item is shown as "Not needed".
- Rules block completion until the data exists: e.g. "Exam date recorded" needs `assessment.examAt`; "Visa result recorded" needs an outcome.
- A stage is satisfied when every applicable required item is `COMPLETED` or `NOT_APPLICABLE`. Moving forward checks the current stage and every skipped stage. The answer lists exactly which items are missing.
- **Gates:** leaving *University Application* is blocked while any required interview/exam is `FAILED` or has no result; a failure sets `needsReview`. Recording a visa outcome closes the application (`CLOSED`); rejection never counts as approval; closed applications can't move.
- Backward moves are allowed and logged; checklist history is kept.
- `OWNER` can override a blocked move with a reason (≥ 5 characters), recorded in stage history and activity.
- Drag-and-drop, the profile button and the mobile "Move" action all call the same endpoint.
- Changing templates: an application keeps its own snapshot of items. Pending items follow config edits (label/required); completed items keep their recorded label; new config items are added to stages the application hasn't passed yet; archived items stop being required.

## Screens

Under `/admissions` inside the existing app shell: **Overview** (dashboard), **Pipeline**, **Students** (searchable, filterable list + export, target of every dashboard card), **Student profile** (`/admissions/students/:id`, tabs: Overview, Checklist, Documents, Payments, Tasks, Activity), **My tasks**, **Payments**, **Settings** (owner only). A notification bell joins the shell header. Nav entries appear only when the module is enabled.

Dashboard definitions: *New leads* = applications created in the period. *Active* = status `ACTIVE`. *Stuck* = active and `now − stageEnteredAt` > that stage's threshold. *Conversion* = of applications created in the period, the share whose visa is approved (shown with that wording). Default period: last 12 months.

## Out of scope for v1 (design leaves room)

WhatsApp/email templates and sending, Instagram/website lead capture, parent contacts. Activity types and the notification channel field leave room for them.
