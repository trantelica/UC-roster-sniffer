# Data Model

This document defines the initial conceptual data model. Field names are draft-level and may be normalized during implementation.

## Season

```json
{
  "seasonId": "2026",
  "label": "2026",
  "status": "active",
  "locked": false
}
```

### Notes

- Prior seasons should be locked.
- Active seasons may receive roster imports, schedule updates, and result updates.
- Some source files may not include season in each row. In those cases, season may be supplied by import metadata or inferred from a reviewed filename convention.

## District

```json
{
  "districtId": "alta",
  "name": "Alta",
  "mascot": "Hawks",
  "logoAssetPath": "assets/districts/alta/logo.png",
  "helmetAssetPath": "assets/districts/alta/helmet.png",
  "primaryColor": "#000000",
  "secondaryColor": "#FFFFFF"
}
```

### Notes

- Districts are standardized.
- District branding is reusable across seasons.
- Imports should preserve raw district labels before mapping them to standardized district IDs.

## Age Division

```json
{
  "ageDivisionId": "GR",
  "name": "Gremlin",
  "leagueLabel": "GR League 9",
  "ordinal": 2,
  "typicalAges": [9]
}
```

### Fixed order

```text
SC -> GR -> PW -> MM -> GI -> BA
```

### Notes

- Source roster files may use labels such as `GI League 12`. Import logic should map these labels to canonical age division IDs, such as `GI`, while preserving the raw source label.

## Team

```json
{
  "teamId": "2026-alta-GR-B1",
  "seasonId": "2026",
  "districtId": "alta",
  "ageDivisionId": "GR",
  "teamCode": "B1",
  "draftOrder": 2,
  "divisionTeamCount": 4,
  "headCoachId": "coach-jane-smith",
  "assistantCoachIds": ["coach-sam-lee"],
  "isMyTeam": false
}
```

### Notes

- `teamCode` follows conference team classification rules.
- `divisionTeamCount` is the number of teams in that district-age-division for the season.
- `isMyTeam` is season-specific.
- Source team labels may embed classification values, such as `GridIron A3`, `GridIron C1`, or `GridIron D2`. Import logic should preserve the raw team label and derive a candidate `teamCode` for review.

## Player

```json
{
  "playerId": "player-generated-id",
  "canonicalName": "Jordan Smith",
  "notes": "Free text notes.",
  "cohortOffsetStatus": "zDown",
  "cohortOffsetFirstSeasonId": "2026",
  "cohortOffsetSource": "yearOverYearReview"
}
```

### Notes

- Player identity is name-based at import, then can be linked to a canonical `playerId`.
- Collisions should be surfaced during import.
- `cohortOffsetStatus` is optional and records a preserved y-up or z-down classification once identified.
- Y-up/z-down is treated as a cohort reclassification event that can persist while the player continues with the reclassified cohort.
- Source player names may contain suffixes, nicknames, inconsistent spacing, punctuation, capitalization differences, and trailing source flags. Raw names should be preserved on season assignments and import candidates.

### Cohort offset values

```text
none
yUp
zDown
```

### Cohort offset source values

```text
yearOverYearReview
explicitImport
manualOverride
```

## Player Season Assignment

```json
{
  "assignmentId": "2026-player-generated-id-alta-GR-B1",
  "seasonId": "2026",
  "playerId": "player-generated-id",
  "playerNameRaw": "Jordan Smith",
  "districtId": "alta",
  "ageDivisionId": "GR",
  "teamId": "2026-alta-GR-B1",
  "derivedStatus": "returning",
  "identityConfidence": "high",
  "cohortOffsetStatusForSeason": "zDown",
  "cohortOffsetReviewRequired": false
}
```

### Notes

- A player may have only one assignment per season.
- The assignment carries season-specific roster context.
- `cohortOffsetStatusForSeason` allows the UI to show that a preserved y-up or z-down classification applies to the current assignment.
- `cohortOffsetReviewRequired` should be true when the preserved cohort path appears broken or ambiguous.
- `playerNameRaw` should preserve the import source name exactly enough to support audit/review, while separate normalization logic may produce a canonical matching name.

## Coach

```json
{
  "coachId": "coach-generated-id",
  "canonicalName": "Jane Smith"
}
```

## Coach Season Assignment

```json
{
  "assignmentId": "2026-coach-jane-smith-alta-GR-B1-head",
  "seasonId": "2026",
  "coachId": "coach-generated-id",
  "coachNameRaw": "Jane Smith",
  "districtId": "alta",
  "ageDivisionId": "GR",
  "teamId": "2026-alta-GR-B1",
  "role": "headCoach"
}
```

### Role values

```text
headCoach
assistantCoach
```

## Game

```json
{
  "gameId": "2026-alta-GR-B1-week-01",
  "seasonId": "2026",
  "teamId": "2026-alta-GR-B1",
  "opponentTeamId": "2026-brighton-GR-B1",
  "weekLabel": "Week 1",
  "gameDate": "2026-08-22",
  "homeAway": "home",
  "teamScore": 20,
  "opponentScore": 14,
  "result": "win",
  "isPlayoff": false,
  "isChampionship": false
}
```

### Notes

- Opponents are existing teams.
- No separate opponent object is needed.
- Records should derive from game objects.

## Identity Match Decision

```json
{
  "decisionId": "import-2026-001-player-jordan-smith",
  "importId": "import-2026-001",
  "entityType": "player",
  "rawName": "Jordan Smith",
  "proposedEntityId": "player-generated-id",
  "confidence": "low",
  "reasons": ["same_name_exists_other_district"],
  "userDecision": "accepted"
}
```

### Confidence values

```text
high
low
```

### User decision values

```text
accepted
rejected
manualLink
createNew
```

## Cohort Review Decision

A persisted cohort review decision is a **separate, append-only record** that
preserves a reviewer's accepted decision about a derived y-up / z-down cohort
status. It is produced only from an **accepted** review action result (see
`docs/derived-logic.md`, Phase 4 slices 6–7). It never rewrites source roster
records, players, teams, imported data, or prior seasons.

```json
{
  "decisionId": "cohort-decision-2027-jordan-smith-001",
  "decisionType": "confirm",
  "reclassificationType": "y-up",
  "identityKey": "jordan smith",
  "playerId": "player-generated-id",
  "playerDisplayName": "Jordan Smith",
  "firstDetectedSeasonId": "2026",
  "evaluatedSeasonId": "2027",
  "priorAgeDivisionId": "GR",
  "firstDetectedAgeDivisionId": "MM",
  "expectedAgeDivisionId": "GI",
  "actualAgeDivisionId": "GI",
  "cohortOffset": 1,
  "reviewActionState": "confirmed",
  "resultingActiveStatus": "active",
  "resetRecommendedAtDecisionTime": false,
  "reviewerNote": "Confirmed travelling with the older cohort.",
  "reviewedAt": "2027-06-01T00:00:00Z",
  "reviewerId": "coach-1",
  "source": {
    "logicVersion": "phase4-slice7-cohort-review-decision-v1",
    "sourceAssignmentStatus": "active",
    "sourceReviewStatus": "clean",
    "sourceReviewReason": "valid-carry-forward",
    "sourceCarryForwardStatus": "carried-forward",
    "sourceCarryForwardReason": "expected-offset-path"
  },
  "audit": {
    "createdAt": "2027-06-01T00:00:00Z",
    "createdBy": "coach-1",
    "supersedesDecisionId": "cohort-decision-2027-jordan-smith-000",
    "lockedSourceSeasonIds": ["2025", "2026"]
  }
}
```

### Decision type values

```text
confirm
reset
defer
mark-insufficient-data
```

### Review action state values

```text
confirmed
reset
deferred
insufficient-data
```

### Notes

- **Append-only.** A later decision may reference an earlier one via
  `audit.supersedesDecisionId`, but never edits or deletes the earlier decision.
- **Roster authority.** A decision never mutates roster rows, player names, team
  assignments, imported data, or prior seasons, and never unlocks a locked prior
  season. `audit.lockedSourceSeasonIds` records prior seasons that stay locked.
- **Accepted-only.** Only an accepted review action result becomes a decision;
  rejected action results never persist.
