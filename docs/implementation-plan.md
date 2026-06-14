# Implementation Plan

This document translates the product requirements, data model, derived logic, import workflow, UI workflow, and build roadmap into a coding-agent-ready implementation approach.

## Bottom line

Build this project in narrow, testable slices.

The first coding pass should not attempt the full product. It should create a local static viewer that proves the sample data contract, navigation model, card layout, and basic summary display.

## Guiding principles

1. **Spec-first**: the coding agent should treat files in `docs/` as the source of truth.
2. **Local-first**: no backend, authentication, cloud database, or paid service should be introduced in early phases.
3. **Pure logic first**: derived rules should live in testable TypeScript functions, not inside React components.
4. **No silent inference**: identity collisions and low-confidence matches must eventually be surfaced for review.
5. **Small slices**: each phase should leave the app runnable and understandable.

## Recommended initial stack

```text
Vite
React
TypeScript
Vitest
Local JSON sample data
CSS modules or plain CSS
```

Do not add state-management libraries, routers, databases, authentication, or UI component frameworks until there is a clear need.

## Proposed source structure

```text
src/
  app/
    App.tsx
    App.css

  data/
    loadSampleData.ts
    normalizeSampleData.ts

  domain/
    types.ts
    constants.ts

  engine/
    teamClassification.ts
    competitiveHierarchy.ts
    rosterStatus.ts
    identityMatching.ts
    records.ts
    summaries.ts

  components/
    FilterBar.tsx
    SummaryPanel.tsx
    TeamView.tsx
    CoachCard.tsx
    PlayerCard.tsx
    DetailPanel.tsx
    MyTeamPanel.tsx

  design/
    tokens.ts

  test/
    fixtures.ts
```

## Phase 1: Static local viewer

### Goal

Create a runnable local app that loads sample data and displays a selected team.

### Build

- Initialize Vite + React + TypeScript.
- Add Vitest.
- Load JSON sample files from `data-samples/` or copy them into `src/test/fixtures` if needed for bundling.
- Add TypeScript domain types matching the current sample contracts.
- Implement basic filter state:
  - season
  - district
  - age division
  - team
- Render:
  - selected team summary
  - head coach card
  - assistant coach cards
  - player cards
- Add system design tokens from `docs/design-system.md`.

### Explicitly do not build yet

- roster import workflow
- identity collision workflow
- editing
- persistence
- backend
- authentication
- advanced analytics
- schedule update forms
- coach lifetime calculations

### Acceptance criteria

```text
App runs locally.
User can select Season -> District -> Age Division -> Team.
Selected team displays coaches and players.
Basic team summary displays total player count and coach count.
System colors are centralized as named tokens.
No backend or cloud dependency exists.
```

### Status

**Complete.** The static local viewer, Season -> District -> Age Division -> Team
navigation, team summary, coach cards, player cards, and centralized design
tokens are implemented. No backend, persistence, or cloud dependency exists.

## Phase 2: Core deterministic logic

### Goal

Move derived behavior into tested pure functions.

### Build

Create engine modules:

```text
teamClassification.ts
competitiveHierarchy.ts
rosterStatus.ts
identityMatching.ts
records.ts
summaries.ts
```

### Tests

Minimum tests:

```text
1 team -> A1
2 teams -> A2, D2
3 teams -> A3, C1, C2
4 teams -> A4, B1, B2, B3
5 teams -> A4, B1, B2, B3, B4
B2 -> B1 = promoted
B1 -> B2 = relegated
C2 -> D2 = lateral
B3/B4/B5 normalize to B3+
District change = transfer
No prior match = new
Same-name in another district can produce low confidence
Two same-name matches in same district can produce low confidence
```

### Acceptance criteria

```text
All engine functions are deterministic.
All core logic has tests.
React components consume function outputs rather than embedding classification logic.
```

### Status (Phase 2 checkpoint)

**Substantially complete.** The deterministic engine foundation is built and
tested, with narrow UI support wired into the existing card layout. Completed
capabilities:

- Team classification parsing and competitive-hierarchy ranking.
- Age division ordinal helpers.
- Season edit/lock helper logic.
- Player name normalization and identity-key helpers.
- Duplicate player identity detection.
- Exact prior-season identity overlap helper.
- Roster status derivation: `returning`, `new`, `not-returning`, `unknown`.
- Roster status confidence: `high`, `low`.
- Roster status summary/count helpers.
- Selected-team perspective summary counts.
- Multi-season sample fixture supporting roster-status testing.
- Per-current-player roster status display: Returning, New, Unknown.
- A separate low-confidence identity-review warning on the player card, distinct
  from the roster status badge.

Phase 2 rules that must continue to hold in later phases:

- Loaded roster records are authoritative.
- Derived metadata must not alter, remove, suppress, merge, nullify, rewrite,
  reorder, or ignore source roster records. Ambiguity affects derived metadata
  only.
- `unknown` is the correct current-player status when identity cannot be safely
  resolved (for example, duplicate-name ambiguity).
- `not-returning` belongs to prior-season comparison/summary context and must not
  appear as a current player-card status.
- Transfer, promotion/relegation, y-up, z-down, and identity-collision resolution
  are intentionally **not** part of Phase 2.

The roster-status engine is exact-identity only: it matches on normalized name
keys and never fuzzy-matches. This is the deliberate, reviewable foundation that
Phase 3 builds on.

## Phase 3: Prior-season roster comparison

### Phase 3 entry point

Phase 3 begins from the exact-identity roster comparison foundation already built
in Phase 2 (`comparePlayerIdentityOverlap` -> `deriveRosterStatusFromOverlap` ->
per-current-player status). Phase 3 extends that foundation with district-aware
movement (transfer) and competitive-tier movement (promotion / relegation /
lateral); it does not replace or rewrite the exact-identity matching already in
place. Phase 3 is **not** complete.

Movement vocabulary is fixed by the taxonomy-alignment pass in
`docs/derived-logic.md` ("Player movement taxonomy alignment (Phase 3 slice 5)").
Coding slices must use those terms and respect the two distinctions it draws:

