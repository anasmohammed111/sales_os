# Custom Sales Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each company shapes its own sales pipelines (several per company, custom stages with name, colour, kind and order), can link a pipeline to Admissions when it has the module, and every existing company keeps today's board unchanged.

**Architecture:** A new `Pipeline` collection holds each company's pipelines and their stages. `Lead` gains `pipelineId` and keeps `status` as the stage **key**, so history and most queries keep working. Everything that used to test stage names (board, dashboard, reports, admissions hand-off) asks a small pipelines service for the stage's **kind** instead. A migration gives each existing company one "Sales pipeline" with today's twelve stage keys.

**Tech Stack:** Express 5 + Mongoose 9 (backend, `node --test` + supertest + mongodb-memory-server), Angular 22 standalone + signals (CRM, Vitest via `ng test`).

**Spec:** `docs/superpowers/specs/2026-11-05-custom-sales-pipelines-design.md`

## Global Constraints

- Stage kinds, exactly: `OPEN`, `WON`, `LOST`, `PARKED`, `ADMISSIONS`.
- A pipeline always has ≥1 `OPEN`, ≥1 `WON`, ≥1 `LOST` stage and ≤1 `ADMISSIONS` stage; a *new* `ADMISSIONS` stage is allowed only when `Business.features.admissions === true` (an existing one may be kept when the module is off).
- Stage `key` matches `/^[A-Z0-9_]{1,40}$/`, is unique within its pipeline and never changes on rename. Stage name 1–60 chars, trimmed. Pipeline name 1–60 chars, unique per company (case-insensitive) among non-archived pipelines.
- Colours are stored as `#RRGGBB`.
- A lead with no `pipelineId` belongs to the company's default pipeline, everywhere (read-time fallback).
- Every query on stages pairs `pipelineId` with the stage key: two pipelines may use the same key.
- Moving into a `LOST` stage requires a lost reason of 3–500 chars (today's rule and message). Leaving a stage for anything but `LOST` clears `lostReason`.
- Existing companies: first pipeline named `Sales pipeline`, today's 12 stages, keys unchanged. New companies (registration): `Sales pipeline` with the 7 standard stages.
- New permission `settings.pipelines`, label `Set up pipelines and stages`, in the `settings` module; Owner has it; it is added to the `except` lists of `SALES_MANAGER` and `SALESPERSON` defaults.
- The local `npm run dev` server (port 5001) uses the **live** database and applies migrations on save. Test only with `scripts/dev-memory.js` / the test suite. Do not run the dev server, deploy, or push without the owner's go-ahead.
- Deliberate visible change (owner to be told): the dashboard's "N qualified or further" becomes "N past the first stage" (open leads not in their pipeline's first `OPEN` stage).
- "A WON-kind lead can't change stage" applies only to `PATCH /api/leads/:id` (including a pipeline change there); the board, stage/pipeline removal moves and the Admissions sync are not blocked.
- Bulk moves (removed stage, removed pipeline, pipeline change in the lead form) cannot target an `ADMISSIONS` stage: 400 `Use "Move to Admissions" to hand a lead over`.
- Removed stages are archived (`stages[].isArchived: true`), never erased; their keys are never reused. Every `statusHistory` entry records `pipelineId`.

## Review Focus

1. **Lead with no `pipelineId`** (created by `scripts/`, old code paths, tests): shows on the default pipeline's board and counts on the dashboard. → test in Task 4.
2. **Same stage key in two pipelines** (a copied pipeline): the board for pipeline B never shows pipeline A's leads; won/lost counts stay per stage. → tests in Tasks 3 and 4.
3. **Module switched off after linking:** the `ADMISSIONS` stage still shows with its leads, saving other edits to that pipeline still succeeds, adding a new `ADMISSIONS` stage fails. → test in Task 3.
4. **Removing a stage that has leads without saying where they go:** 409 listing those stages, nothing saved. → test in Task 3.
5. **Moving a lead into a stage deleted a moment ago** (stale board): 400 "That stage no longer exists", lead unchanged. → test in Task 4.

---

### Task 1: Pipeline model and pipelines service

**Files:**
- Create: `sales-follow-up-backend/src/models/Pipeline.js`
- Create: `sales-follow-up-backend/src/services/pipelines/index.js`
- Test: `sales-follow-up-backend/test/pipelines-service.test.js`

