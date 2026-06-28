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

## Scraped JSON full-file readiness report (Phase 5 slice 12)

The twelfth Phase 5 slice adds a pure, deterministic **full-file readiness report**
over one scraped Ute Conference JSON payload
(`src/engine/uteConferenceScrapedJsonReadinessReport.ts`,
`createUteConferenceScrapedJsonReadinessReport`). It answers: "given one scraped
players or coaches JSON payload, what teams/rows are import-ready, empty, blocked,
provisional, or need review?" It is a **reporting / orchestration helper** that
composes the slice 10 source adapter and slice 11 canonical mapping — it replaces and
duplicates none of their logic — and is NOT UI, persistence, browser storage, file
upload, roster mutation, import apply/commit, movement derivation, coach analytics, or
fuzzy matching.

Each team target (in source order) is classified into a `readinessStatus`:

| Status | Meaning |
| --- | --- |
| `ready` | valid preview, no warning/review reasons |
| `ready-with-warnings` | valid preview with provisional/warning reasons (e.g. provisional district, unknown classification, non-strict count mismatch) |
| `needs-review` | rows preserved but review needed (player review-rows, missing coach name/title, or a count mismatch under `strictCounts`) |
| `blocked` | unresolved target, invalid rows (e.g. missing player name), or underivable context |
| `empty` | zero rows (a valid source state, not corruption) |

Each readiness target carries the source labels, the canonical ids
(`canonicalAgeDivisionId` / `canonicalDistrictId` / `teamClassification` /
`classificationHierarchyCode`), `rowCount`, `readinessReasons`, origin-tagged
`issues`, the full `canonicalContextMapping`, `contextConfidence` /
`targetContextProvisional`, and a `previewSummary` (players) or `coachPreviewSummary`
(coaches). Player readiness uses the slice 11 canonical preview helper (so comma names
are preserved and a high-confidence single candidate is never auto-anything); coach
readiness uses the slice 10 coach helper and never de-duplicates coaches.

Source-level behavior: an unsupported `record_type` (or invalid payload) yields
`ok: false` with the source issue surfaced and no targets; a valid empty-league /
empty-team snapshot is `ok: true`; count mismatches are warnings unless
`strictCounts: true` (which elevates them to `needs-review` while preserving rows);
the year is never inferred from a filename. Options:
`targetContextOverridesBySourceTargetId` (apply slice 11 caller overrides per target),
`districtRegistry`, `includeEmptyTeams` (default true), `includePreviewResults`
(default true), and `strictCounts` (default false).

The summary tallies targets by status, total/player/coach rows, and issue counts by
severity and code, plus two gates: `canProceedToTeamSelection` (source valid and at
least one ready / ready-with-warnings / needs-review target) and
`canProceedWithoutReview` (at least one ready target and no blocked/needs-review
targets). Helpers `summarizeUteConferenceScrapedJsonReadinessReport`,
`getUteScrapedJsonImportReadyTargets`, `getUteScrapedJsonTargetsNeedingReview`,
`getUteScrapedJsonBlockedTargets`, and `getUteScrapedJsonEmptyTargets` round out the
contract. The payload is never mutated; rows, names, titles, source URLs, and order
are preserved; no roster records are written and no apply/persist function exists. A
future review/import UI may consume this report; that remains later work requiring
explicit approval.

## Scraped JSON fixture contracts (Phase 5 slice 13)

The thirteenth Phase 5 slice anchors the scraped JSON pipeline (slices 10–12) to
representative real harvested source shapes via small, hand-curated **test fixtures**
under `src/test/fixtures/ute-scraped-json/`. It adds **no production logic** — it is a
fixture / contract-hardening slice that answers: "do our scraped JSON adapter,
canonical mapping, and readiness report remain compatible with representative real
harvested Ute Conference player, coach, and empty-snapshot source shapes?"

The fixtures are minimized examples (not full harvested files) that preserve the real
source structure (`metadata`, `districts[]` with `district` / `league` /
`teams_count` / `teams[]`, and `players_count` + `players[]` or `coaches_count` +
`coaches[]`). They cover: a players file (with a comma name `Cary, Hudson` and an
extra-space name `Moyer , Knox`), a coaches file (with a non-breaking-space coach name
and `Head Coach` / `Asst Coach` titles), valid empty-league snapshots for players and
coaches (`teams_count: 0`, `teams: []`), a color/non-coded team (`Scout White`), and a
coded-classification team (`Gremlin A2`).

