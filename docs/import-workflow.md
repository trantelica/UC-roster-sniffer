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

## Import commit preview / dry-run plan (Phase 5 slice 6)

The sixth Phase 5 slice folds the slice 5 applied outcomes into a deterministic
**dry-run commit plan** (`src/engine/rosterImportCommitPreviewPlan.ts`,
`createRosterImportCommitPreviewPlan`). It answers: "if a future user tried to apply
this import, what would the system plan to do, and what would block the commit?" It
is **commit-preview planning only** — not import apply/commit, not roster mutation,
not creating/linking records, not deleting/suppressing rows, not persistence, and
not UI. A `ready-to-link` / `ready-to-create` row is a future intended operation,
never a write.

Each applied entry becomes one plan row (in input order) with a `planStatus` and a
`plannedOperation`:

| Effective outcome | planStatus | plannedOperation |
| --- | --- | --- |
| link-to-existing (with target id) | `ready-to-link` | `link-existing-record` |
| link-to-existing (no target id) | `blocked-unresolved` | `none` (blocker `missing-target-existing-record-id`) |
| create-new | `ready-to-create` | `create-new-roster-entry` |
| rejected | `rejected` | `reject-import-row` |
| deferred | `deferred` | `defer-review` |
| unresolved | `blocked-unresolved` | `none` (blocker `unresolved-identity`) |
| conflict | `blocked-conflict` | `none` (blocker `conflicting-decisions`) |
| skipped-invalid-preview-row | `blocked-invalid-preview-row` | `none` |
| skipped-review-preview-row | `blocked-review-preview-row` | `none` |

Commit gating: `canCommit` is true only when there is at least one row, no row is
`blocked-*`, and any provided target context (`seasonId` / `districtId` /
`ageDivisionId` / `teamId`) is complete. **Rejected and deferred rows are explicit
reviewer outcomes and do NOT block the commit.** An empty plan is `canCommit:
false` (nothing to commit). An incomplete provided target context adds a
result-level `invalid-target-context` blocker and makes `canCommit` false without
mutating rows. Unresolved identities (including high-confidence single candidates)
are never auto-linked — they block.

Helpers `summarizeRosterImportCommitPreviewPlanRows`,
`getRosterImportCommitPreviewPlanRowsReadyForCommit` (ready-to-link / ready-to-create
only), and `getRosterImportCommitPreviewPlanRowsBlockingCommit` (blocked-* only)
round out the contract. The hard roster authority rule still applies: rows preserve
their source applied entry by reference and nothing is written. Performing the
commit and the review UI remain later Phase 5 / Phase 6 work.

## Phase 5 checkpoint: import pipeline (Phase 5 slice 7)

