# Custom sales pipelines — design

Date: 2026-11-05 · Status: draft for approval

## Why

Every Kelto company today gets the same fixed sales pipeline: twelve stages
(New, Contacted, Qualified, Quotation sent, Negotiation, Won, Admissions,
On hold, Closed, Not required, Unresponsive, Lost), hard-coded in the server
and the CRM. Companies sell different things in different ways, so they need to
shape their own pipelines. Companies that have the Admissions module also need
a pipeline to hand leads over to Admissions; companies without the module just
need a normal sales pipeline.

## What the owner asked for (decided)

- **Everything about the sales pipeline is customisable in Settings**, per
  company: stage names, colours, order, adding and removing stages.
- **A company can have several pipelines** and can add a new pipeline whenever
  it wants (e.g. "Student enquiries" and "Corporate training"). Each pipeline
  has its own name and stages.
- **Any pipeline can be linked to Admissions**, but only when the company has the
  Admissions module. Without the module, pipelines are plain sales pipelines and
  the link option does not appear.
- **A new company starts with one pipeline**, "Sales pipeline", using the
  standard stages, and can rename, change or delete stages and add pipelines.
- **One pipeline is the company's default**: new leads land there unless the
  person adding the lead picks another pipeline.

Mockups agreed in the session: `.superpowers/brainstorm/2526-1793900007/content/`
(`pipeline-settings.html`, option B; `new-pipeline.html`).

## Goals

1. Settings → **Pipelines** page: list pipelines; create (name + start from a
   copy of an existing pipeline, the standard stages, or blank); rename; set the
   default; delete; per pipeline edit stages (name, colour, kind, order via drag,
   add, remove); link to Admissions by choosing the hand-off stage.
   **Colour (owner's request):** each stage's colour is picked from a row of preset
   swatches or set to any custom colour with a colour picker; it shows on the
   board column, the stage dot and anywhere the stage is labelled.
2. Pipeline page: a switcher at the top chooses which pipeline's board is shown;
   the board's columns are that pipeline's stages. Everything the board does
   today (drag, arrow/menu moves, filters, search, column search, lost reason,
   Admissions hand-off dialog) keeps working.
3. Leads: each lead belongs to one pipeline and one stage of it. Add/edit lead
   lets the person choose the pipeline (default preselected) and stage. A lead
   can be moved to another pipeline (it lands in that pipeline's first open
   stage unless the person chooses one).
4. Dashboard, Reports and the home "Needs attention" figures keep working with
   any stage names, because they read each stage's **kind**, not its name.
   They add up all pipelines, with a pipeline filter where a filter already exists.
5. Existing companies see no change until they edit: their current board becomes
   their first pipeline, with today's twelve stages and every lead in place.

## Non-goals

- Changing the Admissions module's own student journey stages (already
  customisable under Admissions → Settings).
- Per-stage automation (auto tasks, emails, required fields beyond what exists:
  lost reason, Admissions hand-off details).
- Pipeline-level permissions (who can see which pipeline). Everyone who can see
  the pipeline sees all of the company's pipelines, within their existing
  own/team/all lead scope.
- Web forms or imports choosing a pipeline (there are none today; new leads go to
  the default).

## Anti-goals (would be a failure even if it "works")

- Any existing company's board, numbers or leads change on deploy.
- Dashboard conversion, won/lost counts or "neglected leads" silently break
  because a company renamed "Won".
- Deleting a stage or pipeline loses leads or their history.
- A company without the Admissions module sees Admissions options anywhere in
  pipeline settings or the board.

## The model

**Stage kinds** (my call). Every stage has exactly one kind; names are free:

| Kind | Meaning | Today's stages |
|---|---|---|
| `OPEN` | work in progress, counts in the open pipeline value | New, Contacted, Qualified, Quotation sent, Negotiation |
| `WON` | a won deal | Won |
| `LOST` | a lost deal; moving here asks for a lost reason (as today) | Lost |
| `PARKED` | set aside, neither open nor won/lost | On hold, Closed, Not required, Unresponsive |
| `ADMISSIONS` | the Admissions hand-off stage (only in a linked pipeline) | Admissions |

Rules (my calls): a pipeline always has at least one `OPEN`, one `WON` and one
`LOST` stage; at most one `ADMISSIONS` stage, and only when the company has the
module. Kinds of the default stages can be changed except that these minimums
must hold. Linking a pipeline to Admissions = giving it an `ADMISSIONS` stage
(choosing which stage is the hand-off); unlinking turns that stage back into a
normal stage chosen by the person (default `WON`).

**Data** (my call; builder may refine names):

- New `Pipeline` collection: `businessId`, `name`, `isDefault`, `order`,
  `stages: [{ key, name, color, kind, order }]`, `isArchived`, timestamps.
  Stage `key` is stable and unique within the pipeline; renaming never changes it.
- `Lead` gains `pipelineId`; `Lead.status` keeps holding the **stage key** (the
  enum is removed). `statusHistory` keeps recording stage keys, so history stays
  readable. This keeps existing queries and history working with the fewest changes.
- Today's stage keys (`NEW` … `LOST`, `ADMISSIONS`) stay as the keys of each
  existing company's first pipeline, so no lead's `status` needs rewriting.

