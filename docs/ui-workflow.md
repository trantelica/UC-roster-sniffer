# UI Workflow

This document defines the initial user experience model.

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

## Import collision UI

During roster import, low-confidence identity matches should be surfaced before final commit.

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