Contract tests (`src/test/uteConferenceScrapedJsonFixtureContracts.test.ts`) run the
fixtures through the existing public helpers only —
`detectUteConferenceScrapedJsonRecordType`, `summarizeUteConferenceScrapedJson`,
`listUteConferenceScrapedJsonTeamTargets`,
`mapUteScrapedTeamTargetToCanonicalContext`,
`createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext`,
`createCoachImportPreviewInputFromScrapedJson`, and
`createUteConferenceScrapedJsonReadinessReport` — proving raw names/titles, source
order, and empty snapshots are preserved, coded classifications map while color teams
stay unresolved, payloads are never mutated, output is deterministic, and the engine
modules expose no apply/commit/write/persist API. These fixtures are **test contracts
only**: they are not bundled into the app and create no app-visible sample data, and
there is no UI, persistence, file upload, import apply, roster mutation, movement
derivation, or coach analytics.

## Scraped JSON import session state (Phase 5 slice 14)

The fourteenth Phase 5 slice adds an in-memory **import session state model** for one
scraped Ute Conference JSON source file
(`src/engine/uteConferenceScrapedJsonImportSession.ts`). It is **engine only** and is
pure and deterministic. It answers: "can the system hold a scraped JSON source file,
readiness report, selected team target, canonical mapping, and preview state in a
deterministic session object without applying, writing, or persisting anything?"

The session **composes** the existing slice 10/11/12 helpers and replaces or
duplicates none of their logic. Loading a payload
(`createUteScrapedJsonImportSessionFromPayload`) immediately builds the slice 12
readiness report, derives a deterministic non-cryptographic source fingerprint, and
selects no target by default. An unsupported / invalid source yields an
`invalid-source` session. Selecting a target
(`selectUteScrapedJsonImportSessionTarget`) re-runs the existing mapping and preview
helpers — for players,
`createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext`; for coaches,
`createCoachImportPreviewInputFromScrapedJson` — and stores the selected target, its
canonical context mapping, and its preview output. Blocked, empty, and needs-review
targets are tracked distinctly (`target-blocked`, `target-empty`, and
`ready-for-review` states); selecting a blocked or empty target is allowed but yields
no usable preview. A missing target id, an unloaded/invalid source, or a fingerprint
mismatch fails deterministically. Clearing
(`clearUteScrapedJsonImportSessionTarget`) preserves the loaded source and readiness
report while removing the selection.

The session summary exposes deterministic flags for future UI: `totalTargets`,
`selectableTargets`, `blockedTargets`, `emptyTargets`, `selectedSourceTargetId`,
`selectedStatus`, `selectedRowCount`, `selectedIssueCount`, `canSelectTarget`,
`canProceedToPreview`, and `canProceedWithoutReview`. The session state is intended
for future UI consumption: player names, coach names, coach titles, source rows,
source URLs, and source order are preserved exactly; every helper returns a new
session object and never mutates its inputs; and the source payload, when held, is
kept **by reference only, in memory only**, and is never written, uploaded, or
persisted. It does **not** persist, apply, mutate rosters, commit imports, upload
files, derive movement, or create coach analytics, and there is no UI.

## Scraped JSON import session review decisions (Phase 5 slice 15)

The fifteenth Phase 5 slice adds a **session-level review-decision state** layer over
the slice 14 session
(`src/engine/uteConferenceScrapedJsonImportSessionReviewDecisions.ts`). It is **engine
only**, pure, deterministic, and review **metadata only**. It answers: "can the session
hold a reviewer's decisions for the rows of the currently selected scraped JSON target,
and reflect them in deterministic review metadata, before anything is applied or
committed?" It never applies, commits, mutates, suppresses, or reorders source data.

A decision is keyed by `sourceFingerprint` + `sourceTargetId` + `sourceRowId`, with an
action of `confirm-row-identity`, `mark-row-needs-review`, or `ignore-row-for-review`.
`setUteScrapedJsonImportSessionReviewDecisions` /
`addUteScrapedJsonImportSessionReviewDecision` accept a decision only when the session
has a selected target and the decision matches that target's fingerprint, target id,
and an existing preview row; all other decisions are recorded as deterministic
rejections. `getUteScrapedJsonImportSessionReviewDecisions` and
`summarizeUteScrapedJsonImportSessionReviewState` re-validate stored decisions against
the current selection on every read, so decisions never leak across a target switch.

