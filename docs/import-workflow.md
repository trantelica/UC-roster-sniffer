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

## Roster import preview identity matches (Phase 5 slice 2)

The second Phase 5 slice adds pure, deterministic **candidate identity matching**
(`src/engine/rosterImportPreviewIdentityMatch.ts`,
`createRosterImportPreviewIdentityMatches`). Given the slice 1 preview rows and a
set of existing roster identity records supplied in the input, it answers one
question per ready preview row: "which existing roster records might this imported
row correspond to?" The output is review metadata for later collision review and a
future apply workflow — it is **candidate generation only**.

What this slice does:

- Produces one match entry per preview row, in preview row order. Only `ready`
  rows are matched; `invalid` rows become `skipped-invalid-preview-row` entries and
  `needs-review` rows become `skipped-review-preview-row` entries (both preserved,
  never dropped).
- Matches on the exact normalized identity key (reusing the Phase 2
  `getPlayerIdentityKey` helper). One existing match -> `single-candidate`; more
  than one -> `multiple-candidates` (review); none -> `no-match`.
- Orders candidates by existing-record input order.
- A jersey number can **add** a `matching-jersey-number` reason and **raise**
  confidence within an exact-name candidate group, but never creates a match on its
  own.
- Duplicate existing names and duplicate preview names produce review metadata
  (`existing-duplicate-name` / `preview-duplicate-name`), never discarded candidates
  or entries.
- An existing record with a missing/blank name cannot produce an identity key; it
  is reported as a result-level `invalid-existing-record` issue (never throws) and
  excluded from matching only.

Helpers `summarizeRosterImportPreviewIdentityMatches`,
`getRosterImportPreviewIdentityMatchesNeedingReview`, and
`getRosterImportPreviewIdentityMatchesReadyForApply` round out the contract. A
ready-for-apply entry is an unambiguous single high-confidence candidate with no
review issues; no apply is performed. This slice does **not** resolve collisions,
apply imports, compare against prior seasons, derive movement status, persist, or
render UI. Candidate matches feed the collision review (stage 5) and commit
(stage 6) below, which remain later Phase 5 work.

## Roster import identity review decisions (Phase 5 slice 3)

The third Phase 5 slice adds a pure, deterministic **action + decision contract**
for the collision review (stage 5 below):
`src/engine/rosterImportIdentityReviewDecision.ts`. It defines what a reviewer may
DO with a slice 2 match entry and how that choice is captured as an append-only
DECISION record. It mirrors the Phase 4 sequencing (action -> decision; a
repository comes later). It is **decision capture only** — not collision
resolution, not import apply/commit, not a repository, not persistence, not file
parsing, not UI, and not roster mutation.

Review actions, by entry status:

| Entry status | Allowed actions |
| --- | --- |
| `no-match` | create-new, manual-link, defer |
| `single-candidate` | accept-candidate, reject-candidates, manual-link, create-new, defer |
| `multiple-candidates` | accept-candidate, reject-candidates, manual-link, create-new, defer |
| `skipped-invalid-preview-row` | defer only |
| `skipped-review-preview-row` | defer only |

`applyRosterImportIdentityReviewAction(entry, action)` validates one action against
one entry and returns an accepted/rejected result with a future-apply `effect`
(`link-to-existing`, `create-new-roster-entry`, `reject-import-row`,
`defer-review`, or `no-effect` when rejected). `accept-candidate` requires a
`selectedExistingRecordId` that exists among the entry's candidates; `manual-link`
requires a `manualExistingRecordId`; any action requires a stable
`previewSourceRowId`.

Meaning of the actions (all future-facing — nothing is written here):

- **reject-candidates** rejects the proposed candidate interpretation *for now*. It
  never deletes the import row or any existing roster record.
- **create-new** is only an instruction that a future apply *may* create a new
  roster entry. No roster entry is created in this slice.
- **manual-link** records an explicit link to a caller-supplied existing record id.
- **defer** records that review was deferred and has no effect.

`createRosterImportIdentityReviewDecision(actionResult, options)` turns an
**accepted** result into an append-only `RosterImportIdentityReviewDecision`.
Caller-provided `decisionId`, `createdAt`, and `reviewedAt` are required (the helper
never generates ids, never calls `Date.now()`, and never infers user identity).
Rejected results cannot become decisions. Supersession is represented only by
`audit.supersedesDecisionId`; prior decisions are never removed or rewritten.
`validateRosterImportIdentityReviewDecision` and
`summarizeRosterImportIdentityReviewDecisions` round out the contract. Applying
decisions to an import, a decision repository, and the review UI remain later
Phase 5 work.

