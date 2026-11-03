# SYB Student Admissions — Requirements (owner's brief, 2026-11-03)

SYB places Bachelor's and Master's students in universities in the Czech Republic. This module must track each student from first enquiry to visa result. Extend the existing CRM; follow its architecture, design system, authentication, permissions, database conventions and deployment setup. Do not replace existing CRM functionality, introduce a second authentication system or unnecessarily change the technology stack.

## Objectives
- One student profile showing current stage, completed steps and pending work.
- A clear view of the full admissions pipeline.
- Follow-up, deadline and payment tracking.
- A simple interface for non-technical staff; responsive on desktop and mobile.
- Configurable stages and checklists without code changes.

## Default pipeline (seed in this order)
1. **Lead / Counselling** — Enquiry received; Counselling completed; Course, budget and intake discussed. Capture enquiry source (Instagram, referral, website, walk-in…).
2. **University Selection** — University/course shortlist shared; Student's final choice confirmed.
3. **Apostille** — Documents sent for apostille; Apostille process completed; Documents reviewed; Copy of apostilled documents received by email.
4. **University Application** — Application submitted; Interview or entrance exam requirement recorded; Entrance exam/interview date recorded (when applicable); Preparation completed (when applicable); Exam result recorded: passed or failed (when applicable). Separate interview and exam requirements; conditional items may be marked Not applicable with a reason; a failed exam flags the application for review rather than advancing it.
5. **Pre-enrollment** — University confirmation email received; Payment reviewed; Pending documents reminder sent (when applicable).
6. **Nostrification** — Documents notarized; Nostrification form completed; Documents couriered to the Czech Republic; Nostrification payment completed; Confirmation received.
7. **Offer Letter** — University fee paid; Nostrification submitted; Offer letter and accommodation letter requested by email; Offer letter received by email; Accommodation letter received by email; Original offer letter sent by post; Courier received for visa documents.
8. **Visa** — PCC application initiated; Visa appointment registered; Visa appointment/interview date recorded; Visa interview preparation completed; Visa documents ready; Visa interview completed; Visa result recorded: approved or rejected. Approval/rejection are final outcomes, not stages.

## Workflow rules
- Items: Pending, Completed, Not Applicable (reason required). Record who completed and when. Required/optional set in configuration. Conditional requirements validated on the backend.
- When all required items are satisfied, show "Move to next stage". Drag-and-drop and any other stage change use the same backend validation. Missing requirements are explained exactly.
- Admins may override with a mandatory reason, recorded in history. Backward moves logged; checklist history preserved. Stage entry/exit timestamps recorded.
- Checklist completion is separate from document verification and payment transactions. Uploading ≠ verified. Completing a checklist item never marks a fee paid.
- Existing applications keep their history when templates change.
- One student identity; one application per intake/attempt.

## Data
- Student: full name, phone, email, WhatsApp, city.
- Admissions: level (Bachelor's/Master's), intake month/year, lead source, assigned counsellor, shortlist, final selection, current stage + entry date, checklist statuses, exam/interview requirements/dates/results, visa appointment and outcome, next follow-up, notes and activity.
- Documents: configurable types (passport, certificates, transcripts, apostilled documents, PCC, offer letter, accommodation letter, visa documents); checklist-only records and uploads; status Missing/Uploaded/Verified/Rejected; reviewer, review date, rejection reason; uploader and time; expiry dates.
- Payments: agency fee, university fee, nostrification fee; amount due, currency, due date; multiple transactions (amount, date, reference, optional receipt); paid and outstanding calculated; Unpaid/Partially Paid/Paid; no cross-currency totals without conversion.
- Notes/activity: content, author, time; history of stage moves, checklist changes, assignments, document reviews, payment changes.
- Warn about possible duplicates by normalised email/phone; never auto-merge on phone alone.

## Screens
- **Dashboard:** new leads, active applications, per-stage counts, overdue follow-ups, stuck students, outstanding payments by currency, visas approved/rejected, lead-to-visa conversion (defined, with period); filters by intake, month, counsellor, university, level; permission-scoped; cards link to filtered records.
- **Pipeline board:** eight columns with counts; drag-and-drop with validation; cards (name, university/course, intake, counsellor, time in stage, next follow-up, warnings); search and filters; loading/empty/error states; mobile list or stage tabs with a stage-change action.
- **Student profile:** Overview, Checklist, Documents, Payments, Follow-ups/tasks, Notes and activity; current stage, next follow-up, pending requirements and outstanding balance immediately visible.
- **Today's tasks:** signed-in user's tasks in Overdue/Today/Upcoming; type, student, due, priority, status; complete/reschedule; links to profile; admins filter by staff.
- **Payment tracker:** due/paid/outstanding per application; due and overdue; totals by currency; filters (student, intake, counsellor, category, status); export.
- **Settings (admin):** stages and order, checklist items with required/conditional settings, stuck thresholds, document types, lead sources, universities and courses, reminder defaults. Archive in-use configuration.

## Reminders and stuck alerts
Follow-ups have owner, due time, status, completion time. Reminders for follow-ups, exams/interviews, visa appointments, document deadlines, payment due dates; in-app in v1; persistent server-side scheduling; no duplicates; consistent timestamps shown in the configured timezone. Stuck threshold default 7 days per stage, from latest stage entry; closed (visa outcome) applications excluded.

## Permissions and security
- Admin/founder: everything, assign counsellors, configure, all reports/exports, override validation.
- Staff/counsellor: only assigned records; manage their checklists, documents, payments, notes, tasks; scoped dashboards/exports; no configuration or override.
- Enforced on the backend for every endpoint, search, dashboard, export, preview and download; tenant isolation preserved.
- Private storage, authorised downloads / short-lived signed URLs, file type and size validation, safe names, no public URLs, no logging of document contents. Document backup requirements for database and files.

## Search and exports
Search by name, phone, email. Filters: stage, intake, university, counsellor, level, overdue follow-up, stuck, payment status, visa outcome. CSV and Excel exports respecting filters and permissions, no binaries, protected against formula injection.

## Acceptance
Tests for admin vs staff restrictions, unauthorised record/file access, required/conditional validation, stage movement and override history, partial payments, reminder dedupe, stage duration and stuck, scoped dashboard totals and exports. Verify: admin creates student and assigns; only the assignee can access record and files; full progression through 8 stages; incomplete requirements block with an explanation; exam failure and visa rejection don't falsely progress; follow-ups appear in the right task list; stuck alerts follow thresholds; payments calculate; documents private; dashboard matches records; exports respect filters and permissions; mobile works; existing CRM checks still pass.

Later (design for, don't build): WhatsApp/email templates, Instagram/website lead capture, parent contacts.