- **Reset preserves history.** A `reset` decision ends the active cohort status from
  the evaluated-season perspective (`resultingActiveStatus` is not active) but does
  **not** delete the first-year reclassification event record.
- **Coherence.** `decisionType` and `reviewActionState` are paired:
  `confirm`/`confirmed`, `reset`/`reset`, `defer`/`deferred`,
  `mark-insufficient-data`/`insufficient-data`.
- **Re-auditable.** The `source` block captures the derived statuses/reasons and a
  `logicVersion` so a decision can be re-audited against the logic that produced it.
- **Deterministic ids/timestamps.** `decisionId`, `audit.createdAt`, and any
  `reviewedAt` are caller-provided; the engine helpers never generate ids or read
  the wall clock.
- This slice defines the **contract only**. No storage write, no UI. Future slices
  may add local storage integration and a manual review screen.

## Cohort Review Decision Repository

The local repository / storage-boundary payload for cohort review decisions
(Phase 4 slice 9). It is a plain, JSON-compatible envelope around an append-only,
ordered list of `Cohort Review Decision` records.

```json
{
  "version": "cohort-review-decisions.v1",
  "decisions": [
    { "decisionId": "cohort-decision-2027-jordan-smith-001", "decisionType": "confirm" }
  ]
}
```

### Notes

- `version` is an explicit schema tag (`cohort-review-decisions.v1`). Import rejects
  any unsupported version.
- `decisions` preserves append order. The repository is **append-only**: superseded
  decisions stay in the list (excluded only from the active view); decisions are
  never overwritten or deleted.
- Append/import validate every decision and reject invalid (`invalid-decision`) and
  duplicate (`duplicate-decision-id`) records; import additionally guards the
  envelope (`invalid-repository-payload`, `unsupported-repository-version`,
  `missing-decision-list`).
- This is an **in-memory repository model and export/import contract only** — there
  is no browser-storage (localStorage / IndexedDB / file) write yet, and no UI.
  Repository operations never mutate roster records.

### Phase 4 checkpoint: four distinct layers

Phase 4 is checkpointed (see `docs/derived-logic.md`, "Phase 4 checkpoint"). The
cohort reclassification pipeline keeps four layers strictly distinct, and the data
model must not collapse them:

1. **Roster data** — `Player`, `Player Season Assignment`, `Team`, etc. Loaded and
   authoritative. Never altered, removed, suppressed, merged, nullified, reordered,
   or ignored by any cohort logic.
2. **Derived cohort assignment** — the in-memory per-player-season cohort
   `activeStatus` and applied `cohortOffset` (engine `deriveCohortReclassificationAssignments`).
   This is derived state, **not** a stored record and **not** a roster mutation.
3. **Cohort Review Decision** — the separate, append-only record above, built only
   from an accepted manual review action. It can affect derived assignment state in
   memory but never rewrites roster data and never deletes a first-year
   reclassification event.
4. **Cohort Review Decision Repository** — the local storage-boundary envelope
   above. In-memory model and JSON export/import contract only; no browser-storage
   write yet.

