# UI Workflow

This document defines the initial user experience model.

## Automatic save-state indicator (Completion Milestone A1)

The workspace toolbar shows a small save-state indicator reflecting automatic IndexedDB
persistence. It is informational only (no controls) and uses design-system tokens. States:

- **Loading saved workspace…** — reading any saved workspace on startup.
- **Auto-save on (this browser)** — startup finished; nothing saved yet this session
  (e.g. a fresh/empty store using the default sample data).
- **Saving…** — a debounced auto-save is in flight after a workspace change.
- **Saved locally** — the current workspace is saved in this browser.
- **Save failed** — the most recent auto-save failed (data remains in memory; the manual
  export still works as a backup).
- **Saved workspace could not be loaded** — a stored workspace existed but was corrupt or
  unrestorable; the app falls back to the default startup state and does not delete the
  stored record.

The existing portable workspace snapshot Export/Import remains the way to move data between
machines or hand it to another person; it is unchanged.

## Portable dataset Export / Import (Completion Milestone A2)

The workspace toolbar offers two clearly labelled controls, distinct from the browser
auto-save above:

- **Export Dataset (.json)** — downloads a portable `.json` file containing the whole
  **committed** workspace dataset (districts, age divisions, teams, players, games, coaches,
  coach assignments, and the snapshot's selection). Filename
  `uc-roster-sniffer-dataset-YYYY-MM-DD.json`. This is the file you hand to another coach.
- **Import Dataset (.json)** — validates a chosen file and, if valid, **replaces** the
  current committed workspace (never merges), clears any active in-memory import overlay
  (including undo), and the result auto-saves to this browser via A1. Invalid JSON or a
  wrong-shape file shows a calm error and leaves the current workspace unchanged.

Copy in the toolbar explains the two distinct ideas: **auto-save (IndexedDB)** keeps work in
*this browser/session*; **Export Dataset** is the portable *backup/share* file.

**Active in-memory import overlay:** the transient import preview/undo overlay is **not**
part of an exported dataset — Export always writes the committed workspace only. When an
overlay is active the toolbar copy states this explicitly. (Export does not implement import
commit; committing previewed imports is a later slice.)

After a successful import, a summary line reports seasons, districts, teams, players, games,
and coaches.

## Commit a scraped-JSON team import (Completion Milestone B1)

The import workbench can now commit a reviewed **player** team into the workspace (not just
preview it in memory):

- After loading a source, selecting a ready target, resolving identity rows, and staging the
  preview, a **Commit Import to Workspace** button is offered. It is disabled (with a reason)
  for unresolved, blocked, needs-review, missing-context, or not-yet-staged targets, and
  while a separate in-memory preview is active — so an unready import can never be committed.
- Committing writes the team into the committed workspace: it appears in the normal roster
  view, **auto-saves to this browser** (IndexedDB, A1), and is included in an exported
  dataset (A2). A banner reads **"Committed import saved locally"** with the before→after
  player counts.
- **Undo Committed Import** (in that banner) reverts the team to its exact pre-commit state.
  The undo affordance is **current-session only** — the committed data itself is durable and
  survives a reload, but the undo button does not reappear after a reload.
- Existing roster records are preserved exactly and in order; duplicate names are not merged,
  confirmed matches are no-ops, and deferred rows are not added. Nothing is silently resolved.
- The separate **Execute In-Memory Import** action remains for a non-saving preview in the
  roster view; commit is the durable counterpart. Coach scraped-JSON commit is not yet
  available.

## Registry-backed districts + confirm/add unknown district (Completion Milestone C1/C3)

The import workbench now resolves scraped district labels against the committed workspace
**district registry** (the `districts` collection), so known districts stop showing as
provisional:

- When a selected target's district matches a registered district (by exact name or source
  label), the detail panel reads **"District resolved from your registry: <id>"** and the
  context confidence is `high` — the provisional-district warning is gone.
- When the scraped district is **not** in the registry, the panel shows the exact scraped
  name with an **Add district to registry** button. Clicking it adds an **active** district
  with placeholder branding, remembers the exact scraped name, **auto-saves** (IndexedDB,
  A1), and the workbench re-derives in place so the district immediately resolves at `high`
  confidence — the loaded source and selected target are kept (no reset). Confirming the
  same name again is a no-op.
- This is intentionally **narrow**: it only adds/confirms a district from the import flow.
  Editing branding (mascot, colors), pointing a district at helmet/logo files in
  `public/districts/`, and marking a district **inactive** all live in the full **District
  Maintenance** screen, which is **Completion Milestone C2** (not yet built). Districts are
  never deleted — inactivation is the only retirement path.

## Roster import plan panel (create or update teams)

When a scraped **players** file is loaded, a **Roster import plan** panel appears above the
per-target detail. It plans one action per player-team target and commits them in one step —
the per-target B1 flow still works for case-by-case review.

- **Summary:** player team targets · **teams to create** · **teams to update** · **blocked** ·
  coach/non-player targets (not imported here) · **total players to import** · districts
  resolved through the registry vs provisional/unknown.
- **Table** (one row per target): team · district · age · code · **Action** badge — **Create
  team** / **Update team** / Needs review / **Add district first** / Unreadable team code /
  Missing season-age / Duplicate target / Empty / Coach — · players · reason notes for blocked
  targets.
