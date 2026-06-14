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

## Sample data fixtures

Local sample data under `data-samples/` exists to prove the data contract and to exercise derived behavior during development.

### Notes

- Sample data may include multiple seasons.
- Multi-season sample data is used to exercise prior-season comparison behavior.
- The current fixture intentionally includes a same-slot team that appears in both 2025 and 2026 — same district, age division, and team code — so the selected-team roster-status summary can render an available state for visual testing.
- Each roster import sample file represents a single season, matching the existing roster import contract.
- Sample fixtures should remain small, deliberate, and contract-preserving. They should not silently reshape the sample contract to make code easier.
