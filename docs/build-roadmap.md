# Build Roadmap

This roadmap is intended to keep early development narrow and coherent.

## Build posture

Proceed spec-first.

Avoid beginning with visual polish or broad feature sprawl. The first working version should prove the data model and derived classification logic.

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

## Phase 1: Local data contract and static viewer

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

## Phase 2: Prior-season roster comparison

Goal: classify roster movement from one season to the next.

Recommended features:

- compare current roster to prior season
- classify returning/new/transfer
- display status on player cards
- show team composition summary

Acceptance criteria:

- selected team displays counts by derived status
- player cards show derived status
- transfer is detected when prior district differs

## Phase 3: Team hierarchy and promotion/relegation

Goal: add team-level movement intelligence.

Recommended features:

- implement team classification rules
- implement competitive hierarchy
- classify promoted/relegated/lateral movement
- handle changed team counts between seasons

Acceptance criteria:

- B2 -> B1 is promoted
- B1 -> B2 is relegated
- C2 -> D2 is lateral under current hierarchy
- B3/B4/B5 are treated as B3+

## Phase 4: Identity confidence and import collision flow

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

## Phase 5: Schedule and result loading

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

## Phase 6: Coach analytics

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

## Phase 7: Multi-year analytics

Goal: add higher-level conference and district intelligence.

Recommended features:

- district win/loss summaries
- championship history
- coach leaderboards
- roster retention rates
- transfer rates
- promotion/relegation rates

Acceptance criteria:

- filtered summary views display multi-year trends
- analytics derive from canonical assignments and game records

## Phase 8: Branding and visual language

Goal: improve interpretability and product feel.

Recommended features:

- district logos
- district helmets
- primary/secondary colors
- mascot display
- age division visual language
- team-level visual language

Acceptance criteria:

- selecting a district applies recognizable branding cues
- player status remains visually clear and not overwhelmed by branding

## Phase 9: My Team panel

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

## Early technical recommendation

Start with a local-first web app using file-backed JSON samples, then decide whether persistence should remain JSON-only or evolve toward browser storage plus export/import.

Do not select a production architecture until the import contracts and derived logic are validated against realistic sample data.
