# Phase 5 Slice 15: Import Session Review Decision State

This slice adds an engine-only, pure, deterministic review-decision state layer for the scraped JSON import session.

## Scope

The session review-decision layer answers this question:

> Can the session hold review decisions for the selected scraped JSON target and expose deterministic preview/review metadata that reflects those decisions before anything is applied or committed?

## Implementation

The implementation lives in:

- `src/engine/uteConferenceScrapedJsonImportSessionReviewDecisions.ts`

It composes the existing Slice 14 session state and selected player preview rows. It stores selected-target-scoped review decisions by:

- `sourceFingerprint`
- `sourceTargetId`
- `sourceRowId`

The resulting review state is metadata only. It reports accepted and rejected decisions, per-row review state, and deterministic summary counts.

## Guardrails

This slice does not add:

- UI
- browser file upload
- persistence
- localStorage or IndexedDB
- backend or auth
- import apply/commit behavior
- roster mutation
- movement derivation
- schedule/results support
- coach analytics
- a new identity matching algorithm

Loaded roster/source records remain authoritative. Raw player names, coach names, coach titles, source rows, source URLs, and source order must not be altered, removed, merged, rewritten, suppressed, or ignored. Decisions affect review metadata only.

## Decision isolation

Review decisions are accepted only for the currently selected target and current source fingerprint. Decisions for a different source, target, blank row id, or missing row are rejected into deterministic review metadata.

Clearing or switching the selected target requires the caller to clear or reset the selected review-decision state. Target mismatches are rejected and do not carry decisions onto another selected target.

## UI note

No UI is wired in this slice. A future import UI can consume the review-decision state after target selection, but must still keep commit/apply behavior as a separate later slice.