**Interfaces:**
- Produces (model): `Pipeline` with `businessId` (ObjectId, indexed), `name`, `isDefault` (Boolean), `order` (Number), `isArchived` (Boolean, default false), `stages: [{ key, name, color, kind, order, isArchived }]`, timestamps. Export `STAGE_KINDS`. Lookups and kind rules ignore archived stages except `stageOf` (history labels).
- Produces (service, all `async` unless noted):
  - `STANDARD_STAGES` / `LEGACY_STAGES`: arrays of `{ key, name, color, kind }`. Standard = NEW New `#64748B` OPEN, CONTACTED Contacted `#2563EB` OPEN, QUALIFIED Qualified `#7C3AED` OPEN, QUOTATION_SENT Quotation sent `#F59E0B` OPEN, NEGOTIATION Negotiation `#E5603E` OPEN, WON Won `#10B981` WON, LOST Lost `#EF4444` LOST. Legacy = the same in board order plus ADMISSIONS Admissions `#2563EB` ADMISSIONS (after WON), ON_HOLD On hold `#D97706`, CLOSED Closed `#475569`, NO_LONGER_REQUIRED Not required `#64748B`, UNRESPONSIVE Unresponsive `#94A3B8` (all four PARKED), LOST last — matching `DEFAULT_STAGES` order in `sales-follow-up-web/src/app/pipeline/pipeline.ts:32-46`.
  - `ensureDefaultPipeline(businessId, { stages = LEGACY_STAGES } = {}) → Pipeline`: returns the default if the company has any non-archived pipeline; otherwise creates `Sales pipeline` (`isDefault: true`, `order: 0`). Drops the `ADMISSIONS` stage unless the business has the module **or** has a lead with `status: 'ADMISSIONS'`.
  - `listPipelines(businessId) → Pipeline[]` (non-archived, by `order`; calls `ensureDefaultPipeline` first).
  - `stageLookup(pipelines) → { stageOf(pipelineId|null, key) → stage|null, kindOf(pipelineId|null, key) → kind|null, defaultId }` (sync; `null` pipelineId → default).
  - `kindFilter(pipelines, kinds: string[]) → mongo filter` (sync): `{ $or: [{ pipelineId, status: { $in: keys } }, …] }`, where the default pipeline's branch also matches `pipelineId: null`; `{ _id: null }` when nothing matches.
  - `validateStages(stages, { admissionsEnabled, existingKeys = [] }) → normalized stages` (sync): throws `{ status: 400, message }` on rule breaks (Global Constraints); assigns keys to stages without one (`slug(name)`, uppercased, `_2`, `_3` … on clash); sets `order` from array position.
  - `admissionsTarget(businessId, lead) → { pipelineId, status } | null`: spec rule — the lead's own pipeline if it has an `ADMISSIONS` stage, else the default if linked, else the first linked by `order`, else `null`.
  - `linkAdmissionsOnEnable(businessId) → boolean`: if no non-archived pipeline has an active `ADMISSIONS` stage, inserts `{ key: 'ADMISSIONS' (or `ADMISSIONS_2`… if archived), name: 'Admissions', color: '#2563EB', kind: 'ADMISSIONS' }` into the default pipeline right after its first `WON` stage; returns whether it changed anything.