- **Same-slot roster comparison** (slices 1–2) compares one current team to its
  prior-season same-slot team and supports `returning` / `newToRoster` /
  `notReturning` / `unknown`. It cannot detect transfers and must not be extended
  to claim it does.
- **Exact identity team-slot movement** (slice 4) is a deterministic **input
  signal** — exact identity on the same vs a different team slot. Its
  transferred-in / transferred-out buckets are not a final `transfer`,
  `promoted`, `relegated`, or `lateral` verdict. Those verdicts require team
  hierarchy (promotion / relegation / lateral) or district context (transfer)
  layered on top, and y-up / z-down remain cohort reclassification events handled
  in Phase 4. Ambiguous identities stay `unknown` and are never bucketed into
  movement.

### Goal

Show meaningful roster movement from current season versus prior season.

### Build

- Add prior-season sample data.
- Match players by canonical name or normalized raw name.
- Display derived player statuses:
  - returning
  - new
  - transfer
  - promoted
  - relegated
  - lateral
- Add summary counts by status.

### Acceptance criteria

```text
Team summary shows counts by derived player status.
Player cards show status badges.
Transfer is detected when prior district differs.
Promotion/relegation uses competitive hierarchy.
```

## Phase 4: Cohort reclassification preservation

### Goal

Represent y-up/z-down as a cohort reclassification event that can persist across seasons.

### Build

- Add optional cohort offset fields to player records and player-season assignments.
- Detect possible first-year y-up/z-down based on observed year-over-year division path.
- Preserve y-up/z-down while the player follows the reclassified cohort path.
- Flag review when the path breaks or becomes ambiguous.

### Acceptance criteria

```text
First-year reclassification can be detected from year-over-year review.
Preserved y-up/z-down status appears in later seasons when cohort path continues.
Review is required when the preserved path breaks.
Birthdate is not required for the basic version.
```

### Slice progress

- **Slice 1 (done): cohort reclassification signal detection (engine only).**
  `detectCohortReclassificationSignals` classifies exact-identity year-over-year
  age-division movement into `expected-age-progression`, `same-age-division`,
  `y-up-candidate`, `z-down-candidate`, or `unknown`, using age-division ordinal
  movement only. It is a **signal layer** — y-up / z-down are candidate signals,
  not a persisted cohort status. No preservation/carry-forward, no fuzzy matching,
  no birthdate/grade/notes inference, no UI badges, and ambiguous identities stay
  `unknown` / review. See `docs/derived-logic.md` for the full contract.
  Remaining Phase 4 slices add cohort-offset preservation, carry-forward, and
  review/reset.
- **Slice 2 (done): first-year cohort reclassification record (engine only).**
  `deriveFirstYearCohortReclassificationRecords` consumes the slice 1 signal
  output and records the **first-year** y-up / z-down cohort reclassification
  event for high-confidence candidates only. It produces one record per identity
  event (current-side entry preferred over the redundant prior-side perspective),
  with `ageDivisionDelta` positive for y-up and negative for z-down, and skips
  every non-candidate, low-confidence, ambiguous, or incomplete entry. It is
  still derived metadata: no carry-forward into future seasons, no cohort-offset
  persistence, no path reset, no roster mutation, no fuzzy matching /
  birthdate / grade / notes / manual review, and no UI badge. See
  `docs/derived-logic.md` for the full contract. Remaining Phase 4 slices add
  cohort-offset preservation, carry-forward, and review/reset.
- **Slice 3 (done): cohort reclassification carry-forward (engine only).**
  `carryForwardCohortReclassificationStatus` consumes the slice 2 first-year
  records plus a later-season roster and `seasonOrder` (oldest to newest) and
  decides, per record, whether the player is still on the reclassified offset
  path. It computes an explicit `cohortOffset` relative to normal progression
  (`firstDetectedRank - (priorRank + 1)`) and an expected division on the offset
  path (`firstDetectedRank + seasonSteps`, capped at SC..BA). Verdicts:
  `first-year`, `carried-forward` (incl. top/bottom cap), `path-broken`
  (returned-to-normal or unexpected division), and the conservative
  `insufficient-history` / `unknown` for missing records, unusable season
  ordering, invalid divisions, or ambiguous identities. A summary helper
  (`summarizeCohortReclassificationCarryForward`) counts by status, type, and
  confidence. It is still derived metadata: no persistence, no UI badges, no
  import change, no fuzzy matching / birthdate / grade / notes / manual review,
  and no roster mutation; a broken path is a review signal, not data deletion.
  See `docs/derived-logic.md` for the full contract. Remaining Phase 4 work adds
  cohort-offset persistence and review/reset.
- **Slice 4 (done): cohort reclassification review classification (engine only).**
  `classifyCohortReclassificationReview` consumes the slice 3 carry-forward result
  (or its entries) and maps each verdict into a review outcome: `clean`
  (first-year / carried-forward), `reset-recommended` (path-broken returned to the
  normal age path), `needs-review` (path-broken by an unexpected division, an
  `unknown` carry-forward, or an otherwise-clean entry carried forward with low
  confidence), and `insufficient-data` (missing current record or unusable season
  ordering). A summary helper (`summarizeCohortReclassificationReview`) counts by
  review status, type, and confidence. It classifies only: reset is recommended,
  never performed, and nothing is persisted. It is still derived metadata: no
  persisted review decision, no automatic reset, no UI badges, no import change, no
  fuzzy matching / birthdate / grade / notes / manual review, and no roster
  mutation. See `docs/derived-logic.md` for the full contract. Remaining Phase 4
  work adds cohort-offset persistence and the manual review/reset workflow.
- **Slice 5 (done): cohort reclassification derived assignment (engine only).**
  `deriveCohortReclassificationAssignments` consumes the slice 4 review result (or
  its entries) and produces one flat per-player-season cohort assignment per review
  entry. It maps review/carry-forward state into an `activeStatus`: `first-year`
  (clean + first-year), `active` (clean + carried-forward), `inactive` with
  `resetRecommended` true (reset-recommended), `review` (needs-review),
  `insufficient-data`, and `unknown` for any unmapped combination. It surfaces the
  applied `cohortOffset`, the upstream carry-forward / review statuses and reasons,
  and the age-division / season ids, all by reference. A summary helper
  (`summarizeCohortReclassificationAssignments`) counts by active status, reset
  recommendation, type, and confidence. It is an in-memory derived model:
  `resetRecommended` is advisory only — no persistence, no automatic reset, no UI
  badges, no import change, no fuzzy matching / birthdate / grade / notes / manual
  review, and no roster mutation. See `docs/derived-logic.md` for the full
  contract. Remaining Phase 4 work adds persistence and the manual review/reset
  workflow.