- **Commit roster import** (primary action) creates the missing teams and updates the existing
  ones, **all-or-nothing**, and is **disabled** when there is nothing to create or update, or
  while a single-target in-memory preview is executed. Brand-new empty teams need **no row-level
  review**; existing teams still follow the review path. Districts not in the registry are
  blocked (“Add district first”) — never auto-created. There is **no auto-commit** on file load,
  selection, or preview.
- After a successful commit a top banner reads **“Roster import saved locally”** with created /
  updated team counts, total players, and blocked count, plus an **Undo Roster Import** button
  (current session only; the committed data is durable via A1 and survives reload). A failed
  commit shows a calm error and changes nothing.

## District Maintenance screen (Completion Milestone C2)

A top-level **Districts** tab opens the District Maintenance screen
(`src/components/DistrictMaintenanceView.tsx`) — an in-app manager for the canonical district
registry (`workspace.districts`).

- **List (the resting state):** every district, **active and inactive** (inactive are never
  hidden here). Columns: name (with a “provisional” flag when branding is placeholder),
  `districtId`, mascot, status badge (Active/Inactive), primary/secondary color chips, logo &
  helmet path references, and exact import aliases (`sourceLabels`). An **All / Active /
  Inactive** filter and a **+ Add district** button sit above the list.
- **Add / Edit form (opens on demand — production-blocker correction):** the form is
  **hidden by default** so it never crowds or obscures the list. It opens as a side panel only
  after **+ Add district** or a row’s **Edit**, and has a **Cancel** action; after a successful
  create or update it closes and returns to the list. At common desktop widths the list stays
  visible beside the form (no overlay/modal).
  - **Add** — name and mascot are required; primary/secondary color, logo path, helmet path,
    exact aliases (comma/newline separated), and a “branding is placeholder/provisional”
    checkbox are optional. The `districtId` is **generated automatically** from the name (a
    preview of the slug is shown) and disambiguated on collision — the user never types it.
    Aliases default to the district name when left blank.
  - **Edit** — changes the mutable fields only; the **districtId and status are never changed
    on edit**, so team references stay valid. A note shows how many teams reference the
    district.
  - **Inactivate / Reactivate** — per-row actions. Inactivation preserves the record (no
    delete) and only stops new import matching; reactivation restores it under the same id.
    Copy: “Inactive districts are preserved for history but ignored for new import matching.”
- **Persistence/feedback:** every change auto-saves to this browser (A1) and is included in an
  exported dataset (A2); active edits/creates/reactivations feed scraped-import mapping
  (C3/B2) immediately. There is **no district deletion** and **no image upload / file picker**
  — logo/helmet are plain filename references into `public/districts/`.

## First-run & empty states (Completion Milestone E1)

Driven by the pure `assessWorkspaceEmptiness` / `recommendedFirstRunActions` helpers
(`src/engine/workspaceEmptyState.ts`), so the UI is not littered with `length === 0` checks.

- **First-run (no teams):** the Roster tab shows a calm explainer card (a reusable
  `EmptyState` component) instead of an empty filter bar. Copy makes clear the workspace is
  **local to this browser, auto-saves here, and nothing is uploaded**, and offers next-action
  buttons that switch views via existing state (no routing, no wizard): **Go to Roster
  import**, **Import Dataset (.json)** (opens the toolbar file picker), and **Manage
  Districts**.
- **Other empty states:** My Team shows a no-teams card with a Roster-import button; the
  Roster tab, when teams exist but none is selected, prompts to pick a season/district/age/
  team. Existing per-view empty copy (schedule, standings, coaches, review, import targets) is
  kept.
- The bundled **sample workspace has teams, so it is never treated as empty** — the first-run
  state appears only for a genuinely team-less workspace.

## Plain-language file-error handling (Completion Milestone E2)

Both import paths translate the existing deterministic validators into a calm, structured
message — **Title / “What happened” / “Try this”** with an optional small technical detail
line — instead of raw codes or parser internals. Validation itself is unchanged (nothing is
loosened to accept bad files).

- **Import Dataset (top toolbar):** invalid JSON, wrong shape / not a dataset export,
  unsupported schema version, missing/invalid workspace sections, and file-read failure each
  get plain guidance. If the file is actually a scraped Ute Conference file, the message says
  to use **Roster import** instead.
- **Roster import:** empty file, invalid JSON, and parsed-but-unsupported sources get plain
  guidance. If the file is actually a UC Roster Sniffer **dataset export**, the message says to
  use **Import Dataset**; an unsupported scraped `record_type` and unrecognized files are
  explained. A loaded **coaches** file notes that whole-file import is player-only.

## Flat-source normalization note (production-blocker correction)

When a loaded Roster-import file is a **flat row-list** (the Claude-scrape drift shape), the
workbench normalizes it into the standard nested shape on load and shows a small note:
“Normalized a flat row-list … grouped by district + age group + team. Player names were
preserved exactly,” plus which metadata was **inferred** (organization, age division,
season year from filename) and any **warnings** (mixed age groups, no filename year). A flat
file whose rows are missing required fields gets a plain-language error instead. There is no
inline metadata editor in this pass.