**Moves** (my call): any stage → any stage within the pipeline is allowed (the
fixed transition table goes away). Moving into a `LOST` stage requires the lost
reason, as today. Moving into the `ADMISSIONS` stage runs today's hand-off flow
(study level, intake) and creates the student. The current rule "a WON lead can't
change stage" is kept for `WON` kind.

**Admissions link**:
- Moving a lead into a linked pipeline's `ADMISSIONS` stage creates the student,
  exactly as moving to "Admissions" does today.
- When a student is created another way (from the Leads page, or added directly in
  Admissions), the lead is put in the `ADMISSIONS` stage of its own pipeline if
  that pipeline is linked; otherwise of the company's default pipeline if linked;
  otherwise of the first linked pipeline; if no pipeline is linked, the lead's
  stage is left alone.
- If the company loses the Admissions module, `ADMISSIONS` stages keep their
  leads and show as ordinary columns; the hand-off and link options disappear.

**Deleting** (my call): a stage or pipeline that still has leads can only be
deleted after choosing where those leads go (a stage in the same pipeline, or a
pipeline + stage). Deleted pipelines are archived, not erased. The default
pipeline can't be deleted until another is made default.

**Who can edit** (my call): a new permission "Set up pipelines and stages"
(`settings.pipelines`), on for Owner, off by default for Sales manager and
Salesperson (add it to their default `except` lists so the new permission does
not leak into them), grantable through custom roles.

## Rollout and data safety (constraint)

- A migration creates each existing company's first pipeline ("Sales pipeline",
  today's twelve stages with their keys, colours and kinds above; the
  `ADMISSIONS` stage only if the company has the module or has leads in it) and
  sets `pipelineId` on every lead. It must be idempotent and covered by tests.
- New companies get "Sales pipeline" with the standard stages on registration
  (and on first use, for safety).
- **The migration runs against the live database when the server starts.** The
  local dev server (`npm run dev` on 5001) points at the live Atlas database and
  applies new migrations on save; test with the in-memory server
  (`scripts/dev-memory.js`) and get the owner's go-ahead before registering the
  migration or deploying.

## Decisions after the builder review (my calls)

1. **"A WON lead can't change stage"** stays exactly where it is today: the Leads
   edit form (including changing the lead's pipeline there). The board, moving
   leads off a removed stage or pipeline, and the Admissions sync are not blocked;
   the board can still move a Won lead into Admissions.
2. **"N qualified or further"** on the dashboard becomes **"N past the first
   stage"**: open leads not in their pipeline's first `OPEN` stage. This is the
   one deliberate visible change for existing companies.
3. **Stage breakdowns:** the home "Pipeline Stages" panel shows the default
   pipeline's `OPEN` stages with that pipeline's leads; the home dashboard gets no
   filter. Reports gets a pipeline picker: "All pipelines" (default) shows rows by
   kind (Open, Won, Lost, Parked, Admissions); one pipeline shows its own stages;
   the CSV follows the table. The Leads page gets a pipeline filter, and its stage
   filter lists the chosen pipeline's stages.
4. **Entering the Admissions stage:** a single lead always goes through today's
   hand-off dialog (study level, intake) that creates the student, including when
   a card is dragged onto that column (the drag now opens the dialog). Bulk paths
   (moving leads off a removed stage or pipeline, changing a lead's pipeline)
   cannot target an `ADMISSIONS` stage. Linking a stage that already holds leads
   is allowed; those leads stay as they are and Settings says they won't become
   students automatically.
5. **Module switched on later:** whenever the Admissions module is switched on
   (admin console toggle, a subscription plan, or `scripts/admissions-enable.js`)
   and no pipeline has an `ADMISSIONS` stage, an "Admissions" hand-off stage is
   added to the default pipeline after its Won stage, so it works as it does today.
6. **Standard stages for new companies** are the seven: New, Contacted,
   Qualified, Quotation sent, Negotiation, Won, Lost. The Leads page's On hold /
   Close / Not required quick buttons become "Move to <stage>" buttons for the
   lead's pipeline's `PARKED` stages, and don't show when it has none.
7. **Blank pipelines** get one `OPEN` stage ("New") plus Won and Lost, to satisfy
   the minimums.
8. **Removed stages are archived, not erased** (hidden from the board and
   settings, key never reused), and each stage-history entry records the
   `pipelineId`, so a lead's history stays readable after moves and removals.

## Left to the builder

- Exact API shape and route names (pipelines CRUD, stage edits, lead move between
  pipelines); reuse the Admissions settings stage editor's patterns.
- How the Settings page is laid out within the existing Settings area, following
  the agreed mockups.
- How the dashboard/report pipeline filter looks; default = all pipelines.
- Which preset swatches to offer (reuse the Kelto stage/chart colours) and the
  default colour a new stage gets. Store colours as hex (`#RRGGBB`) so custom
  colours and presets are the same thing; keep stage text readable on any colour.
- Updating tests: existing lead/pipeline/dashboard tests must keep passing with
  the migrated first pipeline; add tests for custom stages, kinds, deletion with
  re-homing, Admissions link and the no-module case.
