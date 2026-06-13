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