## Empty startup, Reset, Seed, and Sample data (production-blocker correction)

A fresh browser (no persisted workspace) opens to an **empty** workspace and the first-run
state — bundled sample data is no longer forced into startup. The top toolbar offers four
**distinct, separately-confirmed** workspace actions (each replaces this browser’s local
workspace; export a dataset first for a backup; the change auto-saves and survives reload):

- **Reset workspace** → **empty** workspace: a production fresh start with **no teams**
  (baseline age divisions + seeded district registry kept).
- **Load Ute Conference seed** → an **optional baseline**: a registry of the **39 known Ute
  Conference districts** (Alta/Brighton keep their branding; the rest provisional, editable in
  District Maintenance) + age divisions + some GI/2026 empty team shells. With teams now created
  on import, the team shells are **no longer required** — they're a convenience; what matters is
  that the districts are registered.
- **Load sample data** → **demo/testing** content only (bundled multi-season sample teams with
  players). Not for production use.
- **Import Dataset** / **Export Dataset** → portable full-dataset JSON round-trip (unchanged).

These are deliberately **not** collapsed into one concept. The primary path is: start empty →
register districts (Districts tab, in-flow “Add district to registry”, or the optional seed) →
**roster import creates the season's teams** and adds players. A district not in the registry is
blocked with “Add district first” (never auto-invented). An existing persisted workspace still
restores normally on load.

## Primary navigation

The primary navigation path is:

```text
Season -> District -> Age Division -> Team
```

Each selection narrows the analytical scope.

## Default season selection

When loaded data includes multiple seasons, the app should default to the most recent season.

- This matches the normal expectation that the current/latest season is the first view.
- Prior-season data remains available for derived comparison, but a prior season should not become the default landing state unless the user explicitly selects it.

## No-team-selected summary view

When the user has selected season, district, and/or age division but has not selected a specific team, the app should show derived summaries based on the active filters.

### Example summary metrics

Team composition:

- team count
- count by team level

Player composition:

- total players
- returning players
- new players
- transfers
- y-ups
- z-downs
- promotions
- relegations

Coach composition:

- returning coaches
- continuous-cohort coaches

## Team selected view

When a team is selected, the app should display:

- team composition summary
- in-year performance summary
- head coach card
- assistant coach cards
- player cards

## Team composition summary

The team composition summary should show current roster makeup relative to the prior season.

Initial metrics:

- total players
- returning player count
- new player count
- transfer count
- y-up count
- z-down count
- promoted count
- relegated count

### Prior-season comparison summary panel (Phase 3)

The selected team view includes a read-only prior-season comparison summary panel
derived from the Phase 3 comparison pipeline
(`comparePriorSeasonRoster` -> `summarizePriorSeasonRosterComparison`).

When a prior-season same-slot team exists, the panel shows these derived counts:

- Returning
- New to roster
- Not returning
- Unknown current
- Unknown prior
- Total current
- Total prior
- High confidence
- Low confidence

Rules:

- The panel is read-only and non-interactive. It displays derived counts only and
  never alters, removes, suppresses, merges, reorders, or hides any roster record.
- Returning is counted once per current player, never double-counted across the
  current and prior sides.
- Not-returning is a prior-season summary count only; prior-only players are never
  rendered as current player cards.
- When no prior-season same-slot team is available, the panel shows a clear
  unavailable state instead of fabricated zero counts.
- This panel is additive and does not replace the existing roster-status summary.

## Team performance summary

The team performance summary should show:

- current record
- win percentage
- prior-year record
- playoff status
- championship status
- schedule summary

## Cards

Cards should exist for:

- head coach
- assistant coaches
- players

Cards should communicate roster or coaching context visually.

## Player card visual status

Supported roster status indicators:

- Returning
- New
- Transfer
- Y-Up
- Z-Down
- Promoted
- Relegated
- Low Confidence

The UI should distinguish between the roster status and identity-confidence warnings.

### Current roster player-card status (Phase 2)

Current selected-team player cards may show a small derived status badge based on
exact prior-season identity comparison. Only these values appear on a current
roster card:

- Returning — an exact current/prior identity match.
- New — a current-only player with no prior-season identity match.
- Unknown — an ambiguous (duplicate-name) current player; identity confidence is
  low, but the player record still displays.

Rules:

- `Not returning` belongs in summary/comparison context, not on current roster
  player cards. Not-returning players are prior-season players absent from the
  current roster, so they are never rendered as current player cards.
- Ambiguous or duplicate current players remain individually visible and display
  `Unknown`; ambiguity affects derived metadata only and never hides, merges, or
  rewrites a rostered player record.
- When prior-season comparison is unavailable, current player cards display no
  per-player status badge and the full roster still renders.

Derived status is display metadata only and never mutates the player object.

### Roster status vs. identity-confidence warning (Phase 2)

Roster status and identity confidence are two separate visual signals on a
player card. They must not be merged into one overloaded badge.

- The roster status badge answers: Returning / New / Unknown.
- The identity-confidence warning answers: this identity match needs review
  because derived confidence is low.

