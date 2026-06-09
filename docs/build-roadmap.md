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

Phase 3 (Prior-season roster comparison) is **not** complete. Not yet built
(deferred to Phase 3 and later phases): transfer (district change), promotion /
relegation / lateral movement, y-up / z-down cohort reclassification, fuzzy
matching, and import-collision resolution. Roster comparison is exact-identity
only and is the foundation the next phase extends — it is not replaced.

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