- [ ] **Step 1: Write failing tests** in `test/pipelines-service.test.js` (use `h.startDb/stopDb/resetDb`, `h.makeBusiness`):
  - `ensureDefaultPipeline creates "Sales pipeline" once with the legacy keys` — call twice → 1 pipeline; `stages.map(s => s.key)` equals the 12 legacy keys in order; `isDefault === true`.
  - `the Admissions stage is only added when the company has the module or Admissions leads` — `makeBusiness({ admissions: false })` → no `ADMISSIONS` key; with a lead `status: 'ADMISSIONS'` → present; `makeBusiness()` (module on) → present.
  - `kindFilter matches leads without a pipelineId on the default pipeline only` — leads: (default, WON), (null, WON), (other pipeline copy, WON) → `Lead.countDocuments(kindFilter([default], ['WON']))` is 2.
  - `validateStages enforces kinds` — missing WON → 400 `/Won/`; two ADMISSIONS → 400; new ADMISSIONS with `admissionsEnabled: false` → 400; existing ADMISSIONS key kept with module off → ok; bad colour `red` → 400; duplicate names allowed but keys unique (`Call`, `Call` → `CALL`, `CALL_2`).
  - `admissionsTarget follows the spec order` — own linked pipeline → own; own unlinked + default linked → default's ADMISSIONS; none linked → `null`.
  - `linkAdmissionsOnEnable adds a hand-off stage once` — default pipeline without ADMISSIONS → returns `true`, stage inserted after `WON`; second call → `false`, unchanged; a company where another pipeline is linked → `false`.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/pipelines-service.test.js` — expect FAIL (`Cannot find module '../src/services/pipelines'`).
- [ ] **Step 3: Implement** the model and service per the Interfaces block.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `feat(pipelines): pipeline model and stage-kind service`.

---

### Task 2: Lead pipelineId, migration, new-company pipeline, permission

**Files:**
- Modify: `sales-follow-up-backend/src/models/Leads.js:92-111` (drop the `status` enum, keep `default: 'NEW'`, add `pipelineId` ObjectId ref `Pipeline`, `default: null`, index `{ businessId: 1, pipelineId: 1, status: 1 }`)
- Create: `sales-follow-up-backend/src/migrations/004-sales-pipelines.js`; register in `src/migrations/index.js`
- Modify: `sales-follow-up-backend/src/controllers/authController.js` (register: after `giveOwnerRole`, `ensureDefaultPipeline(business._id, { stages: STANDARD_STAGES })`)
- Modify: `sales-follow-up-backend/src/services/access/catalog.js` (settings action `pipelines`; `REQUIRES['settings.pipelines'] = ['pipeline.view']`; add to SALES_MANAGER and SALESPERSON `except`)
- Test: `sales-follow-up-backend/test/pipelines-migration.test.js`

**Interfaces:**
- Consumes: `ensureDefaultPipeline`, `STANDARD_STAGES` (Task 1).
- Produces: migration id `004-sales-pipelines`; every lead of every business has `pipelineId` = that business's default pipeline after it runs.

- [ ] **Step 1: Write failing tests:**
  - `the migration gives every company its first pipeline and every lead a pipelineId, and can run twice` — two businesses with leads in `NEGOTIATION` and `ADMISSIONS`; run `require('../src/migrations/004-sales-pipelines').up()` twice → each business has exactly 1 pipeline; `Lead.countDocuments({ pipelineId: null })` is 0; lead `status` values unchanged.
  - `a newly registered company starts with the standard seven stages` — `POST /api/auth/register` → its pipeline's keys equal `['NEW','CONTACTED','QUALIFIED','QUOTATION_SENT','NEGOTIATION','WON','LOST']`.
  - `only the owner can set up pipelines by default` — `GET /api/auth/me` for OWNER includes `settings.pipelines`; SALES_MANAGER and SALESPERSON do not.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/pipelines-migration.test.js` — expect FAIL.
- [ ] **Step 3: Implement** the model change, migration (per business: `ensureDefaultPipeline`, then `Lead.updateMany({ businessId, pipelineId: null }, { $set: { pipelineId } })`), registration hook and permission.
- [ ] **Step 4: Run** it, then `npm test` — expect all PASS (existing tests rely on the read-time fallback and the legacy keys).
- [ ] **Step 5: Commit** `feat(pipelines): migrate leads onto a first pipeline; pipeline permission`.

---

### Task 3: Pipelines settings API

**Files:**
- Create: `sales-follow-up-backend/src/controllers/pipelineSettingsController.js`
- Create: `sales-follow-up-backend/src/routes/pipelineSettingsRoutes.js`; mount in `src/app.js` as `app.use('/api/pipelines', …)` (next to `/api/pipeline`)
- Test: `sales-follow-up-backend/test/pipelines-api.test.js`