A current player card may show both at once: the roster status badge plus, when
derived confidence is low, a distinct identity-review warning (for example
`Identity review`).

Rules:

- The low-confidence identity warning is a review indicator only. It does not
  alter, hide, reorder, merge, or remove any roster record. Loaded roster
  records remain authoritative; ambiguity affects derived metadata only.
- High-confidence current players (exact returning matches, current-only new
  players) show no identity-review warning.
- When prior-season comparison is unavailable, no derived confidence exists, so
  no identity-review warning appears and the full roster still renders.
- Ambiguous (duplicate-name) current players each remain individually visible
  and each may show the warning.

## Coach cards

Coach cards should support summary signals such as:

- returning coach
- new coach
- continuous-cohort coach
- lifetime record
- current team record

## Detail side panel

Selecting a card opens a side panel.

### Player side panel

Show:

- full historical team assignments
- historical districts
- historical age divisions
- historical roster classifications
- notes
- identity confidence details, if applicable

Full detail should be shown unless performance degrades.

### Coach side panel

Show:

- coaching history
- team assignments
- lifetime record
- continuous-cohort record
- championship history

## District branding

When a district is selected, district branding may influence the UI.

District branding fields:

- logo
- helmet
- mascot
- primary color
- secondary color

Potential applications:

- page header
- card accents
- badges
- team summary panels
- coach and player cards

Exact application is intentionally open for later design.

## Age division visual language

Age divisions should have distinct visual treatment.

Possible mechanisms:

- badge styles
- color families
- labels
- icons

## Team-level visual language

Team classifications should have distinct visual treatment.

Examples:

- A-team indicators
- B-team indicators
- C-team indicators
- D-team indicators
- competitive tier markers

## My Team panel

Users should be able to mark a team as `My Team` for a specific season.

The app should include a collapsible left-side panel for My Team.

Panel content:

- schedule
- upcoming games
- results
- opponent links

Opponent entries should navigate to the corresponding opponent team profile.

## Cohort reclassification UI (Phase 4 checkpoint)

Phase 4 (cohort reclassification preservation) is checkpointed and is **engine-only
— it adds no UI** (see `docs/derived-logic.md`, "Phase 4 checkpoint"). Through
Phase 4 there are:

- no y-up / z-down player-card badges;
- no manual cohort review screen;
- no wiring of derived cohort assignments, review actions, decisions, or the
  decision repository into React state.

`resetRecommended` and an accepted `reset` are advisory / recorded only; nothing in
the UI performs a reset. Rendering cohort status and a manual review screen are
future work, layered on top of the existing engine when approved.

## Import pipeline UI (Phase 5 checkpoint)

Phase 5 slices 1–6 (import preview, identity match candidates, the review
action/decision contract, the decision repository, effective decision application,
and the dry-run commit preview plan) are checkpointed and are **engine-only — they
add no UI** (see `docs/derived-logic.md`, "Phase 5 checkpoint"). Through Phase 5 so
far there are:

- no import preview, identity match, or collision review screens;
- no controls to accept / reject / manually link / create-new;
- no commit or dry-run plan UI;
- no wiring of preview rows, match entries, review decisions, the decision
  repository, applied outcomes, or the commit preview plan into React state.

`ready-to-link` / `ready-to-create` plan rows are future intended operations only;
nothing in the UI performs an import apply / commit, and a high-confidence single
candidate is never auto-linked. Rendering the collision review and commit screens is
future work, layered on top of the existing engine when approved.

Slices 9–12 add engine-only ingestion for harvested data — a pasted-text/CSV parser
(slice 9), a Ute Conference scraped-JSON source adapter (slice 10), canonical
source-label mapping (slice 11), and a full-file **readiness report** (slice 12). None
of these add UI. A future import screen could consume
`createUteConferenceScrapedJsonReadinessReport` to drive team selection: it exposes,
per team, a `readinessStatus` (`ready` / `ready-with-warnings` / `needs-review` /
`blocked` / `empty`), human-readable reasons, and summary gates
(`canProceedToTeamSelection`, `canProceedWithoutReview`). That UI remains future work,
gated on explicit approval; the report itself reads source data only and mutates
nothing.

### Scraped JSON import session state (Phase 5 slice 14)

Slice 14 adds an engine-only, in-memory **import session state model** for one scraped
JSON source file (`src/engine/uteConferenceScrapedJsonImportSession.ts`) that is
**intended for future UI consumption** but **adds no UI itself**. It composes the
slice 12 readiness report with target selection, canonical mapping, and preview
outputs into one deterministic session object. A future import screen could:

- load a source file into a session, reading `status`
  (`uninitialized` / `source-loaded` / `target-selected` / `target-blocked` /
  `ready-for-review` / `ready-for-preview` / `invalid-source`) and the deterministic
  `sourceFingerprint`;
- list selectable teams via `getUteScrapedJsonImportSessionSelectableTargets`, showing
  blocked, empty, and needs-review targets distinctly;
- select a team to surface its canonical mapping and player/coach preview, and clear
  the selection to go back;
- gate "preview" and "import without review" buttons on the summary flags
  `canSelectTarget`, `canProceedToPreview`, and `canProceedWithoutReview`.

