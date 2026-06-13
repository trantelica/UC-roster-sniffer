import type {
  CohortReclassificationCarryForwardConfidence,
  CohortReclassificationCarryForwardEntry,
  CohortReclassificationCarryForwardReason,
  CohortReclassificationCarryForwardResult,
  CohortReclassificationCarryForwardStatus,
  CohortReclassificationCarryForwardType,
} from './cohortReclassificationCarryForward';
import type { CohortReclassificationRecord } from './cohortReclassificationRecord';
import type { RosterMovementRecord } from './playerMovementDetection';
import type { PlayerIdentityInput } from './playerIdentityOverlap';

/**
 * Phase 4 slice 4: cohort reclassification REVIEW CLASSIFICATION — ENGINE ONLY.
 *
 * Slice 1 (`detectCohortReclassificationSignals`) detects y-up / z-down candidate
 * signals. Slice 2 (`deriveFirstYearCohortReclassificationRecords`) records the
 * first-year event. Slice 3 (`carryForwardCohortReclassificationStatus`) carries a
 * recorded status forward across later seasons and flags broken paths. This slice
 * adds a thin classification layer ON TOP of the slice 3 carry-forward result: it
 * maps each carry-forward verdict into a simple REVIEW outcome a human can act on.
 *
 * Conceptual product rule: a carried-forward y-up / z-down can be `clean`,
 * `needs-review`, `reset-recommended`, or `insufficient-data`. The system preserves
 * roster records and classifies the derived cohort status for review rather than
 * deleting or rewriting anything.
 *
 * This is NOT storage, NOT UI, NOT import workflow, and NOT manual override:
 *   - No persistence: review decisions are derived on demand, never written back.
 *   - No reset: a `reset-recommended` outcome is a RECOMMENDATION only. Nothing is
 *     reset, and no cohort status is changed.
 *   - No UI badges, no fuzzy matching, no identity-collision resolution, no
 *     birthdate / grade / notes inference, no schedule / result changes.
 *
 * Roster authority rule (carried forward): loaded roster records are
 * authoritative. This helper never alters, removes, suppresses, merges, nullifies,
 * rewrites, reorders, or ignores source records, first-year records, or
 * carry-forward entries. Source objects (`carryForwardEntry`, `player`,
 * `firstYearRecord`, `currentRecord`) are preserved by reference; review metadata
 * is fresh and attached alongside, never on the source objects.
 */

export type CohortReclassificationReviewStatus =
  | 'clean'
  | 'needs-review'
  | 'reset-recommended'
  | 'insufficient-data';

export type CohortReclassificationReviewConfidence = 'high' | 'low';

export type CohortReclassificationReviewReason =
  | 'valid-first-year-record'
  | 'valid-carry-forward'
  | 'path-broken-returned-to-normal'
  | 'path-broken-unexpected-age-division'
  | 'missing-current-record'
  | 'invalid-age-division'
  | 'ambiguous-identity'
  | 'unusable-season-order'
  | 'low-confidence-carry-forward'
  | 'unknown-carry-forward-result';

/**
 * One review verdict per carry-forward entry.
 *
 * - `carryForwardEntry` is the slice 3 entry this verdict was derived from,
 *   preserved by reference.
 * - `identityKey` / `reclassificationType` / `player` / `firstYearRecord` /
 *   `currentRecord` / `evaluatedSeasonId` mirror the carry-forward entry (the
 *   record references are preserved by reference, not copied).
 * - `carryForwardStatus` / `carryForwardReason` are the slice 3 verdict that was
 *   classified.
 * - `reviewStatus` / `confidence` / `reason` are this slice's derived review
 *   verdict.
 */
export type CohortReclassificationReviewEntry = {
  carryForwardEntry: CohortReclassificationCarryForwardEntry;
  identityKey: string;
  reclassificationType: CohortReclassificationCarryForwardType;
  player: PlayerIdentityInput;
  firstYearRecord: CohortReclassificationRecord;
  currentRecord: RosterMovementRecord | null;
  evaluatedSeasonId: string | null;
  carryForwardStatus: CohortReclassificationCarryForwardStatus;
  carryForwardReason: CohortReclassificationCarryForwardReason;
  reviewStatus: CohortReclassificationReviewStatus;
  confidence: CohortReclassificationReviewConfidence;
  reason: CohortReclassificationReviewReason;
};

export type CohortReclassificationReviewSummary = {
  total: number;
  clean: number;
  needsReview: number;
  resetRecommended: number;
  insufficientData: number;
  yUp: number;
  zDown: number;
  highConfidence: number;
  lowConfidence: number;
};