This layer does **not** add its own apply semantics. The three actions are projected
onto the canonical identity-review vocabulary via
`mapUteScrapedJsonImportSessionReviewAction`, and every action maps to a review-only
effect (`no-effect` or `defer-review`) — never a roster-mutating effect. The full
slice 2–5 identity-review decision/repository/application helpers are intentionally not
composed here because the scraped session has no existing-roster registry or identity
match entries yet; see `docs/derived-logic.md` ("Scraped JSON import session review
decisions") for the full rationale. There is no persistence, browser storage, file
upload, import apply/commit, roster mutation, movement derivation, coach analytics, or
UI.

## Local scraped JSON import preview workflow (Phase 5 slice 16–17)

The import preview screen is a local-first **read-only workbench**. Slice 16 added the
read-only UI shell; slice 17 made real local file loading the primary workflow and added
a dry-run projection. The user can:

- **Choose a local JSON file** with the browser file picker. The file is read in-browser
  with `FileReader` only — never uploaded, sent to a server, or stored (no backend, no
  localStorage/IndexedDB, no persistence). A pure helper
  (`src/app/scrapedImportFileParse.ts`) turns the text into a payload or a clean
  invalid-file error; invalid JSON and empty files are reported without throwing. Bundled
  demo fixtures remain available as a fallback.
- The parsed payload is fed into the existing slice 14 import session engine, which
  produces the readiness report. The workbench shows the source filename/type, status,
  readiness summary, and the targets grouped distinctly as ready, needs-review, blocked,
  and empty.
- Selecting a target shows its canonical context, import-blocking issues/warnings, the
  read-only review state (reviewed/unreviewed), and the preview rows: player rows for
  player targets, coach rows (raw names + titles) for coach targets.
- A **dry-run projection** panel (`src/engine/uteConferenceScrapedJsonImportDryRunProjection.ts`)
  composes the existing slice 2/3/5/6/8 helpers end to end to show, for a ready player
  target, what an import **would** create — in memory only, clearly labelled "Dry run
  only · nothing applied". Because the scraped pipeline has no existing-roster registry
  yet, every row is a `no-match` whose canonical resolution is `create-new`, so the
  projection only ever creates new entries; it never links or merges. The projection
  never bypasses readiness — blocked, empty, needs-review, coach, or missing-context
  targets yield a deterministic unavailable state instead of a forced projection.

Nothing in this workflow applies, commits, persists, or mutates roster data; the parsed
payload and preview rows are never mutated, and raw player/coach names and titles are
preserved exactly. There are no save/apply/commit controls.

## Roster-aware import matching, review, and decision-aware dry run (Phase 5 slice 18)

Slice 18 makes the dry-run **roster-aware**. For the selected player target, the
workbench locates the existing local roster team for the target's canonical context
(matched by season + district + age division + team code/classification against the same
static roster the viewer uses) and compares the imported preview rows against that team's
players. The pure engine helper
(`src/engine/uteConferenceScrapedJsonImportRosterAwareReview.ts`) composes the existing
Phase 5 helpers end to end — slice 2 identity matching, slice 3 review actions/decisions,
slice 5 decision application, slice 6 commit-preview plan, slice 8 application projection
— and classifies each imported row as `likely-new`, `likely-existing`, `ambiguous`,
`needs-review`, or `blocked`.

The reviewer can resolve rows in memory (confirm an existing match, create new, or mark
needs-review) and clear a decision; decisions are a per-row in-memory map (slice 4's
append-only repository is not needed for a stateless-per-render dry run). The dry-run
reflects those decisions, distinguishing **projected create**, **projected link**,
**deferred**, and **blocked-unresolved** rows, and is only "clean" (committable) when no
rows remain unresolved. Guardrails hold: a high-confidence single candidate is never
auto-linked (a match-bearing row stays unresolved until the reviewer decides); only an
unambiguous no-match row defaults to a projected create; ambiguous/collision rows
(duplicate existing names) block a clean dry run. If no existing roster is found for the
context, a deterministic **unavailable** state is shown rather than pretending every row
is new. Raw imported and existing names are preserved exactly; nothing is applied,
committed, persisted, or mutated, and prior seasons are untouched.

## Staged in-memory roster projection (Phase 5 slice 19)

Slice 19 adds an in-memory **staged projection**: once the slice 18 dry run is clean
(available, no unresolved/blocked rows), the user can "Stage preview" a projected
post-import roster to inspect the result before any permanent import exists. The pure
engine helper (`src/engine/uteConferenceScrapedJsonImportStagedProjection.ts`) consumes
the slice 18 review (itself built on the slice 2/3/5/6/8 pipeline) plus the located
existing roster team, and assembles: the actual roster (existing players, source order,
with linked players annotated), the projected roster (existing + projected-new imported
players in source order), counts (actual + new = projected; links do not grow the
roster), and any deferred rows (listed but not added). Staging is gated — unresolved
ambiguity, blocked rows, a missing existing-roster context, or a non-player target all
yield a deterministic unavailable state. The workbench shows a **Stage preview** action
(only when stageable) and a **Clear staged preview** action; changing the source,
target, or any identity decision automatically invalidates the staged projection.

This is preview / in-memory only: nothing is applied, saved, committed, written, or
persisted; the review, existing roster, payload, preview rows, and prior seasons are
never mutated; and raw imported and existing names are preserved exactly. There are no
Save / Apply / Commit / Import-now / Finalize controls.

## Future import readiness and preview artifact (Phase 5 slice 20)

Slice 20 adds **future-import-commit readiness reporting** and a **preview-only export
artifact** on top of slices 18–19. It introduces no new import model: it composes the
slice 18 review (per-row outcomes) and the slice 19 staged projection (projected roster
totals).

The readiness gate (`src/engine/uteConferenceScrapedJsonImportFutureReadiness.ts`,
`buildScrapedJsonImportFutureCommitReadiness`) answers a single question: *given the
current staged preview and review state, what — if anything — would prevent this from
being safe to commit in a future, explicitly approved import slice?* It produces a
stable, deterministic result distinguishing:

- `readyAdditions` — rows that would be added as new roster records in a future commit
- `readyLinks` — rows linked to an existing record (not added as new)
- `deferredRows` — rows intentionally deferred (not added yet)
- `unresolvedRows` — match-bearing rows still awaiting a reviewer decision
- `blockedRows` — structurally invalid / skipped rows that cannot proceed
- `totalIncomingRows` and `totalProjectedRosterRows` (the latter from the staged projection, or null when not stageable)
- `isReadyForFutureCommit` and stable `blockingReasons` (reason codes + messages), plus a plain-language `explanation`

A future commit is "ready" only when the review is available, no rows are unresolved or
blocked, there is at least one incoming row, and the staged projection is stageable.
Unresolved and blocked rows are reported directly; the "dry-run-not-clean" staged-projection
blocker is not double-reported when per-row blockers already explain it.

The preview artifact builder
(`src/engine/uteConferenceScrapedJsonImportPreviewArtifact.ts`,
`buildScrapedJsonImportPreviewArtifact`) assembles a single inspectable JSON snapshot of
current in-memory state — source/target summary, readiness summary, staged-projection
summary, and per-row statuses — stamped with a caller-supplied `generatedAt` so it is
fully deterministic. The workbench exposes a **Future import readiness** panel (ready /
linked / deferred / unresolved / blocked counts plus the plain-language explanation) and
an **Export preview artifact** button that downloads that JSON locally in the browser.

This remains preview-only. There is no actual import commit, apply, save, or persistence;
the export is a local client-side download only (no `localStorage`, no `IndexedDB`, no
backend); the review, staged projection, existing roster, and prior seasons are never
mutated; and raw imported and existing names are preserved exactly. **Permanent import
application remains a future, explicitly approved slice.**

## Reversible in-memory transaction plan (Phase 5 slice 21)

Slice 21 adds a **reversible, in-memory import transaction plan** — a design / safety
contract describing exactly what a future, explicitly approved import-write slice *would*
do, without doing it. The pure engine helper
(`src/engine/uteConferenceScrapedJsonImportTransactionPlan.ts`,
`buildScrapedJsonImportTransactionPlan`) composes the slice 18 review, slice 19 staged
projection, and slice 20 readiness gate. It introduces no new import model and re-derives
no matching/decision logic.

Planning **requires readiness**: when `isReadyForFutureCommit` is false, the helper returns
a deterministic `rejected` result carrying the readiness `blockingReasons` (and the
unresolved/blocked rows for inspection) and produces **no add operations**. When readiness
is ready it returns a `planned` result that distinguishes:

- `addOperations` — incoming rows that would become new roster records (each with a
  deterministic provisional `projectedRecordRef`; never a real id)
- `linkOperations` — incoming rows linked to an existing record, marked `rosterMutation:
  'none'` (no new roster record)
- `deferredRows` — incoming rows intentionally excluded from addition
- `rejectedRows` — unresolved/blocked/invalid rows (empty on a ready plan)
- `beforeRosterSummary` / `afterRosterSummary` / `rosterDeltaSummary` (only additions
  change the record count: `netRosterRecordChange === addedCount`)
- `rollbackPlan` (undo preview) — which added records would be removable, which links are
  no-ops, which deferred/rejected rows were never applied, and the player count the roster
  restores to after a full undo
- `audit` metadata — logic versions, caller-supplied `transactionId` / `generatedAt`, and
  `executed: false`

Caller-supplied `transactionId` / `generatedAt` keep output deterministic; the view model
uses stable sentinels for on-screen display and a real timestamp/id only at export time.
The workbench shows a read-only **Future import transaction plan** panel (add / link
(no-op) / deferred / rejected counts, before → after roster summary, an operations table,
and an **Undo preview**), and the preview artifact builder optionally embeds a transaction-
plan summary always marked `executed: false`.

This remains preview-only and is **not** a commit. Building or rendering a plan applies,
writes, saves, or persists nothing; there is no `localStorage` / `IndexedDB` / backend /
file / app-state write; the review, staged projection, existing roster, and prior seasons
are never mutated; loaded roster records stay authoritative; and raw imported and existing
names are preserved exactly. The transaction plan is a contract for a future, explicitly
approved import-write slice — **durable roster writes remain out of scope.**

## In-memory import execution and undo (Phase 5 slice 22)

Slice 22 adds the **first controlled write boundary**: an explicit, user-triggered,
reversible execution of a `planned` transaction plan into the **current runtime/session
roster view** — in-memory only. The write is **not durable**: nothing is saved, persisted,
or committed to any store (no `localStorage`, no `IndexedDB`, no backend, no database) and
it does not survive a reload.

Two pure engine helpers (`src/engine/uteConferenceScrapedJsonImportExecution.ts`) carry the
logic:

- `executeUteConferenceScrapedJsonImportTransaction` — executes a `planned` plan into a new
  in-memory team value. It refuses any plan that is not `planned` (carrying the readiness
  blocking reasons), a missing team, or a team/plan mismatch. Only `addOperations` change
  the roster: they are appended as new records after the existing records, which are
  preserved exactly and never reordered. `linkOperations` are no-ops; `deferredRows` and
  `rejectedRows` are never applied. The result carries applied additions, no-op links,
  skipped rows, before/after/delta summaries, an `undoPlan`, and an audit
  (`executed: true`, `durable: false`, `persisted: false`).
- `undoUteConferenceScrapedJsonImportExecution` — removes only the records the execution
  added and restores the team to its pre-execution count. It preserves every surviving
  record exactly, leaves linked/deferred/rejected rows untouched, and rejects non-executed
  or malformed execution results.

A pure `evaluateScrapedJsonImportExecutionAvailability` gate decides whether the execution
action is offered: it requires a staged preview, a `planned` transaction plan, and no
already-executed in-memory import for the active workflow.

In the workbench the user can: load a local file, resolve identities, stage the preview,
confirm readiness, see the transaction plan, then **Execute In-Memory Import**. The roster
view immediately reflects the added records (with an "in-memory import active" banner that
states it is in-memory only, has no saved roster data, and does not persist after reload),
and **Undo In-Memory Import** restores the pre-execution roster. While an execution is
active the workflow is **locked** — the source, target, review decisions, and staged
preview cannot change until the import is undone — so additions cannot be duplicated and no
phantom records are orphaned. The view model always derives against the immutable baseline
roster, so staging/readiness/the plan stay stable and re-running them cannot duplicate
additions. The preview/export artifact gains an `inMemoryExecution` section
(`notExecuted` / `executed` / `undone`, always `durable: false` / `persisted: false`).

This is the first write boundary, but the write is to current runtime/session state only.
**No durable persistence exists**; no `localStorage`, `IndexedDB`, backend, auth, or cloud
database is involved; prior seasons are never mutated and identities are never destructively
merged. Reloading or resetting the app must not be treated as preserving the in-memory
execution. (Durable import persistence arrived later in Completion Milestone B1 — see below.)

## Commit a previewed scraped-JSON team to the workspace (Completion Milestone B1)

B1 turns a reviewed, ready **player** team import into committed workspace data. It reuses
the slice 22 pipeline unchanged — the same transaction plan, the same
`executeUteConferenceScrapedJsonImportTransaction`, and the same
`evaluateScrapedJsonImportExecutionAvailability` readiness gate — and adds only a small pure
workspace transformation plus the app wiring.

**Distinct from the slice 22 in-memory execution.** The in-memory execution writes the
`executedTeam` into the transient runtime overlay (`inMemoryImport`); it is preview-only and
does not survive a reload. B1 **commit** instead writes that same `executedTeam` into the
committed `workspace` state, which then auto-saves to IndexedDB via Completion Milestone A1
and is included by the A2 Export Dataset. The two are not stacked: committing clears any
active in-memory overlay.

Engine (`src/engine/workspaceImportCommit.ts`, pure, tested):

- `commitImportedTeamToWorkspace(workspace, committedTeam)` — replaces ONLY the team that
  shares `committedTeam.teamId`, preserving every other team, game, coach, coach assignment,
  district, age division, and selection exactly. Returns the new workspace plus the previous
  team value (for undo). Refuses (`committed: false`) when no team with that id exists — it
  updates an existing team only and never silently creates a new team. It never re-implements
  the add/link/defer roster semantics: those belong to the execution helper, which produced
  `committedTeam`.
- `undoImportedTeamCommitInWorkspace(workspace, previousTeam)` — restores the previous team
  value into the CURRENT workspace, replacing only that team, so any unrelated later changes
  are preserved.

In the workbench: after load → select → review → stage, the user clicks **Commit Import to
Workspace** (offered only when the readiness gate passes; disabled for unresolved / blocked /
needs-review / missing-context / not-staged targets, and while an in-memory preview is
active). The committed team appears in the normal roster view, a top banner reads
"Committed import saved locally" with the before→after counts, and **Undo Committed Import**
reverts it for the current session (the undo affordance itself is session-only; the committed
data is durable via A1 and survives reload). Loaded roster records remain authoritative:
existing names are preserved exactly and in order, duplicates are not merged, links are
no-ops, and deferred/rejected rows are never added — nothing is silently resolved.

**Scope:** B1 commits **player roster teams** only. Coach scraped-JSON commit needs a new
engine path beyond the existing helpers and is deferred to a later slice. No backend, auth,
cloud DB, `localStorage`, whole-file multi-team import, or district registry is introduced.

## Registry-backed district mapping + confirm/add unknown district (Completion Milestone C1/C3)

The scraped-JSON canonical mapping already accepts an exact-name `districtRegistry`
(`name` → `districtId`). C3 feeds the **committed workspace district registry** into it:
the import workbench builds the lookup from the **active** districts (matching on `name`
and any `sourceLabels`) via `buildDistrictNameRegistryLookup` and passes it as the import
session's `districtRegistry` option.

- **Registered districts resolve at `high` confidence** and no longer emit the
  `district-mapping-provisional` warning.
- Matching is **exact only** — never fuzzy. `Bingham` and `Bingham Girls` stay distinct.
- **Active matches are preferred over inactive ones.** Inactive districts are excluded from
  the lookup, so they are never preferred for new import mapping.
- An **unknown** scraped district label is preserved exactly and stays `provisional` until
  confirmed.

**Confirm/add unknown district (narrow — not full District Maintenance).** When a selected
target's district is provisional, the workbench shows an **Add district to registry** action.
Confirming calls `confirmUnknownScrapedDistrict`, which always yields an **active** registry
outcome (so the action is never a dead no-op):

- An exact **active** match is reused unchanged (idempotent).
- When the only exact match(es) are **inactive**, the existing inactive record is
  **reactivated** (status flipped back to active) — it is reactivated, not duplicated or
  deleted, so a previously-retired district keeps its id and branding and the scraped label
  resolves again. (`outcome: 'reactivated'`.)
- When there is **no** exact match, a new **active** record is appended with a deterministic
  id (the name slug, disambiguated on collision), the exact scraped name, the scraped name
  recorded as a `sourceLabel`, and **placeholder/provisional branding**
  (`brandingProvisional: true`). (`outcome: 'added'`.)

Matching stays exact (never fuzzy). The updated registry lands in committed `workspace` state (auto-saved via A1, exported by A2), and
the workbench **re-derives its mapping reactively** (the district prop changes; no remount,
so the loaded source and selected target are preserved) — the district is then no longer
provisional. Full branding/image/inactivate editing remains the **C2 District Maintenance**
screen; this slice adds no edit forms, image pickers, or color pickers.

## Portable workspace snapshot export / import (Phase 5 slice 23)

Slice 23 adds **portable workspace snapshots**: the user can explicitly export the current
local roster workspace to a JSON file and later import that file to validate and restore it.
This adds practical durability **only because the user moves a file by hand** — it is not a
database, browser storage, or sync.

A **workspace snapshot is distinct from the import preview artifact**. The preview artifact
(slices 20–22) documents an import workflow; a workspace snapshot (`snapshotKind:
"workspace"`) captures and restores the whole app workspace. Validation rejects a preview
artifact with the `wrong-snapshot-kind` code.

The pure engine module `src/engine/workspaceSnapshot.ts` provides:

- `buildWorkspaceSnapshot` — deep-copies the current workspace (districts, age divisions,
  teams/rosters) plus the active selection into a versioned, JSON-serializable snapshot
  (`schemaVersion`, caller-supplied `generatedAt`, `appName`, `source:
  "user-exported-json"`, and summary counts). It captures the CURRENT in-memory roster,
  including any slice-22 executed additions. Pure; never mutates input.
- `parseWorkspaceSnapshotJson` / `validateWorkspaceSnapshot` — parse and validate, never
  throwing. They reject with stable reason codes: `invalid-json`, `not-an-object`,
  `missing-schema-version`, `unsupported-schema-version`, `wrong-snapshot-kind`,
  `invalid-workspace` / `invalid-districts` / `invalid-age-divisions` / `invalid-teams`, and
  `empty-workspace` (no teams). Valid data is preserved exactly.
- `restoreWorkspaceFromSnapshot` — returns the workspace to **replace** the current one
  (never a merge) plus a resolved active selection: the snapshot's selected team if it still
  exists, otherwise the most recent season with no specific team (the app's default
  convention).

In the app shell a **workspace toolbar** offers **Export Workspace Snapshot** (downloads
`uc-roster-sniffer-workspace-YYYY-MM-DD.json`; does not change app state) and **Import
Workspace Snapshot** (validates a chosen file). A valid import **replaces** the in-memory
workspace, clears all transient import-execution/workbench state (the import workbench is
remounted; any active in-memory import and its undo are discarded), restores the
season/team, and shows a restored summary. An invalid import shows a readable error and
leaves the current workspace **unchanged**. The toolbar copy states it is portable JSON that
replaces the current in-memory workspace and that no browser storage is used.

This is explicit, user-controlled **file** durability — **not** automatic persistence. No
`localStorage`, `IndexedDB`, backend, auth, cloud database, auto-save, or sync exists.
Prior-season lock rules are unchanged, identities are never merged, and the import preview
artifact and the workspace snapshot remain separate concepts. **Browser/database persistence
remains a future, explicitly approved decision.**

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

## Schedule import workflow (Phase 6 slice 25)

Slice 25 makes schedule/results a working local feature, **separate from roster import**.
It reads the preserved team-centric `data-samples/schedule-import.sample.json` row contract
(`importType: "schedule"`; rows with `teamId` / `opponentTeamId` / `homeAway` and
team-relative `teamScore` / `opponentScore`) and maps it into the game-centric slice-24
`Game` model. **Opponents resolve through existing `Team.teamId` references only** — no
opponent object is created, and an unresolvable reference rejects the row.

Pure engine pipeline:

- **Adapter** (`src/engine/scheduleImportAdapter.ts`, `adaptScheduleImport`) — validates the
  file shape, then maps each row to a `Game` or row errors. Home/away are derived from
  `homeAway` (`away` swaps the listed team and opponent; `neutral` treats the listed team as
  home by deterministic convention since `Game` has no neutral concept); scores are oriented
  to home/away. Status comes from an explicit `status` if present, else is derived
  (`final` when a result/scores are present, otherwise `scheduled`); a final game requires
  both scores. Stable row error codes: `invalid-row-shape`, `missing-season`,
  `invalid-home-away`, `unresolved-home-team` / `unresolved-away-team`, `invalid-status`,
  `invalid-scores`, `invalid-final-scores`. Source row values are preserved for display.
- **Preview** (`src/engine/scheduleImportPreview.ts`, `buildScheduleImportPreview`) —
  classifies every row as **add / update / skip / error** against the current games. A row
  updates an existing game when their `gameId` matches, else when the deterministic natural
  key (`seasonId + scheduledDate + homeTeamId + awayTeamId`) matches exactly one existing
  game; an ambiguous natural-key match or a duplicate within the import is a blocking error
  (`ambiguous-existing-match`, `duplicate-in-import`, `duplicate-natural-key`). It never
  silently overwrites. The preview reports `totalRows` / `validRows` / `invalidRows` /
  `addCandidates` / `updateCandidates` / `skippedRows` / `blockingErrors` and `isExecutable`.
- **Execution / undo** (`src/engine/scheduleImportExecution.ts`) — `executeScheduleImport`
  applies an executable preview into a new games array (adds appended, updates in place
  keeping the existing gameId, skips/errors not applied) with a `durable:false` /
  `persisted:false` audit; `undoScheduleImport` removes added games and restores updated
  games to their captured prior state, preserving unrelated games. Caller-supplied
  `transactionId` / `executedAt` / `undoneAt` keep output deterministic.

The **Schedule import** tab previews, executes (explicitly), and undoes the import in
memory. Imported games appear immediately in the team Schedule & Results view, and the
record recalculates. This is **in-memory only** — durability comes only from a workspace
snapshot export. No backend, browser storage, cloud, or sync is used.

**Slice 26 — game context preservation:** the adapter also preserves game context from the
contract: `homeAway: neutral` maps to `isNeutralSite: true`, and `isPlayoff` /
`isChampionship` are carried onto the `Game` (only boolean `true` sets a flag). Championship
games count as playoff context in derived record splits and feed the standings dashboard.

### In-memory result/status updates (Phase 6 slice 25)

The team Schedule & Results section gained an **Edit Result** control per game
(`src/engine/gameResultUpdate.ts`, `updateGameResult`): the user can update a game's status,
home/away scores, and notes in memory. Final games require valid numeric scores;
scheduled / postponed / cancelled games may have blank scores. Invalid edits are rejected
with readable messages and do not alter state. The summary recalculates immediately. This is
**result/status editing only — not full schedule construction**, and is in-memory only.

Imported schedule games and in-memory result edits travel with the workspace snapshot (games
are snapshot-aware since slice 24); importing a workspace snapshot replaces the games and
clears transient schedule-import execution/undo state.

## Coach import workflow (Phase 7 slice 27)

Phase 7 adds a coach import workflow, **separate from roster and schedule import**, following
the same preview → execute → undo pattern. It reads a focused row-per-assignment contract
(`data-samples/coach-import.sample.json`; `importType: "coach"`, rows with `coachName` +
`teamId` + `role`) — chosen over the nested Phase-5 scraped coaches contract for the same
reason slice 24/25 chose clean teamId-referenced contracts (the scraped coaches JSON resolves
team labels via the canonical pipeline and remains a separate future scraped-coach path).

- **Adapter** (`coachImportAdapter.ts`) validates the shape, resolves `teamId` against
  existing teams (no opponent/team invention), derives a name-based identity key, and maps
  rows to assignment candidates with stable error codes (`invalid-row-shape`,
  `unresolved-team`, `invalid-role`). Raw coach names/source labels are preserved.
- **Preview** (`coachImportPreview.ts`) classifies rows add / update / skip / error /
  **review**. A row reuses an existing coach when exactly one shares its identity key; zero
  matches add a new coach; MORE THAN ONE existing match is **ambiguous → review** (blocking,
  never merged). Assignments match by (season, team, coach); a duplicate within the import
  blocks. It never silently overwrites.
- **Execution / undo** (`coachImportExecution.ts`) apply an executable preview into new
  coaches/assignments arrays (`durable:false` / `persisted:false` audit); undo removes added
  assignments, restores updated ones, and removes added coaches only when no surviving
  assignment references them. Coach import never mutates rosters or games.

Everything is in-memory only — durability comes only from a workspace snapshot export. No
backend, browser storage, cloud, or sync is used.

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