**Interfaces:**
- Consumes: Task 1 service.
- Produces (all behind `authMiddleware`):
  - `GET /api/pipelines` (any signed-in member) → `{ data: { pipelines: [{ id, name, isDefault, order, linkedToAdmissions, stages: [{ key, name, color, kind, order, leadCount? }] }], admissionsEnabled } }`. `leadCount` only for people with `settings.pipelines`.
  - `POST /api/pipelines` (`settings.pipelines`) `{ name, template: 'STANDARD'|'BLANK'|'COPY', copyFrom? }` → 201 `{ data: { pipeline } }`. BLANK = `New` (OPEN), `Won`, `Lost`. COPY keeps the source's keys, names, colours, kinds (drops ADMISSIONS when the module is off).
  - `PATCH /api/pipelines/:id` (`settings.pipelines`) `{ name?, isDefault?: true, stages?: [{ key?, name, color, kind }], moves?: { [removedKey]: targetKey } }` → 200 `{ data: { pipeline } }`; 409 `{ code: 'STAGES_HAVE_LEADS', stages: [{ key, name, leadCount }] }` when a removed stage has leads and no move; moves rewrite `status` (and push a `statusHistory` entry with reason `Stage removed` and the `pipelineId`); stages left out of `stages` are archived; a move target of `ADMISSIONS` kind → 400 (Global Constraints). `isDefault: true` clears it on the others. Response includes `newlyLinkedLeadCount` when this save made an existing stage the hand-off stage while it held leads (the UI warns they won't become students automatically).
  - `DELETE /api/pipelines/:id` (`settings.pipelines`) `{ moveTo?: { pipelineId, stageKey } }` → 200 (archives); 409 `{ code: 'DEFAULT_PIPELINE' }`; 409 `{ code: 'PIPELINE_HAS_LEADS', leadCount }` without `moveTo`; `moveTo` an `ADMISSIONS` stage → 400.
  - `GET` returns every stage with `isArchived`; the CRM hides archived ones except for history labels.

- [ ] **Step 1: Write failing tests** (`h.makeBusiness`, `h.makeUser`, `h.auth`):
  - `members read pipelines; only pipeline admins change them` — SALESPERSON GET 200 without `leadCount`; SALESPERSON POST 403; OWNER POST 201.
  - `create from standard, blank and a copy` — keys as specified; copy of a pipeline with `ADMISSIONS` into a module-off company drops it.
  - `rename stages without touching leads` — PATCH renaming `WON` to `Enrolled`, colour `#123ABC` → lead in `WON` still `status: 'WON'`; GET shows `Enrolled`.
  - `removing a stage with leads needs a destination` (Review Focus 4) — PATCH without `moves` → 409 `STAGES_HAVE_LEADS` and the pipeline unchanged; with `moves: { ON_HOLD: 'NEW' }` → 200, the lead is in `NEW` with a history entry carrying `pipelineId`, and `ON_HOLD` is still in the pipeline with `isArchived: true`; `moves: { ON_HOLD: 'ADMISSIONS' }` → 400.
  - `two pipelines can share stage keys` (Review Focus 2) — copy, then GET shows both with `NEW`; `leadCount` per pipeline correct.
  - `linking needs the module; an existing link survives the module going off` (Review Focus 3) — module off: PATCH adding an ADMISSIONS stage → 400; module on: add it → 200; switch module off, PATCH renaming another stage → 200 and the ADMISSIONS stage is kept.
  - `the default pipeline cannot be deleted; deleting with leads needs a destination` — DELETE default → 409 `DEFAULT_PIPELINE`; DELETE second pipeline with a lead, no `moveTo` → 409; with `moveTo` → 200, lead moved, pipeline archived and gone from GET.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/pipelines-api.test.js` — expect FAIL (404s).
- [ ] **Step 3: Implement** controller and routes.
- [ ] **Step 4: Run** it — expect PASS.
- [ ] **Step 5: Commit** `feat(pipelines): settings API for pipelines and stages`.

---

### Task 4: Board and lead endpoints work per pipeline

**Files:**
- Modify: `sales-follow-up-backend/src/controllers/pipelineController.js` (remove `PIPELINE_STAGES`, `TERMINAL_OR_EXIT_STATUSES`, `ALLOWED_STATUS_TRANSITIONS`; `getPipeline` takes `?pipelineId=`; `updatePipelineStatus` validates against the lead's pipeline)
- Modify: `sales-follow-up-backend/src/controllers/leadController.js` (remove the same three constants; create/list/update by pipeline)
- Test: `sales-follow-up-backend/test/pipeline-board.test.js`

**Interfaces:**
- Consumes: `listPipelines`, `stageLookup`, `kindFilter`.
- Produces:
  - `GET /api/pipeline?pipelineId=` (default pipeline when omitted; 404 if not the company's) → today's shape plus `pipeline: { id, name }`, and each `data[]` item gains `name`, `color`, `kind`; columns follow the pipeline's stage order; the `$match` adds `pipelineId` (default also matches `null`). Summary: `activeLeads`/`pipelineValue` = `OPEN` kind, `won*` = `WON` kind, `lost*` = `LOST` kind.
  - `PATCH /api/pipeline/:leadId/status` `{ status }`: `status` must be a stage key of the lead's pipeline, else 400 `That stage no longer exists`; any stage → any stage; `LOST` kind needs the reason (today's messages).
  - `POST /api/leads` accepts `pipelineId` (default when omitted) and `status` (stage key of that pipeline; default = its first `OPEN` stage).
  - `GET /api/leads` accepts `pipelineId`; `status` must exist in some company pipeline (400 `Invalid status filter` otherwise); the overdue filter's `$nin: ['WON','LOST']` becomes "not a `WON`/`LOST` kind" via `kindFilter`.
  - `PATCH /api/leads/:id` accepts `pipelineId` (target stage = body `status` or that pipeline's first `OPEN` stage; an `ADMISSIONS` target → 400); a lead in a `WON`-kind stage can't change stage or pipeline here (today's message `Closed WON deals cannot change status`); `LOST` kind needs the reason.
  - Every `statusHistory` entry these endpoints push includes `pipelineId` (add the field to the `Leads.js` history sub-schema).

- [ ] **Step 1: Write failing tests:**
  - `the board shows the chosen pipeline's stages in order with names, colours and kinds`.
  - `a lead without a pipelineId shows on the default board` (Review Focus 1) — `Lead.collection.insertOne` without `pipelineId`.
  - `a copied pipeline's board never shows the original's leads` (Review Focus 2).
  - `any stage to any stage; lost needs a reason` — `NEW → NEGOTIATION` 200 (the old transition table refused it); move into a renamed LOST-kind stage without reason → 400 `Lost reason is required when marking a lead as LOST`.
  - `moving into a stage that was just removed is refused` (Review Focus 5) — 400 `That stage no longer exists`, status unchanged.
  - `a new lead lands in the default pipeline's first open stage; pipelineId picks another` — POST twice, check `pipelineId`/`status`.
  - `renamed won and lost stages still count in the board summary` — rename `WON` to `Enrolled` → `summary.wonDeals` unchanged.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/pipeline-board.test.js` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it, then `npm test` — expect all PASS.
- [ ] **Step 5: Commit** `feat(pipelines): board and leads follow each company's pipelines`.

---

### Task 5: Admissions hand-off, module switch-on, and the home dashboard by kind

**Files:**
- Modify: `sales-follow-up-backend/src/controllers/admissions/applicationController.js:143-155,192` (new lead gets `pipelineId`/`status` from `admissionsTarget`, falling back to the default pipeline's first OPEN stage; existing lead moved via `admissionsTarget`, or left alone when it returns `null`)
- Modify: `sales-follow-up-backend/src/controllers/homeDashboardController.js` (remove `OPEN_STATUSES`, `QUALIFIED_STATUSES`, `STATUS_LABELS`; use `listPipelines` + `stageLookup`)
- Modify: `sales-follow-up-backend/src/controllers/platformController.js` (`updateFeatures`), `src/controllers/platformSubscriptionController.js` (`applyPlanModules`), `scripts/admissions-enable.js`: after Admissions turns on, `await linkAdmissionsOnEnable(businessId)`
- Test: `sales-follow-up-backend/test/home-dashboard.test.js` (extend), `test/applications.test.js` (extend), `test/platform-subscriptions.test.js` (extend)

**Interfaces:**
- Consumes: `listPipelines`, `stageLookup`, `admissionsTarget`, `linkAdmissionsOnEnable`.
- Produces (summary response changes): `pipeline.byStatus` = the default pipeline's `OPEN` stages `{ status, label, color, count, value }`, counting only that pipeline's leads (plus its `pipelineId: null` leads); `openCount`/`openValue` stay across all pipelines; `pipeline.qualifiedCount` new meaning = open leads not in their pipeline's first `OPEN` stage (field name kept); `closedSince` uses kinds (`WON`/`LOST` kind, last move into a stage of that kind); `attention.neglectedLeads.items[].statusLabel` = stage name.

- [ ] **Step 1: Write failing tests:**
  - home-dashboard: `renaming Won and adding a second pipeline keeps the numbers right` — rename `WON` → `Enrolled`; second pipeline with a WON-kind stage `Signed`; a lead won there → `wonLast7Days.count` includes both; `byStatus[].label` uses custom names and lists only the default pipeline's open stages; `byStatus[].color` present.
  - applications: `a student made from a lead moves it to the linked hand-off stage` — default pipeline linked → lead `status: 'ADMISSIONS'`; company whose pipelines have no ADMISSIONS stage → lead status unchanged; student added directly in Admissions → new lead has the default pipeline's `pipelineId`.
  - platform-subscriptions: `switching Admissions on links the default pipeline` — company with module off and a migrated pipeline without `ADMISSIONS`; `PATCH /platform/workspaces/:id/features { admissions: true }` → default pipeline now has an `ADMISSIONS` stage after `WON`; assigning a plan with admissions to another such company does the same.
- [ ] **Step 2: Run** `node --test --test-concurrency=1 test/home-dashboard.test.js test/applications.test.js test/platform-subscriptions.test.js` — expect FAIL.
- [ ] **Step 3: Implement.** Existing assertion `qualifiedCount === 1` in `home-dashboard.test.js` changes to the new meaning (open leads past their first open stage); update it with a one-line comment why.
- [ ] **Step 4: Run** them, then `npm test` — expect all PASS.
- [ ] **Step 5: Commit** `feat(pipelines): admissions hand-off and dashboard read stage kinds`.

---

### Task 6: CRM data layer for pipelines

**Files:**
- Modify: `sales-follow-up-web/src/app/core/services/pipeline.service.ts` (types + definitions API + lookups)
- Modify: `sales-follow-up-web/src/app/core/services/lead.service.ts` (`LeadStatus = string`; `Lead.pipelineId: string | null`; `CreateLeadPayload/UpdateLeadPayload.pipelineId?`; `LeadFilters.pipelineId?`; keep `LEAD_STATUS_LABELS` only as a fallback for unknown keys)
- Modify: `sales-follow-up-web/src/app/core/services/home-dashboard.service.ts` (`byStatus[].color: string`)
- Test: `sales-follow-up-web/src/app/core/services/pipeline.service.spec.ts`

**Interfaces:**
- Produces:
  - `export type StageKind = 'OPEN' | 'WON' | 'LOST' | 'PARKED' | 'ADMISSIONS'`
  - `export interface PipelineStage { key: string; name: string; color: string; kind: StageKind; order: number; leadCount?: number }`
  - `export interface SalesPipeline { id: string; name: string; isDefault: boolean; order: number; linkedToAdmissions: boolean; stages: PipelineStage[] }`
  - `PipelineService`: `pipelines = signal<SalesPipeline[]>([])`, `admissionsEnabled = signal(false)`, `loadPipelines(force = false): Observable<SalesPipeline[]>` (cached like `AdmissionsService.loadContext`), `defaultPipeline(): SalesPipeline | null`, `pipelineOf(lead: { pipelineId?: string | null }): SalesPipeline | null`, `stageOf(lead: { pipelineId?: string | null; status: string }): PipelineStage | null`, `createPipeline(body)`, `updatePipeline(id, body)`, `deletePipeline(id, moveTo?)`, and `getPipeline(filters)` gains `pipelineId?`.
  - `PipelineStageData` gains `name`, `color`, `kind`; `PipelineResponse` gains `pipeline: { id: string; name: string }`.

- [ ] **Step 1: Write failing spec** `pipeline.service.spec.ts`: `stageOf falls back to the default pipeline when a lead has no pipelineId`; `loadPipelines caches until forced` (one HTTP request for two calls, a second after `force`).
- [ ] **Step 2: Run** `npx ng test sales-follow-up-web --watch=false --include src/app/core/services/pipeline.service.spec.ts` — expect FAIL.
- [ ] **Step 3: Implement.** Fix the compile errors the `LeadStatus = string` change surfaces only by widening types; behaviour changes belong to Tasks 8–9.
- [ ] **Step 4: Run** the spec, then `npx ng build` — expect PASS / build OK.
- [ ] **Step 5: Commit** `feat(pipelines-web): pipeline definitions in the CRM`.

---

### Task 7: Settings → Pipelines page

**Files:**
- Create: `sales-follow-up-web/src/app/settings/pipelines/pipelines-settings.ts|html|scss|spec.ts`
- Modify: `sales-follow-up-web/src/app/app.routes.ts` (route `settings/pipelines`, `permissionGuard('settings.pipelines')`, loads `Dashboard` like `settings/roles`)
- Modify: `sales-follow-up-web/src/app/dashboard/dashboard.ts|html` (tab `'pipelines'`: `tabForUrl`, `TAB_PERMISSION`, page label `Pipelines`, renders `<app-pipelines-settings />`; Settings stays highlighted in the sidebar)
- Modify: `sales-follow-up-web/src/app/settings/settings.html` (card "Sales pipelines" → `routerLink="/settings/pipelines"`, shown with `settings.pipelines`, next to the Roles card)

**Interfaces:**
- Consumes: `PipelineService` (Task 6), API (Task 3).
- Produces: `PipelinesSettings` standalone component, selector `app-pipelines-settings`. Matches `new-pipeline.html` and option B of `pipeline-settings.html` in `.superpowers/brainstorm/2526-1793900007/content/`:
  - pipeline tabs + "+ New pipeline" (dialog: name, start from copy / standard / blank, "Link to Admissions" toggle only when `admissionsEnabled()`), rename, "Make default", delete (dialog to pick destination when it has leads; `ADMISSIONS` stages are not offered as destinations);
  - after a save that returns `newlyLinkedLeadCount > 0`, a note: "N leads already in this stage won't become students automatically. Move them with "Move to Admissions"."
  - stage rows: drag to reorder, name input, colour (8 preset swatches from the Kelto stage/chart colours + `<input type="color">`), kind select (OPEN/WON/LOST/PARKED, and Admissions hand-off only with the module), lead count, remove;
  - one Save per pipeline that sends the whole `stages` array; on 409 `STAGES_HAVE_LEADS` a dialog asks, per listed stage, where its leads go, then re-sends with `moves`.

- [ ] **Step 1: Write failing spec** `pipelines-settings.spec.ts`: renders tabs and stages from a flushed `GET /pipelines`; hides every Admissions option when `admissionsEnabled: false`; Save sends the reordered/renamed `stages`; a 409 `STAGES_HAVE_LEADS` opens the move dialog and the retry includes `moves`.
- [ ] **Step 2: Run** `npx ng test sales-follow-up-web --watch=false --include src/app/settings/pipelines/pipelines-settings.spec.ts` — expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the spec — PASS; `npx ng build` — OK and no new style-budget **error**.
- [ ] **Step 5: Commit** `feat(pipelines-web): Settings → Pipelines`.

---

### Task 8: Pipeline board uses the chosen pipeline

**Files:**
- Modify: `sales-follow-up-web/src/app/pipeline/pipeline.ts|html` (remove `DEFAULT_STAGES` and `ALLOWED_STATUS_TRANSITIONS`; `selectedPipelineId` signal, default = default pipeline, remembered in `localStorage` key `kelto_pipeline_selected`; switcher in the page header listing pipelines with an "Admissions" tag on linked ones; columns from `PipelineStageData` name/color/kind; move menu/modal offers all stages of the pipeline; `LOST` kind → lost-reason flow; `ADMISSIONS` kind → today's hand-off dialog, **also when a card is dropped on that column** (the drop opens the dialog instead of moving); WON/LOST badge classes by kind)
- Modify: `sales-follow-up-web/src/app/pipeline/pipeline.spec.ts`

**Interfaces:**
- Consumes: `PipelineService.pipelines`, `loadPipelines`, `getPipeline({ pipelineId })`.

- [ ] **Step 1: Write failing spec:** with two pipelines flushed, the board requests `pipelineId` of the default; choosing the other refetches with its id; a renamed WON stage still gets the won styling (class by kind); dropping a card on an `ADMISSIONS` column opens the hand-off dialog and sends no status PATCH.
- [ ] **Step 2: Run** `npx ng test sales-follow-up-web --watch=false --include src/app/pipeline/pipeline.spec.ts` — FAIL.
- [ ] **Step 3: Implement.** Column search (`ColumnSearch`) keys stay stage keys. When `admissionsEnabled()` is false, an `ADMISSIONS` column behaves like any other column (no hand-off dialog, no "Admissions" tag).
- [ ] **Step 4: Run** the spec — PASS.
- [ ] **Step 5: Commit** `feat(pipelines-web): board switcher and custom stages`.

---

### Task 9: Leads page, Reports and dashboard rail use pipelines

**Files:**
- Modify: `sales-follow-up-web/src/app/leads/leads.ts|html` (stage chip coloured by `stageOf(lead).color` instead of `statusClasses`; add/edit form: pipeline select (default preselected) and stage select from that pipeline, `ADMISSIONS` stages not offered there; lost reason shown when the chosen stage's kind is `LOST`; filter bar: pipeline select + stage select of the chosen pipeline; the "Move into Admissions" button hides when `stageOf(lead)?.kind === 'ADMISSIONS'`; the On hold / Close / Not required quick buttons become one "Move to <stage>" button per `PARKED` stage of the lead's pipeline, none when it has none)
- Modify: `sales-follow-up-web/src/app/reports/reports.ts|html` (open/won/lost by kind; pipeline picker defaulting to "All pipelines": all → stage table rows by kind (Open, Won, Lost, Parked, Admissions); one pipeline → its active stages; the CSV export follows the table)
- Modify: `sales-follow-up-web/src/app/dashboard/dashboard.ts|html` (rail bar colour = `byStatus[].color`; KPI subtext "past the first stage")

**Interfaces:**
- Consumes: `PipelineService.stageOf`, `pipelineOf`, `pipelines`.

- [ ] **Step 1: Write failing specs** (extend `leads` and `reports` specs if present, else add focused ones): a lead in a custom stage shows its name and colour; choosing a LOST-kind stage in the form reveals the lost reason; a pipeline without `PARKED` stages shows no quick move buttons; reports count a renamed WON stage as won and, on "All pipelines", show rows by kind.
- [ ] **Step 2: Run** `npx ng test sales-follow-up-web --watch=false` — the new specs FAIL.
- [ ] **Step 3: Implement.** The Leads page is under active edit by the owner: pull first and keep changes to the listed behaviours.
- [ ] **Step 4: Run** `npx ng test sales-follow-up-web --watch=false` — all PASS except the 3 known `app.spec.ts` failures; `npx ng build` OK.
- [ ] **Step 5: Commit** `feat(pipelines-web): leads, reports and dashboard follow stage kinds`.

---

### Task 10: Demo data and end-to-end check

**Files:**
- Modify: `sales-follow-up-backend/scripts/dev-memory.js` (after seeding: a second pipeline "Corporate training" (copy of the default, unlinked) with two leads; the default pipeline linked; rename one stage so the demo shows custom names)
- Create (scratch, not committed): browser script driving the CRM on `http://localhost:4200` against `PORT=5001 node scripts/dev-memory.js`

- [ ] **Step 1:** Start the in-memory API and CRM; as `admin@syb.test`: Settings → Pipelines → create "Test pipeline" from blank, add a stage, recolour it, save; open the board, switch to it, drag a lead into the new stage; rename `Won`; confirm the dashboard's won count is unchanged; remove a stage that has leads and pick a destination.
- [ ] **Step 2:** As `anu@syb.test`: Settings card hidden; board switcher shows both pipelines; dragging works.
- [ ] **Step 3:** Run `npm test` (backend) and `npx ng test sales-follow-up-web --watch=false` and `npx ng build` — all green except the 3 known `app.spec.ts` failures.
- [ ] **Step 4: Commit** `chore(pipelines): demo data for custom pipelines`.
- [ ] **Step 5:** Stop. Report to the owner; the migration reaches the live database only when they approve deploying.
