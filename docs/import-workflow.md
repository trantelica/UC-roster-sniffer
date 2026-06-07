# Import Workflow

This document defines the initial import behavior for rosters, schedules, results, and district branding.

## Import principles

- Roster imports are separate from schedule and result imports.
- Prior seasons should be locked after import.
- Active seasons may receive schedule and result updates.
- Beginning in 2026, the app should support ongoing weekly maintenance.
- Identity collisions must be surfaced before import decisions are committed.

## Import types

```text
roster
schedule
result
branding
```

## Roster import

Roster import should load:

- season
- district
- age division
- team code or team draft/formation information
- head coach
- assistant coaches
- player names

Roster import should not be responsible for:

- game schedules
- scores
- playoff outcomes
- championship outcomes

## Roster import stages

### 1. Parse source data

Read source rows into normalized import candidates.

### 2. Validate required fields

Required fields are likely:

- season
- district
- age division
- team identifier
- player name for player rows
- coach name and role for coach rows

### 3. Resolve teams

Create or match team records for the season/district/age division/team code.

### 4. Resolve people

For each player or coach name:

- search existing canonical people
- propose a match
- assign confidence
- identify collision reason codes

### 5. Surface collisions

Low-confidence matches should be shown to the user before final commit.

User decisions:

```text
accept proposed match
reject proposed match
manual link
create new person
```

### 6. Commit import

Once collisions are resolved, persist:

- teams
- player assignments
- coach assignments
- import batch metadata
- identity match decisions

## Low-confidence player rules

Flag low confidence when:

1. The player was not in the same district in the preceding season, and the same named match exists in another district.
2. There are two or more matching names in the same district.

## Schedule import

A team may have games loaded before results are known.

Schedule import should load:

- season
- team
- opponent team
- week or date
- home/away
- playoff flag, if known
- championship flag, if known

Open item: determine whether schedule rows are imported once per team or once per game. If once per team, reciprocal opponent game records may need synchronization.

## Result import

Result imports or updates should load:

- team score
- opponent score
- result
- playoff flag, if applicable
- championship flag, if applicable

Records should derive from game objects rather than manual win/loss entry.

## District branding import

District branding import should support:

- district name
- mascot
- logo artwork path
- helmet artwork path
- primary color
- secondary color

Branding configuration helpers should make it easier to load or update district assets and colors.

## Historical locking

Prior seasons should be locked.

Locked seasons should not allow casual edits to:

- roster assignments
- team composition
- coach assignments
- historical team structure

Open item: define whether an administrator correction workflow is needed for rare historical mistakes.

## Active season maintenance

For active seasons, users should be able to update:

- future scheduled games
- game scores
- playoff flags
- championship flags

The current understanding is that player and team detail editing is not a priority, but schedule and result maintenance is.