That screen remains future work, gated on explicit approval. The session reads source
data only and mutates nothing: it does not persist, store in the browser, upload
files, apply/commit imports, mutate rosters, derive movement, or create coach
analytics, and the loaded payload (if held) is kept by reference only, in memory only.

### Scraped JSON import session review decisions (Phase 5 slice 15)

Slice 15 adds an engine-only **session-level review-decision state** layer
(`src/engine/uteConferenceScrapedJsonImportSessionReviewDecisions.ts`) that is intended
for future UI consumption but **adds no UI itself**. A future review screen could let a
reviewer mark each preview row of the selected target as `confirm-row-identity`,
`mark-row-needs-review`, or `ignore-row-for-review`, then read
`summarizeUteScrapedJsonImportSessionReviewState` to show per-row review status and
counts. The layer is review **metadata only**: decisions never apply, commit, mutate,
suppress, or reorder source data; they are projected onto canonical review-only effects;
and they are auto-isolated to the currently selected target (re-validated on read), so a
screen switching targets cannot show stale decisions. Any commit/apply remains a
separate, later, explicitly approved slice.

### Read-only scraped JSON import UI shell (Phase 5 slice 16)

Slice 16 adds the **first visible import UI**: a read-only scraped JSON import preview
shell (`src/components/ScrapedImportPreview.tsx`), reachable from a top-level import
view toggle in `App.tsx` alongside the existing roster view (the toggle was originally
labelled "Import preview (read-only)" and was renamed to "Roster import" once B1/B2
added explicit commit actions). It is a thin renderer over the existing engine: it builds a slice 14 import
session from a chosen **demo source** (the existing scraped JSON test fixtures, plus
two small inline payloads so the blocked and invalid-source states are visible), lets
the user select one target, and renders the readiness/preview/review state via a pure
view model (`src/app/scrapedImportPreviewViewModel.ts`). It shows the source/readiness
summary, selectable targets, blocked and empty targets (clearly marked not importable),
and — for a selected player target — the canonical context and a read-only player-row
table. All selection lives in component memory; there is no file upload, drag/drop,
persistence, or any apply/commit control. A future slice replaces the demo-source
picker with real source loading.

### Local scraped JSON import preview workflow (Phase 5 slice 17)

Slice 17 turns the shell into a usable **local-first import workbench**. The primary
action is **Choose JSON file**: a real Ute Conference scraped JSON file is read in the
browser with `FileReader` (local only — never uploaded, stored, or persisted), parsed by
a pure helper, and loaded into the existing import session engine. The bundled demo
fixtures remain as a fallback. The workbench shows the source filename/type, readiness
status and summary; groups targets distinctly as ready / needs-review / blocked / empty;
and for a selected target shows canonical context, blocking issues/warnings, the
read-only review state, and preview rows (player rows, or coach rows with raw names and
titles).

It adds a **dry-run projection** panel, clearly labelled "Dry run only · nothing
applied", that shows what an import of a ready player target **would** create (composing
the existing Phase 5 dry-run plan / projection helpers). Blocked, empty, needs-review,
coach, or missing-context targets show a deterministic unavailable state rather than a
forced projection. Primary actions are Choose JSON file, Clear loaded file, Select
target, and Clear selected target; there are deliberately no Save / Apply / Commit /
Import-now controls. Everything stays in component memory — nothing is written,
persisted, or committed, and switching source resets the selected target so no stale
preview/projection leaks.

### Roster-aware identity review (Phase 5 slice 18)

Slice 18 makes the dry run **roster-aware** for player targets. The workbench compares
the selected target's imported rows against the existing local roster for that context
and shows, per row, the identity match status (`likely-new`, `likely-existing`,
`ambiguous`, `needs-review`, `blocked`), the candidate existing name(s), and what the
import **would** do. The reviewer resolves each match-bearing row in memory with explicit
controls — **Confirm match** (only when a single candidate exists), **Create new**,
**Needs review**, and **Clear** — and the dry-run summary updates live (would create /
would link / deferred / unresolved, and whether the dry run is clean). Confirm is never
offered for an ambiguous (duplicate) row, so nothing is auto-linked. Decisions live only
in component memory and are reset when the target or source changes. When no existing
roster matches the context, a clear unavailable message is shown instead of a projection.
All safety wording ("Preview only", "Dry run only · nothing applied") remains, and there
are no Save / Apply / Commit controls — no roster data is written or mutated.

### Staged in-memory roster projection (Phase 5 slice 19)

Slice 19 adds a **Staged projection** section below the dry run. When the dry run is
clean (every imported row resolved), a **Stage preview** action builds an in-memory
projected roster the user can inspect; otherwise the section explains why staging is
unavailable (resolve the remaining rows / missing roster context). The staged view shows
the **actual roster** and the **projected roster** side by side and visually distinct:
the actual roster annotates players that a confirmed import links to, and the projected
roster lists existing players (tagged "existing") plus projected new imported players
(tagged "new"), with counts ("N current + M new = P projected"). Deferred rows are listed
separately as not added. A **Clear staged preview** action removes only the staged view
from memory, and changing the source, target, or any identity decision automatically
invalidates it. It is labelled "Preview only · in memory only · nothing has been
applied"; there are no Save / Apply / Commit / Import-now / Finalize controls, and no
roster data is written, mutated, or persisted.