- **Slice 6 (done): cohort assignment review action model (engine only).**
  `applyCohortReclassificationReviewAction` takes one slice 5 assignment plus a
  requested action (`confirm`, `reset`, `defer`, `mark-insufficient-data`) and
  returns a validated result: `accepted` plus a `resultingReviewState`
  (`confirmed`, `reset`, `deferred`, `insufficient-data`, `rejected`), the would-be
  active status, `resetRecommended`, `confidence`, an explicit `reason`, and any
  supplied reviewer note / timestamp / id echoed back. Confirm is allowed on
  active / first-year (clean-confirmed) and review (confirmed -> active); reset only
  on inactive with a reset recommendation, and is rejected on clean assignments;
  defer only on review; mark-insufficient-data only on insufficient-data; unknown
  states and unmapped pairings are rejected with a named reason. A summary helper
  (`summarizeCohortReclassificationReviewActions`) counts by acceptance, resulting
  state, and action type. It is an engine-only action result model: nothing is
  persisted or committed — an accepted reset only records acceptance — and there is
  no UI, no roster mutation, no fuzzy matching / birthdate / grade / notes. See
  `docs/derived-logic.md` for the full contract. Remaining Phase 4 work persists
  accepted actions and wires the manual review screen.
- **Slice 7 (done): cohort review decision persistence contract (specs + small
  engine helper).** Specs define a separate, append-only `Cohort Review Decision`
  record (`docs/data-model.md`) built only from an accepted slice 6 action result.
  `createCohortReviewDecision(actionResult, options)` is pure and deterministic:
  caller-provided `decisionId` / `createdAt` (no `Date.now()`), returns a result
  object (not a throw), and refuses creation for rejected actions, empty identity
  keys, missing evaluated seasons, or missing id / timestamp.
  `validateCohortReviewDecision` checks required fields, type/state coherence, and
  the reset-not-active / confirm-not-reset guards; `summarizeCohortReviewDecisions`
  counts by type, reclassification type, reviewer-note, supersession, and validity.
  Decisions are append-only (supersede by reference), never mutate rosters or unlock
  prior seasons, and a reset decision does not delete the first-year event. It is
  the contract only: no storage write, no UI, no reset side effect. See
  `docs/derived-logic.md` for the full contract. Remaining Phase 4 work adds local
  storage integration and the manual review screen.
- **Slice 8 (done): cohort review decision application (engine only).**
  `applyCohortReviewDecisionsToAssignments(assignments, decisions)` resolves slice 5
  assignments against slice 7 decisions in memory and returns one effective-state
  entry per assignment (engine-derived / confirmed / reset / deferred /
  insufficient-data / unresolved-review) plus a list of ignored decisions. Decisions
  match on identityKey + evaluatedSeasonId + reclassificationType and are validated
  via `validateCohortReviewDecision`; supersession is by reference
  (`audit.supersedesDecisionId`); multiple current matches are a conservative
  conflict (none applied, stays engine-derived, never resolved by array order);
  invalid / unmatched / key-less decisions are ignored with explicit reasons. A
  summary helper (`summarizeAppliedCohortReviewDecisions`) counts by effective
  state, application, and ignored reason. It is pure and in-memory: no storage
  write, no UI, no roster mutation, and a reset only changes effective state without
  deleting the first-year event record. See `docs/derived-logic.md` for the full
  contract. Remaining Phase 4 work adds local storage integration and the manual
  review screen.
- **Slice 9 (done): cohort review decision repository (storage boundary only).**
  `cohortReviewDecisionRepository` models the local data boundary with pure helpers:
  `createEmptyCohortReviewDecisionRepositoryState`, `appendCohortReviewDecision(s)`,
  `getCohortReviewDecisions`, `getActiveCohortReviewDecisions`, and JSON-compatible
  `exportCohortReviewDecisionRepository` / `importCohortReviewDecisionRepository`.
  State is `{ version: 'cohort-review-decisions.v1', decisions }`; it is append-only,
  validates each decision via `validateCohortReviewDecision`, rejects invalid and
  duplicate-decisionId records (in-batch duplicates included), keeps superseded
  decisions in history while excluding them from the active view, and imports
  partially after validating the envelope (`invalid-repository-payload` /
  `unsupported-repository-version` / `missing-decision-list`). Every operation
  returns a new state and never mutates inputs or roster data. It is the
  storage-boundary model only: no browser-storage write, no UI. See
  `docs/derived-logic.md` and `docs/data-model.md` for the full contract. Remaining
  Phase 4 work wires this repository to actual local storage and the manual review
  screen.
- **Slice 10 (done): Phase 4 checkpoint and integration summary (docs only).** A
  documentation / spec-alignment slice that adds no product logic. It documents the
  full Phase 4 pipeline end-to-end and confirms the standing contracts: Phase 4 is
  pure and deterministic (no browser persistence, no `localStorage` / `IndexedDB`,
  no file writes, no React/UI wiring, no sample-data mutation, no roster mutation, no
  reset side effect); decision history is append-only (a decision may affect derived
  assignment state in memory but never deletes roster records or first-year events;
  superseded decisions remain in repository history); loaded roster records stay
  authoritative (ambiguity affects metadata/review state only); imports never write
  review decisions; prior seasons stay locked; and the y-up/z-down /
  advisory-reset / derived "active assignment" terminology is unchanged. See
  `docs/derived-logic.md` ("Phase 4 checkpoint"), `docs/data-model.md`,
  `docs/import-workflow.md`, `docs/ui-workflow.md`, and `docs/build-roadmap.md`.

### Phase 4 checkpoint

