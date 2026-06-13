# Import Workflow

This document defines the initial import behavior for rosters, schedules, results, and district branding.

## Import principles

- Roster imports are separate from schedule and result imports.
- Prior seasons should be locked after import.
- Active seasons may receive schedule and result updates.
- Beginning in 2026, the app should support ongoing weekly maintenance.
- Identity collisions must be surfaced before import decisions are committed.
- Source import files may be flatter and less complete than the internal data model. Import adapters should preserve raw source values while producing normalized candidates for review.
- Imports never write cohort review decisions. A `Cohort Review Decision` (see `docs/data-model.md`) is a separate, append-only record produced only from an accepted manual review action, not from importing rosters, schedules, results, or branding.

### Phase 4 / Phase 5 boundary

Phase 4 (cohort reclassification preservation) is checkpointed and is engine-only
— it builds no import behavior (see `docs/derived-logic.md`, "Phase 4
checkpoint"). The import preview and identity collision handling described in this
document are **Phase 5 work** and are not yet implemented.

When Phase 5 is built, it must:

- preserve loaded roster authority — duplicate and ambiguous roster entries are
  surfaced for review, never discarded, suppressed, merged, or silently resolved;
- keep cohort review decisions out of roster import payloads (the import boundary
  above is unchanged);
- surface low-confidence identity collisions before any commit, per the stages
  below.

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

### Real-world flat roster source shape

A known real-world roster source may arrive as a flat JSON array with one player per row.

Example row shape:

```json
{
  "district": "Alta",
  "age_group": "GI League 12",
  "team": "GridIron A3",
  "player_name": "Cary, Hudson"
}
```

Observed source fields:

```text
district
age_group
team
player_name
```

Known implications:

- `season` may be absent from row data and may need to be inferred from filename or import metadata.
- `age_group` may use source labels such as `GI League 12` and must map to canonical age division IDs such as `GI`.
- `team` may embed team classification, such as `GridIron A3`, `GridIron C1`, or `GridIron D2`.
- Coach data may be absent from roster player rows.
- Player identity is name-only at source and must flow through identity confidence and collision review.
- Raw player names should be preserved because source names may include suffixes, nicknames, inconsistent spacing, punctuation, and trailing source flags.
- Trailing source flags, such as a final `O` in `player_name`, should not be discarded until their meaning is confirmed.

This source shape is an import input contract, not the preferred internal storage shape.

## Roster import preview (Phase 5 slice 1)

Phase 5 begins with a pure, deterministic **import preview state/contract**
(`src/engine/rosterImportPreview.ts`, `createRosterImportPreview`). The preview is
a **non-destructive staging layer** that sits ahead of the stages below. It is not
real parsing, not identity collision resolution, not commit/apply, not persistence,
and not UI.

What this slice does:

- Represents each candidate roster row as a preview row with a deterministic
  `rowIndex`, the original `playerName`, a `normalizedIdentityKey` (derived from
  the existing Phase 2 `getPlayerIdentityKey` helper), preserved passthrough
  `fields` (jersey number, grade, notes, raw), per-row `issues`, and a `status`.
- Preserves **every** input row in input order, even when it is invalid,
  duplicate, ambiguous, or low confidence. Rows are never dropped, merged,
  reordered, or rewritten — ambiguity affects preview metadata only.
- Validates the target context (`seasonId`, `districtId`, `ageDivisionId`,
  `teamId`) for presence and reports `invalid-target-context` as a preview-level
  error without mutating or dropping rows.
- Summarizes the preview (total / ready / needs-review / invalid rows, duplicate
  name groups, duplicate source-row-id groups, and error/warning/info counts).

Chosen row contract (documented and tested):

| Condition | Status | Issue (severity) |
| --- | --- | --- |
| Missing player name | `invalid` | `missing-player-name` (error) |
| Missing source row id (no stable identity) | `invalid` | `missing-source-row-id` (error) |
| Duplicate source row id | `needs-review` | `duplicate-source-row-id` (warning) |
| Duplicate normalized name within the import | `needs-review` | `duplicate-name-in-import` (warning) |

`ok` is true only when the target context is valid, there are no error issues, and
there are no invalid rows. Warnings / review items never remove rows. This slice
**does not** compare against existing roster data, classify new / returning /
transferred players, resolve identity collisions, or apply the import — those are
later Phase 5 / Phase 6 stages below.

## Roster import stages

### 1. Parse source data

Read source rows into normalized import candidates.

For flat roster sources, parsing should preserve:

- raw district label
- raw age group label
- raw team label
- raw player name
- source filename or import metadata used to infer season

Parsing may derive candidate values, but those derived values should remain reviewable before commit:

- candidate season
- canonical district ID
- canonical age division ID
- team label
- team code or classification
- normalized player name
- source flags

### 2. Validate required fields

Required fields are likely:

- season
- district
- age division
- team identifier
- player name for player rows
- coach name and role for coach rows

For flat roster player sources, season may be supplied through import metadata rather than row data, and coach fields may be absent.

### 3. Resolve teams

Create or match team records for the season/district/age division/team code.

If the source team label embeds a classification, such as `GridIron A3`, the import adapter should preserve the raw team label while extracting a candidate team code/classification for review.

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