### In-memory import execution and undo (Phase 5 slice 22)

Slice 22 adds the first controlled WRITE boundary to the workbench — in-memory only. Below
the readiness and transaction-plan panels, an **In-memory import execution** panel offers an
explicit **Execute In-Memory Import** action, available only when the preview is staged, the
transaction plan is `planned`, and no in-memory import is already executed. Executing applies
the plan's additions into the current runtime/session roster view: the **roster tab updates**
to show the added records and displays an "in-memory import active" banner. The execution
panel then shows the executed counts (added / linked no-op / deferred-skipped /
rejected-skipped, before → after roster, net change), explanatory copy ("in-memory only", "no
saved roster data", "this does not persist after reload", "no durable commit occurs"), and an
**Undo In-Memory Import** action that restores the pre-execution roster.

The five workflow layers stay visually distinct: dry-run preview, staged preview,
transaction-plan preview, executed in-memory import, and (still nonexistent) durable
persistence. While an import is executed the workflow is **locked** — the source, target,
review decisions, and staged-preview controls are disabled until the user undoes the import —
so additions cannot be duplicated and no phantom records are orphaned; both app views stay
mounted so the Undo control is never lost by switching tabs. The export artifact records the
`inMemoryExecution` state (`notExecuted` / `executed` / `undone`, always `durable: false` /
`persisted: false`). No durable save / finalize / persist / write-to-roster control exists;
the write is to runtime/session state only and does not survive a reload.

### Portable workspace snapshot toolbar (Phase 5 slice 23)

A persistent **workspace toolbar** in the app shell offers **Export Workspace Snapshot** and
**Import Workspace Snapshot**, labelled "Portable JSON · replaces current in-memory workspace
· no browser storage is used". Export downloads `uc-roster-sniffer-workspace-YYYY-MM-DD.json`
capturing the current in-memory roster (including any executed in-memory import additions)
and does not change app state. Import validates a chosen JSON file: a valid snapshot
**replaces** the workspace (never merges), clears the active in-memory import and the import
workbench's transient state, restores the season/team, and shows a green "Workspace restored"
summary; an invalid file shows a red error notice with the validation reason and leaves the
current workspace unchanged. The toolbar warns that importing replaces the workspace and
clears any active in-memory import (including undo), and that nothing is written to a database
or browser storage. This is explicit file durability only — no auto-save, sync, or
browser/cloud persistence — and is separate from the import preview artifact.

## Team schedule & results (Phase 6 slice 24)

The selected team view shows a read-only **Schedule & Results** section derived from games
between existing teams (opponents resolve through team references — there are no opponent
objects). It displays a record summary (W-L-T, points for, points against, point
differential, upcoming and cancelled counts), the next game, the last result, and a game
list (date/week, home/away, opponent, status, score/result, location). Only `final` games
with scores count toward the record; `scheduled`/`postponed` games are upcoming and
`cancelled` games are shown but excluded from the record. Team with no games shows "No
schedule/results loaded for this team." An unresolved opponent reference is shown inline
("opponent reference could not be resolved") and never crashes the view. Schedules/results
travel with the workspace snapshot.

## Schedule import workbench & in-memory result edits (Phase 6 slice 25)

A dedicated **Schedule import** tab (separate from the read-only roster Import preview) lets
the user load a schedule JSON file (or a bundled demo of the preserved
`schedule-import.sample.json`) and previews it: summary counts (rows / valid / invalid /
additions / updates / skipped / blocking errors) and a row-level table (date/week, home,
away, status, score, outcome add/update/skip/error, and the reason when blocked). **Execute
Schedule Import (In Memory)** is enabled only when the preview is executable; execution is
explicit. After execution the team Schedule & Results view reflects the imported games and an
**Undo Schedule Import** action appears. While executed, the file controls are locked — the
user must undo before loading a different schedule file. Copy states the import is in-memory
only, that workspace snapshot export is the durability path, and that no browser storage or
cloud sync is used.

In the team Schedule & Results section, each game row gains an **Edit Result** control
(shown only when an in-memory update handler is wired): the user edits status, home/away
scores, and notes and clicks **Save Result In Memory**. Final games require both scores;
invalid edits show a readable error and leave state unchanged. The record/summary recalculate
immediately. This is result/status editing only — not full schedule construction. Imported
games and result edits are preserved only through workspace snapshot export/import; importing
a workspace snapshot clears transient schedule-import execution/undo state.

## Game context & standings (Phase 6 slice 26)

The team Schedule & Results section now shows record splits — overall plus **regular
season**, **playoffs** (includes championship games), and **championship** — and each game
row carries context markers (**Playoff**, **Championship**, **Neutral**). Result editing
remains limited to status/scores/notes and preserves the context flags.

A read-only **Standings** tab shows standings for a selected season + age division, derived
from final games only: rank, team, classification (team code), W–L–T, win %, PF, PA, DIFF,
and playoff/championship records, ranked by win percentage then wins, point differential,
points for, and name. Empty states cover no teams and "No final games available for these
standings"; unresolved final references are noted. Schedule imports and result edits flow
into standings immediately and are preserved only through workspace snapshot export/import.

## Coach staff, directory & import (Phase 7 slice 27)

The team view gained a read-only **Coaching Staff & History** section: head coach, assistant
coaches, unknown-role coaches, and (when a prior same-slot team exists) returning / new /
departed coach counts. Empty teams show "No coach/staff data loaded for this team." A
**Coaches** tab lists every coach with their latest assignment, seasons active, teams coached,
and roles held; selecting a coach shows their assignment history across seasons/teams. Both
are read-only.

A **Coach import** tab mirrors the schedule import workbench: load a local coach JSON file
(or the bundled demo), preview row-level add / update / skip / error / **review** outcomes
with summary counts (rows / valid / invalid / coaches-to-add / assignments to add-update /
skipped / blocking), then explicitly **Execute Coach Import (In Memory)** and **Undo Coach
Import**. Ambiguous coach identity is surfaced as a blocking *review* row, never merged.
Copy states coach import is in-memory only until a workspace snapshot export, that workspace
snapshot export is the durability path, and that no browser storage or cloud sync is used.
Coach import never modifies rosters or games; while executed, the file controls are locked
until undo. Coach data travels with workspace snapshots; importing a snapshot clears
transient coach-import execution/undo state.

## Coach performance dashboard & team performance (Phase 7 slice 28)

The **Coaches** tab is upgraded from a basic directory to a read-only **coach performance
dashboard**. Each row shows the coach's latest assignment, seasons active, roles held, overall
W–L–T, win percentage, points for (PF), points against (PA), differential (DIFF), playoff
W–L–T, and championship W–L–T. The empty state reads "No coach performance data available." A
coach with assignments but no final games shows 0–0–0. Selecting a coach opens a detail panel:
overall / regular / playoff / championship splits, head-coach vs assistant vs unknown-role
splits, unresolved-reference notes, and the assignment history table.

The team view's **Coaching Staff & History** section gains a **Coach performance** table for
the selected team's staff. Each row shows role, the **With this team** record (this team's
final games, with regular / playoff / championship splits), and the coach's **Career / all
assignments** record. The labels distinguish with-this-team from career so a coach's full
record is never shown as if it were only this team's. Existing staff continuity (returning /
new / departed) and role lists are preserved, and teams with no coach data keep their empty
state. All performance views are read-only — there is no coach editing. Records are derived
from final games only; scheduled/postponed/cancelled games do not count, and championship
games count toward both championship and playoff context.

