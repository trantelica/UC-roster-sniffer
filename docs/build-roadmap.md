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

As of the Phase 2 checkpoint:

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

Phase 3 (Prior-season roster comparison) is **in progress**. The exact-identity
foundation now includes a current-vs-prior comparison contract (slice 1), a
display-count summary (slice 2), a read-only summary panel (slice 3), and an
engine-only exact-identity transfer/team-slot movement detector
(`detectExactPriorSeasonPlayerMovement`, slice 4) that classifies same-team
returning, transferred-in, transferred-out, new-to-conference, not-returning, and
unknown across team slots. A spec-only movement-taxonomy alignment pass (slice 5)
then fixed shared vocabulary in `docs/derived-logic.md`: it distinguishes the
**same-slot roster comparison** (slices 1–2, which cannot detect transfers by
design) from **exact identity team-slot movement** (slice 4), and frames the
latter's transferred-in/out buckets as an **input signal**, not a final
`transfer` / promotion / relegation / lateral verdict. An engine-only
district-aware classification layer (`classifyDistrictAwarePlayerMovement`, slice
6) then interprets that signal into product-level statuses: `same-team-returning`,
`promoted` / `relegated` / `lateral` (same district + same age division, via the
competitive hierarchy `A(x) > B1 > C1 = B2 > B3+ = C2 = D2`, where any valid
A-code is the top tier), `transfer` (district change), the conservative
`age-division-change` (same district + different age division), `new-to-conference`,
`not-returning`, and `unknown`. Not yet built (deferred to Phase 4 and beyond):
y-up / z-down cohort reclassification, fuzzy matching, and import-collision
resolution. Roster comparison is exact-identity only and is the foundation the
richer taxonomy extends — it is not replaced.

Boundary rule carried forward: loaded roster records are authoritative; derived
metadata never alters, removes, suppresses, merges, nullifies, rewrites, reorders,
or ignores source roster records. Ambiguity affects derived metadata only.

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