export type CohortReclassificationReviewResult = {
  entries: CohortReclassificationReviewEntry[];
  summary: CohortReclassificationReviewSummary;
};

type ReviewVerdict = {
  reviewStatus: CohortReclassificationReviewStatus;
  confidence: CohortReclassificationReviewConfidence;
  reason: CohortReclassificationReviewReason;
};

const CLEAN_FIRST_YEAR: ReviewVerdict = {
  reviewStatus: 'clean',
  confidence: 'high',
  reason: 'valid-first-year-record',
};
const CLEAN_CARRY_FORWARD: ReviewVerdict = {
  reviewStatus: 'clean',
  confidence: 'high',
  reason: 'valid-carry-forward',
};
const RESET_RECOMMENDED: ReviewVerdict = {
  reviewStatus: 'reset-recommended',
  confidence: 'high',
  reason: 'path-broken-returned-to-normal',
};
const NEEDS_REVIEW_UNEXPECTED: ReviewVerdict = {
  reviewStatus: 'needs-review',
  confidence: 'low',
  reason: 'path-broken-unexpected-age-division',
};
const INSUFFICIENT_MISSING_CURRENT: ReviewVerdict = {
  reviewStatus: 'insufficient-data',
  confidence: 'low',
  reason: 'missing-current-record',
};
const INSUFFICIENT_SEASON_ORDER: ReviewVerdict = {
  reviewStatus: 'insufficient-data',
  confidence: 'low',
  reason: 'unusable-season-order',
};
const INSUFFICIENT_UNKNOWN: ReviewVerdict = {
  reviewStatus: 'insufficient-data',
  confidence: 'low',
  reason: 'unknown-carry-forward-result',
};
const NEEDS_REVIEW_INVALID_DIVISION: ReviewVerdict = {
  reviewStatus: 'needs-review',
  confidence: 'low',
  reason: 'invalid-age-division',
};
const NEEDS_REVIEW_AMBIGUOUS: ReviewVerdict = {
  reviewStatus: 'needs-review',
  confidence: 'low',
  reason: 'ambiguous-identity',
};
const NEEDS_REVIEW_UNKNOWN: ReviewVerdict = {
  reviewStatus: 'needs-review',
  confidence: 'low',
  reason: 'unknown-carry-forward-result',
};
const NEEDS_REVIEW_LOW_CONFIDENCE: ReviewVerdict = {
  reviewStatus: 'needs-review',
  confidence: 'low',
  reason: 'low-confidence-carry-forward',
};

/**
 * Returns the review verdict for an otherwise-clean carry-forward status. A clean
 * status produced with `low` carry-forward confidence is demoted to `needs-review`
 * / `low-confidence-carry-forward` so a reviewer can confirm it before trusting it.
 */
function cleanOrLowConfidence(
  carryForwardConfidence: CohortReclassificationCarryForwardConfidence,
  cleanVerdict: ReviewVerdict
): ReviewVerdict {
  return carryForwardConfidence === 'low'
    ? NEEDS_REVIEW_LOW_CONFIDENCE
    : cleanVerdict;
}

/**
 * Maps a single carry-forward verdict to a review verdict. Pure: it reads only the
 * carry-forward `status`, `reason`, and `confidence` and never mutates anything.
 *
 * Mapping (see `docs/derived-logic.md` "Cohort reclassification review"):
 *   - `first-year`        -> clean / valid-first-year-record (high)
 *   - `carried-forward`   -> clean / valid-carry-forward (high)
 *   - `path-broken` + returned-to-normal-path   -> reset-recommended (high)
 *   - `path-broken` + unexpected-age-division   -> needs-review (low)
 *   - `insufficient-history` -> insufficient-data (low), reason by ordering vs.
 *     missing record, else unknown-carry-forward-result
 *   - `unknown`           -> needs-review (low), reason invalid-age-division /
 *     ambiguous-identity, else unknown-carry-forward-result
 *   - Any otherwise-clean entry with low carry-forward confidence is demoted to
 *     needs-review / low-confidence-carry-forward.
 */