## My Team command center (Phase 8 slice 29)

A new **My Team** tab consolidates one selected team's intelligence into a read-only command
center, so a user can see roster movement, schedule/results, standings position, coaching staff,
and attention items without hunting across tabs. A team picker (grouped by season) selects the
team; if a team is already selected elsewhere it is reused, and choosing a team here syncs the
season/district/age-division selection so the Roster tab stays consistent.

Cards:

- **Header** — team name, season, district, age division, classification/team code, mascot, and
  a record summary (overall W–L–T, win%, differential, standings position).
- **Roster Intelligence** — total players, duplicate-name groups, and (when a prior-season
  same-slot team exists) returning / new / not-returning / unknown / identity-review counts; a
  clean unavailable state otherwise.
- **Schedule & Results** — overall / regular / playoff / championship records, PF/PA/DIFF,
  upcoming/cancelled counts, next game, and last result; empty state when no schedule is loaded.
- **Standings** — rank, total teams, win%, and differential, or a provisional note when the
  season/age-division group has no final games.
- **Coaching Staff** — head coach, assistants, the staff record with this team, and
  returning/new/departed continuity; empty state when no coach data exists.
- **Attention Items** — a deterministic list of review cues, each with a severity chip
  (`Info` / `Review` / `Blocker`) and a plain-language message (e.g. no prior team, roster
  duplicates, ambiguous movement, low-confidence identity, unresolved schedule/coach references,
  no schedule, no final games, provisional standings, no coach data, imported-workspace).
- **Workspace** — a reminder that the view is recomputed from the in-memory workspace and that
  workspace snapshot export/import is the durability path (no auto-save / browser / cloud
  storage).

Every card is read-only and links to the existing detailed tab rather than duplicating it. The
whole view is derived at runtime by `buildMyTeamSummary`; nothing new is persisted, and it
renders from restored source data after a workspace snapshot import.

## Multi-year analytics dashboard (Phase 9 slice 30)

A new **Analytics** tab provides a read-only, season-over-season dashboard derived at runtime by
`buildMultiYearAnalyticsSummary`. It does not duplicate authoritative data and is not persisted.

Layout:

- **Dashboard header** — season range, season count, districts, teams, players, games, final
  games, and coaches for the current filter scope.
- **Filters** — season, district, age division, team, and coach selectors, each with an "All"
  option. Filters live in component state only and are not saved; the team selector narrows to
  the active season/district/age-division scope. Standings ranks are always computed within the
  true (season, age-division) group regardless of filters.
- **Team trends** — per team: roster count, returning/new/unknown movement, retention rate,
  season-wide y-up/z-down candidate counts, record + differential, standings rank, and coach
  continuity. Each row can open the team in My Team. Unavailable values (no prior-season team,
  no final games) render as "—", not fabricated zeros.
