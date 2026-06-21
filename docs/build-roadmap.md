# Build Roadmap

This roadmap is intended to keep early development narrow and coherent.

## Build posture

Proceed spec-first.

Avoid beginning with visual polish or broad feature sprawl. The first working version should prove the data model and derived classification logic.

## Phase numbering

This roadmap uses the same canonical phase numbering as
`docs/implementation-plan.md` and `CLAUDE.md`:

```text
1 Static local viewer
2 Core deterministic logic
3 Prior-season roster comparison
4 Cohort reclassification preservation
5 Import preview and identity collision handling
6 Schedule and result support
7 Coach analytics
8 My Team panel
9 Multi-year analytics and visual polish
```

The sections below are feature groupings under this shared sequence. Where this
roadmap and `docs/implementation-plan.md` describe the same phase, the phase
number and meaning match. Phase 0 below is a pre-coding specification baseline and
sits ahead of canonical Phase 1.

## Current status checkpoint

As of the Phase 5 checkpoint (slices 1–6 complete; slice 7 is this
documentation/spec-alignment checkpoint):

- **Specification baseline — complete.** Governing docs and sample data contracts
  exist in the repo.
- **Static local viewer (Phase 1) — complete.** Sample data loads; users can
  navigate Season -> District -> Age Division -> Team and view coach and player
  cards.
- **Core deterministic logic (Phase 2) — substantially complete.** Tested pure
  helpers exist for team classification and hierarchy ranking, age division
  ordinals, season edit/lock, name normalization and identity keys, duplicate
  identity detection, exact prior-season identity overlap, roster status
  derivation (`returning`, `new`, `not-returning`, `unknown`), roster status
  confidence (`high`, `low`), roster status summary/count helpers, and
  selected-team perspective counts. Current player cards show Returning / New /
  Unknown plus a separate low-confidence identity-review warning.
- **Prior-season roster comparison (Phase 3) — complete.** The exact-identity
  foundation includes a current-vs-prior comparison contract (slice 1), a
  display-count summary (slice 2), a read-only summary panel (slice 3), an
  engine-only exact-identity transfer/team-slot movement detector
  (`detectExactPriorSeasonPlayerMovement`, slice 4), a spec-only movement-taxonomy
  alignment pass (slice 5), and a district-aware classification layer
  (`classifyDistrictAwarePlayerMovement`, slice 6) that interprets the movement
  signal into product-level statuses (`same-team-returning`, `promoted` /
  `relegated` / `lateral` via the competitive hierarchy
  `A(x) > B1 > C1 = B2 > B3+ = C2 = D2`, `transfer`, the conservative
  `age-division-change`, `new-to-conference`, `not-returning`, `unknown`). Roster
  comparison is exact-identity only and is the foundation the richer taxonomy
  extends — it is not replaced.
- **Cohort reclassification preservation (Phase 4) — complete / checkpointed.** A
  single engine-only, pure-and-deterministic pipeline detects a y-up / z-down
  signal (slice 1), records the first-year event (slice 2), carries the status
  forward and flags broken paths (slice 3), classifies a review outcome (slice 4),
  derives a per-player-season cohort assignment (slice 5), validates a manual
  review action (slice 6), defines an append-only `Cohort Review Decision` record
  (slice 7), applies decisions to assignments in memory (slice 8), and models a
  local decision repository / storage-boundary (slice 9). Slice 10 (this slice) is
  the documentation/spec-alignment checkpoint; see `docs/derived-logic.md`
  ("Phase 4 checkpoint"). Phase 4 has no persistence, no browser storage, no
  `localStorage` / `IndexedDB`, no file writes, no React/UI wiring, no sample-data
  mutation, no roster mutation, and no reset side effect.