Phase 5 slices 1–6 are **complete / checkpointed**. This slice is a
documentation / spec-alignment checkpoint that adds **no product logic**. It records
the import preview and identity collision pipeline end-to-end through the dry-run
commit preview plan, and it pins the layer boundaries before any future import
application / projection slice. The deeper engine-level checkpoint lives in
`docs/derived-logic.md` ("Phase 5 checkpoint: import preview and identity collision
pipeline (Phase 5 slice 7)").

### Pipeline end-to-end (so far)

1. **Import preview rows** — `createRosterImportPreview` (slice 1). Non-destructive
   staging of every candidate row.
2. **Identity match candidates** — `createRosterImportPreviewIdentityMatches`
   (slice 2). Per ready row, the existing records it might correspond to.
3. **Review action + decision contract** —
   `applyRosterImportIdentityReviewAction` -> `createRosterImportIdentityReviewDecision`
   (slice 3). An append-only reviewer decision (a future-apply instruction).
4. **Decision repository** — `rosterImportIdentityReviewDecisionRepository` (slice
   4). Local `{ version, decisions }` storage-boundary contract.
5. **Effective decision application** —
   `applyRosterImportIdentityReviewDecisionsToMatches` (slice 5). The effective
   in-memory outcome per row.
6. **Dry-run commit preview plan** — `createRosterImportCommitPreviewPlan` (slice
   6). Per-row planned operation + blockers + the `canCommit` gate.

### Distinct data layers

Loaded authoritative roster data -> import preview rows -> identity match entries ->
review actions -> append-only review decisions -> decision repository state ->
applied / effective outcome entries -> dry-run commit preview plan rows. Each layer
is separate and must not be collapsed.

### Hard roster authority rule

- Loaded roster records remain authoritative.
- Import preview must **never** alter, remove, suppress, merge, nullify, rewrite,
  reorder, or ignore rostered names.
- Duplicate or ambiguous names affect **metadata / review state only**.
- Invalid, duplicate, skipped, rejected, and deferred import rows remain preserved
  as rows.

### Current Phase 5 purity / boundaries

No file parsing, no file upload, no browser persistence, no `localStorage`, no
`IndexedDB`, no React wiring, no UI, no sample-data mutation, no roster mutation, and
no import apply / commit. Ids and timestamps are caller-provided.

### Decision semantics

Review decisions are append-only; superseded decisions stay in repository history
(active view excludes them only); decisions can influence derived effective outcomes
only and never mutate preview rows, match entries, roster records, or sample data.

### Dry-run plan semantics

`ready-to-link` / `ready-to-create` are future intended operations only; `rejected`
and `deferred` rows remain preserved and do not block; `blocked-*` rows prevent
commit availability; no decision means `unresolved`; a high-confidence single
candidate does not auto-link; top-level `canCommit` is the authoritative readiness
gate.

### Terminology

"commit preview plan" means the dry-run plan only; "ready-to-create" does not create
a roster entry; "ready-to-link" does not link records; "rejected" does not delete an
import row; "deferred" keeps review pending; "blocked" prevents future commit
availability until resolved.

### Boundary for the next possible slice

A future slice may produce a pure **in-memory import application / projection** from
a committable plan, describing the resulting roster additions / links. Even then it
must not persist, mutate sample data, parse files, or wire UI unless explicitly
approved. Actual browser persistence, CSV / file parsing, and the review UI remain
separate later slices.

## Import application / projection (Phase 5 slice 8)

The eighth Phase 5 slice adds a pure, deterministic **in-memory import
application / projection** (`src/engine/rosterImportApplicationProjection.ts`,
`createRosterImportApplicationProjection`). Given a **committable** slice 6 dry-run
commit preview plan plus a set of existing roster records, it answers: "if this
already-reviewed plan were applied later, what roster links / additions would
result?" It is **projection only** — not import apply/commit, not persistence, not
sample-data mutation, not browser storage, not file parsing, and not UI. No
write/apply function is exported.

Each plan row becomes one projection row (in plan row order) with a
`projectionStatus` and a `projectedOperation`:

| Plan status | projectionStatus | projectedOperation |
| --- | --- | --- |
| ready-to-link (one matching existing record) | `projected-link` | `link-existing-record` |
| ready-to-link (no target id on the row) | `blocked` | `none` (blocker `invalid-plan-row`) |
| ready-to-link (target id matches no existing record) | `blocked` | `none` (blocker `missing-existing-record`) |
| ready-to-link (target id matches 2+ existing records) | `blocked` | `none` (blocker `duplicate-existing-record-id`) |
| ready-to-create (valid) | `projected-create` | `create-new-roster-entry` |
| ready-to-create (incomplete target context) | `blocked` | `none` (blocker `missing-target-context`) |
| ready-to-create (no preview row key) | `blocked` | `none` (blocker `missing-preview-row-key`) |
| ready-to-create (no player name) | `blocked` | `none` (blocker `missing-player-name-for-create`) |
| rejected | `projected-reject` | `reject-import-row` |
| deferred | `projected-defer` | `defer-review` |
| any `blocked-*` plan row (defensive) | `blocked` | `none` (blocker `blocked-plan-row`) |

Behavior and boundaries:

- **Gating.** Projection only proceeds when `plan.canCommit` is true. A
  non-committable plan returns `ok: false` with a result-level `plan-not-committable`
  blocker and **no** projected rows. Even when `plan.canCommit` claims true, a
  defensively-present `blocked-*` plan row is projected as `blocked` and forces
  `ok: false` — the row scan, not just the flag, decides readiness.
- **Projected links never modify the existing record.** A `projected-link` only
  references an existing record id; the record is read for resolution and never
  mutated.
- **Projected creates are provisional and not persisted.** A `projected-create`
  carries a minimal `projectedNewRecord` (season / district / age division / team /
  player name + source row metadata) with a deterministic `provisionalRecordId`
  derived from the target context + `previewSourceRowId` + `previewRowIndex`. It is
  an in-memory description only; no final/canonical id is generated and nothing is
  written. Jersey number / grade are intentionally **not** chased through raw plan /
  match objects (the plan row does not expose them cleanly); a later parser /
  import-map slice may enrich the projected record.
- **Rejected and deferred rows are preserved.** They project to `projected-reject` /
  `projected-defer` (their default) and delete nothing. Optional
  `allowRejectedRows: false` / `allowDeferredRows: false` instead project those rows
  as `skipped` (`skipped-non-committed-row`) for callers that only want the actual
  link / create changes.
- **Duplicate / missing existing records block the affected link row only** and are
  reported on that row; other rows still project.
- **`ok`** is true only when `plan.canCommit` is true, there are no result-level
  blockers, and no projected row carries a blocker.

Helpers `summarizeRosterImportApplicationProjection` (counts
link / create / reject / defer / blocked / skipped rows, blockers, and a row-level
`ok`), `getRosterImportApplicationProjectionLinkedRows`,
`getRosterImportApplicationProjectionNewRows`, and
`getRosterImportApplicationProjectionSkippedRows` (reject / defer / skipped) round
out the contract. The hard roster authority rule still holds: the plan, its rows, the
original applied entries, and the existing records are referenced, never mutated.
Actually applying the projection (the real import apply / commit), persistence, file
parsing, and the review UI remain later work and require explicit approval.

## CSV / text roster parsing (Phase 5 slice 9)

The ninth Phase 5 slice adds a pure, deterministic **text / CSV-like parser** into
the slice 1 import preview contract (`src/engine/rosterImportTextParser.ts`,
`parseRosterImportText` and `createRosterImportPreviewFromText`). It converts pasted
roster text (or simple delimited input) into slice 1 `RosterImportPreviewRowInput`
rows and can hand them to the existing `createRosterImportPreview` helper. It answers:
"can the system take pasted roster text and produce preserved import preview rows
without touching roster data?"

This is **parser-to-preview only**. It is NOT file upload, NOT the browser File API,
NOT UI, NOT persistence, NOT roster mutation, and NOT import apply/commit. It does
**not** decide whether a player is new / returning / linked / transferred / promoted /
relegated / y-up / z-down — it only stages rows for the existing pipeline.

Supported (kept simple and deterministic):

- comma / tab / pipe delimited rows, and newline-separated plain names;
- an optional header row (`hasHeader: true | false | 'auto'`);
- auto delimiter detection (presence precedence: tab, then pipe, then comma; comma is
  the harmless default when no delimiter is present);
- basic trimming and blank-line handling.

**Comma-in-name protection (auto mode).** In auto / omitted delimiter mode, a single
comma between two **non-numeric text cells** is treated as part of the player name and
is **not** split — this preserves the real-world "Last, First" `player_name` shape
(e.g. `Cary, Hudson` -> `playerName: "Cary, Hudson"`). A comma still splits when the
row is clearly tabular: a recognized header row, 3+ comma cells, or a 2-cell row where
either cell looks like a jersey number (e.g. `12, Hudson Cary` or `Alice, 12`). To
force comma columns regardless of shape, pass an explicit `delimiter: ','` (or use a
recognized header). Tabs and pipes are unambiguous and always split.

**Not** supported (reported, never guessed): full RFC CSV quoting, escaped delimiters
inside names, multi-line quoted fields, Excel files, browser file upload, and fuzzy
column inference beyond the narrow documented header aliases below.

Header aliases (lowercased, narrow, no broad fuzzy matching):

| Field | Recognized labels |
| --- | --- |
| playerName | name, player, player name, athlete |
| jerseyNumber | jersey, jersey #, number, no, # |
| grade | grade |
| notes | note, notes |

`options.columns` lets a caller map explicit header labels (e.g.
`{ playerName: 'athlete_name' }`); explicit column labels are matched before the
default aliases. With `hasHeader: 'auto'` (or omitted), a header is detected only when
the first non-empty line contains a recognized label.

Column behavior with a header maps recognized columns by index. Without a header,
columns are positional **per row's own cell count**:

- 1 column -> `playerName`;
- 2 columns -> `jerseyNumber` + `playerName`, unless the first value looks like a name
  and the second like a jersey number, then `playerName` + `jerseyNumber`;
- 3 columns -> `jerseyNumber` + `playerName` + `grade`;
- 4+ columns -> `jerseyNumber` + `playerName` + `grade` + `notes` (remaining cells
  joined by a space).

Preservation and reporting:

- **Every non-empty source line becomes one parse row in source order**, even when it
  is incomplete or malformed. A row with no resolvable player name is preserved and
  flagged `missing-player-name`; it then flows into the slice 1 preview's own
  validation (which marks it `invalid`).
- **Blank lines are skipped but counted** in `summary.skippedEmptyLines`.
- **`sourceRowId` is deterministic** (`line-<n>`, from the 1-based source line number)
  and `sourceLineNumber` is preserved — no random ids, no `Date.now()`.
- Parser issue codes: `empty-input`, `empty-line-skipped`, `header-detected`,
  `missing-player-name-column`, `missing-player-name`, `inconsistent-column-count`,
  `unsupported-delimiter`, `invalid-target-context`, `quoted-csv-not-supported`,
  `duplicate-source-row-id`. A line containing a quote is flagged
  `quoted-csv-not-supported` and parsed literally.
- The target context is validated independently and reported as
  `invalid-target-context` **before** preview creation; it is then passed through to
  the preview exactly. **Parser issues and preview issues stay distinguishable** —
  `createRosterImportPreviewFromText` returns both `{ parse, preview }` and does not
  duplicate slice 1 validation.

`parseRosterImportText` returns `{ ok, targetContext, delimiter, rows, issues,
summary }`; its `ok` reflects structural success (no parser-level error issue), while
per-row validity is owned by the preview. `summarizeRosterImportTextParseRows`
tallies row-derived counts (context fields are supplied by the parser).
`createRosterImportPreviewFromText` returns a null `preview` only for empty input.
The hard roster authority rule still holds: the input text, target context, and
options are referenced, never mutated. File upload, persistence, UI, and import
apply / commit remain later work and require explicit approval.

## Ute Conference scraped JSON source adapter (Phase 5 slice 10)

The tenth Phase 5 slice adds a pure, deterministic **source adapter** for harvested
Ute Conference website-scrape JSON (`src/engine/uteConferenceScrapedJsonAdapter.ts`).
It reads the scraped shape, lists importable team targets, and converts a selected
team into import-ready preview inputs — player teams into the existing slice 1
`RosterImportPreviewInput`, and coach teams into a separate coach preview shape. It
answers: "can the system inspect harvested Ute Conference JSON and convert selected
team data into internal import-ready preview inputs without mutating roster data?"

This is a **source adapter only**. It is NOT UI, NOT persistence, NOT browser
storage, NOT file upload, NOT roster mutation, NOT an actual import commit/apply, NOT
coach analytics, and NOT movement derivation. It composes with (and never replaces)
the slice 1 preview contract and does not change the slice 9 parser.

### Source shape

`metadata` carries `organization`, `event`, `age_division` (+ optional
`age_division_alias`), `year`, `record_type` (`players` | `coaches`), district/team/
row counts, `scraped_at`, and `source_url`. `districts[]` each carry `district`,
`league`, `teams_count`, and `teams[]`; player teams carry `players_count` +
`players[] { name }`, coach teams carry `coaches_count` + `coaches[] { name, title }`.

### Functions

- `detectUteConferenceScrapedJsonRecordType(payload)` -> `players` / `coaches` /
  `unknown` (from `metadata.record_type`).
- `summarizeUteConferenceScrapedJson(payload)` -> record type, metadata, district /
  team / row counts (`totalRows`, `teamsWithRows`, `emptyTeams`), and issues.
- `listUteConferenceScrapedJsonTeamTargets(payload)` -> one target per team in source
  order (district index, then team index), each with a deterministic `sourceTargetId`
  (`scraped:<year>:<ageSlug>:<districtIndex>:<teamIndex>`), record type, year, event,
  age division label/alias, league, district/team names + indices, team/source URLs,
  `rowCount`, and `playersCount` / `coachesCount`.
- `createPlayerRosterImportPreviewInputFromScrapedJson(payload, target)` -> a slice 1
  `RosterImportPreviewInput` (composed through `createRosterImportPreview`) for the
  selected player team.
- `createCoachImportPreviewInputFromScrapedJson(payload, target)` -> a separate coach
  preview shape (rows + summary) for the selected coach team.

The `target` selector is a `sourceTargetId` string or
`{ districtIndex, teamIndex, targetContext? }`.

### Behavior

- **Exact preservation.** Player names, coach names, coach titles, and source URLs
  are preserved EXACTLY — `Last, First` commas, extra spaces, and non-breaking spaces
  survive; nothing is split, reordered, normalized, or rewritten. Coaches are never
  de-duplicated (repeat name/title rows are all preserved). Player and coach rows are
  kept separate; coach data is not wired into the player roster import preview.
- **Deterministic source ids.** Player rows get
  `scraped:<year>:<ageSlug>:<districtIndex>:<teamIndex>:player:<playerIndex>`; coach
  rows use `:coach:<coachIndex>`. No random ids, no `Date.now()`.
- **Target context.** A caller may supply explicit `seasonId` / `districtId` /
  `ageDivisionId` / `teamId`; otherwise the adapter derives **provisional** ids with a
  deterministic slug helper (e.g. `2025-alta-gi-gridiron-a3`), flagged via
  `targetContextProvisional`. Provisional ids are not canonical roster ids.
- **Preservation of incomplete data.** A missing player/coach name or coach title
  preserves the row and attaches a `missing-player-name` / `missing-coach-name` /
  `missing-coach-title` issue (a missing player name flows into the preview's own
  validation as an invalid row). Empty districts and empty teams are preserved in
  target listing.
- **Empty league snapshots are valid source data.** A valid file with zero rows is
  `ok: true` with an informational `empty-league` issue, not corrupt data.
- **Count mismatches are non-destructive warnings.** Declared `*_count` /
  `total_*` values that disagree with actuals raise `count-mismatch` warnings; rows
  are preserved.

Issue codes: `invalid-payload`, `missing-metadata`, `unsupported-record-type`,
`missing-districts`, `missing-team-name`, `missing-player-name`, `missing-coach-name`,
`missing-coach-title`, `count-mismatch`, `empty-league`, `invalid-target`,
`target-not-found`.

The hard roster authority rule still holds: the payload is referenced, never mutated;
output is identical across repeated calls. No roster records are created or mutated,
and no apply/write/persist function exists. UI, persistence, file upload, import
apply/commit, and coach analytics remain later work and require explicit approval.

## Canonical source mapping for scraped JSON (Phase 5 slice 11)

The eleventh Phase 5 slice maps the scraped Ute Conference **source labels** into
canonical internal import context values
(`src/engine/uteConferenceScrapedCanonicalMapping.ts`). Slice 10 exposed raw source
targets/rows; this slice derives a canonical (or clearly provisional) season, age
division, district, and team classification for a selected team. It answers: "given a
scraped JSON payload and team target, can the system derive canonical season, age
division, district, and team/classification context without mutating the source
data?"

This is a **mapping adapter only** — NOT UI, persistence, browser storage, file
upload, roster mutation, import apply/commit, movement derivation, coach analytics, or
fuzzy identity matching. It reuses the existing age-division and team-classification
helpers and composes with the slice 10 adapter and slice 1 preview; it replaces
nothing. Mappings are deterministic — there is **no broad fuzzy matching** and **no
invented color-to-classification mapping**.

### Canonical age divisions

`SC`, `GR`, `PW`, `MM`, `GI`, `BA`. Known scraped labels map deterministically:

| Source label / form | Canonical |
| --- | --- |
| `SC League 7-8`, `Scout`, `Scouts` (or a `Scout…` team prefix) | `SC` |
| `GR League 9`, `Gremlin(s)` (or a `Gremlin…` team prefix) | `GR` |
| `PW League 10`, `PeeWee(s)` / `Pee Wee` (or a `PeeWee…` team prefix) | `PW` |
| `MM`, `MityMite` / `Mity Mite` / `Mighty Mite(s)` | `MM` |
| `GI`, `GridIron` / `Grid Iron` | `GI` |
| `BA`, `Bantam(s)` | `BA` |

Precedence is metadata label, then alias, then a **team-name prefix fallback** (used
only when the label/alias are missing or unmapped; reported as `provisional`,
source `team-name`). A label that conflicts with the alias is reported
(`conflicting-age-division-labels`) and resolved to the label as `provisional`. An
unmapped label is `unsupported-age-division` (`unknown`); none present is
`missing-age-division`.

### Team classification extraction

Only an **explicit, validated coded trailing token** is extracted from the team name
(`Gremlin A2` -> `A2`, `Gremlin D2` -> `D2`, `PeeWee C1` -> `C1`, `PeeWee B4` -> `B4`,
validated via `parseTeamClassification`, which also yields the hierarchy tier). An
out-of-range code (e.g. `C3`, `D1`) is `unsupported-team-classification`. Color-based
team names (`Scout White` / `Black` / `Gray` / `Silver`) are left classification
`unknown` / review-needed (`color-team-classification-unknown`) — **no color-to-class
mapping is invented**.

### District and season mapping

District names are preserved EXACTLY. A caller-supplied exact-name `districtRegistry`
yields a `high`-confidence id; otherwise a deterministic slug is derived and marked
`provisional` (`district-mapping-provisional`). Districts are never fuzzy-matched or
collapsed (`Bingham` and `Bingham Girls` stay distinct). The season id comes from
`metadata.year` (finite integer or 4-digit string) with `metadata.event` as the
label; a missing/invalid year reports `missing-season-year` / `invalid-season-year`
and is never inferred from a filename.

### Caller overrides & functions

A caller may override `seasonId` / `districtId` / `ageDivisionId` / `teamId` /
`teamClassification`; an override is applied, recorded with source `caller-override`
and an info `caller-override-used` issue, and the raw source values are preserved.
Functions: `mapUteScrapedAgeDivisionLabel`, `mapUteScrapedTeamClassification`,
`mapUteScrapedDistrict`, `mapUteScrapedSeason`,
`mapUteScrapedTeamTargetToCanonicalContext` (+ a coach-target wrapper
`mapCoachScrapedTeamTargetToCanonicalContext`), and
`createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext` — which
feeds the derived canonical context into the slice 10 player adapter and returns the
`canonicalContextMapping`, `previewInput`, and `previewResult` together (player names
preserved exactly). `contextConfidence` is the weakest of the contributing mappings
(`high` / `provisional` / `unknown`). The payload is never mutated; no roster records
are written and no apply/persist function exists.

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