function classifyVerdict(
  entry: CohortReclassificationCarryForwardEntry
): ReviewVerdict {
  switch (entry.status) {
    case 'first-year':
      return cleanOrLowConfidence(entry.confidence, CLEAN_FIRST_YEAR);
    case 'carried-forward':
      return cleanOrLowConfidence(entry.confidence, CLEAN_CARRY_FORWARD);
    case 'path-broken':
      if (entry.reason === 'returned-to-normal-path') return RESET_RECOMMENDED;
      if (entry.reason === 'unexpected-age-division')
        return NEEDS_REVIEW_UNEXPECTED;
      return NEEDS_REVIEW_UNKNOWN;
    case 'insufficient-history':
      if (entry.reason === 'missing-current-record')
        return INSUFFICIENT_MISSING_CURRENT;
      if (
        entry.reason === 'missing-season-order' ||
        entry.reason === 'first-season-not-in-order' ||
        entry.reason === 'evaluated-season-not-in-order' ||
        entry.reason === 'evaluated-season-before-first-detection'
      )
        return INSUFFICIENT_SEASON_ORDER;
      return INSUFFICIENT_UNKNOWN;
    case 'unknown':
      if (entry.reason === 'invalid-age-division')
        return NEEDS_REVIEW_INVALID_DIVISION;
      if (entry.reason === 'ambiguous-identity') return NEEDS_REVIEW_AMBIGUOUS;
      return NEEDS_REVIEW_UNKNOWN;
    default:
      return NEEDS_REVIEW_UNKNOWN;
  }
}

/**
 * Normalizes the accepted input into a carry-forward entry list. Accepts either the
 * slice 3 result object (`{ entries, summary }`) or a bare entry array, so callers
 * can pass `carryForwardCohortReclassificationStatus(...)` directly or just its
 * `.entries`.
 */
function toCarryForwardEntries(
  input:
    | CohortReclassificationCarryForwardResult
    | CohortReclassificationCarryForwardEntry[]
): CohortReclassificationCarryForwardEntry[] {
  return Array.isArray(input) ? input : input.entries;
}

/**
 * Classifies slice 3 carry-forward verdicts into review outcomes. Pure and
 * deterministic: exactly one review entry per carry-forward entry, in carry-forward
 * input order.
 *
 * Guarantees:
 *   - Source `carryForwardEntry`, `player`, `firstYearRecord`, and `currentRecord`
 *     objects are preserved by reference and never mutated. Review metadata is
 *     fresh.
 *   - No entry is dropped, merged, reordered, or suppressed. This is a derived
 *     review classification, never a reset and never persistence.
 */
export function classifyCohortReclassificationReview(
  carryForwardResult:
    | CohortReclassificationCarryForwardResult
    | CohortReclassificationCarryForwardEntry[]
): CohortReclassificationReviewResult {
  const carryForwardEntries = toCarryForwardEntries(carryForwardResult);
  const entries: CohortReclassificationReviewEntry[] = [];

  for (const carryForwardEntry of carryForwardEntries) {
    const verdict = classifyVerdict(carryForwardEntry);
    entries.push({
      carryForwardEntry,
      identityKey: carryForwardEntry.identityKey,
      reclassificationType: carryForwardEntry.reclassificationType,
      player: carryForwardEntry.player,
      firstYearRecord: carryForwardEntry.firstYearRecord,
      currentRecord: carryForwardEntry.currentRecord,
      evaluatedSeasonId: carryForwardEntry.evaluatedSeasonId,
      carryForwardStatus: carryForwardEntry.status,
      carryForwardReason: carryForwardEntry.reason,
      reviewStatus: verdict.reviewStatus,
      confidence: verdict.confidence,
      reason: verdict.reason,
    });
  }

  return {
    entries,
    summary: summarizeCohortReclassificationReview(entries),
  };
}

/**
 * Counts review entries by review status, reclassification type, and confidence.
 * Pure and deterministic; reads only each entry's `reviewStatus`,
 * `reclassificationType`, and `confidence`.
 */
export function summarizeCohortReclassificationReview(
  reviewEntries: CohortReclassificationReviewEntry[]
): CohortReclassificationReviewSummary {
  const summary: CohortReclassificationReviewSummary = {
    total: reviewEntries.length,
    clean: 0,
    needsReview: 0,
    resetRecommended: 0,
    insufficientData: 0,
    yUp: 0,
    zDown: 0,
    highConfidence: 0,
    lowConfidence: 0,
  };

  for (const entry of reviewEntries) {
    switch (entry.reviewStatus) {
      case 'clean':
        summary.clean += 1;
        break;
      case 'needs-review':
        summary.needsReview += 1;
        break;
      case 'reset-recommended':
        summary.resetRecommended += 1;
        break;
      case 'insufficient-data':
        summary.insufficientData += 1;
        break;
    }

    if (entry.reclassificationType === 'y-up') {
      summary.yUp += 1;
    } else {
      summary.zDown += 1;
    }

    if (entry.confidence === 'high') {
      summary.highConfidence += 1;
    } else {
      summary.lowConfidence += 1;
    }
  }

  return summary;
}