The optional `Player` cohort offset fields (see the `Player` section, "Cohort
offset values" / "Cohort offset source values") remain the eventual persistence
target for a preserved offset, but Phase 4 does not write them — the offset lives
as derived state through the checkpoint.

## Import Batch

```json
{
  "importId": "import-2026-rosters-001",
  "importType": "roster",
  "seasonId": "2026",
  "createdAt": "2026-06-07T00:00:00Z",
  "status": "completed"
}
```

### Import types

```text
roster
schedule
result
branding
```

## Import Candidate

Import candidates are temporary, reviewable records created from source files before commit. They are not canonical season records until validation, identity review, and collision decisions are complete.

A flat roster import candidate may carry fields like:

```json
{
  "importId": "import-2025-rosters-001",
  "sourceRowNumber": 1,
  "sourceFileName": "UTE_Conference_GI_League_12_2025_Rosters.json",
  "rawDistrict": "Alta",
  "rawAgeGroup": "GI League 12",
  "rawTeam": "GridIron A3",
  "rawPlayerName": "Cary, Hudson",
  "candidateSeasonId": "2025",
  "candidateDistrictId": "alta",
  "candidateAgeDivisionId": "GI",
  "candidateTeamCode": "A3",
  "candidatePlayerNameNormalized": "Cary, Hudson",
  "sourceFlags": []
}
```

### Notes

- Import candidates should preserve raw source values separately from derived candidate values.
- Candidate values are not final until the import is committed.
- Unknown or unexplained source flags should be preserved for review rather than discarded.

## Roster Import Preview

A roster import preview (Phase 5 slice 1) is a **pure, in-memory, non-destructive
staging structure** produced by `createRosterImportPreview`
(`src/engine/rosterImportPreview.ts`). It is not a persisted record, not a commit,
and not compared against existing rosters yet — it only stages candidate rows for
later collision review.

```json
{
  "ok": false,
  "target": {
    "seasonId": "2026",
    "districtId": "alta",
    "ageDivisionId": "GI",
    "teamId": "alta-GI-A1"
  },
  "targetValid": true,
  "rows": [
    {
      "sourceRowId": "r1",
      "rowIndex": 0,
      "playerName": "Cary, Hudson",
      "normalizedIdentityKey": "cary hudson",
      "fields": { "jerseyNumber": null, "grade": null, "notes": null, "raw": null },
      "issues": [],
      "status": "ready"
    }
  ],
  "summary": {
    "totalRows": 1,
    "readyRows": 1,
    "needsReviewRows": 0,
    "invalidRows": 0,
    "duplicateNameGroups": 0,
    "duplicateSourceRowIdGroups": 0,
    "errorCount": 0,
    "warningCount": 0,
    "infoCount": 0
  },
  "issues": []
}
```

### Row status values

```text
ready
needs-review
invalid
```

### Issue severity values

```text
info
warning
error
```

### Issue codes

```text
missing-source-row-id
duplicate-source-row-id
missing-player-name
duplicate-name-in-import
invalid-target-context
```

### Notes

- **Non-destructive.** Every input row is preserved as a preview row, in input
  order, even when invalid, duplicate, ambiguous, or low confidence. Rows are never
  dropped, merged, reordered, or rewritten; ambiguity affects preview metadata only.
- **Roster authority.** Loaded roster records remain authoritative; the preview
  never touches existing rosters or prior seasons.
- `normalizedIdentityKey` reuses the Phase 2 `getPlayerIdentityKey` helper; no new
  name-normalization rules are introduced.
- Row-status contract: missing player name -> `invalid`; missing source row id ->
  `invalid` (no stable identity); duplicate source row id -> `needs-review`;
  duplicate normalized name within the import -> `needs-review`.
- `ok` is true only when the target context is valid, there are no error issues,
  and there are no invalid rows. Warnings / review items never remove rows.
- `summary` severity counts reflect row-level issues; preview-level issues (e.g.
  `invalid-target-context`) live in the top-level `issues` array and affect `ok`
  via `targetValid`.
- This slice is **contract only**: no file/CSV parsing, no identity collision
  resolution, no import commit/apply, no persistence, and no UI.

## Roster Import Preview Identity Match

A roster import preview identity match (Phase 5 slice 2) is a **pure, in-memory,
non-destructive** structure produced by
`createRosterImportPreviewIdentityMatches` (`src/engine/rosterImportPreviewIdentityMatch.ts`).
It pairs slice 1 preview rows with existing roster identity records supplied in the
input and records candidate matches for later collision review. It is candidate
metadata only — not a resolved match, not a decision, and not a commit.

```json
{
  "entries": [
    {
      "previewSourceRowId": "r1",
      "previewRowIndex": 0,
      "previewPlayerName": "Jordan Smith",
      "previewNormalizedIdentityKey": "jordan smith",
      "status": "single-candidate",
      "candidates": [
        {
          "previewSourceRowId": "r1",
          "previewRowIndex": 0,
          "existingRecordId": "alta-GI-A1-jordan-smith",
          "existingPlayerName": "Jordan Smith",
          "matchType": "exact-identity-key",
          "confidence": "high",
          "reasons": ["exact-normalized-name-match"]
        }
      ],
      "issues": []
    }
  ],
  "summary": {
    "totalEntries": 1,
    "noMatchEntries": 0,
    "singleCandidateEntries": 1,
    "multipleCandidateEntries": 0,
    "skippedInvalidEntries": 0,
    "skippedReviewEntries": 0,
    "readyForApplyEntries": 1,
    "needsReviewEntries": 0,
    "totalCandidates": 1
  },
  "issues": []
}
```

An existing roster identity record supplied as input carries:

```json
{
  "recordId": "alta-GI-A1-jordan-smith",
  "seasonId": "2026",
  "districtId": "alta",
  "ageDivisionId": "GI",
  "teamId": "2026-alta-GI-A1",
  "playerName": "Jordan Smith",
  "jerseyNumber": "7",
  "grade": "6",
  "raw": null
}
```

### Entry status values

```text
no-match
single-candidate
multiple-candidates
skipped-invalid-preview-row
skipped-review-preview-row
```

### Match type values

```text
exact-identity-key
same-name-duplicate-existing
same-name-duplicate-preview
jersey-assisted-exact-name
```

### Confidence values

```text
high
medium
low
none
```

### Reason / issue codes

```text
exact-normalized-name-match
matching-jersey-number
existing-duplicate-name
preview-duplicate-name
preview-row-invalid
preview-row-needs-review
no-existing-identity-match
invalid-existing-record
```

### Notes

- **Candidate generation only.** This structure is metadata for later collision
  review and a future apply workflow. It does not resolve collisions or apply
  imports.
- **Roster authority.** Matching never alters, removes, suppresses, merges,
  nullifies, rewrites, reorders, or ignores existing roster records or preview
  rows. Source objects are referenced, never mutated.
- Only `ready` preview rows are matched; `invalid` / `needs-review` rows are
  preserved as skipped entries. Entries follow preview row order; candidates follow
  existing-record input order.
- Matching reuses the Phase 2 `getPlayerIdentityKey` helper (exact normalized
  identity key). Jersey number can add a reason and raise confidence within an
  exact-name candidate group but never creates a match alone.
- Duplicate existing names and duplicate preview names produce review metadata, not
  discarded candidates/entries. An existing record with a missing/blank name is
  reported via a result-level `invalid-existing-record` issue and excluded from
  matching only (never throws).
- This slice is **engine only**: no collision resolution, no commit/apply, no
  prior-season comparison, no movement derivation, no persistence, and no UI.

## Roster Import Identity Review Decision

An import identity review decision (Phase 5 slice 3) is a **separate, append-only
record** that captures a reviewer's choice about a slice 2 match entry and the
future-apply instruction it implies. It is produced only from an **accepted**
review action result (`applyRosterImportIdentityReviewAction`) and is built by
`createRosterImportIdentityReviewDecision` (`src/engine/rosterImportIdentityReviewDecision.ts`).
It never rewrites roster records, preview rows, or existing roster records, and it
applies nothing on its own — a later apply step consumes it.

```json
{
  "decisionId": "import-2026-001-r1",
  "previewSourceRowId": "r1",
  "previewRowIndex": 0,
  "action": "accept-candidate",
  "effect": "link-to-existing",
  "selectedExistingRecordId": "alta-GI-A1-jordan-smith",
  "manualExistingRecordId": null,
  "reasonCodes": ["accept-candidate-confirmed"],
  "createdAt": "2026-06-13T00:00:00Z",
  "reviewedAt": "2026-06-13T00:00:00Z",
  "reviewedBy": "coach-1",
  "note": "Confirmed same player.",
  "audit": {
    "logicVersion": "phase5-slice3-import-identity-review-decision-v1",
    "sourceEntryStatus": "single-candidate",
    "supersedesDecisionId": "import-2026-001-r1-prev"
  }
}
```

### Action values

```text
accept-candidate
reject-candidates
manual-link
create-new
defer
```

### Effect values

```text
link-to-existing
create-new-roster-entry
reject-import-row
defer-review
no-effect
```

### Notes

- **Append-only.** A later decision may reference an earlier one via
  `audit.supersedesDecisionId`, but never edits or deletes the earlier decision.
- **Accepted-only.** Only an accepted review action result becomes a decision;
  rejected action results never persist.
- **Future-facing instruction.** `effect` describes what a future apply step *may*
  do. `reject-import-row` rejects the candidate interpretation for now — it never
  deletes the import row or any roster record. `create-new-roster-entry` does not
  create a roster entry in this slice.
- **Roster authority.** A decision never mutates roster rows, existing records,
  preview rows, or prior seasons.
- **Deterministic ids/timestamps.** `decisionId`, `createdAt`, and `reviewedAt` are
  caller-provided; the engine helpers never generate ids, read the wall clock, or
  infer user identity. `reviewedBy` is optional.
- **Coherence.** `action` and `effect` are paired (`accept-candidate` /
  `manual-link` -> `link-to-existing`, `reject-candidates` -> `reject-import-row`,
  `create-new` -> `create-new-roster-entry`, `defer` -> `defer-review`). A
  `link-to-existing` decision must carry a `selectedExistingRecordId` or
  `manualExistingRecordId`.
- This slice defines the **action + decision contract only** — no repository, no
  apply, no persistence, and no UI.

## Roster Import Identity Review Decision Repository

The local repository / storage-boundary payload for import identity review
decisions (Phase 5 slice 4). It is a plain, JSON-compatible envelope around an
append-only, ordered list of `Roster Import Identity Review Decision` records,
mirroring the `Cohort Review Decision Repository`.

```json
{
  "version": "roster-import-identity-review-decisions.v1",
  "decisions": [
    { "decisionId": "import-2026-001-r1", "action": "accept-candidate" }
  ]
}
```

### Notes

- `version` is an explicit schema tag (`roster-import-identity-review-decisions.v1`).
  Import rejects any unsupported version.
- `decisions` preserves append order. The repository is **append-only**: superseded
  decisions stay in the list (excluded only from the active view via
  `audit.supersedesDecisionId`); decisions are never overwritten or deleted.
- Append/import validate every decision and reject invalid (`invalid-decision`) and
  duplicate (`duplicate-decision-id`) records; import additionally guards the
  envelope (`invalid-repository-payload`, `unsupported-repository-version`,
  `missing-decision-list`) and performs a partial import (`ok` is false if anything
  was rejected).
- This is an **in-memory repository model and export/import contract only** — there
  is no browser-storage (localStorage / IndexedDB / file) write yet, and no UI.
  Repository operations never mutate roster records, preview rows, existing records,
  or the decision objects.

## Applied Roster Import Identity Review Decision

The effective, in-memory resolution of slice 2 match entries against active slice 3
decisions (Phase 5 slice 5), produced by
`applyRosterImportIdentityReviewDecisionsToMatches`
(`src/engine/rosterImportIdentityReviewDecisionApplication.ts`). It is **derived
state only** — not a persisted record, not a commit, and not a roster write. Each
effective outcome is a future-apply instruction.

```json
{
  "entries": [
    {
      "previewSourceRowId": "r1",
      "previewRowIndex": 0,
      "previewPlayerName": "Jordan Smith",
      "sourceEntryStatus": "single-candidate",
      "effectiveOutcome": "link-to-existing",
      "effectiveConfidence": "high",
      "appliedDecisionId": "import-2026-001-r1",
      "selectedExistingRecordId": "alta-GI-A1-jordan-smith",
      "manualExistingRecordId": null,
      "reasons": ["accept-candidate-applied"],
      "issues": []
    }
  ],
  "ignoredDecisions": [
    { "decisionId": "import-2026-001-r9", "reason": "no-matching-entry" }
  ],
  "summary": { "totalEntries": 1, "linkToExisting": 1, "decisionsApplied": 1 }
}
```

### Effective outcome values

```text
unresolved
link-to-existing
create-new
rejected
deferred
skipped-invalid-preview-row
skipped-review-preview-row
conflict
```

### Effective confidence values

```text
high
medium
low
none
```

### Ignored decision reason values

```text
invalid-decision
superseded-decision
missing-preview-row-key
no-matching-entry
duplicate-current-decision
decision-entry-status-mismatch
selected-candidate-not-found
```

### Notes

- **Derived state only.** Outcomes never mutate roster records, preview rows,
  existing records, candidates, decisions, or sample data; source entries and
  decisions are referenced, never modified. The `originalEntry` is the slice 2 entry
  by reference.
- **Match key.** Decisions match an entry on `previewSourceRowId` +
  `previewRowIndex`. Entry order is the input entry order; ignored decisions follow
  decision input order.
- **No auto-link.** With no applicable decision, a matchable entry is `unresolved`
  even for a high-confidence single candidate. Skipped entries always resolve to
  their skip outcome and accept no decisions.
- **Conflict.** Two or more current (valid, non-superseded) decisions for one entry
  yield `conflict` with none applied — surfaced for review.
- **Future-facing.** `link-to-existing` / `create-new` / `rejected` / `deferred` are
  instructions for a later apply step; reject does not delete the row and create-new
  does not write a roster entry here.

## Roster Import Commit Preview Plan

The dry-run import commit plan (Phase 5 slice 6), produced by
`createRosterImportCommitPreviewPlan`
(`src/engine/rosterImportCommitPreviewPlan.ts`) from slice 5 applied entries. It is
**derived planning state only** — it describes what a future commit would do and
what blocks it, and performs nothing.

```json
{
  "canCommit": false,
  "targetContext": {
    "seasonId": "2026",
    "districtId": "alta",
    "ageDivisionId": "GI",
    "teamId": "2026-alta-GI-A1"
  },
  "targetContextProvided": true,
  "targetContextValid": true,
  "rows": [
    {
      "previewSourceRowId": "r1",
      "previewRowIndex": 0,
      "previewPlayerName": "Jordan Smith",
      "sourceEntryStatus": "single-candidate",
      "effectiveOutcome": "link-to-existing",
      "planStatus": "ready-to-link",
      "plannedOperation": "link-existing-record",
      "targetExistingRecordId": "alta-GI-A1-jordan-smith",
      "reasons": ["accepted-candidate-link"],
      "blockers": []
    }
  ],
  "blockers": [],
  "summary": { "totalRows": 1, "readyToLinkRows": 1, "canCommit": true }
}
```

### Plan status values

```text
ready-to-link
ready-to-create
rejected
deferred
blocked-unresolved
blocked-conflict
blocked-invalid-preview-row
blocked-review-preview-row
```

### Planned operation values

```text
link-existing-record
create-new-roster-entry
reject-import-row
defer-review
none
```

### Blocker codes

```text
unresolved-identity
conflicting-decisions
invalid-preview-row
preview-row-needs-review
missing-target-existing-record-id
invalid-target-context
```

### Notes

- **Dry-run only.** The plan never mutates roster records, preview rows, existing
  records, applied entries, or candidates; each row keeps its source applied entry by
  reference (`originalAppliedEntry`). `ready-to-link` / `ready-to-create` are future
  operations, not writes.
- **Commit gating.** Top-level `canCommit` is true only when there is at least one
  row, no row is `blocked-*`, and any provided target context is complete. Rejected
  and deferred rows do not block. An empty plan is `canCommit: false`.
- **Target context.** Validated only when provided; an incomplete provided context
  adds a result-level `invalid-target-context` blocker and makes `canCommit` false
  without mutating rows. `summary.canCommit` is row-level readiness (ignores target
  context); the top-level `canCommit` is authoritative.
- **No auto-link.** Unresolved identities — including high-confidence single
  candidates — block; they are never auto-linked.

### Phase 5 checkpoint: import pipeline layers

Phase 5 slices 1–6 are checkpointed (see `docs/derived-logic.md`, "Phase 5
checkpoint: import preview and identity collision pipeline (Phase 5 slice 7)"). The
import preview and identity collision pipeline keeps these layers strictly distinct,
and the data model must not collapse them:

1. **Loaded authoritative roster data** — `Player`, `Player Season Assignment`,
   `Team`, and the existing roster identity records supplied to matching. Loaded and
   authoritative. Never altered, removed, suppressed, merged, nullified, reordered,
   or ignored by any import logic.
2. **Roster Import Preview rows** — staged candidate rows
   (`createRosterImportPreview`). Non-destructive staging; not roster records.
3. **Roster Import Preview Identity Match entries** — per-row candidate metadata
   against existing records (`createRosterImportPreviewIdentityMatches`). Candidate
   generation only; not a resolution or a decision.
4. **Review actions** — a validated reviewer intent against one match entry
   (`applyRosterImportIdentityReviewAction`). Not yet a stored decision.
5. **Roster Import Identity Review Decision** — the separate, append-only records
   built only from an accepted action. They influence derived effective outcomes in
   memory but never rewrite roster data, preview rows, or match entries.
6. **Roster Import Identity Review Decision Repository** — the local
   storage-boundary envelope (`{ version, decisions }`). In-memory model and JSON
   export/import contract only; no browser-storage write yet.
7. **Applied Roster Import Identity Review Decision** — the in-memory per-row
   effective outcome (`applyRosterImportIdentityReviewDecisionsToMatches`). Derived
   state, not a roster write.
8. **Roster Import Commit Preview Plan** — the dry-run per-row planned operation,
   blockers, and the top-level `canCommit` gate
   (`createRosterImportCommitPreviewPlan`). A plan, not a commit.

Through Phase 5 so far there is no file parsing, no file upload, no browser
persistence (`localStorage` / `IndexedDB` / file), no UI, no sample-data mutation, no
roster mutation, and no import apply / commit. Invalid, duplicate, skipped, rejected,
and deferred import rows are always preserved as rows. A future slice may add a pure
in-memory import application / projection from a committable plan; even then it must
not persist, mutate sample data, parse files, or wire UI unless explicitly approved.

## Roster Import Application Projection

The in-memory import application projection (Phase 5 slice 8), produced by
`createRosterImportApplicationProjection`
(`src/engine/rosterImportApplicationProjection.ts`) from a **committable** slice 6
commit preview plan plus existing roster records. It is **derived projection state
only** — it describes the roster links / additions a future apply *would* produce and
performs nothing. It does not persist, mutate sample data, mutate rosters, link
records, create persisted entries, parse files, or wire UI.

```json
{
  "ok": true,
  "planCommittable": true,
  "targetContext": {
    "seasonId": "2026",
    "districtId": "alta",
    "ageDivisionId": "GI",
    "teamId": "2026-alta-GI-A1"
  },
  "rows": [
    {
      "previewSourceRowId": "r1",
      "previewRowIndex": 0,
      "previewPlayerName": "Jordan Smith",
      "planStatus": "ready-to-link",
      "plannedOperation": "link-existing-record",
      "projectionStatus": "projected-link",
      "projectedOperation": "link-existing-record",
      "targetExistingRecordId": "alta-GI-A1-jordan-smith",
      "reasons": ["linked-to-existing-record"],
      "blockers": []
    },
    {
      "previewSourceRowId": "r2",
      "previewRowIndex": 1,
      "previewPlayerName": "Sam Lee",
      "planStatus": "ready-to-create",
      "plannedOperation": "create-new-roster-entry",
      "projectionStatus": "projected-create",
      "projectedOperation": "create-new-roster-entry",
      "projectedNewRecord": {
        "provisionalRecordId": "projected:2026:alta:GI:2026-alta-GI-A1:r2:1",
        "seasonId": "2026",
        "districtId": "alta",
        "ageDivisionId": "GI",
        "teamId": "2026-alta-GI-A1",
        "playerName": "Sam Lee",
        "sourceRowId": "r2",
        "sourceRowIndex": 1,
        "source": {
          "logicVersion": "phase5-slice8-import-application-projection-v1",
          "planStatus": "ready-to-create",
          "provisional": true
        }
      },
      "reasons": ["projected-new-roster-entry"],
      "blockers": []
    }
  ],
  "blockers": [],
  "summary": { "totalRows": 2, "projectedLinkRows": 1, "projectedCreateRows": 1, "ok": true }
}
```

### Projection status values

```text
projected-link
projected-create
projected-reject
projected-defer
blocked
skipped
```

### Projected operation values

```text
link-existing-record
create-new-roster-entry
reject-import-row
defer-review
none
```

### Blocker codes

```text
plan-not-committable
missing-existing-record
duplicate-existing-record-id
blocked-plan-row
invalid-plan-row
missing-target-context
missing-preview-row-key
missing-player-name-for-create
```

### Reason codes

```text
linked-to-existing-record
projected-new-roster-entry
reviewer-rejected
reviewer-deferred
blocked-by-plan
skipped-non-committed-row
```

### Notes

- **Projection only.** It never mutates the plan, plan rows, original applied
  entries, or existing roster records; each projection row keeps its source plan row
  by reference (`originalPlanRow`). `projected-link` / `projected-create` are future
  operations, not writes.
- **Committable plans only.** A non-committable plan yields `ok: false`, a
  result-level `plan-not-committable` blocker, and no projected rows. A defensively
  present `blocked-*` plan row is projected as `blocked` and forces `ok: false`.
- **Projected links never modify the existing record** — they only reference its
  `recordId` after resolving exactly one match (missing / duplicate ids block the
  affected row).
- **`ProjectedNewRosterRecord` is provisional and not persisted.** Its
  `provisionalRecordId` is derived deterministically from the target context +
  `previewSourceRowId` + `previewRowIndex`; no final/canonical id is generated.
  Jersey number / grade are optional and intentionally omitted until a later parser /
  import-map slice can enrich them.
- **Rejected / deferred rows are preserved** (`projected-reject` / `projected-defer`
  by default; `skipped` when `allowRejectedRows` / `allowDeferredRows` is false);
  nothing is deleted.
- **`summary.ok` is row-level** (no blocked rows, no row blockers); the result's
  top-level `ok` is authoritative and additionally requires plan committability and
  no result-level blockers.

## Roster Import Text Parse

The text / CSV-like parse result (Phase 5 slice 9), produced by
`parseRosterImportText` (`src/engine/rosterImportTextParser.ts`) from pasted roster
text plus a target context. It is **staging input only** — it converts text into
slice 1 `RosterImportPreviewRowInput` rows; `createRosterImportPreviewFromText` then
hands those rows to `createRosterImportPreview`. It does not parse files, upload, the
browser File API, persist, mutate rosters, or apply imports.

```json
{
  "ok": true,
  "targetContext": {
    "seasonId": "2026",
    "districtId": "alta",
    "ageDivisionId": "GI",
    "teamId": "2026-alta-GI-A1"
  },
  "delimiter": ",",
  "rows": [
    {
      "sourceRowId": "line-2",
      "sourceLineNumber": 2,
      "rawLine": "12,Cary Hudson,5",
      "cells": ["12", "Cary Hudson", "5"],
      "playerName": "Cary Hudson",
      "jerseyNumber": "12",
      "grade": "5",
      "notes": null,
      "issues": []
    }
  ],
  "issues": [{ "code": "header-detected", "severity": "info", "message": "..." }],
  "summary": {
    "totalLines": 2,
    "dataRows": 1,
    "skippedEmptyLines": 0,
    "headerDetected": true,
    "withPlayerName": 1,
    "missingPlayerName": 0,
    "withJerseyNumber": 1,
    "withGrade": 1,
    "withNotes": 0,
    "inconsistentColumnRows": 0,
    "errorCount": 0,
    "warningCount": 0,
    "infoCount": 1
  }
}
```

### Issue severity values

```text
info
warning
error
```

### Issue codes

```text
empty-input
empty-line-skipped
header-detected
missing-player-name-column
missing-player-name
inconsistent-column-count
unsupported-delimiter
invalid-target-context
quoted-csv-not-supported
duplicate-source-row-id
```

### Supported delimiters

```text
,  (comma)
\t (tab)
|  (pipe)
```

### Header aliases (lowercased)

```text
playerName:   name, player, player name, athlete
jerseyNumber: jersey, jersey #, number, no, #
grade:        grade
notes:        note, notes
```

### Notes

- **Parse-to-preview only.** The parser converts text into slice 1 preview input
  rows; it reuses (does not replace) `createRosterImportPreview`. Parser issues and
  preview issues stay distinguishable (`createRosterImportPreviewFromText` returns
  `{ parse, preview }`).
- **Every non-empty source line is preserved** as a parse row in source order, even
  when incomplete; a missing player name is flagged and flows into the preview's own
  validation. Blank lines are skipped but counted in `summary.skippedEmptyLines`.
- **`sourceRowId` is deterministic** (`line-<n>` from the 1-based source line number)
  and `sourceLineNumber` is preserved; no random ids and no `Date.now()`.
- **Unsupported delimiter / quoted CSV** are reported, never guessed: a quote
  character flags `quoted-csv-not-supported` and the line is parsed literally; full
  RFC CSV quoting, Excel files, and browser file upload are out of scope.
- **Comma-in-name protection (auto mode).** A single comma between two non-numeric
  text cells is preserved as the player name (not split), protecting the real-world
  "Last, First" `player_name` shape (e.g. `Cary, Hudson`). A comma still splits when
  the row is clearly tabular (recognized header, 3+ comma cells, or a 2-cell row where
  either cell looks like a jersey number); an explicit `delimiter: ','` or a header
  always forces comma columns.
- **Target context** is validated independently and reported as
  `invalid-target-context` before preview creation, then passed through exactly.
  `parseRosterImportText`'s `ok` reflects structural success (no parser-level error);
  per-row validity is owned by the preview. Inputs are never mutated.

## Ute Conference Scraped JSON Source

The harvested Ute Conference website-scrape JSON (Phase 5 slice 10) is an **external
source shape**, read by the adapter `src/engine/uteConferenceScrapedJsonAdapter.ts`.
It is **not** an internal record and is never persisted; the adapter converts a
selected team into the existing `Roster Import Preview` input (players) or a separate
coach preview shape (coaches).

```json
{
  "metadata": {
    "organization": "Ute Conference",
    "event": "Fall",
    "age_division": "GridIron League 12",
    "age_division_alias": "GI",
    "year": 2025,
    "record_type": "players",
    "total_districts": 2,
    "districts_with_league": 2,
    "districts_without_league": 0,
    "total_teams": 3,
    "total_players": 5,
    "scraped_at": "2025-09-01T00:00:00Z",
    "source_url": "https://ute.example/players"
  },
  "districts": [
    {
      "district": "Alta",
      "league": "GI League 12",
      "teams_count": 2,
      "teams": [
        {
          "team_name": "GridIron A3",
          "source_url": "https://ute.example/alta/a3",
          "players_count": 3,
          "players": [{ "name": "Cary, Hudson" }]
        }
      ]
    }
  ]
}
```

Coach files use `record_type: "coaches"`, and each team carries `coaches_count` and
`coaches[] { name, title }` instead of `players_count` / `players[]`.

### Record type values

```text
players
coaches
unknown
```

### Adapter issue codes

```text
invalid-payload
missing-metadata
unsupported-record-type
missing-districts
missing-team-name
missing-player-name
missing-coach-name
missing-coach-title
count-mismatch
empty-league
invalid-target
target-not-found
```

### Notes

- **Source adapter only.** The payload is read, never mutated; no roster records are
  created or mutated, nothing is persisted, and there is no apply/write function.
- **Team targets** are listed in source order with a deterministic `sourceTargetId`
  (`scraped:<year>:<ageSlug>:<districtIndex>:<teamIndex>`); player/coach source rows
  add `:player:<i>` / `:coach:<i>`.
- **Exact preservation.** Player names, coach names, coach titles, and source URLs are
  preserved exactly (commas, extra spaces, non-breaking spaces intact); coaches are
  never de-duplicated; player and coach rows are kept separate.
- **Provisional target context.** When a caller supplies no explicit ids, the adapter
  derives provisional slug-based ids (`targetContextProvisional: true`); these are not
  canonical roster ids.
- **Empty league snapshots** are valid source data (`ok: true` + `empty-league`).
- **Count mismatches** (declared `*_count` / `total_*` vs actual) are non-destructive
  `count-mismatch` warnings; rows are preserved. Missing names/titles preserve the row
  with a `missing-*` issue.

## Ute Scraped Canonical Context Mapping

The canonical context mapping (Phase 5 slice 11) is a **derived mapping result**,
produced by `src/engine/uteConferenceScrapedCanonicalMapping.ts` from a scraped
payload + team target. It converts scraped source labels into canonical (or
provisional) import context values. It is not a persisted record and never mutates the
source; raw values are preserved on every mapping result.

```json
{
  "ok": true,
  "season": { "rawValue": "2025", "canonicalValue": "2025", "seasonLabel": "Fall", "confidence": "high", "source": "metadata-year" },
  "ageDivision": { "rawValue": "GridIron League 12", "canonicalValue": "GI", "confidence": "high", "source": "metadata-age-division" },
  "district": { "rawValue": "Alta", "canonicalValue": "alta", "confidence": "provisional", "source": "district-name" },
  "teamClassification": { "rawValue": "GridIron A3", "canonicalValue": "A3", "hierarchyCode": "A", "confidence": "high", "source": "team-name" },
  "canonicalContext": {
    "seasonId": "2025",
    "districtId": "alta",
    "ageDivisionId": "GI",
    "teamId": "2025-alta-gi-a3",
    "teamClassification": "A3"
  },
  "contextConfidence": "provisional",
  "issues": []
}
```

### Canonical age divisions

```text
SC  GR  PW  MM  GI  BA
```

### Mapping confidence values

```text
high          (direct, explicit source mapping or caller override)
provisional   (inferred prefix / slug-derived id, or a label/alias conflict)
unknown       (no safe mapping)
```

### Mapping source values

```text
metadata-age-division
metadata-age-division-alias
district-name
team-name
metadata-year
caller-override
```

### Mapping issue codes

```text
missing-age-division
unsupported-age-division
conflicting-age-division-labels
missing-team-name
unsupported-team-classification
color-team-classification-unknown
missing-district
district-mapping-provisional
missing-season-year
invalid-season-year
target-not-found
invalid-target
caller-override-used
```

### Notes

- **Deterministic mapping only.** Known scraped age-division labels map to canonical
  ids; team classifications are extracted only from explicit coded team-name tokens
  (validated via `parseTeamClassification`). No broad fuzzy matching and no invented
  color-to-classification mapping — color team names stay `unknown` / review-needed.
- **Raw preserved.** District/team/source values are preserved exactly; districts are
  never collapsed (`Bingham` vs `Bingham Girls`).
- **Provisional ids.** Without a canonical district registry, district/team ids are
  provisional slugs; `contextConfidence` reflects the weakest contributing mapping.
- **Caller overrides** replace derived canonical values, are recorded as
  `caller-override` with a `caller-override-used` issue, and never rewrite raw source.
- **Composition.** `createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext`
  feeds the derived context into the slice 10 player adapter and returns the mapping +
  preview input + preview result; player names are preserved exactly.

## Ute Scraped JSON Readiness Report

The full-file readiness report (Phase 5 slice 12) is a **derived reporting result**,
produced by `createUteConferenceScrapedJsonReadinessReport`
(`src/engine/uteConferenceScrapedJsonReadinessReport.ts`) over one scraped Ute
Conference payload. It composes the slice 10 adapter and slice 11 mapping to classify
every team target. It is not a persisted record and never mutates the source.

```json
{
  "ok": true,
  "recordType": "players",
  "sourceSummary": { "recordType": "players", "ok": true, "totalTeams": 4, "totalRows": 5 },
  "issues": [],
  "targets": [
    {
      "sourceTargetId": "scraped:2025:gridiron-league-12:0:0",
      "recordType": "players",
      "year": "2025",
      "event": "Fall",
      "ageDivisionLabel": "GridIron League 12",
      "ageDivisionAlias": "GI",
      "canonicalAgeDivisionId": "GI",
      "districtName": "Alta",
      "canonicalDistrictId": "alta",
      "teamName": "GridIron A3",
      "teamClassification": "A3",
      "classificationHierarchyCode": "A",
      "teamSourceUrl": "https://ute.example/alta/a3",
      "rowCount": 2,
      "readinessStatus": "ready-with-warnings",
      "readinessReasons": ["valid-player-preview", "provisional-district"],
      "issues": [{ "code": "district-mapping-provisional", "severity": "info", "origin": "mapping", "message": "..." }],
      "contextConfidence": "provisional",
      "targetContextProvisional": true,
      "previewSummary": { "totalRows": 2, "readyRows": 2, "invalidRows": 0 },
      "coachPreviewSummary": null
    }
  ],
  "summary": {
    "recordType": "players",
    "totalTargets": 4,
    "readyTargets": 0,
    "readyWithWarningsTargets": 2,
    "needsReviewTargets": 0,
    "blockedTargets": 1,
    "emptyTargets": 1,
    "totalRows": 5,
    "playerRows": 5,
    "coachRows": 0,
    "canProceedToTeamSelection": true,
    "canProceedWithoutReview": false
  }
}
```

### Readiness status values

```text
ready
ready-with-warnings
needs-review
blocked
empty
```

### Readiness reason codes

```text
valid-player-preview
valid-coach-preview
empty-team
empty-league
provisional-district
provisional-age-division
unknown-team-classification
color-team-classification-unknown
missing-player-name
missing-coach-name
missing-coach-title
invalid-target-context
target-not-found
count-mismatch
unsupported-record-type
invalid-payload
```

### Notes

- **Composition only.** The report composes the slice 10 adapter and slice 11 mapping;
  it replaces/duplicates neither and writes nothing.
- **Empty is valid.** Empty teams are `empty` (not `blocked`); empty-league /
  empty-team snapshots leave `ok: true`.
- **Rows preserved.** Missing names/titles and count mismatches preserve rows;
  `strictCounts: true` elevates a count mismatch to `needs-review` without dropping
  rows. Coaches are never de-duplicated.
- **Per-target issues** are origin-tagged (`source` / `mapping` / `preview` / `coach`)
  with the underlying adapter/mapping code; the summary tallies them by severity and
  code.
- **Gates.** `canProceedToTeamSelection` requires a valid source and at least one
  ready / ready-with-warnings / needs-review target; `canProceedWithoutReview`
  additionally requires at least one ready target and no blocked/needs-review targets.
- **Caller overrides** (per `sourceTargetId`) flow through to the slice 11 mapping and
  can raise a provisional target to `ready`. The payload is never mutated.

## Game / Schedule model (Phase 6 slice 24)

Phase 6 begins schedule/results. A `Game` (`src/domain/types.ts`) is a scheduled or
completed game between two EXISTING teams:

```text
gameId: string
seasonId: string
ageDivisionId?: string            (optional; for filtering/display)
weekLabel: string
scheduledDate: string | null      (ISO date, e.g. "2026-08-22", or null)
homeTeamId: string                (references Team.teamId)
awayTeamId: string                (references Team.teamId)
location?: string
status: "scheduled" | "final" | "cancelled" | "postponed"
homeScore?: number                (required in practice only for final games)
awayScore?: number
notes?: string
isNeutralSite?: boolean           (slice 26; absent = non-neutral)
isPlayoff?: boolean               (slice 26; absent = regular)
isChampionship?: boolean          (slice 26; also playoff context for summaries)
```

Slice 26 adds game context. A derived `GameType` (`regular` / `playoff` / `championship`)
comes from these flags (`deriveGameType`): championship implies playoff context. Defaults:
regular + non-neutral when flags are absent. Existing slice-24/25 games without these fields
remain valid. Neutral-site games never create a venue/opponent entity.

Rules:

- **Opponents are not separate objects.** `homeTeamId` / `awayTeamId` reference existing
  `Team.teamId` values. An unresolvable reference is reported, never invented.
- **Schedules/results are separate from roster imports** and never mutate rosters or infer
  player movement.
- Only `final` games with usable scores count toward a team's record; `scheduled` /
  `postponed` are upcoming; `cancelled` is excluded from the record.
- The read-only team schedule summary (`src/engine/teamScheduleSummary.ts`) derives W-L-T,
  points for/against/differential, next game, last result, and per-game opponent-resolved
  views, sorted by scheduledDate, then weekLabel, then gameId. Slice 26 adds record splits
  (`overallRecord` / `regularSeasonRecord` / `playoffRecord` / `championshipRecord`):
  only final games count; championship games count in both championship and playoff records;
  regular excludes both.
- **Standings** (`src/engine/standingsSummary.ts`, `buildStandings`) derive per-team
  records for a selected season + age division from final games only, ranked by win
  percentage, then wins, point differential, points for, display name, and teamId. Opponents
  resolve only through existing teams; unresolved final references are flagged
  (`unresolvedGameReferenceCount`), never invented. Classification grouping is by team code
  shown per row (no separate classification model).
- `AppData` gains `games: Game[]`. Sample games live in `data-samples/games.sample.json`
  (game-centric); the older `data-samples/schedule-import.sample.json` is a separate,
  preserved team-centric import-row contract and is unchanged.
- Prior seasons remain locked from roster/import mutation; historical schedules/results may
  still be displayed.

### Schedule import + in-memory result updates (Phase 6 slice 25)

Slice 25 makes schedule/results editable in memory (separate from roster import):

- **Schedule import adapter** (`src/engine/scheduleImportAdapter.ts`) maps the preserved
  team-centric `schedule-import.sample.json` rows (`teamId` / `opponentTeamId` / `homeAway`
  / team-relative scores) into `Game` records, resolving home/away through existing
  `Team.teamId` references only (`neutral` → listed team is home by convention). Row errors
  use stable codes (`invalid-row-shape`, `missing-season`, `invalid-home-away`,
  `unresolved-home-team` / `unresolved-away-team`, `invalid-status`, `invalid-scores`,
  `invalid-final-scores`).
- **Preview** (`src/engine/scheduleImportPreview.ts`) classifies rows add / update / skip /
  error. Update matching prefers `gameId`, else the deterministic natural key
  (`seasonId + scheduledDate + homeTeamId + awayTeamId`) when it matches exactly one
  existing game; ambiguous or duplicate matches block execution (never silent overwrite).
- **Execution / undo** (`src/engine/scheduleImportExecution.ts`) apply an executable preview
  into a new games array and reverse it; in-memory only (`durable:false` / `persisted:false`).
- **Result update** (`src/engine/gameResultUpdate.ts`) applies a validated status/score/notes
  patch to one game (final requires numeric scores). Result/status editing only — not full
  schedule construction.

All of this is in-memory only and never mutates rosters; imported games and result edits are
preserved through workspace snapshot export/import (games are snapshot-aware since slice 24).
No browser/cloud/database persistence exists.

## Coach / staff model (Phase 7 slice 27)

Phase 7 begins coach/staff intelligence. Coaches are tracked **separately from player
rosters** and never mutate rosters, games, or schedules. The roster-embedded `Coach`
(`{ name }`) stays as-is on `Team`; these are the normalized, season-spanning records added
to `AppData` (`coaches`, `coachAssignments`):

```text
StaffCoach: { coachId, displayName, identityKey, sourceName?, notes? }
TeamCoachAssignment: { assignmentId, seasonId, teamId, coachId,
                       role: "headCoach" | "assistantCoach" | "unknown",
                       sourceLabel?, sourceRowId?, notes? }
```

- **Coach identity is name-based and deterministic** (`coachModel.ts` reuses the existing
  exact-identity name normalization; `coachId = "coach:" + identityKey`). The same name maps
  to one coach across seasons/teams. Ambiguity (two distinct coachIds sharing one identity
  key) is **surfaced for review, never silently merged**.
- The sample coach model is derived from the roster-embedded coach fields
  (`deriveCoachesAndAssignmentsFromTeams`), so e.g. a head coach who returns the next season
  is one coach with two assignments. Raw names are preserved as `sourceName`.
- Pure helpers (`coachHistorySummary.ts`): `summarizeTeamCoachStaff` (by role + prior-season
  returning/new/departed continuity), `summarizeCoachHistory` (assignments across
  seasons/teams), `buildCoachDirectory`, and `validateCoachAssignments` (unresolved
  coach/team references reported, never invented).
- Coach import (`coachImportAdapter` / `coachImportPreview` / `coachImportExecution`) maps a
  row-per-assignment contract (`importType: "coach"`; `coachName` + `teamId` + `role`),
  resolving teams by `teamId`. It is in-memory only with explicit execute/undo.
- Workspace snapshots carry `coaches` / `coachAssignments` (optional for backward
  compatibility; assignments must reference existing coaches + teams or restore is rejected).
  Coach data is preserved only through workspace snapshot export/import; no
  browser/cloud/database persistence exists.

## Coach performance analytics (Phase 7 slice 28)

Slice 28 adds **derived coach performance analytics**: it connects coach assignments to game
results so the app can report how coaches performed across their assigned teams, seasons,
roles, and playoff/championship contexts. Analytics are **read-only and deterministic**, and
are derived at runtime from existing source data — they are not a new persisted shape.

Pure helpers (`src/engine/coachPerformanceSummary.ts`):

- `summarizeCoachPerformance` — one coach's overall / regular / playoff / championship records,
  points for/against/differential, win percentage, role-split records (head / assistant /
  unknown), latest assignment, plus unresolved assignment/game counts.
- `summarizeCoachPerformanceDirectory` — one row per coach, ordered by display name then
  coachId (directory/dashboard).
- `summarizeTeamCoachPerformance` — for a selected team, each assigned coach's **with-this-team**
  record (this team's final games, with regular/playoff/championship splits) alongside their
  **career / all-assignment** record.
- `summarizeCoachRolePerformance` and `validateCoachPerformanceReferences` (unresolved
  coach-assignment and game references, surfaced for display).

Derivation rules:

- **Coach performance is derived from coach assignments plus FINAL games** for each assigned
  team. A coach is credited with the final games of every team they are assigned to.
- Scheduled, postponed, and cancelled games **do not count** toward records.
- Championship games count toward **both** the championship record and the playoff-context
  record; the regular-season record excludes playoff/championship games.
- If multiple coaches are assigned to one team, each is credited with that team's games.
- Duplicate same-team assignments and multiple roles on the same team/season **do not
  double-count** the overall record; role-specific records still reflect each role bucket.
- Records accumulate across seasons (career / all-assignment record).
- Coach analytics **do not mutate** rosters, games, or coach assignments. Coach/team names are
  preserved exactly; unresolved references are surfaced, never invented.
- Workspace snapshots preserve the source data (coaches, assignments, games); performance
  analytics are recomputed at runtime after restore. No backend/browser/cloud persistence
  exists.

## Portable Workspace Snapshot (Phase 5 slice 23)

The portable workspace snapshot (`src/engine/workspaceSnapshot.ts`) is a versioned,
JSON-serializable capture of the current local workspace that the user can explicitly
export to a file and later import to restore. It is distinct from the import preview
artifact (which documents an import workflow); a workspace snapshot restores the whole app
workspace.

Shape (schemaVersion 1):

```text
appName: "uc-roster-sniffer"
snapshotKind: "workspace"
schemaVersion: 1
generatedAt: ISO string (caller-supplied)
source: "user-exported-json"
note: explanatory string
selection: { seasonId, districtId, ageDivisionId, teamId } (each string | null)
workspace: { districts: District[], ageDivisions: AgeDivision[], teams: Team[], games: Game[] }
summary: { schemaVersion, generatedAt, seasonCount, districtCount,
           ageDivisionCount, teamCount, playerCount, gameCount }
```

- The snapshot reuses the existing `District` / `AgeDivision` / `Team` / `Player` / `Coach`
  / `Game` domain shapes (no competing model). `workspace.teams` is the CURRENT in-memory
  roster, including any slice-22 executed additions; `workspace.games` is the schedule
  (Phase 6 slice 24).
- `workspace.games` is OPTIONAL on input: slice-23 snapshots that predate games still import
  and restore with an empty schedule (schemaVersion stays 1 — optional extension, no
  migration). Exported snapshots always include `games` and `summary.gameCount`.
- Validation rejects with stable reason codes (`invalid-json`, `not-an-object`,
  `missing-schema-version`, `unsupported-schema-version`, `wrong-snapshot-kind`,
  `invalid-workspace` / `invalid-districts` / `invalid-age-divisions` / `invalid-teams`,
  `invalid-games`, `unresolved-game-reference`, `empty-workspace`) and preserves valid data
  exactly. A game referencing a team not in the snapshot is rejected (opponents must be
  existing teams).
- Restore REPLACES the workspace (never merges) and resolves the active selection (the
  snapshot's team if it still exists, else the most recent season).
- This is explicit user-controlled **file** durability only — not automatic persistence, and
  not `localStorage` / `IndexedDB` / backend / cloud. See `docs/import-workflow.md`
  ("Portable workspace snapshot export / import (Phase 5 slice 23)").

> **Completion Milestone A1 (landed 2026-06-27):** automatic browser persistence was
> subsequently approved and added on top of this same snapshot contract (see the persisted
> record below). The "not automatic persistence / not IndexedDB" note above describes the
> historical slice-23 status; the portable file export/import itself is unchanged.

## Persisted Workspace Record (IndexedDB) — Completion Milestone A1

The automatic local-persistence wrapper (`src/storage/workspaceIndexedDbStore.ts`) stores
exactly one active workspace record in IndexedDB. It reuses the Portable Workspace Snapshot
above as its payload — it does NOT define a second workspace format.

IndexedDB layout:

```text
database:     uc-roster-sniffer   (version 1)
object store: workspace           (keyPath "id")
record key:   "active-workspace"  (single active record)
```

Record shape (`PersistedWorkspaceRecord`):

```text
id:                 "active-workspace"
persistenceVersion: 1                 (envelope version, independent of snapshot schemaVersion)
savedAt:            ISO string
snapshot:           WorkspaceSnapshot  (the portable snapshot above)
```

- The app auto-saves (debounced) after workspace-data changes and auto-loads on startup,
  validating the stored `snapshot` through the existing snapshot validator and restoring via
  `restoreWorkspaceFromSnapshot`.
- An empty store keeps the default startup workspace. A malformed record, an unsupported
  `persistenceVersion`, or a snapshot that fails validation resolves to a calm error state
  (visible warning, no crash); the stored record is never auto-deleted.
- Storage is isolated from `src/engine` pure logic. No `localStorage`, backend, auth, cloud
  database, or sync. See `docs/completion-plan.md` (Workstream A) and `docs/ui-workflow.md`
  ("Automatic save-state indicator").

## Sample data fixtures

Local sample data under `data-samples/` exists to prove the data contract and to exercise derived behavior during development.

### Notes

- Sample data may include multiple seasons.
- Multi-season sample data is used to exercise prior-season comparison behavior.
- The current fixture intentionally includes a same-slot team that appears in both 2025 and 2026 — same district, age division, and team code — so the selected-team roster-status summary can render an available state for visual testing.
- Each roster import sample file represents a single season, matching the existing roster import contract.
- Sample fixtures should remain small, deliberate, and contract-preserving. They should not silently reshape the sample contract to make code easier.

### Scraped JSON fixture contracts (Phase 5 slice 13)

Separate from the app sample data above, small hand-curated **scraped JSON test
fixtures** live under `src/test/fixtures/ute-scraped-json/`. They are minimized
examples of the harvested Ute Conference source shape — players, coaches,
empty-league snapshots, a comma player name (`Cary, Hudson`), an extra-space name
(`Moyer , Knox`), a non-breaking-space coach name, `Head Coach` / `Asst Coach` titles,
a coded classification team (`Gremlin A2`), and a color/non-coded team
(`Scout White`). They exist only to anchor the slice 10–12 scraped JSON pipeline to
real source shapes via contract tests
(`src/test/uteConferenceScrapedJsonFixtureContracts.test.ts`).

- **Test contracts only.** These fixtures are not loaded by the app and create no
  app-visible sample data; they are consumed exclusively by tests.
- **Real shape, minimized.** They preserve the source structure (`metadata`,
  `districts[]`, `teams[]`, `players[]` / `coaches[]`) but stay small for readable
  tests.
- They prove raw names/titles/source URLs/order are preserved, coded classifications
  map while color teams stay unresolved, empty snapshots are valid, and the pipeline
  never mutates the payload.

### Scraped JSON import session state (Phase 5 slice 14)

An in-memory **import session state model** for one scraped JSON source file lives in
`src/engine/uteConferenceScrapedJsonImportSession.ts`. It is engine-only, pure, and
deterministic, and is intended for future UI consumption. It is **not** persisted,
stored in the browser, or written anywhere — it is an in-process value built from a
loaded payload.

The `UteScrapedJsonImportSession` shape composes existing slice 10/11/12 outputs:

- `status` — one of `uninitialized`, `source-loaded`, `target-selected`,
  `target-blocked`, `ready-for-review`, `ready-for-preview`, `invalid-source`.
- `sourceFingerprint` — a deterministic, non-cryptographic source/debug identifier
  derived from stable source metadata (record type, year, event, age division and
  alias, source URL) plus target and row counts. It never uses `Date.now()`,
  randomness, or object identity.
- `recordType`, `sourceSummary`, `readinessReport` — the slice 10 record type, slice
  10 file summary, and slice 12 readiness report.
- `selectedSourceTargetId`, `selectedTarget`, `selectedCanonicalContextMapping`,
  `selectedPlayerPreviewInput`, `selectedPlayerPreviewResult`,
  `selectedCoachPreviewResult` — the current selection (null when nothing is
  selected). `selectedTarget` carries the slice 12 readiness target snapshot plus
  selection-derived issues.
- `issues` — session-level issues (codes: `invalid-source`,
  `unsupported-record-type`, `readiness-report-failed`, `target-not-found`,
  `target-blocked`, `target-empty`, `target-needs-review`,
  `selected-target-missing-preview`, `source-fingerprint-mismatch`).
- `summary` — deterministic flags for future UI (`totalTargets`,
  `selectableTargets`, `blockedTargets`, `emptyTargets`, `selectedSourceTargetId`,
  `selectedStatus`, `selectedRowCount`, `selectedIssueCount`, `canSelectTarget`,
  `canProceedToPreview`, `canProceedWithoutReview`).
- `sourcePayload` — the loaded payload, held **by reference only and never mutated**,
  in memory only. It is retained solely so selection can re-run the existing
  mapping/preview helpers; it is never written, uploaded, or persisted.

The session never persists, applies, mutates rosters, commits imports, uploads files,
derives movement, or creates coach analytics, and adds no UI.

### Scraped JSON import session review decisions (Phase 5 slice 15)

A session-level **review-decision state** layer extends the slice 14 session
(`src/engine/uteConferenceScrapedJsonImportSessionReviewDecisions.ts`). It is
engine-only, pure, deterministic, and review-metadata only — it is **not** persisted,
stored in the browser, or written anywhere, and it never alters source data.

- `UteScrapedJsonImportSessionReviewDecision` — a reviewer decision keyed by
  `sourceFingerprint` + `sourceTargetId` + `sourceRowId`, with an `action`
  (`confirm-row-identity` | `mark-row-needs-review` | `ignore-row-for-review`) and an
  optional `note`.
- `UteScrapedJsonImportSessionWithReviewDecisions` — the slice 14 session plus
  `selectedReviewDecisions` (the accepted decisions for the current target) and
  `selectedReviewState` (derived review metadata).
- `UteScrapedJsonImportSessionReviewState` — derived counts and per-row review state
  (`rowStates`), accepted/rejected counts, rejected-decision reasons, and issues. Each
  row state carries the canonical `identityReviewEffect` the decision projects onto.

The session review actions are **not** a parallel decision model: they are projected
onto the canonical identity-review vocabulary
(`RosterImportIdentityReviewActionType` / `...Effect`) via
`mapUteScrapedJsonImportSessionReviewAction`, and every action maps to a review-only
effect (`no-effect` or `defer-review`), never a roster-mutating one. The full slice 2–5
identity-review decision/repository/application helpers are intentionally not composed
at this layer because the scraped session has no existing-roster registry or identity
match entries yet (see `docs/derived-logic.md`, "Scraped JSON import session review
decisions"). Stored decisions are always re-validated against the current selection on
read, so decisions never leak across a target switch.