- **District trends** — seasons represented, teams, players, aggregate record, and differential.
- **Age division trends** — seasons, teams, players, average roster size, and aggregate record.
- **Coach trends** — seasons active, assignments, career record, playoff/championship splits, and
  latest assignment; rows can open the Coaches tab.
- **Attention summary** — aggregated, stable-code review cues with a severity chip
  (`Info`/`Review`/`Blocker`), an affected-entity count, and a plain-language message (missing
  prior-team comparisons, roster identity ambiguity, unresolved schedule/coach references, teams
  without schedule/coach data, sparse seasons).

The whole view is read-only and recomputes from the in-memory workspace — it reflects roster /
schedule / coach import execution, result edits, and workspace snapshot restore, and shows clean
empty/unavailable states for older snapshots that lack games or coaches.

## Visual intelligence polish & cross-tab navigation (Phase 9 slice 31)

Slice 31 improves how the existing intelligence surfaces are scanned and moved through, without
adding persistence, a new data model, or a charting library. All additions are display-only and
derived from existing workspace data.

District/team branding (a colored initials badge from the pure `teamBrandingDisplay` helper)
appears in the My Team header, Analytics team/district rows, Standings rows, and the TeamView
header. There are no logo/helmet image files in the workspace, so the badge is always a colored
initials fallback (never a broken image).

Compact indicators improve scanning: record `metric-chip`s, `diff-chip`s (green/bronze point
differential), `rank-badge` pills, and the existing playoff/championship/neutral/unresolved tags.

Cross-tab navigation (selection/view state only — never mutates data; disabled when the target no
longer resolves):

- Analytics team row → opens the team in My Team; Analytics coach row → opens that coach's detail
  in Coaches.
- Standings team row → opens the team in My Team.
- My Team next/last game opponent → opens the opponent team; My Team coach names → open that coach
  in Coaches.
- TeamView schedule opponent → opens the opponent team.
- Coach Directory assignment-history team → opens that team in My Team.

The Coaches tab's selected-coach detail is now externally addressable: App holds the selected
coach id (component/app state only, not persisted) so navigation can open a specific coach, and it
is cleared automatically if that coach is no longer in the workspace after a snapshot import.

Empty/unavailable states remain plain-language and never fabricate zeros (e.g. "— (no prior)" for
roster movement without a prior-season team, "—" for an unavailable rank/retention, and an
"(unresolved)" tag when an opponent reference cannot be resolved).

## Data Quality / Review Center (Phase 10 slice 32)

Phase 10 begins with a read-only **Review Center** tab: one operational place to see the
data-quality issues already detected across rosters, imports, schedules, coaches, standings, and
analytics. It is derived at runtime by the pure `buildWorkspaceDataQualitySummary` engine and is
read-only — it never mutates rosters, games, coaches, or imports, and persists nothing (including
its filters).

Layout:

- **Header summary** — total issue count, blocker/warning/info counts, and a plain-language status
  ("No major issues found." / "Review recommended." / "Blocking issues need attention before a
  future durable import.").
- **Category cards** — clickable Roster / Schedule / Coach / Workspace counts that filter the list.
- **Filters** — severity, category, season, team, and text search. Component state only; not
  persisted.
- **Issue list** — each item shows a severity chip (Info/Review/Blocker), a category chip, a title,
  a plain-language message, optional detail, a recommended action, and an "Open →" button that
  navigates to the relevant tab when the target resolves (My Team for a team, Coaches for a coach,
  Standings/Analytics for a view). When a target no longer resolves, the control renders as a
  disabled "Unavailable" affordance rather than navigating to a missing entity.
- **Empty states** — "No data-quality issues detected in the current workspace." when there are no
  issues, or "No review items found for the current filters." when filters exclude everything.

Issue coverage (composed from the existing helpers): roster (no players, duplicate identities,
no prior-season team, ambiguous movement, low-confidence identity matches, y-up/z-down candidate
signals); schedule (unresolved game references, final games missing scores, no schedule, no final
results); standings (provisional when a season/age-division group has no final games); coach (no
coach data, unresolved coach assignments, coaches with assignments but no final-game record); and
workspace/import (sparse seasons, in-memory import active, imported-workspace cue). Review items
are recomputed after in-memory roster/schedule/coach changes and after a workspace snapshot
restore, and are never persisted into snapshots. The My Team attention card and the Analytics
attention summary each include an "Open Review Center →" link.

## Import collision UI

During roster import, low-confidence identity matches should be surfaced before final commit.

> Phase positioning: the collision UI below is the **future review screen** for the
> Phase 5 engine pipeline and is **not yet implemented** (see "Import pipeline UI
> (Phase 5 checkpoint)" above). Phase 5 must preserve loaded roster authority and
> must not discard duplicate or ambiguous roster entries.

The collision UI should show:

- raw imported name
- proposed canonical match
- prior known team/district/age division
- confidence level
- reason codes
- available user actions

User actions:

- accept proposed match
- reject proposed match
- manually link
- create new person

## Locked season UI

Locked prior seasons should clearly appear read-only.

The UI should not imply that casual edits are available for historical roster/team composition.