- **Import preview and identity collision handling (Phase 5) — slices 1–6
  complete / checkpointed (slice 7).** A single engine-only,
  pure-and-deterministic import pipeline stages candidate roster rows into a
  non-destructive preview (slice 1), generates identity match candidates against
  existing roster records (slice 2), captures an append-only review decision from a
  validated reviewer action (slice 3), models a local decision repository /
  storage-boundary (slice 4), resolves decisions against matches into an effective
  in-memory outcome per row (slice 5), and folds those outcomes into a dry-run
  commit preview plan with a `canCommit` readiness gate (slice 6). Slice 7 is the
  documentation/spec-alignment checkpoint; see `docs/derived-logic.md` ("Phase 5
  checkpoint"). Slice 8 adds a pure in-memory import application / projection from a
  committable plan (the link / create / reject / defer outcomes a future apply would
  produce), still with no persistence and no apply. Later Phase 5 slices wire a
  read-only import workbench (slices 16–18), an in-memory staged roster projection
  (slice 19), a future-import-commit readiness report plus an exportable
  preview-only artifact (slice 20), and a reversible in-memory transaction-plan
  contract with an undo preview (slice 21) — all preview-only, with no import
  apply/commit/save and no persistence. Slice 22 then adds the first controlled
  WRITE boundary: an explicit, reversible **in-memory** import execution into the
  current runtime/session roster view, with undo. That write is in-memory only and
  is **not durable** — nothing is saved, persisted, or committed, and it does not
  survive a reload. Slice 23 then adds practical durability the only safe way so far:
  explicit, user-controlled **portable JSON workspace snapshots** (export to a file,
  import to validate and REPLACE the in-memory workspace). That is file durability by
  hand, not automatic persistence. Phase 5 has no automatic persistence, no browser
  storage, no `localStorage` / `IndexedDB`, no backend/auth/cloud database, no
  auto-save/sync, and no prior-season mutation; browser/database persistence remains a
  future, explicitly approved decision.

Boundary rule carried forward: loaded roster records are authoritative; derived
metadata never alters, removes, suppresses, merges, nullifies, rewrites, reorders,
or ignores source roster records. Ambiguity affects derived metadata only.

Next (optional, requires explicit approval): the actual import **apply / commit**
that performs a projection's planned links / additions, plus real persistence, CSV /
file parsing, and the review UI — each a separate later slice.

## Phase 0: Specification baseline

Goal: establish governing docs before coding.

Deliverables:

- product requirements
- data model
- derived logic
- import workflow
- UI workflow
- sample data contracts

Acceptance criteria:

- docs exist in repo
- unresolved questions are clearly marked as open items
- sample JSON files reflect the current conceptual model

## Phase 1: Static local viewer

Goal: prove that sample data can be loaded and displayed.

Recommended features:

- local JSON load
- district config load
- season selector
- district selector
- age division selector
- team selector
- display team roster cards
- display coach cards

Acceptance criteria:

- user can load sample data
- user can navigate Season -> District -> Age Division -> Team
- team view shows head coach, assistant coaches, and players
- no derived roster logic required yet beyond basic display

## Phase 2: Core deterministic logic

Goal: move derived behavior into tested pure functions before any UI consumes it.

Recommended features:

- team classification parsing
- competitive-hierarchy ranking
- roster status derivation (returning / new / not-returning / unknown)
- roster status confidence (high / low)
- name normalization and identity-key helpers
- duplicate-identity and exact prior-season overlap detection
- summary/count helpers

Acceptance criteria:

- all engine functions are deterministic
- core logic is covered by tests
- React components consume function outputs rather than embedding classification logic

## Phase 3: Prior-season roster comparison

Goal: classify roster movement from one season to the next, including team-level
movement intelligence.

Recommended features:

- compare current roster to prior season
- classify returning/new/transfer
- display status on player cards
- show team composition summary
- implement team classification rules
- implement competitive hierarchy
- classify promoted/relegated/lateral movement
- handle changed team counts between seasons

Acceptance criteria:

- selected team displays counts by derived status
- player cards show derived status
- transfer is detected when prior district differs
- B2 -> B1 is promoted
- B1 -> B2 is relegated
- C2 -> D2 is lateral under current hierarchy
- B3/B4/B5 are treated as B3+
- any valid A-code (A1..A4) is the top tier: B1 -> A4 is promoted, A4 -> B1 is
  relegated, and A-code to A-code (e.g. A2 -> A4) is lateral

## Phase 4: Cohort reclassification preservation

Goal: represent y-up/z-down as a cohort reclassification event that can persist
across seasons.

Recommended features:

- add optional cohort offset fields to player records and player-season assignments
- detect possible first-year y-up/z-down from the observed year-over-year division path
- preserve y-up/z-down while the player follows the reclassified cohort path
- flag review when the path breaks or becomes ambiguous

Acceptance criteria:

- first-year reclassification can be detected from year-over-year review
- preserved y-up/z-down status appears in later seasons when the cohort path continues
- review is required when the preserved path breaks
- birthdate is not required for the basic version

Slice status:

- **Slice 1 (done): cohort reclassification signal detection (engine only).** A
  pure helper (`detectCohortReclassificationSignals`) flags y-up / z-down
  **candidates** from exact-identity year-over-year age-division movement only.
  See `docs/derived-logic.md` ("Cohort reclassification signal detection (Phase 4
  slice 1)"). This slice detects candidates only — it does not persist a cohort
  offset, carry reclassification forward, use fuzzy matching / birthdate / grade /
  notes, or render any UI badge. Ambiguous identities stay `unknown` / review.
  Preservation, carry-forward, and review/reset remain later Phase 4 work.
- **Slice 2 (done): first-year cohort reclassification record (engine only).** A
  pure helper (`deriveFirstYearCohortReclassificationRecords`) consumes the slice
  1 signal output and records the first-year y-up / z-down event for the
  **high-confidence candidates only**, preferring the current-side entry and
  emitting one record per identity event (`ageDivisionDelta` positive for y-up,
  negative for z-down). See `docs/derived-logic.md` ("First-year cohort
  reclassification record (Phase 4 slice 2)"). This is still derived metadata. It
  records the first-year event only — it does not carry the status forward into
  future seasons, persist a cohort offset, reset a preserved path, alter roster
  records, use fuzzy matching / birthdate / grade / notes / manual review, or
  render any UI badge. Preservation / carry-forward across later seasons remains
  later Phase 4 work.
- **Slice 3 (done): cohort reclassification carry-forward (engine only).** A pure
  helper (`carryForwardCohortReclassificationStatus`) takes the slice 2 first-year
  records, a later-season roster, and a season order (oldest to newest), and
  preserves the recorded y-up / z-down status while the player stays on the
  reclassified offset path. It computes an explicit `cohortOffset` relative to
  normal progression and an expected division on the offset path
  (`firstDetectedRank + seasonSteps`, capped at SC..BA), yielding `first-year`,
  `carried-forward` (incl. top/bottom cap), `path-broken` (returned-to-normal or
  unexpected division), or the conservative `insufficient-history` / `unknown` for
  missing records, unusable season ordering, invalid divisions, or ambiguous
  identities. A summary helper (`summarizeCohortReclassificationCarryForward`)
  counts by status, type, and confidence. See `docs/derived-logic.md` ("Cohort
  reclassification carry-forward (Phase 4 slice 3)"). This is still derived
  metadata: a broken path is a review signal, not data deletion. It does not
  persist a cohort offset, alter roster records, use fuzzy matching / birthdate /
  grade / notes / manual review, or render any UI badge. Cohort-offset persistence
  and review/reset remain later Phase 4 work.
- **Slice 4 (done): cohort reclassification review classification (engine only).**
  A pure helper (`classifyCohortReclassificationReview`) takes the slice 3
  carry-forward result (or its entries) and maps each verdict into a simple review
  outcome: `clean` (first-year / carried-forward), `reset-recommended` (path-broken
  by returning to the normal age path), `needs-review` (path-broken by an
  unexpected division, an `unknown` carry-forward, or an otherwise-clean entry that
  carried forward with low confidence), or `insufficient-data` (missing current
  record or unusable season ordering). A summary helper
  (`summarizeCohortReclassificationReview`) counts by review status, type, and
  confidence. See `docs/derived-logic.md` ("Cohort reclassification review
  classification (Phase 4 slice 4)"). This is still derived metadata. Reset is only
  recommended, never performed; a broken path is a review signal. It does not
  persist a review decision, reset cohort status, alter roster records, use fuzzy
  matching / birthdate / grade / notes / manual review, or render any UI badge.
  Persistence and the manual review/reset workflow remain later Phase 4 work.
- **Slice 5 (done): cohort reclassification derived assignment (engine only).** A
  pure helper (`deriveCohortReclassificationAssignments`) folds the slice 4 review
  result (which carries its slice 3 carry-forward entry) into one flat
  per-player-season cohort assignment: `active` / `first-year` (clean
  carried-forward / first-year), `inactive` with `resetRecommended` (review
  reset-recommended), `review` (needs-review), `insufficient-data`, or `unknown`
  for any unmapped combination. It surfaces the applied `cohortOffset`, the
  upstream carry-forward / review statuses and reasons, and the age-division /
  season ids. A summary helper (`summarizeCohortReclassificationAssignments`)
  counts by active status, reset recommendation, type, and confidence. See
  `docs/derived-logic.md` ("Cohort reclassification derived assignment (Phase 4
  slice 5)"). This is an in-memory derived model: `resetRecommended` is advisory
  only. It does not persist, reset cohort status, alter roster records, use fuzzy
  matching / birthdate / grade / notes / manual review, or render any UI badge.
  Persistence, manual review/reset, and UI wiring remain later work.
- **Slice 6 (done): cohort assignment review action model (engine only).** A pure
  helper (`applyCohortReclassificationReviewAction`) takes one slice 5 assignment
  plus a requested action (`confirm`, `reset`, `defer`, `mark-insufficient-data`)
  and returns a validated review-action result: accepted or rejected, with a
  resulting review state (`confirmed`, `reset`, `deferred`, `insufficient-data`,
  `rejected`), the would-be active status, an explicit reason, and any supplied
  reviewer note / timestamp / id echoed back. A summary helper
  (`summarizeCohortReclassificationReviewActions`) counts by acceptance, resulting
  state, and action type. See `docs/derived-logic.md` ("Cohort assignment review
  action model (Phase 4 slice 6)"). This is an engine-only action result model that
  validates possible future review actions. It does not persist a decision, reset
  cohort status, alter roster records, add UI, use fuzzy matching / birthdate /
  grade / notes. An accepted `reset` only records that the recommendation was
  accepted; nothing is committed. Persisting accepted actions and wiring a manual
  review screen remain later work.
- **Slice 7 (done): cohort review decision persistence contract (specs + small
  engine helper).** Specs define a separate, append-only `Cohort Review Decision`
  record (see `docs/data-model.md`) built only from an accepted slice 6 action
  result, plus pure helpers `createCohortReviewDecision` /
  `validateCohortReviewDecision` / `summarizeCohortReviewDecisions`. Ids and
  timestamps are caller-provided (no `Date.now()`), build returns a result object
  instead of throwing, and rejected actions / missing identity / missing evaluated
  season / missing id / missing timestamp all prevent creation. Reset decisions end
  active status without deleting the first-year event; the `source` block keeps the
  derived statuses/reasons + a logic version for re-audit. See
  `docs/derived-logic.md` ("Cohort review decision persistence contract (Phase 4
  slice 7)"). This is the **contract only**: no storage write, no UI, no roster
  mutation, no prior-season unlocking, no reset side effect. Local storage
  integration and the manual review screen remain later work.
- **Slice 8 (done): cohort review decision application (engine only).** A pure
  helper (`applyCohortReviewDecisionsToAssignments`) resolves slice 5 assignments
  against slice 7 decisions in memory, computing an effective state per assignment
  (engine-derived / confirmed / reset / deferred / insufficient-data /
  unresolved-review). Decisions match on identityKey + evaluatedSeasonId +
  reclassificationType; invalid, superseded (by reference), unmatched, key-less, and
  conflicting decisions are ignored with explicit reasons; conflicting current
  decisions are never guessed by array order. A summary helper
  (`summarizeAppliedCohortReviewDecisions`) counts by effective state, application,
  and ignored reason. See `docs/derived-logic.md` ("Cohort review decision
  application (Phase 4 slice 8)"). This is in-memory only: no storage write, no UI,
  no roster mutation; a reset only changes effective state and never deletes the
  first-year event record. Actual local storage and the manual review UI remain
  later work.
- **Slice 9 (done): cohort review decision repository (storage boundary only).** A
  small pure module (`cohortReviewDecisionRepository`) models the local data
  boundary for decisions: `createEmptyCohortReviewDecisionRepositoryState`,
  `appendCohortReviewDecision(s)`, `getCohortReviewDecisions`,
  `getActiveCohortReviewDecisions`, and JSON-compatible
  `exportCohortReviewDecisionRepository` / `importCohortReviewDecisionRepository`.
  State is `{ version, decisions }`; appends validate via
  `validateCohortReviewDecision` and reject invalid / duplicate-decisionId records;
  active excludes superseded decisions while history keeps them; import validates
  the envelope (version / decisions list) and partially imports valid records. Every
  operation returns a new state and never mutates inputs. See `docs/derived-logic.md`
  ("Cohort review decision repository (Phase 4 slice 9)") and `docs/data-model.md`
  ("Cohort Review Decision Repository"). This is the **storage-boundary model only**:
  no browser-storage write (localStorage / IndexedDB / file), no UI, no roster
  mutation. Wiring to actual local storage and a manual review UI remains later work.
- **Slice 10 (done): Phase 4 checkpoint and integration summary (docs only).** A
  documentation / spec-alignment slice that adds no product logic. It records the
  full Phase 4 pipeline end-to-end (signal -> first-year record -> carry-forward /
  path-break -> review classification -> derived assignment -> review action ->
  append-only decision -> decision application -> repository / storage boundary) and
  confirms the standing contracts: Phase 4 is pure and deterministic (no browser
  persistence, no `localStorage` / `IndexedDB`, no file writes, no React/UI wiring,
  no sample-data mutation, no roster mutation, no reset side effect); decision
  history is append-only (decisions may affect derived assignment state in memory
  but never delete roster records or first-year events; superseded decisions stay in
  history); roster authority holds (loaded records are authoritative, ambiguity
  affects metadata/review state only); imports never write review decisions; prior
  seasons stay locked; and y-up/z-down terminology, advisory reset, and derived
  "active assignment" are unchanged. See `docs/derived-logic.md` ("Phase 4
  checkpoint"), `docs/data-model.md` ("Phase 4 checkpoint: four distinct layers"),
  `docs/import-workflow.md`, and `docs/ui-workflow.md`. Phase 4 is **complete /
  checkpointed**; import preview and identity collision handling are Phase 5.

## Phase 5: Import preview and identity collision handling

Goal: prevent name-only matching from silently corrupting history.

Recommended features:

- import preview
- proposed identity matches
- high/low confidence flags
- low-confidence reason codes
- user override decisions

Acceptance criteria:

- same-name collisions are surfaced before commit
- user can accept, reject, manually link, or create new person
- decisions are persisted

Slice status:

- **Slice 1 (done): roster import preview state/contract (engine only).** A pure
  helper (`createRosterImportPreview`) stages candidate roster rows into a
  non-destructive preview: each input row becomes a preview row in input order with
  a deterministic `rowIndex`, the original `playerName`, a `normalizedIdentityKey`
  (reusing the Phase 2 `getPlayerIdentityKey` helper), preserved passthrough
  `fields`, per-row `issues`, and a `status` (`ready` / `needs-review` /
  `invalid`). Missing player name and missing source row id mark a row `invalid`;
  duplicate source row id and duplicate normalized name within the import mark
  affected rows `needs-review` — never discarded. The target context
  (`seasonId` / `districtId` / `ageDivisionId` / `teamId`) is validated and an
  invalid context is reported without mutating rows. Helpers
  `summarizeRosterImportPreviewRows`, `getRosterImportPreviewRowsNeedingReview`, and
  `getValidRosterImportPreviewRows` round out the contract. `ok` is true only when
  the target is valid, there are no error issues, and there are no invalid rows. See
  `docs/import-workflow.md` ("Roster import preview (Phase 5 slice 1)") and
  `docs/data-model.md` ("Roster Import Preview"). This slice does **not** compare
  against existing rosters, classify movement, resolve identity collisions, apply
  imports, parse files, persist, or render UI. Roster comparison, collision review,
  and commit remain later Phase 5 work.
- **Slice 2 (done): import preview identity match candidates (engine only).** A
  pure helper (`createRosterImportPreviewIdentityMatches`) pairs slice 1 preview
  rows with existing roster identity records supplied in the input and generates
  candidate matches per ready preview row. Only `ready` rows are matched (`invalid`
  -> `skipped-invalid-preview-row`, `needs-review` -> `skipped-review-preview-row`,
  both preserved). Matching is exact normalized identity key (reusing the Phase 2
  `getPlayerIdentityKey` helper): one match -> `single-candidate`, more than one ->
  `multiple-candidates` (review), none -> `no-match`. A jersey number can add a
  `matching-jersey-number` reason and raise confidence within an exact-name
  candidate group but never creates a match alone. Duplicate existing names and
  duplicate preview names produce review metadata (never discarded); an existing
  record with a missing name is reported as `invalid-existing-record` without
  throwing. Helpers `summarizeRosterImportPreviewIdentityMatches`,
  `getRosterImportPreviewIdentityMatchesNeedingReview`, and
  `getRosterImportPreviewIdentityMatchesReadyForApply` round out the contract. See
  `docs/import-workflow.md` ("Roster import preview identity matches (Phase 5 slice
  2)"), `docs/data-model.md` ("Roster Import Preview Identity Match"), and
  `docs/derived-logic.md` ("Import preview identity match candidates (Phase 5 slice
  2)"). This slice reuses (does not replace) the slice 1 preview contract and does
  **not** resolve collisions, capture decisions, apply imports, compare prior
  seasons, derive movement, persist, or render UI. Collision resolution, user
  decisions, and commit remain later Phase 5 work.
- **Slice 3 (done): import identity review decision contract (engine only).** Pure
  helpers (`applyRosterImportIdentityReviewAction`,
  `createRosterImportIdentityReviewDecision`,
  `validateRosterImportIdentityReviewDecision`,
  `summarizeRosterImportIdentityReviewDecisions`) define what a reviewer may do with
  a slice 2 match entry and capture it as an append-only decision, mirroring the
  Phase 4 action -> decision sequencing. Allowed actions depend on entry status
  (`no-match`: create-new / manual-link / defer; `single-candidate` /
  `multiple-candidates`: accept-candidate / reject-candidates / manual-link /
  create-new / defer; skipped rows: defer only). `accept-candidate` requires a
  selected id present among the candidates; `manual-link` requires a manual id;
  every action requires a stable `previewSourceRowId`. Effects are future-apply
  instructions (`link-to-existing`, `create-new-roster-entry`, `reject-import-row`,
  `defer-review`, `no-effect`): reject means reject the interpretation for now (no
  deletion) and create-new creates nothing here. Only accepted results become
  decisions; `decisionId` / `createdAt` / `reviewedAt` are caller-provided (no id
  generation, no `Date.now()`, no inferred identity); supersession is recorded only
  via `audit.supersedesDecisionId`. See `docs/import-workflow.md` ("Roster import
  identity review decisions (Phase 5 slice 3)"), `docs/data-model.md` ("Roster
  Import Identity Review Decision"), and `docs/derived-logic.md` ("Import identity
  review decision contract (Phase 5 slice 3)"). This slice reuses (does not replace)
  the slice 1/2 contracts and adds **no** repository, apply, persistence, or UI.
  Applying decisions, a decision repository, and the review UI remain later Phase 5
  work.
- **Slice 4 (done): import identity review decision repository (engine only,
  storage boundary).** A small pure module
  (`rosterImportIdentityReviewDecisionRepository`) models the local data boundary
  for slice 3 decisions, mirroring the Phase 4 slice 9 cohort repository:
  `createEmptyRosterImportIdentityReviewDecisionRepositoryState`,
  `appendRosterImportIdentityReviewDecision(s)`,
  `getRosterImportIdentityReviewDecisions`,
  `getActiveRosterImportIdentityReviewDecisions`, and JSON-compatible
  `exportRosterImportIdentityReviewDecisionRepository` /
  `importRosterImportIdentityReviewDecisionRepository`. State is
  `{ version: 'roster-import-identity-review-decisions.v1', decisions }`; it is
  append-only, validates each decision via
  `validateRosterImportIdentityReviewDecision`, rejects invalid and
  duplicate-decisionId records (in-batch duplicates included, batch order
  preserved), keeps superseded decisions in history while excluding them from the
  active view (via `audit.supersedesDecisionId`), and imports partially after
  validating the envelope (`invalid-repository-payload` /
  `unsupported-repository-version` / `missing-decision-list`), with `ok` false if
  anything was rejected. Every operation returns a new state and never mutates
  inputs or roster/preview data. See `docs/import-workflow.md` ("Roster import
  identity review decision repository (Phase 5 slice 4)"), `docs/data-model.md`
  ("Roster Import Identity Review Decision Repository"), and `docs/derived-logic.md`
  ("Import identity review decision repository (Phase 5 slice 4)"). It reuses (does
  not replace) the slice 3 decision contract and adds **no** browser-storage write
  (localStorage / IndexedDB / file), no apply, and no UI. Wiring to actual local
  storage, applying decisions to imports, and the review UI remain later Phase 5
  work.
- **Slice 5 (done): import identity decision application (engine only).** A pure
  helper (`applyRosterImportIdentityReviewDecisionsToMatches`) resolves slice 2
  match entries against active slice 3 decisions in memory and computes the
  effective import outcome per row, mirroring the Phase 4 slice 8 application step.
  Outcomes: `unresolved`, `link-to-existing`, `create-new`, `rejected`, `deferred`,
  `skipped-invalid-preview-row`, `skipped-review-preview-row`, `conflict`. Decisions
  match on `previewSourceRowId` + `previewRowIndex`; with no decision a matchable
  entry stays `unresolved` (a high-confidence single candidate is never
  auto-linked); accept-candidate / manual-link -> link-to-existing, create-new ->
  create-new, reject-candidates -> rejected (row preserved), defer -> deferred.
  Skipped rows always resolve to their skip outcome; two+ current decisions for one
  entry -> conflict (none applied). Invalid, superseded (via
  `audit.supersedesDecisionId`), key-less, unmatched, status-mismatched, and
  selected-candidate-not-found decisions are ignored with explicit reasons in
  decision input order; `summarizeAppliedRosterImportIdentityReviewDecisions` tallies
  outcomes and ignored reasons. It is effective-state only — no roster write, no
  record creation/linking, no row deletion, no persistence, no UI — and never
  mutates entries or decisions. See `docs/import-workflow.md` ("Applying import
  identity review decisions (Phase 5 slice 5)"), `docs/data-model.md` ("Applied
  Roster Import Identity Review Decision"), and `docs/derived-logic.md` ("Applying
  import identity review decisions (Phase 5 slice 5)"). It reuses (does not replace)
  the slice 2/3/4 contracts. Actually applying outcomes to the roster (import
  commit) and the review UI remain later Phase 5 / Phase 6 work.
- **Slice 6 (done): import commit preview / dry-run plan (engine only).** A pure
  helper (`createRosterImportCommitPreviewPlan`) folds slice 5 applied outcomes into
  a deterministic dry-run commit plan: per row (in input order) a `planStatus`
  (`ready-to-link`, `ready-to-create`, `rejected`, `deferred`, `blocked-unresolved`,
  `blocked-conflict`, `blocked-invalid-preview-row`, `blocked-review-preview-row`)
  and a `plannedOperation` (`link-existing-record`, `create-new-roster-entry`,
  `reject-import-row`, `defer-review`, `none`). link-to-existing with a target id ->
  ready-to-link; without a target -> blocked (`missing-target-existing-record-id`);
  create-new -> ready-to-create; unresolved -> blocked-unresolved (no auto-link, even
  for high-confidence single candidates); conflict / skipped-* -> their blocked
  status. `canCommit` is true only with at least one row, no `blocked-*` rows, and a
  complete (or absent) target context; rejected and deferred do **not** block; an
  empty plan is `canCommit: false`; an incomplete provided target context adds a
  result-level `invalid-target-context` blocker. Helpers
  `summarizeRosterImportCommitPreviewPlanRows`,
  `getRosterImportCommitPreviewPlanRowsReadyForCommit`, and
  `getRosterImportCommitPreviewPlanRowsBlockingCommit` round out the contract. It is
  planning only — no roster write, no record creation/linking, no row deletion, no
  persistence, no UI — and never mutates applied entries or nested original
  entries/candidates (referenced via `originalAppliedEntry`). See
  `docs/import-workflow.md` ("Import commit preview / dry-run plan (Phase 5 slice
  6)"), `docs/data-model.md` ("Roster Import Commit Preview Plan"), and
  `docs/derived-logic.md` ("Import commit preview / dry-run plan (Phase 5 slice 6)").
  It reuses (does not replace) the slice 5 application contract. Performing the
  commit and the review UI remain later Phase 5 / Phase 6 work.
- **Slice 7 (done): Phase 5 checkpoint and import pipeline integration summary
  (docs only).** A documentation / spec-alignment slice that adds no product logic.
  It records the full Phase 5 import pipeline end-to-end (import preview rows ->
  identity match candidates -> review action/decision contract -> decision
  repository -> effective decision application -> dry-run commit preview plan) and
  confirms the standing contracts: the distinct data layers (loaded authoritative
  roster data, preview rows, match entries, review actions, append-only review
  decisions, decision repository state, applied/effective outcome entries, dry-run
  commit plan rows); the hard roster authority rule (loaded records authoritative,
  duplicate/ambiguous names affect metadata/review state only, invalid / duplicate /
  skipped / rejected / deferred rows preserved as rows); Phase 5 purity (no file
  parsing, no file upload, no browser persistence, no `localStorage` / `IndexedDB`,
  no React wiring, no UI, no sample-data mutation, no roster mutation, no import
  apply/commit); append-only decision semantics (superseded decisions stay in
  history, active view excludes them, decisions influence derived effective outcomes
  only); dry-run plan semantics (`ready-to-link` / `ready-to-create` are future
  operations only, rejected/deferred preserved and non-blocking, `blocked-*`
  prevents commit, no decision means unresolved, high-confidence single candidates
  never auto-link, top-level `canCommit` authoritative); and terminology ("commit
  preview plan" = dry-run only; ready-to-create/ready-to-link/rejected/deferred/
  blocked meanings). It defines the boundary for the next optional slice: a pure
  in-memory import application / projection from a committable plan that still must
  not persist, mutate sample data, parse files, or wire UI unless explicitly
  approved. See `docs/derived-logic.md` ("Phase 5 checkpoint"),
  `docs/data-model.md` ("Phase 5 checkpoint: import pipeline layers"),
  `docs/import-workflow.md` ("Phase 5 checkpoint: import pipeline (Phase 5 slice
  7)"), and `docs/ui-workflow.md` ("Import pipeline UI (Phase 5 checkpoint)").
  Phase 5 slices 1–6 are **complete / checkpointed**; the next optional slice is a
  pure in-memory import application / projection (not actual persistence), and
  actual browser persistence, file parsing, and the review UI remain later slices.
- **Slice 8 (done): pure in-memory import application / projection (engine only).**
  A pure helper (`createRosterImportApplicationProjection`) consumes a **committable**
  slice 6 dry-run commit preview plan plus existing roster records and computes, per
  plan row (in plan order), the roster link / addition a future apply *would*
  produce: `projected-link` (ready-to-link resolving to exactly one existing record),
  `projected-create` (ready-to-create, with a provisional, deterministic
  `projectedNewRecord` that is never persisted), `projected-reject` / `projected-defer`
  (preserved; `skipped` when `allowRejectedRows` / `allowDeferredRows` is false), or
  `blocked` (non-committable plan, missing/duplicate existing record, missing target
  context / player name / preview row key, or a defensive `blocked-*` plan row).
  Projection proceeds only when `plan.canCommit` is true; a non-committable plan
  returns `ok: false` with a result-level `plan-not-committable` blocker and no rows.
  Helpers `summarizeRosterImportApplicationProjection`,
  `getRosterImportApplicationProjectionLinkedRows`,
  `getRosterImportApplicationProjectionNewRows`, and
  `getRosterImportApplicationProjectionSkippedRows` round out the contract. It is
  projection only — no import apply/commit, no roster write, no record
  creation/linking, no row deletion, no persistence, no browser storage, no file
  parsing, no UI — and never mutates the plan, its rows, the original applied entries,
  or the existing records (the projected link never modifies the existing record). It
  reuses (does not replace) the slice 6 commit preview plan contract. See
  `docs/import-workflow.md` ("Import application / projection (Phase 5 slice 8)"),
  `docs/data-model.md` ("Roster Import Application Projection"), and
  `docs/derived-logic.md` ("Import application / projection (Phase 5 slice 8)").
  Actually applying the projection (the real import apply / commit), persistence,
  file parsing, and the review UI remain later work and require explicit approval.
- **Slice 9 (done): CSV / text roster parsing into the import preview contract
  (engine only).** A pure parser (`parseRosterImportText` /
  `createRosterImportPreviewFromText`, `src/engine/rosterImportTextParser.ts`)
  converts pasted roster text into slice 1 `RosterImportPreviewRowInput` rows and can
  hand them to the existing `createRosterImportPreview`. It supports comma / tab /
  pipe delimited rows, newline-separated plain names, an optional header
  (`hasHeader: true | false | 'auto'`), auto delimiter detection (presence
  precedence tab > pipe > comma), basic trimming, and blank-line handling; it
  reports — never guesses — full RFC CSV quoting, escaped delimiters, Excel files,
  browser upload, and fuzzy column inference. Header aliases are narrow (name /
  player / athlete; jersey / number / no / #; grade; note / notes) with optional
  `options.columns` overrides; no-header columns map positionally by the row's own
  cell count (1 = name; 2 = jersey+name unless name+jersey; 3 = jersey+name+grade;
  4+ adds notes). Every non-empty source line is preserved as a parse row in source
  order (missing names flagged and flowed into the preview's own validation); blank
  lines are skipped but counted; `sourceRowId` is deterministic (`line-<n>`) with no
  random ids or `Date.now()`. Target context is validated independently
  (`invalid-target-context`) before preview creation and passed through exactly;
  parser issues and preview issues stay distinguishable (`{ parse, preview }`).
  Helpers `summarizeRosterImportTextParseRows` round out the contract. It is
  parser-to-preview only — no file upload, no browser File API, no UI, no
  persistence, no roster mutation, no import apply/commit — and never mutates the
  input text / target context / options. It reuses (does not replace) the slice 1
  preview contract. See `docs/import-workflow.md` ("CSV / text roster parsing (Phase
  5 slice 9)"), `docs/data-model.md` ("Roster Import Text Parse"), and
  `docs/derived-logic.md` ("CSV / text roster parsing (Phase 5 slice 9)"). File
  upload, persistence, UI, and import apply / commit remain later work and require
  explicit approval.
- **Slice 10 (done): Ute Conference scraped JSON source adapter (engine only).** A
  pure adapter (`src/engine/uteConferenceScrapedJsonAdapter.ts`) reads harvested Ute
  Conference website-scrape JSON (`metadata` + `districts[] -> teams[] ->
  players[]/coaches[]`), detects the record type
  (`detectUteConferenceScrapedJsonRecordType`), summarizes it
  (`summarizeUteConferenceScrapedJson`), lists importable team targets in source order
  (`listUteConferenceScrapedJsonTeamTargets`, deterministic `sourceTargetId`), and
  converts a selected team into import-ready preview inputs:
  `createPlayerRosterImportPreviewInputFromScrapedJson` produces a slice 1
  `RosterImportPreviewInput` (composed through `createRosterImportPreview`), and
  `createCoachImportPreviewInputFromScrapedJson` produces a separate coach preview
  shape. Player names, coach names, coach titles, and source URLs are preserved
  exactly (`Last, First` commas, extra spaces, non-breaking spaces intact); coaches
  are never de-duplicated; player and coach rows stay separate. Source row ids are
  deterministic (`scraped:<year>:<ageSlug>:<districtIndex>:<teamIndex>:player|coach:<i>`);
  target context is caller-supplied or derived as provisional slug ids
  (`targetContextProvisional`). Empty league snapshots are valid source data; missing
  names/titles preserve the row with a `missing-*` issue; count mismatches are
  non-destructive `count-mismatch` warnings. It is a source adapter only — no UI, no
  persistence, no browser storage, no file upload, no roster mutation, no import
  apply/commit, no coach analytics, no movement derivation — and never mutates the
  payload. It reuses (does not replace) the slice 1 preview contract or the slice 9
  parser. See `docs/import-workflow.md` ("Ute Conference scraped JSON source adapter
  (Phase 5 slice 10)"), `docs/data-model.md` ("Ute Conference Scraped JSON Source"),
  and `docs/derived-logic.md` ("Ute Conference scraped JSON source adapter (Phase 5
  slice 10)"). UI, persistence, file upload, import apply/commit, and coach analytics
  remain later work and require explicit approval.
- **Slice 11 (done): canonical source mapping for scraped Ute JSON (engine only).** A
  pure mapping adapter (`src/engine/uteConferenceScrapedCanonicalMapping.ts`) converts
  scraped source labels into canonical internal import context.
  `mapUteScrapedAgeDivisionLabel` maps known labels to canonical `SC` / `GR` / `PW` /
  `MM` / `GI` / `BA` (metadata label > alias > team-name prefix fallback; conflicts and
  unsupported labels reported); `mapUteScrapedTeamClassification` extracts only
  explicit coded team-name tokens (`Gremlin A2` -> `A2`, `PeeWee B4` -> `B4`, validated
  via `parseTeamClassification`), leaving color names (`Scout White`/etc.) unknown with
  no invented mapping; `mapUteScrapedDistrict` preserves the raw name and yields a
  registry id (`high`) or a provisional slug (never collapsing `Bingham` vs `Bingham
  Girls`); `mapUteScrapedSeason` maps `metadata.year` (+ `event` label), never from a
  filename. `mapUteScrapedTeamTargetToCanonicalContext` (+ a coach wrapper) composes
  these into a `canonicalContext` with a weakest-of `contextConfidence`, and
  `createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext` feeds that
  context into the slice 10 player adapter, returning the mapping + preview input +
  preview result with player names preserved exactly. Caller overrides
  (`seasonId` / `districtId` / `ageDivisionId` / `teamId` / `teamClassification`)
  replace derived values, are recorded as `caller-override`, and preserve raw source.
  It is a mapping adapter only — no UI, persistence, browser storage, file upload,
  roster mutation, import apply/commit, movement derivation, coach analytics, or fuzzy
  matching — and never mutates the payload. It reuses the existing age-division /
  team-classification helpers, the slice 10 adapter, and the slice 1 preview. See
  `docs/import-workflow.md` ("Canonical source mapping for scraped JSON (Phase 5 slice
  11)"), `docs/data-model.md` ("Ute Scraped Canonical Context Mapping"), and
  `docs/derived-logic.md` ("Canonical source mapping for scraped JSON (Phase 5 slice
  11)"). UI, persistence, file upload, import apply/commit, coach analytics, and a
  canonical district registry remain later work and require explicit approval.
- **Slice 12 (done): scraped JSON full-file readiness report (engine only).** A pure
  reporting/orchestration helper (`createUteConferenceScrapedJsonReadinessReport`,
  `src/engine/uteConferenceScrapedJsonReadinessReport.ts`) classifies every team
  target in one scraped Ute Conference payload as `ready`, `ready-with-warnings`,
  `needs-review`, `blocked`, or `empty`, composing the slice 10 source adapter and
  slice 11 canonical mapping (replacing neither). Each readiness target carries the
  source labels, canonical ids, classification + hierarchy code, `rowCount`,
  `readinessReasons`, origin-tagged `issues`, the `canonicalContextMapping`,
  `contextConfidence` / `targetContextProvisional`, and a `previewSummary` (players) or
  `coachPreviewSummary` (coaches). Players use the slice 11 canonical preview helper
  (comma names preserved; missing player name -> blocked); coaches use the slice 10
  coach helper and are never de-duplicated (missing title/name -> needs-review).
  Unsupported `record_type` / invalid payload -> `ok: false` with the source issue and
  no targets; empty league/team snapshots stay `ok: true`; count mismatches are
  warnings unless `strictCounts` elevates them to needs-review (rows preserved); the
  year is never inferred from a filename. Options:
  `targetContextOverridesBySourceTargetId`, `districtRegistry`, `includeEmptyTeams`
  (default true), `includePreviewResults` (default true), `strictCounts` (default
  false). The summary tallies statuses, total/player/coach rows, and issues by
  severity/code, plus `canProceedToTeamSelection` and `canProceedWithoutReview`;
  helpers `summarizeUteConferenceScrapedJsonReadinessReport`,
  `getUteScrapedJsonImportReadyTargets`, `getUteScrapedJsonTargetsNeedingReview`,
  `getUteScrapedJsonBlockedTargets`, and `getUteScrapedJsonEmptyTargets` round out the
  contract. It is a reporting helper only — no UI, persistence, browser storage, file
  upload, roster mutation, import apply/commit, movement derivation, coach analytics,
  or fuzzy matching — and never mutates the payload. See `docs/import-workflow.md`
  ("Scraped JSON full-file readiness report (Phase 5 slice 12)"), `docs/data-model.md`
  ("Ute Scraped JSON Readiness Report"), and `docs/derived-logic.md` ("Scraped JSON
  full-file readiness report (Phase 5 slice 12)"). A review/import UI may later consume
  this report; that and the other later-work items remain gated on explicit approval.
- **Slice 13 (done): scraped JSON fixture contracts (engine-only, test hardening).**
  A fixture/contract slice that adds **no production logic**. It anchors the scraped
  JSON pipeline (slices 10–12) to representative real harvested source shapes via small
  hand-curated fixtures under `src/test/fixtures/ute-scraped-json/` (players, coaches,
  empty-league snapshots, a comma name `Cary, Hudson`, an extra-space name
  `Moyer , Knox`, a non-breaking-space coach name, `Head Coach` / `Asst Coach` titles, a
  coded classification `Gremlin A2`, and a color team `Scout White`) plus contract
  tests (`src/test/uteConferenceScrapedJsonFixtureContracts.test.ts`) that run the
  fixtures through the existing slice 10/11/12 public helpers only. The tests prove raw
  names/titles, source URLs, and source order are preserved, coded classifications map
  while color teams stay unresolved (no invented mapping), empty snapshots are valid
  source data, payloads are never mutated, output is deterministic, and the engine
  modules expose no apply/commit/write/persist API. Fixtures are test contracts only —
  not bundled into the app and creating no app-visible sample data — with no UI,
  persistence, file upload, import apply, roster mutation, movement derivation, or coach
  analytics. See `docs/import-workflow.md` ("Scraped JSON fixture contracts (Phase 5
  slice 13)"), `docs/data-model.md` ("Scraped JSON fixture contracts (Phase 5 slice
  13)"), and `docs/derived-logic.md` ("Scraped JSON fixture contracts (Phase 5 slice
  13)").

- **Slice 14 (done): scraped JSON import session state (engine only).** A pure,
  deterministic in-memory session-state model for one scraped Ute Conference JSON
  source file (`src/engine/uteConferenceScrapedJsonImportSession.ts`) that **composes**
  the slice 10 adapter, slice 11 canonical mapping, and slice 12 readiness report
  without duplicating their logic. Loading a payload builds the readiness report and a
  deterministic non-cryptographic source fingerprint and selects no target by default;
  an invalid/unsupported source becomes an `invalid-source` session. Selecting a target
  re-runs the existing preview helpers and stores the selected target, canonical
  mapping, and preview output; blocked, empty, and needs-review targets are tracked
  distinctly; missing targets, unloaded sources, and fingerprint mismatches fail
  deterministically; clearing preserves the loaded source/report. The session summary
  exposes deterministic UI flags (`canSelectTarget`, `canProceedToPreview`,
  `canProceedWithoutReview`, and selection counts). Names, titles, source rows, source
  URLs, and source order are preserved exactly; helpers never mutate their inputs (the
  payload is held by reference only, in memory only); and there is no persistence,
  browser storage, file upload, import apply/commit, roster mutation, movement
  derivation, coach analytics, or UI. See `docs/import-workflow.md`, `docs/data-model.md`,
  `docs/derived-logic.md`, and `docs/ui-workflow.md` ("Scraped JSON import session state
  (Phase 5 slice 14)").

- **Slice 15 (done, governance-corrected): scraped JSON import session review
  decisions (engine only).** A pure, deterministic **session-level review-decision
  state** layer over the slice 14 session
  (`src/engine/uteConferenceScrapedJsonImportSessionReviewDecisions.ts`). It holds a
  reviewer's per-row decisions (`confirm-row-identity` / `mark-row-needs-review` /
  `ignore-row-for-review`) for the currently selected target and reflects them in
  deterministic review metadata — and nothing else. It is review **metadata only**: it
  never applies, commits, mutates, suppresses, or reorders source data. It does **not**
  compose the slice 2–5 identity-review decision/repository/application helpers, because
  those operate on identity match entries that require an existing-roster registry the
  scraped session does not have yet; instead the three actions are projected onto the
  canonical identity-review vocabulary (`mapUteScrapedJsonImportSessionReviewAction`),
  mapping only to review-only effects (`no-effect` / `defer-review`) so the layer can
  never apply or mutate by construction. Decisions are accepted only for the selected
  target/fingerprint/row, and stored decisions are re-validated against the current
  selection on every read so they cannot leak across a target switch. This slice was
  written onto main before authorization and then corrected under governance: the
  canonical-vocabulary adapter, the read-time decision isolation, and the doc fold were
  added, and the standalone `docs/phase5-slice15-*.md` was removed in favor of the
  source-of-truth docs. No UI, persistence, browser storage, file upload, import
  apply/commit, roster mutation, movement derivation, or coach analytics. See
  `docs/import-workflow.md`, `docs/data-model.md`, `docs/derived-logic.md`, and
  `docs/ui-workflow.md` ("Scraped JSON import session review decisions (Phase 5 slice
  15)").

## Phase 6: Schedule and result support

Goal: derive records from game objects.

Recommended features:

- load schedule records
- update game results
- home/away support
- playoff flag
- championship flag
- team performance summary

Acceptance criteria:

- team record derives from games
- playoff wins/losses derive from flagged games
- championship appearance/win derive from championship games

Status: **Phase 6 has begun.** Slice 24 adds a game-centric schedule/result model
(games reference existing teams as home/away participants — opponents are not separate
objects), pure deterministic team schedule summaries (W-L-T, points for/against/
differential, next game, last result, per-game opponent-resolved views; only final games
count toward the record), a read-only **Schedule & Results** team-view section, and
workspace-snapshot support for schedules/results (optional/backward-compatible at
schemaVersion 1). Slice 25 then makes schedule/results a working local feature: a schedule
import workflow (preview → explicit in-memory execution → undo) that maps the preserved
team-centric `schedule-import.sample.json` rows into the game model (opponents resolve
through existing teams; add/update/skip/error classification with safe gameId/natural-key
matching that never silently overwrites), plus in-memory result/status editing from the team
schedule view. Both are in-memory only and preserved solely through workspace snapshot
export/import. Slice 26 expands game context (neutral-site, playoff, and championship flags,
preserved through import / result editing / snapshots), adds team record splits (regular /
playoff / championship — championship counts as playoff context), and adds a read-only
**Standings** dashboard derived from final games only for a selected season + age division
(opponents resolved through existing teams). Schedules/results are maintained separately from
roster imports and never mutate rosters. Schedule editing remains limited to result/status
updates (not full schedule construction); external schedule import and full multi-year
analytics dashboards remain future work.

## Phase 7: Coach analytics

Goal: calculate lifetime and continuous-cohort records.

Recommended features:

- coach lifetime record
- coach continuous-cohort record
- coach history panel
- returning coach indicators

Acceptance criteria:

- lifetime record accumulates across all assigned teams
- continuous-cohort record continues only when district and expected age progression continue
- Scout-to-Scout exception is handled

Status: **Phase 7 has begun.** Slice 27 adds a normalized coach/staff model (coaches +
season/team assignments, tracked separately from rosters and never mutating
rosters/games/schedules), deterministic name-based coach identity (ambiguity surfaced, not
merged), team staff history with returning/new/departed continuity, a coach directory, a
coach import workflow (preview → in-memory execute → undo), and workspace-snapshot support
for coaches/assignments. Everything is in-memory only and preserved solely through workspace
snapshot export/import. Slice 28 adds derived **coach performance analytics**: read-only,
deterministic records connecting coach assignments to final game results across teams,
seasons, roles, and playoff/championship contexts (overall / regular / playoff / championship
splits, PF/PA/DIFF, win percentage, head/assistant/unknown role splits, with-this-team vs
career records). Scheduled/postponed/cancelled games do not count; championship games count
toward championship and playoff context; analytics never mutate rosters, games, or assignments
and are recomputed at runtime from snapshot-preserved source data. The continuous-cohort
Scout-to-Scout exception remains future work.

## Phase 8: My Team panel

Goal: support season-specific favorite team workflows.

Recommended features:

- mark one team as My Team per season
- collapsible left-side panel
- schedule display
- opponent profile links

Acceptance criteria:

- My Team persists for the season
- panel shows schedule and results
- opponent links navigate to team profiles

## Phase 9: Multi-year analytics and visual polish

Goal: add higher-level conference and district intelligence, and improve
interpretability and product feel.

Recommended features:

- district win/loss summaries
- championship history
- coach leaderboards
- roster retention rates
- transfer rates
- promotion/relegation rates
- district logos
- district helmets
- primary/secondary colors
- mascot display
- age division visual language
- team-level visual language

Acceptance criteria:

- filtered summary views display multi-year trends
- analytics derive from canonical assignments and game records
- selecting a district applies recognizable branding cues
- player status remains visually clear and not overwhelmed by branding

## Early technical recommendation

Start with a local-first web app using file-backed JSON samples, then decide whether persistence should remain JSON-only or evolve toward browser storage plus export/import.

Do not select a production architecture until the import contracts and derived logic are validated against realistic sample data.