## Roster import identity review decision repository (Phase 5 slice 4)

The fourth Phase 5 slice adds the narrow **repository / storage-boundary** layer
for the slice 3 decisions
(`src/engine/rosterImportIdentityReviewDecisionRepository.ts`). It mirrors the
Phase 4 slice 9 cohort decision repository: how decisions are appended, loaded,
validated, and exported / imported at the local data boundary. The repository state
shape is `{ version, decisions }`.

The app has no browser-storage persistence layer yet, so this is an **in-memory
repository adapter** plus a documented, JSON-compatible export/import contract —
**not** real persistence. It does **not** write to localStorage / IndexedDB / files
/ sample data / app state, and it does **not** apply decisions to import preview
rows, existing records, or roster data.

Behavior:

- **Append-only.** `appendRosterImportIdentityReviewDecision(s)` validate each
  decision via `validateRosterImportIdentityReviewDecision`, accept valid ones, and
  reject invalid (`invalid-decision`) and duplicate-`decisionId`
  (`duplicate-decision-id`) decisions. Duplicates are detected against both existing
  state and earlier decisions in the same batch; batch order is preserved. Every
  operation returns a NEW state and never mutates the prior state or the decision
  objects.
- **Load.** `getRosterImportIdentityReviewDecisions` returns all decisions in append
  order; `getActiveRosterImportIdentityReviewDecisions` returns only the decisions
  not superseded by another decision's `audit.supersedesDecisionId`. Superseded
  decisions remain in full history and are excluded from the active view only.
- **Export / import.** `exportRosterImportIdentityReviewDecisionRepository` returns a
  plain `{ version, decisions }` payload (no functions).
  `importRosterImportIdentityReviewDecisionRepository` validates the envelope
  (`invalid-repository-payload`, `unsupported-repository-version`,
  `missing-decision-list`) and then validates each decision, performing a **partial
  import** that reports accepted and rejected decisions; `ok` is false if anything
  was rejected. It never mutates the payload.

Wiring this repository to actual local storage and the review UI, and applying
decisions to an import, remain later Phase 5 work.

## Applying import identity review decisions (Phase 5 slice 5)

The fifth Phase 5 slice resolves slice 2 match entries against the (active) slice 3
decisions in memory, computing the **effective import outcome per row**
(`src/engine/rosterImportIdentityReviewDecisionApplication.ts`,
`applyRosterImportIdentityReviewDecisionsToMatches`). It mirrors the Phase 4 slice 8
decision-application step. It is **effective-state computation only** — not import
apply/commit, not roster mutation, not creating/linking roster records, not
deleting rows, not persistence, and not UI. Every outcome is a future-apply
instruction, never an immediate write.

Per entry (in input order), the effective outcome is one of: `unresolved`,
`link-to-existing`, `create-new`, `rejected`, `deferred`,
`skipped-invalid-preview-row`, `skipped-review-preview-row`, or `conflict`.

- Decisions match an entry on `previewSourceRowId` + `previewRowIndex`.
- With no applicable decision, a matchable entry is `unresolved` — a high-confidence
  single candidate is **never** auto-linked.
- An applied decision maps action -> outcome: accept-candidate / manual-link ->
  `link-to-existing`; create-new -> `create-new`; reject-candidates -> `rejected`
  (the interpretation is rejected for now, the row is **not** deleted); defer ->
  `deferred`.
- Skipped rows always resolve to their skip outcome; any decision targeting them is
  ignored with `decision-entry-status-mismatch`.
- Two or more current decisions for one entry make it a `conflict` (none applied,
  surfaced for review).

Decisions are validated with `validateRosterImportIdentityReviewDecision`;
superseded decisions (via `audit.supersedesDecisionId`) are ignored. Ignored
decisions are reported in decision input order with a reason (`invalid-decision`,
`superseded-decision`, `missing-preview-row-key`, `no-matching-entry`,
`duplicate-current-decision`, `decision-entry-status-mismatch`,
`selected-candidate-not-found`). An `accept-candidate` whose selected record is no
longer among the entry's candidates is ignored with `selected-candidate-not-found`.
`summarizeAppliedRosterImportIdentityReviewDecisions` tallies outcomes and ignored
reasons. Nothing is mutated. Actually applying outcomes to the roster (the import
commit), and the review UI, remain later Phase 5 / Phase 6 work.

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
