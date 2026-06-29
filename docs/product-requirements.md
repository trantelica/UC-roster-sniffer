# Product Requirements

## Purpose

UC Roster Sniffer is a locally hosted roster intelligence application for tracking youth football players, coaches, teams, districts, age divisions, schedules, results, and season-over-season movement.

The primary workflow is:

```text
Season -> District -> Age Division -> Team -> Roster Analysis
```

The core product question is:

> How did this roster change compared to the prior season?

## Primary outcomes

The application should help users understand:

- roster continuity and turnover
- player movement between teams, districts, and age divisions
- promotion and relegation across team levels
- y-up and z-down movement relative to age cohort
- coach lifetime performance
- coach continuous-cohort performance
- team schedules, results, playoff outcomes, and championship outcomes
- multi-year district, team, player, and coach trends

## Expected scale

Initial expected scale:

- approximately 6 seasons
- approximately 30 standardized districts
- approximately 300-450 teams
- thousands of player-season records

This scale supports a local-first architecture using JSON or similar portable file-backed storage.

## Core entities

- Season
- District
- Age Division
- Team
- Player
- Coach
- Game
- Roster Import
- Schedule/Result Import
- Identity Match / Collision Decision

## Season behavior

Everything is season-specific where applicable.

Prior seasons should be locked after import.

Beginning with the 2026 season, the system should support ongoing maintenance through:

- seasonal roster imports
- weekly schedule imports or updates
- weekly game result updates

## District behavior

Districts are standardized and should support:

- name
- mascot
- logo artwork
- helmet artwork
- primary brand color
- secondary brand color

District branding should be configurable through helper workflows or config files.

Districts are **infrastructure**, not roster content: the known historical Ute Conference
districts may be **seeded** and ship in a fresh workspace (see "Workspace data lifecycle &
roster import"). A district without confirmed branding is still valid (provisional blank
branding). Districts are never destructively deleted — inactivation is the only retirement
path.

## Age division behavior

Age divisions are fixed and do not split, merge, or consolidate.

The fixed hierarchy is:

| Code | Name | Ages |
| --- | --- | --- |
| SC | Scout | 7-8 |
| GR | Gremlin | 9 |
| PW | Peewee | 10 |
| MM | Mity Mite | 11 |
| GI | Gridiron | 12 |
| BA | Bantam | 13-14 |

## Team behavior

A team belongs to a season, district, and age division.

Team counts within a district-age-division may expand or contract from season to season.

Teams have:

- one head coach
- up to five assistant coaches
- players
- schedule/results
- playoff/championship flags through game records

## Workspace data lifecycle & roster import

This is the final corrected product model for how data enters the workspace.

**Fresh workspace.** A fresh (no persisted data) workspace contains:

- the **39 known historical Ute Conference districts** (seeded; Alta/Brighton with confirmed
  branding, the rest provisional)
- the **fixed age divisions** (SC, GR, PW, MM, GI, BA)
- **zero** teams, players, coaches, and games/schedules/results

Default startup is this empty workspace — **not** demo/sample data. Bundled **sample data is
demo-only** (an explicit "Load sample data" action, and tests). District-registry seeding is
allowed precisely because districts are infrastructure.

**Teams are season-specific content created by committed imports.** A team is never required
to exist before import, and is **never created on file load** — only on an **explicit commit**.
A player roster JSON is authoritative evidence that the listed teams exist for that season.

**Roster import** (see `docs/import-workflow.md`) accepts a **flat row-list** player JSON and a
**nested scraped** JSON, supports the **empty-workspace first import**, and plans one action
per team target:

- **create** — a registered district + resolved season/age/team code with no matching team →
  create the team and add its players (no row-level review needed for a brand-new team)
- **update** — a matching team already exists → update it through the existing review path
- **blocked** — with a clear reason (unregistered district → "Add district first"; unreadable
  team code; missing season/age; needs-review existing team; duplicate)

**Loaded rostered player names are authoritative and preserved exactly** (no trim, dedupe,
merge, suppress, or rewrite).

**Materialized teams.** A team is **materialized** when committed source data populated it —
players, an assigned coach, schedule/results, or an explicit committed source marker. The
normal **Team selector shows materialized teams only**, never theoretical/empty team shells.
Prior-season comparison operates after current-season teams/players are materialized, not
against empty shells.

**Acceptance reference (Corner Canyon, 2025 GI roster).** Importing the 2025 GI roster must
create/show Corner Canyon **GridIron A3 (17 players)**, **C1 (18 players)**, and **C2 (20
players)** — and must **not** show Corner Canyon A1/A2/A4 unless those teams exist in committed
data.

**Known limitations.**

- A district outside the seeded registry is **blocked** ("Add district first") or requires a
  provisional add; it is never silently invented on import.
- **Parenthetical / sub-label** team names (e.g. `GridIron A1 (Bonneville)`) must not collapse
  into a plain code; until disambiguation is supported they are **blocked** (future work).
- **Coach commit** is a separate path from roster import (not yet committed via this flow).
- **Schedule/results** import is separate from roster import.

**Optional seed.** An optional "Load Ute Conference seed" action can pre-create empty team
shells over the same district registry, but it is **non-primary and not required** for normal
roster import (which creates teams). A roster import simply updates any matching shell.

## Player behavior

Current player information is minimal:

- name
- free-text notes

A player may only belong to one team in a given season.

Players may change teams, districts, or age divisions only between seasons.

## Coach behavior

Coaches may move between teams, districts, and age divisions across seasons.

The system should calculate:

- lifetime win-loss record
- continuous-cohort win-loss record
- championship history

## Main roster status classifications

For a selected current-season roster, each player should receive a derived status:

- Returning
- New
- Transfer / Move-In
- Promoted
- Relegated
- Lateral
- Y-Up
- Z-Down

The canonical meaning of each term, and how it relates to the underlying exact-
identity comparison signals, is fixed in `docs/derived-logic.md` ("Player
movement taxonomy alignment"). Two additional comparison-context terms —
`Not Returning` and `New to Conference` — also live there; they describe
prior-vs-current comparison results and are not current player-card statuses.

## Team view requirements

When a team is selected, the view should show:

- team composition summary
- in-year performance summary
- head coach card
- assistant coach cards
- player cards

Cards should use a visual language to indicate current roster status relative to the prior year.

## Summary view requirements

Before a team is selected, filtered views should show derived summary statistics based on the selected season, district, and age division.

Potential summary metrics:

- team count
- count by team level
- player count
- returning player count
- new player count
- transfer count
- y-up count
- z-down count
- promoted count
- relegated count
- returning coach count
- continuous-cohort coach count

## My Team behavior

Users should be able to mark a team as `My Team`.

This designation is season-specific.

A dedicated collapsible left-side panel should show My Team schedule content. Opponent entries should navigate directly to the opponent team profile.

A possible future enhancement is a global favorite district plus season-specific My Team.

## Out of scope for now

The current scope does not require:

- rich player biographical management
- manual editing of historical player/team detail after prior seasons are locked
- enforcement against the same coach appearing on multiple teams
- creating separate opponent objects outside the team database
- complex playoff bracket modeling beyond playoff and championship game flags