Phase 4 (cohort reclassification preservation) is **complete / checkpointed**. The
acceptance criteria above are met by the engine pipeline (slices 1–9), and slice 10
documents and confirms the contracts. The next narrow work is **Phase 5: import
preview and identity collision handling**, which must preserve loaded roster
authority and must not discard duplicate or ambiguous roster entries.

## Phase 5: Import preview and collision handling

### Goal

Prevent name-only matching from silently corrupting history.

### Build

- Create roster import preview state.
- Generate proposed person matches.
- Assign confidence and reason codes.
- Surface low-confidence matches before commit.
- Allow user decisions:
  - accept proposed match
  - reject proposed match
  - manually link
  - create new person

### Acceptance criteria

```text
Low-confidence collisions are never silently committed.
User decisions are captured.
Import commit happens only after collision review.
```

### Slice progress

- **Slice 1 (done): roster import preview state/contract (engine only).**
  `createRosterImportPreview(input)` produces a pure, deterministic, non-destructive
  preview (`src/engine/rosterImportPreview.ts`). Every input row is preserved as a
  preview row in input order with a deterministic `rowIndex`, the original
  `playerName`, a `normalizedIdentityKey` (reusing Phase 2 `getPlayerIdentityKey`),
  preserved passthrough `fields`, per-row `issues`, and a `status`. Chosen contract:
  missing player name -> `invalid`; missing source row id -> `invalid`; duplicate
  source row id -> `needs-review`; duplicate normalized name within the import ->
  `needs-review`. The target context (`seasonId` / `districtId` / `ageDivisionId` /
  `teamId`) is validated and an invalid context is reported without mutating rows.
  `summarizeRosterImportPreviewRows`, `getRosterImportPreviewRowsNeedingReview`, and
  `getValidRosterImportPreviewRows` round out the contract; `ok` is true only when
  the target is valid and there are no error issues or invalid rows. It does **not**
  compare against existing rosters, classify movement, resolve identity collisions,
  apply imports, parse files, persist, or render UI. See `docs/import-workflow.md`
  ("Roster import preview (Phase 5 slice 1)") and `docs/data-model.md` ("Roster
  Import Preview"). Remaining Phase 5 work adds proposed matches, collision review,
  user decisions, and commit.
- **Slice 2 (done): import preview identity match candidates (engine only).**
  `createRosterImportPreviewIdentityMatches(input)` pairs slice 1 preview rows with
  existing roster identity records and generates candidate matches per ready preview
  row (`src/engine/rosterImportPreviewIdentityMatch.ts`). Only `ready` rows are
  matched; `invalid` / `needs-review` rows are preserved as skipped entries.
  Matching is exact normalized identity key (reusing Phase 2 `getPlayerIdentityKey`):
  one match -> `single-candidate`, more than one -> `multiple-candidates`, none ->
  `no-match`. A jersey number adds a reason and raises confidence within an
  exact-name candidate group but never matches alone; duplicate existing/preview
  names produce review metadata; a missing existing-record name is reported as
  `invalid-existing-record` without throwing. `summarizeRosterImportPreviewIdentityMatches`,
  `getRosterImportPreviewIdentityMatchesNeedingReview`, and
  `getRosterImportPreviewIdentityMatchesReadyForApply` round out the contract; entries
  follow preview row order and candidates follow existing-record input order. It
  reuses (does not replace) the slice 1 contract and does **not** resolve collisions,
  capture decisions, apply imports, compare prior seasons, derive movement, persist,
  or render UI. See `docs/import-workflow.md`, `docs/data-model.md` ("Roster Import
  Preview Identity Match"), and `docs/derived-logic.md` ("Import preview identity
  match candidates (Phase 5 slice 2)"). Remaining Phase 5 work adds collision
  resolution, user decisions, and commit.
- **Slice 3 (done): import identity review decision contract (engine only).**
  `applyRosterImportIdentityReviewAction(entry, action)` validates a reviewer action
  against a slice 2 match entry; `createRosterImportIdentityReviewDecision(actionResult,
  options)` turns an accepted result into an append-only decision
  (`src/engine/rosterImportIdentityReviewDecision.ts`), mirroring the Phase 4 action
  -> decision sequencing. Allowed actions depend on entry status (skipped rows allow
  defer only); `accept-candidate` needs a selected id present among the candidates,
  `manual-link` needs a manual id, and every action needs a stable
  `previewSourceRowId`. Effects (`link-to-existing`, `create-new-roster-entry`,
  `reject-import-row`, `defer-review`, `no-effect`) are future-apply instructions —
  reject rejects the interpretation for now (no deletion) and create-new creates
  nothing here. Only accepted results become decisions; `decisionId` / `createdAt` /
  `reviewedAt` are caller-provided (no id generation, no `Date.now()`, no inferred
  identity); supersession is recorded only via `audit.supersedesDecisionId`.
  `validateRosterImportIdentityReviewDecision` and
  `summarizeRosterImportIdentityReviewDecisions` round out the contract. It reuses
  (does not replace) the slice 1/2 contracts and adds **no** repository, apply,
  persistence, or UI. See `docs/import-workflow.md` ("Roster import identity review
  decisions (Phase 5 slice 3)"), `docs/data-model.md` ("Roster Import Identity Review
  Decision"), and `docs/derived-logic.md` ("Import identity review decision contract
  (Phase 5 slice 3)"). Remaining Phase 5 work adds a decision repository, applying
  decisions to imports, and the review UI.
- **Slice 4 (done): import identity review decision repository (engine only,
  storage boundary).** `rosterImportIdentityReviewDecisionRepository` models the
  local data boundary for slice 3 decisions with pure helpers:
  `createEmptyRosterImportIdentityReviewDecisionRepositoryState`,
  `appendRosterImportIdentityReviewDecision(s)`,
  `getRosterImportIdentityReviewDecisions`,
  `getActiveRosterImportIdentityReviewDecisions`, and JSON-compatible
  `exportRosterImportIdentityReviewDecisionRepository` /
  `importRosterImportIdentityReviewDecisionRepository`. State is
  `{ version: 'roster-import-identity-review-decisions.v1', decisions }`; it is
  append-only, validates via `validateRosterImportIdentityReviewDecision`, rejects
  invalid and duplicate-decisionId records (in-batch duplicates included, batch
  order preserved), keeps superseded decisions in history while excluding them from
  the active view, and imports partially after validating the envelope
  (`invalid-repository-payload` / `unsupported-repository-version` /
  `missing-decision-list`), `ok` false if anything was rejected. Every operation
  returns a new state and never mutates inputs or roster/preview data. It mirrors
  the Phase 4 slice 9 cohort repository and reuses (does not replace) the slice 3
  contract; it adds **no** browser-storage write, no apply, and no UI. See
  `docs/import-workflow.md` ("Roster import identity review decision repository
  (Phase 5 slice 4)"), `docs/data-model.md` ("Roster Import Identity Review Decision
  Repository"), and `docs/derived-logic.md` ("Import identity review decision
  repository (Phase 5 slice 4)"). Remaining Phase 5 work wires this repository to
  actual local storage, applies decisions to imports, and adds the review UI.
- **Slice 5 (done): import identity decision application (engine only).**
  `applyRosterImportIdentityReviewDecisionsToMatches(entries, decisions)` resolves
  slice 2 match entries against active slice 3 decisions in memory and computes the
  effective import outcome per row (`src/engine/rosterImportIdentityReviewDecisionApplication.ts`),
  mirroring the Phase 4 slice 8 application step. Outcomes: `unresolved`,
  `link-to-existing`, `create-new`, `rejected`, `deferred`,
  `skipped-invalid-preview-row`, `skipped-review-preview-row`, `conflict`. Decisions
  match on `previewSourceRowId` + `previewRowIndex`; no decision -> `unresolved` (no
  auto-link, even for a high-confidence single candidate); accept-candidate /
  manual-link -> link-to-existing, create-new -> create-new, reject-candidates ->
  rejected (row preserved), defer -> deferred. Skipped rows always resolve to their
  skip outcome; 2+ current decisions -> conflict (none applied). Invalid, superseded,
  key-less, unmatched, status-mismatched, and selected-candidate-not-found decisions
  are ignored with explicit reasons in decision input order;
  `summarizeAppliedRosterImportIdentityReviewDecisions` tallies the result. It is
  effective-state only — no roster write, no creation/linking, no row deletion, no
  persistence, no UI — and never mutates entries or decisions. It reuses (does not
  replace) the slice 2/3/4 contracts. See `docs/import-workflow.md` ("Applying
  import identity review decisions (Phase 5 slice 5)"), `docs/data-model.md`
  ("Applied Roster Import Identity Review Decision"), and `docs/derived-logic.md`
  ("Applying import identity review decisions (Phase 5 slice 5)"). Remaining Phase 5
  work applies outcomes to the roster (import commit) and adds the review UI.
- **Slice 6 (done): import commit preview / dry-run plan (engine only).**
  `createRosterImportCommitPreviewPlan(input)` folds slice 5 applied entries into a
  deterministic dry-run commit plan (`src/engine/rosterImportCommitPreviewPlan.ts`):
  per row, a `planStatus` and `plannedOperation`, plus `targetExistingRecordId`,
  `reasons`, and `blockers`. link-to-existing (with target) -> ready-to-link;
  link-to-existing (no target) -> blocked (`missing-target-existing-record-id`);
  create-new -> ready-to-create; rejected -> rejected; deferred -> deferred;
  unresolved -> blocked-unresolved (no auto-link); conflict -> blocked-conflict;
  skipped-* -> their blocked status. `canCommit` requires at least one row, no
  `blocked-*` rows, and a complete (or absent) target context; rejected and deferred
  do not block; empty -> false; incomplete provided target context -> result-level
  `invalid-target-context` blocker, `canCommit` false. Helpers
  `summarizeRosterImportCommitPreviewPlanRows`,
  `getRosterImportCommitPreviewPlanRowsReadyForCommit`, and
  `getRosterImportCommitPreviewPlanRowsBlockingCommit` round out the contract. It is
  planning only — no roster write, no creation/linking, no row deletion, no
  persistence, no UI — and never mutates applied entries or nested
  entries/candidates. It reuses (does not replace) the slice 5 contract. See
  `docs/import-workflow.md` ("Import commit preview / dry-run plan (Phase 5 slice
  6)"), `docs/data-model.md` ("Roster Import Commit Preview Plan"), and
  `docs/derived-logic.md` ("Import commit preview / dry-run plan (Phase 5 slice 6)").
  Remaining Phase 5 work performs the commit (applies the plan to the roster) and
  adds the review UI.
- **Slice 7 (done): Phase 5 checkpoint and import pipeline integration summary
  (docs only).** A documentation / spec-alignment slice that adds no product logic.
  It documents the full Phase 5 import pipeline end-to-end (import preview rows ->
  identity match candidates -> review action/decision contract -> decision
  repository -> effective decision application -> dry-run commit preview plan) and
  confirms the standing contracts: the distinct data layers (loaded authoritative
  roster data, preview rows, match entries, review actions, append-only review
  decisions, decision repository state, applied/effective outcome entries, dry-run
  commit plan rows); the hard roster authority rule (loaded records authoritative;
  duplicate/ambiguous names affect metadata/review state only; invalid / duplicate /
  skipped / rejected / deferred import rows preserved as rows); Phase 5 purity (no
  file parsing, no file upload, no browser persistence, no `localStorage` /
  `IndexedDB`, no React wiring, no UI, no sample-data mutation, no roster mutation,
  no import apply/commit); append-only decision semantics (superseded decisions stay
  in history; active view excludes them; decisions influence derived effective
  outcomes only); dry-run plan semantics (`ready-to-link` / `ready-to-create` are
  future operations only; rejected/deferred preserved and non-blocking; `blocked-*`
  prevents commit; no decision means unresolved; high-confidence single candidates
  never auto-link; top-level `canCommit` authoritative); and the terminology
  ("commit preview plan" = dry-run only; ready-to-create/ready-to-link/rejected/
  deferred/blocked meanings). It defines the boundary for the next optional slice: a
  pure in-memory import application / projection from a committable plan that still
  must not persist, mutate sample data, parse files, or wire UI unless explicitly
  approved. See `docs/derived-logic.md` ("Phase 5 checkpoint"), `docs/data-model.md`
  ("Phase 5 checkpoint: import pipeline layers"), `docs/import-workflow.md` ("Phase 5
  checkpoint: import pipeline (Phase 5 slice 7)"), `docs/ui-workflow.md` ("Import
  pipeline UI (Phase 5 checkpoint)"), and `docs/build-roadmap.md`.
- **Slice 8 (done): pure in-memory import application / projection (engine only).**
  `createRosterImportApplicationProjection(input)` consumes a **committable** slice 6
  dry-run commit preview plan plus existing roster records and computes, per plan row
  (in plan order), the roster link / addition a future apply *would* produce
  (`src/engine/rosterImportApplicationProjection.ts`). Outcomes: `projected-link`
  (ready-to-link resolving to exactly one existing record; the existing record is
  never modified), `projected-create` (ready-to-create, with a provisional,
  deterministic `projectedNewRecord` — id derived from target context +
  `previewSourceRowId` + `previewRowIndex` — that is never persisted),
  `projected-reject` / `projected-defer` (preserved; `skipped` when
  `allowRejectedRows` / `allowDeferredRows` is false), and `blocked`
  (non-committable plan, missing/duplicate existing record, missing target context /
  player name / preview row key, or a defensive `blocked-*` plan row). Projection
  proceeds only when `plan.canCommit` is true; a non-committable plan returns
  `ok: false` with a result-level `plan-not-committable` blocker and no rows; `ok` is
  true only when the plan is committable and no row or result blocker exists. Helpers
  `summarizeRosterImportApplicationProjection`,
  `getRosterImportApplicationProjectionLinkedRows`,
  `getRosterImportApplicationProjectionNewRows`, and
  `getRosterImportApplicationProjectionSkippedRows` round out the contract. It is
  projection only — no import apply/commit, no roster write, no record
  creation/linking, no row deletion, no persistence, no browser storage, no file
  parsing, no UI — and never mutates the plan, its rows, the original applied entries,
  or the existing records. It reuses (does not replace) the slice 6 commit preview
  plan contract. See `docs/import-workflow.md` ("Import application / projection
  (Phase 5 slice 8)"), `docs/data-model.md` ("Roster Import Application Projection"),
  `docs/derived-logic.md` ("Import application / projection (Phase 5 slice 8)"), and
  `docs/build-roadmap.md`. Remaining Phase 5 work performs the actual import apply /
  commit (and requires explicit approval), with real persistence, file parsing, and
  the review UI as separate later slices.
- **Slice 9 (done): CSV / text roster parsing into the import preview contract
  (engine only).** `parseRosterImportText(input)` converts pasted roster text into
  slice 1 `RosterImportPreviewRowInput` rows, and
  `createRosterImportPreviewFromText(input)` hands them to the existing
  `createRosterImportPreview` (`src/engine/rosterImportTextParser.ts`). It supports
  comma / tab / pipe delimited rows, newline-separated plain names, an optional
  header (`hasHeader: true | false | 'auto'`), auto delimiter detection (presence
  precedence tab > pipe > comma), basic trimming, and blank-line handling; full RFC
  CSV quoting, escaped delimiters, Excel files, browser upload, and broad fuzzy
  inference are reported, never guessed. Header aliases are narrow (name / player /
  player name / athlete; jersey / jersey # / number / no / #; grade; note / notes)
  with optional `options.columns` overrides; without a header, columns map
  positionally by the row's own cell count (1 = name; 2 = jersey+name unless the
  first looks like a name and the second a jersey; 3 = jersey+name+grade; 4+ adds
  notes). Every non-empty source line is preserved as a parse row in source order
  (missing names flagged and surfaced as `invalid` by the preview); blank lines are
  skipped but counted; `sourceRowId` is deterministic (`line-<n>`) with no random ids
  or `Date.now()`. Target context is validated independently (`invalid-target-context`)
  before preview creation and passed through exactly; parser and preview issues stay
  distinguishable via `{ parse, preview }`, and slice 1 validation is reused, not
  duplicated. `summarizeRosterImportTextParseRows` rounds out the contract. It is
  parser-to-preview only — no file upload, no browser File API, no UI, no persistence,
  no roster mutation, no import apply/commit — and never mutates the input. It reuses
  (does not replace) the slice 1 preview contract. See `docs/import-workflow.md`
  ("CSV / text roster parsing (Phase 5 slice 9)"), `docs/data-model.md` ("Roster
  Import Text Parse"), `docs/derived-logic.md` ("CSV / text roster parsing (Phase 5
  slice 9)"), and `docs/build-roadmap.md`. File upload, persistence, UI, and import
  apply / commit remain later work and require explicit approval.
- **Slice 10 (done): Ute Conference scraped JSON source adapter (engine only).**
  `src/engine/uteConferenceScrapedJsonAdapter.ts` reads harvested Ute Conference
  website-scrape JSON and exposes importable team targets and source rows.
  `detectUteConferenceScrapedJsonRecordType` returns `players` / `coaches` /
  `unknown`; `summarizeUteConferenceScrapedJson` reports metadata + district / team /
  row counts and issues; `listUteConferenceScrapedJsonTeamTargets` lists targets in
  source order with a deterministic `sourceTargetId`;
  `createPlayerRosterImportPreviewInputFromScrapedJson(payload, target)` builds a
  slice 1 `RosterImportPreviewInput` (composed through `createRosterImportPreview`)
  for a selected player team; and
  `createCoachImportPreviewInputFromScrapedJson(payload, target)` builds a separate
  coach preview shape. Player names, coach names, coach titles, and source URLs are
  preserved exactly (commas, extra spaces, non-breaking spaces intact); coaches are
  never de-duplicated; player and coach rows stay separate. Source ids are
  deterministic (no random ids, no `Date.now()`); target context is caller-supplied
  or derived as provisional slug ids (`targetContextProvisional`). Empty league
  snapshots are valid (`empty-league`, `ok: true`); missing names/titles preserve the
  row with a `missing-*` issue; count mismatches are non-destructive `count-mismatch`
  warnings; `target-not-found` / `invalid-target` are reported for bad selectors. It
  is a source adapter only — no UI, no persistence, no browser storage, no file
  upload, no roster mutation, no import apply/commit, no coach analytics, no movement
  derivation — and never mutates the payload. It reuses (does not replace) the slice 1
  preview contract or the slice 9 parser. See `docs/import-workflow.md` ("Ute
  Conference scraped JSON source adapter (Phase 5 slice 10)"), `docs/data-model.md`
  ("Ute Conference Scraped JSON Source"), `docs/derived-logic.md` ("Ute Conference
  scraped JSON source adapter (Phase 5 slice 10)"), and `docs/build-roadmap.md`. UI,
  persistence, file upload, import apply/commit, and coach analytics remain later work
  and require explicit approval.
- **Slice 11 (done): canonical source mapping for scraped Ute JSON (engine only).**
  `src/engine/uteConferenceScrapedCanonicalMapping.ts` maps scraped source labels into
  canonical import context. `mapUteScrapedAgeDivisionLabel` -> canonical `SC` / `GR` /
  `PW` / `MM` / `GI` / `BA` (metadata label > alias > team-name prefix fallback, with
  conflict / unsupported / missing issues); `mapUteScrapedTeamClassification` extracts
  only explicit coded team-name tokens (validated via `parseTeamClassification`) and
  leaves color names unknown (no invented mapping); `mapUteScrapedDistrict` preserves
  the raw name and yields a registry id (`high`) or a provisional slug, never
  collapsing distinct names; `mapUteScrapedSeason` maps `metadata.year` + `event`,
  never from a filename. `mapUteScrapedTeamTargetToCanonicalContext` (and the coach
  wrapper `mapCoachScrapedTeamTargetToCanonicalContext`) compose these into a
  `canonicalContext` (`seasonId` / `districtId` / `ageDivisionId` / `teamId` /
  `teamClassification`) with a weakest-of `contextConfidence`, applying caller
  overrides (recorded as `caller-override`, raw source preserved).
  `createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext` feeds the
  derived context into the slice 10 player adapter and returns the canonical mapping +
  preview input + preview result, with player names preserved exactly. It is a mapping
  adapter only — no UI, persistence, browser storage, file upload, roster mutation,
  import apply/commit, movement derivation, coach analytics, or fuzzy matching — and
  never mutates the payload. It reuses the existing age-division / team-classification
  helpers, the slice 10 adapter, and the slice 1 preview. See `docs/import-workflow.md`
  ("Canonical source mapping for scraped JSON (Phase 5 slice 11)"), `docs/data-model.md`
  ("Ute Scraped Canonical Context Mapping"), `docs/derived-logic.md` ("Canonical source
  mapping for scraped JSON (Phase 5 slice 11)"), and `docs/build-roadmap.md`. A
  canonical district registry, UI, persistence, file upload, import apply/commit, and
  coach analytics remain later work and require explicit approval.
- **Slice 12 (done): scraped JSON full-file readiness report (engine only).**
  `createUteConferenceScrapedJsonReadinessReport(payload, options?)`
  (`src/engine/uteConferenceScrapedJsonReadinessReport.ts`) classifies every team
  target in one scraped Ute Conference payload as `ready`, `ready-with-warnings`,
  `needs-review`, `blocked`, or `empty`, composing the slice 10 source adapter and
  slice 11 canonical mapping (replacing neither). Players use the slice 11 canonical
  preview helper (comma names preserved; missing player name -> blocked); coaches use
  the slice 10 coach helper, never de-duplicated (missing title/name -> needs-review).
  Unsupported `record_type` / invalid payload -> `ok: false` with the source issue and
  no targets; empty league/team snapshots stay `ok: true`; count mismatches are
  warnings unless `strictCounts` elevates them (rows preserved); year never inferred
  from a filename. Options: `targetContextOverridesBySourceTargetId`,
  `districtRegistry`, `includeEmptyTeams` (default true), `includePreviewResults`
  (default true), `strictCounts` (default false). The summary tallies statuses,
  total/player/coach rows, and issues by severity/code, plus
  `canProceedToTeamSelection` and `canProceedWithoutReview`; helpers
  `summarizeUteConferenceScrapedJsonReadinessReport`,
  `getUteScrapedJsonImportReadyTargets`, `getUteScrapedJsonTargetsNeedingReview`,
  `getUteScrapedJsonBlockedTargets`, and `getUteScrapedJsonEmptyTargets` round out the
  contract. It is a reporting helper only — no UI, persistence, browser storage, file
  upload, roster mutation, import apply/commit, movement derivation, coach analytics,
  or fuzzy matching — and never mutates the payload. See `docs/import-workflow.md`
  ("Scraped JSON full-file readiness report (Phase 5 slice 12)"), `docs/data-model.md`
  ("Ute Scraped JSON Readiness Report"), `docs/derived-logic.md` ("Scraped JSON
  full-file readiness report (Phase 5 slice 12)"), `docs/build-roadmap.md`, and
  `docs/ui-workflow.md`. A review/import UI may later consume this report; that and the
  other later-work items remain gated on explicit approval.
- **Slice 13 (done): scraped JSON fixture contracts (engine-only, test hardening).**
  A fixture/contract slice that adds **no production logic**. Small hand-curated
  fixtures under `src/test/fixtures/ute-scraped-json/` (players, coaches, empty-league
  snapshots, a comma name `Cary, Hudson`, an extra-space name `Moyer , Knox`, a
  non-breaking-space coach name, `Head Coach` / `Asst Coach` titles, a coded
  classification `Gremlin A2`, and a color team `Scout White`) are exercised through
  the existing slice 10/11/12 public helpers by
  `src/test/uteConferenceScrapedJsonFixtureContracts.test.ts`. The tests prove raw
  names/titles/source URLs/order are preserved, coded classifications map while color
  teams stay unresolved, empty snapshots are valid, payloads are never mutated, output
  is deterministic, and the engine modules expose no apply/commit/write/persist API.
  Fixtures are test contracts only — not bundled into the app, no app-visible sample
  data — with no UI, persistence, file upload, import apply, roster mutation, movement
  derivation, or coach analytics. See `docs/import-workflow.md`, `docs/data-model.md`,
  `docs/derived-logic.md` (all "Scraped JSON fixture contracts (Phase 5 slice 13)"),
  and `docs/build-roadmap.md`.

- **Slice 14 (done): scraped JSON import session state (engine only).** A pure,
  deterministic in-memory session-state model for one scraped Ute Conference JSON
  source file (`src/engine/uteConferenceScrapedJsonImportSession.ts`,
  `src/test/uteConferenceScrapedJsonImportSession.test.ts`) that **composes** the slice
  10 adapter, slice 11 canonical mapping, and slice 12 readiness report without
  duplicating their logic. Loading a payload builds the readiness report plus a
  deterministic non-cryptographic source fingerprint and selects no target by default;
  unsupported/invalid sources become `invalid-source` sessions. Selecting a target
  re-runs the existing preview helpers and stores the selected target, canonical
  mapping, and preview output, mapping readiness status to a session status
  (`ready-for-preview` / `ready-for-review` / `target-blocked` / `target-selected`).
  Blocked, empty, and needs-review targets are tracked distinctly; missing targets,
  unloaded sources, and `expectedSourceFingerprint` mismatches fail deterministically;
  per-selection overrides can alter the canonical context; re-selection is idempotent;
  clearing preserves the loaded source/report. The summary exposes deterministic UI
  flags (`canSelectTarget`, `canProceedToPreview`, `canProceedWithoutReview`, and
  selection counts). Names, titles, source rows, source URLs, and source order are
  preserved exactly; helpers never mutate inputs (the payload is held by reference
  only, in memory only); and there is no persistence, browser storage, file upload,
  import apply/commit, roster mutation, movement derivation, coach analytics, or UI.
  See `docs/import-workflow.md`, `docs/data-model.md`, `docs/derived-logic.md`,
  `docs/ui-workflow.md`, and `docs/build-roadmap.md` (all "Scraped JSON import session
  state (Phase 5 slice 14)").

### Phase 5 checkpoint

Phase 5 (import preview and identity collision handling) slices 1–6 are **complete /
checkpointed**, slice 7 documents and confirms the contracts, slice 8 adds a pure
in-memory import application / projection from a committable plan, slice 9 adds a pure
text / CSV-like parser into the slice 1 preview contract, slice 10 adds a source
adapter for harvested Ute Conference scraped JSON (players and coaches), slice 11
adds canonical source-label mapping over that adapter, slice 12 adds a full-file
readiness report that classifies every team target, slice 13 hardens slices 10–12
with representative scraped JSON fixture contracts (test-only), and slice 14 adds a
pure in-memory import session-state model that composes the readiness report, target
selection, canonical mapping, and preview outputs. The acceptance criteria above
are met by the engine pipeline: low-confidence collisions are never silently committed
(unresolved identities and high-confidence single candidates block — never
auto-link), user decisions are captured as append-only records, and the dry-run commit
plan gates commit availability behind collision review (`canCommit`); slice 8 projects
what a committable plan would link / add without applying it, slice 9 stages pasted
text into preserved preview rows, slice 10 adapts harvested Ute Conference JSON into
those same preview inputs, slice 11 derives canonical (or provisional) season /
age-division / district / classification context for a selected team, and slice 12
reports, for a whole scraped file, what is import-ready / empty / blocked / provisional
/ needs-review. Phase 5 so far is engine-only with no file upload, no browser File API,
no persistence, no UI, and no import apply/commit. The next narrow work is **optional
and requires explicit approval**: the actual import apply / commit that performs a
projection's planned links / additions, plus a canonical district registry, real
browser persistence, file upload / Excel parsing, coach analytics, and the review UI —
each a separate later slice.

## Phase 6: Schedule and results

### Goal

Derive team performance from game objects.

### Build

- Load schedule data.
- Display schedule for selected team.
- Add result update pathway for active seasons.
- Calculate team record from games.
- Support playoff and championship flags.

### Acceptance criteria

```text
Team record derives from games.
Playoff wins and losses derive from playoff-flagged games.
Championship appearance and win derive from championship-flagged games.
```

## Phase 7: Coach analytics

### Goal

Calculate coach lifetime and continuous-cohort records.

### Build

- Derive coach record from team assignments and game records.
- Calculate lifetime record.
- Calculate continuous-cohort record.
- Apply Scout-to-Scout exception.
- Show coach history in side panel.

### Acceptance criteria

```text
Lifetime record accumulates across all coach assignments.
Continuous-cohort record continues through expected age progression.
Continuous-cohort record resets on district change, skipped season, or broken progression.
Scout-to-Scout exception works.
```

## Phase 8: My Team panel

### Goal

Support a season-specific favorite team workflow.

### Build

- Allow one My Team per season.
- Add collapsible left-side My Team panel.
- Show My Team schedule.
- Link opponents to team profiles.

### Acceptance criteria

```text
My Team designation is season-specific.
Panel shows the selected My Team schedule.
Opponent links navigate to opponent team profiles.
```

## Phase 9: Multi-year analytics and visual polish

### Goal

Add higher-level analytics and refine the interface.

### Build

- District-level summaries.
- Coach leaderboards.
- Retention, transfer, promotion, and relegation rates.
- District branding integration.
- Age division visual language.
- Team-level visual language.

### Acceptance criteria

```text
Filtered views show multi-year trends.
Branding improves clarity without overwhelming roster-status badges.
System colors remain centralized.
```

## Coding agent guardrails

The coding agent should:

- keep changes limited to the requested phase
- avoid speculative architecture
- avoid adding dependencies without justification
- keep derived logic out of UI components
- add tests for deterministic logic
- update docs when behavior changes
- preserve sample data contracts unless explicitly asked to change them

The coding agent should not:

- introduce a backend in early phases
- add authentication
- hard-code district data inside components
- silently broaden scope
- build import commit behavior before import preview behavior
- treat y-up/z-down as birthdate-required logic

## First coding prompt target

The first coding prompt should target **Phase 1: Static local viewer** only.

It should ask for:

- Vite + React + TypeScript scaffold
- centralized design tokens
- local sample data loading
- basic filters
- team summary
- coach cards
- player cards

It should explicitly forbid:

- import workflows
- editing
- persistence
- backend
- authentication
- advanced derived logic
