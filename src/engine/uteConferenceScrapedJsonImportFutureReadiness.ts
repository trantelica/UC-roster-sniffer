import type { ScrapedImportRosterAwareReview } from './uteConferenceScrapedJsonImportRosterAwareReview';
import type { ScrapedImportStagedProjection } from './uteConferenceScrapedJsonImportStagedProjection';

/**
 * Phase 5 slice 20: PURE, deterministic FUTURE IMPORT READINESS gate — ENGINE ONLY.
 *
 * It answers: "given the current slice 18 roster-aware review and the slice 19 staged
 * projection, what — if anything — would prevent this from being SAFE to commit in a
 * FUTURE, explicitly approved import slice?"
 *
 * It COMPOSES the slice 18 review (per-row outcomes, built on the slice 2/3/5/6/8
 * pipeline) and the slice 19 staged projection (projected roster totals). It invents NO
 * parallel import model and re-derives no matching/decision logic: the per-row counts
 * come straight from the review's resolved outcomes, and the projected roster size comes
 * straight from the staged projection.
 *
 * Guardrails: REPORTING ONLY. No actual import application, commit, apply, save,
 * persistence, or roster mutation exists or is implied here — this only describes
 * readiness. The review, staged projection, and all inputs are never mutated. Loaded
 * roster records are authoritative: this gate never removes, suppresses, rewrites,
 * reorders, merges, nullifies, or ignores rostered names; ambiguity affects derived
 * review state only. Output is identical across repeated calls.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_FUTURE_READINESS_LOGIC_VERSION =
  'phase5-slice20-scraped-json-import-future-readiness-v1';

export type ScrapedImportReadinessBlockingReasonCode =
  | 'review-unavailable'
  | 'no-incoming-rows'
  | 'unresolved-rows-remain'
  | 'blocked-rows-present'
  | 'staged-projection-unavailable';

export type ScrapedImportReadinessBlockingReason = {
  code: ScrapedImportReadinessBlockingReasonCode;
  message: string;
};

export type ScrapedImportFutureCommitReadiness = {
  /** True when a roster-aware review is available to assess. */
  available: boolean;
  /** Rows that would be added as NEW roster records in a future commit. */
  readyAdditions: number;
  /** Rows linked to an existing record — NOT added as new roster records. */
  readyLinks: number;
  /** Rows intentionally deferred by the reviewer — not added yet. */
  deferredRows: number;
  /** Rows that cannot proceed (structurally invalid / skipped preview rows). */
  blockedRows: number;
  /** Rows still awaiting a reviewer decision (match-bearing, unresolved). */
  unresolvedRows: number;
  /** Total incoming imported rows under review. */
  totalIncomingRows: number;
  /** Projected roster size from the staged projection, or null when not stageable. */
  totalProjectedRosterRows: number | null;
  /** Whether the slice 19 staged projection is currently stageable. */
  stagedProjectionStageable: boolean;
  /** True only when nothing would block a future import commit. */
  isReadyForFutureCommit: boolean;
  /** Stable, ordered reason codes/messages explaining any blockers. */
  blockingReasons: ScrapedImportReadinessBlockingReason[];
  /** Plain-language summary suitable for direct UI display. */
  explanation: string;
};

function countOutcome(
  review: Extract<ScrapedImportRosterAwareReview, { available: true }>,
  outcome: string
): number {
  return review.rows.filter((row) => row.outcome === outcome).length;
}

/**
 * Builds the future-import-commit readiness gate from a slice 18 review and a slice 19
 * staged projection. Pure; never mutates either input.
 */
export function buildScrapedJsonImportFutureCommitReadiness(
  review: ScrapedImportRosterAwareReview,
  stagedProjection: ScrapedImportStagedProjection
): ScrapedImportFutureCommitReadiness {
  if (!review.available) {
    return {
      available: false,
      readyAdditions: 0,
      readyLinks: 0,
      deferredRows: 0,
      blockedRows: 0,
      unresolvedRows: 0,
      totalIncomingRows: 0,
      totalProjectedRosterRows: null,
      stagedProjectionStageable: stagedProjection.stageable,
      isReadyForFutureCommit: false,
      blockingReasons: [
        { code: 'review-unavailable', message: review.message },
      ],
      explanation:
        'Roster-aware review is unavailable, so future import readiness cannot be assessed. No commit occurs in this preview.',
    };
  }

  const readyAdditions = countOutcome(review, 'projected-create');
  const readyLinks = countOutcome(review, 'projected-link');
  const deferredRows = countOutcome(review, 'deferred');
  const unresolvedRows = countOutcome(review, 'blocked-unresolved');
  const blockedRows = countOutcome(review, 'blocked');
  const totalIncomingRows = review.summary.totalRows;
  const totalProjectedRosterRows = stagedProjection.stageable
    ? stagedProjection.projectedRosterCount
    : null;

  const blockingReasons: ScrapedImportReadinessBlockingReason[] = [];
  if (totalIncomingRows === 0) {
    blockingReasons.push({
      code: 'no-incoming-rows',
      message: 'There are no incoming rows to commit.',
    });
  }
  if (unresolvedRows > 0) {
    blockingReasons.push({
      code: 'unresolved-rows-remain',
      message: `${unresolvedRows} ${unresolvedRows === 1 ? 'row still needs' : 'rows still need'} a reviewer decision (link to an existing player or add as new).`,
    });
  }
  if (blockedRows > 0) {
    blockingReasons.push({
      code: 'blocked-rows-present',
      message: `${blockedRows} row${blockedRows === 1 ? '' : 's'} cannot proceed and must be corrected at the source.`,
    });
  }
  // Only surface a staged-projection blocker that the per-row blockers above do not
  // already explain (the "dry-run-not-clean" reason is exactly unresolved/blocked rows).
  if (!stagedProjection.stageable && unresolvedRows === 0 && blockedRows === 0) {
    blockingReasons.push({
      code: 'staged-projection-unavailable',
      message: stagedProjection.message,
    });
  }

  const isReadyForFutureCommit = blockingReasons.length === 0;

  return {
    available: true,
    readyAdditions,
    readyLinks,
    deferredRows,
    blockedRows,
    unresolvedRows,
    totalIncomingRows,
    totalProjectedRosterRows,
    stagedProjectionStageable: stagedProjection.stageable,
    isReadyForFutureCommit,
    blockingReasons,
    explanation: buildExplanation({
      isReadyForFutureCommit,
      readyAdditions,
      readyLinks,
      deferredRows,
      totalIncomingRows,
      blockingReasons,
    }),
  };
}

function buildExplanation(input: {
  isReadyForFutureCommit: boolean;
  readyAdditions: number;
  readyLinks: number;
  deferredRows: number;
  totalIncomingRows: number;
  blockingReasons: ScrapedImportReadinessBlockingReason[];
}): string {
  const { readyAdditions, readyLinks, deferredRows, totalIncomingRows } = input;
  const breakdown = `Of ${totalIncomingRows} incoming row${totalIncomingRows === 1 ? '' : 's'}: ${readyAdditions} would be added as new, ${readyLinks} linked to existing players, ${deferredRows} deferred.`;
  if (input.isReadyForFutureCommit) {
    return `Every incoming row is resolved. ${breakdown} A future approved import slice could safely commit this staged projection. No commit, apply, or save occurs in this preview.`;
  }
  const reasons = input.blockingReasons.map((r) => r.message).join(' ');
  return `Not ready for a future import commit. ${reasons} ${breakdown} No commit, apply, or save occurs in this preview.`;
}
