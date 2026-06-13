import type {
  CohortReclassificationCarryForwardEntry,
  CohortReclassificationCarryForwardReason,
  CohortReclassificationCarryForwardStatus,
  CohortReclassificationCarryForwardType,
} from './cohortReclassificationCarryForward';
import type {
  CohortReclassificationReviewEntry,
  CohortReclassificationReviewReason,
  CohortReclassificationReviewResult,
  CohortReclassificationReviewStatus,
} from './cohortReclassificationReview';
import type { CohortReclassificationRecord } from './cohortReclassificationRecord';
import type { RosterMovementRecord } from './playerMovementDetection';
import type { PlayerIdentityInput } from './playerIdentityOverlap';

/**
 * Phase 4 slice 5: cohort reclassification DERIVED ASSIGNMENT — ENGINE ONLY.
 *
 * Slice 1 detects y-up / z-down candidate signals, slice 2 records the first-year
 * event, slice 3 carries the recorded status forward and flags broken paths, and
 * slice 4 classifies each carry-forward verdict into a review outcome. This slice
 * folds the slice 4 review result (which already carries its slice 3 carry-forward
 * entry) into a single, flat per-player-season COHORT ASSIGNMENT record a caller
 * can read directly: is a y-up / z-down active, is it first-year / carried-forward
 * / broken / unknown / unsupported, does it need review or recommend a reset, and
 * what cohort offset is being applied.
 *
 * This is an IN-MEMORY DERIVED ASSIGNMENT MODEL ONLY. It does NOT persist to
 * storage, mutate roster records, add UI badges, perform a reset, or create a
 * manual review/override workflow. `resetRecommended` is ADVISORY ONLY — nothing is
 * reset. Future slices may wire these assignments into persistence, manual review,
 * or UI.
 *
 * Roster authority rule (carried forward): loaded roster records are
 * authoritative. This helper never alters, removes, suppresses, merges, nullifies,
 * rewrites, reorders, or ignores source review entries, carry-forward entries,
 * first-year records, players, teams, or roster records. Source objects are
 * preserved by reference; assignment metadata is fresh and attached alongside,
 * never on the source objects.
 */

export type CohortReclassificationAssignmentActiveStatus =
  | 'active'
  | 'first-year'
  | 'inactive'
  | 'review'
  | 'insufficient-data'
  | 'unknown';

export type CohortReclassificationAssignmentConfidence = 'high' | 'low';

export type CohortReclassificationAssignmentReason =
  | 'first-year-active'
  | 'carried-forward-active'
  | 'reset-recommended'
  | 'review-required'
  | 'insufficient-data'
  | 'unknown-status';

/**
 * One derived cohort assignment per slice 4 review entry.
 *
 * - `reviewEntry` / `carryForwardEntry` are the source slice 4 / slice 3 entries,
 *   preserved by reference.
 * - `player` / `firstYearRecord` / `currentRecord` mirror the source references
 *   (preserved by reference, never copied).
 * - `identityKey` / `reclassificationType` / season ids / age division ids /
 *   `cohortOffset` mirror the carry-forward entry's derived facts.
 * - `carryForwardStatus` / `carryForwardReason` / `reviewStatus` / `reviewReason`
 *   are the upstream verdicts this assignment was derived from.
 * - `activeStatus` / `resetRecommended` / `confidence` / `reason` are this slice's
 *   derived assignment verdict.
 */
export type CohortReclassificationAssignment = {
  reviewEntry: CohortReclassificationReviewEntry;
  carryForwardEntry: CohortReclassificationCarryForwardEntry;
  player: PlayerIdentityInput;
  firstYearRecord: CohortReclassificationRecord;
  currentRecord: RosterMovementRecord | null;
  identityKey: string;
  reclassificationType: CohortReclassificationCarryForwardType;
  firstDetectedSeasonId: string;
  evaluatedSeasonId: string | null;
  priorAgeDivisionId: string;
  firstDetectedAgeDivisionId: string;
  expectedAgeDivisionId: string | null;
  actualAgeDivisionId: string | null;
  cohortOffset: number;
  carryForwardStatus: CohortReclassificationCarryForwardStatus;
  carryForwardReason: CohortReclassificationCarryForwardReason;
  reviewStatus: CohortReclassificationReviewStatus;
  reviewReason: CohortReclassificationReviewReason;
  activeStatus: CohortReclassificationAssignmentActiveStatus;
  resetRecommended: boolean;
  confidence: CohortReclassificationAssignmentConfidence;
  reason: CohortReclassificationAssignmentReason;
};

export type CohortReclassificationAssignmentSummary = {
  total: number;
  active: number;
  firstYear: number;
  inactive: number;
  review: number;
  insufficientData: number;
  unknown: number;
  resetRecommended: number;
  yUp: number;
  zDown: number;
  highConfidence: number;
  lowConfidence: number;
};

export type CohortReclassificationAssignmentResult = {
  assignments: CohortReclassificationAssignment[];
  summary: CohortReclassificationAssignmentSummary;
};

type AssignmentVerdict = {
  activeStatus: CohortReclassificationAssignmentActiveStatus;
  resetRecommended: boolean;
  confidence: CohortReclassificationAssignmentConfidence;
  reason: CohortReclassificationAssignmentReason;
};

const FIRST_YEAR_ACTIVE: AssignmentVerdict = {
  activeStatus: 'first-year',
  resetRecommended: false,
  confidence: 'high',
  reason: 'first-year-active',
};
const CARRIED_FORWARD_ACTIVE: AssignmentVerdict = {
  activeStatus: 'active',
  resetRecommended: false,
  confidence: 'high',
  reason: 'carried-forward-active',
};
const RESET_RECOMMENDED: AssignmentVerdict = {
  activeStatus: 'inactive',
  resetRecommended: true,
  confidence: 'high',
  reason: 'reset-recommended',
};
const REVIEW_REQUIRED: AssignmentVerdict = {
  activeStatus: 'review',
  resetRecommended: false,
  confidence: 'low',
  reason: 'review-required',
};
const INSUFFICIENT_DATA: AssignmentVerdict = {
  activeStatus: 'insufficient-data',
  resetRecommended: false,
  confidence: 'low',
  reason: 'insufficient-data',
};
const UNKNOWN_STATUS: AssignmentVerdict = {
  activeStatus: 'unknown',
  resetRecommended: false,
  confidence: 'low',
  reason: 'unknown-status',
};

/**
 * Maps a single review entry to an assignment verdict. Pure: it reads only the
 * review `reviewStatus` and the underlying carry-forward `status` and never
 * mutates anything.
 *
 * Mapping (see `docs/derived-logic.md` "Cohort reclassification derived
 * assignment"):
 *   - clean + first-year       -> first-year / first-year-active (high)
 *   - clean + carried-forward   -> active / carried-forward-active (high)
 *   - reset-recommended         -> inactive / reset-recommended (high, reset true)
 *   - needs-review              -> review / review-required (low)
 *   - insufficient-data         -> insufficient-data / insufficient-data (low)
 *   - anything else (unmapped)  -> unknown / unknown-status (low)
 */
function classifyAssignment(
  reviewEntry: CohortReclassificationReviewEntry
): AssignmentVerdict {
  switch (reviewEntry.reviewStatus) {
    case 'clean':
      if (reviewEntry.carryForwardStatus === 'first-year')
        return FIRST_YEAR_ACTIVE;
      if (reviewEntry.carryForwardStatus === 'carried-forward')
        return CARRIED_FORWARD_ACTIVE;
      return UNKNOWN_STATUS;
    case 'reset-recommended':
      return RESET_RECOMMENDED;
    case 'needs-review':
      return REVIEW_REQUIRED;
    case 'insufficient-data':
      return INSUFFICIENT_DATA;
    default:
      return UNKNOWN_STATUS;
  }
}

/**
 * Normalizes the accepted input into a review entry list. Accepts either the slice
 * 4 result object (`{ entries, summary }`) or a bare entry array, mirroring slice
 * 4's own input flexibility, so callers can pass
 * `classifyCohortReclassificationReview(...)` directly or just its `.entries`.
 */
function toReviewEntries(
  input:
    | CohortReclassificationReviewResult
    | CohortReclassificationReviewEntry[]
): CohortReclassificationReviewEntry[] {
  return Array.isArray(input) ? input : input.entries;
}

/**
 * Derives a flat per-player-season cohort assignment from each slice 4 review
 * entry. Pure and deterministic: exactly one assignment per review entry, in
 * review input order.
 *
 * Guarantees:
 *   - Source `reviewEntry`, `carryForwardEntry`, `player`, `firstYearRecord`, and
 *     `currentRecord` objects are preserved by reference and never mutated.
 *     Assignment metadata is fresh.
 *   - No entry is dropped, merged, reordered, or suppressed. This is a derived
 *     assignment, never a reset and never persistence; `resetRecommended` is
 *     advisory only.
 */
export function deriveCohortReclassificationAssignments(
  reviewResult:
    | CohortReclassificationReviewResult
    | CohortReclassificationReviewEntry[]
): CohortReclassificationAssignmentResult {
  const reviewEntries = toReviewEntries(reviewResult);
  const assignments: CohortReclassificationAssignment[] = [];

  for (const reviewEntry of reviewEntries) {
    const carryForwardEntry = reviewEntry.carryForwardEntry;
    const verdict = classifyAssignment(reviewEntry);

    assignments.push({
      reviewEntry,
      carryForwardEntry,
      player: reviewEntry.player,
      firstYearRecord: reviewEntry.firstYearRecord,
      currentRecord: reviewEntry.currentRecord,
      identityKey: reviewEntry.identityKey,
      reclassificationType: reviewEntry.reclassificationType,
      firstDetectedSeasonId: carryForwardEntry.firstDetectedSeasonId,
      evaluatedSeasonId: reviewEntry.evaluatedSeasonId,
      priorAgeDivisionId: carryForwardEntry.priorAgeDivisionId,
      firstDetectedAgeDivisionId: carryForwardEntry.firstDetectedAgeDivisionId,
      expectedAgeDivisionId: carryForwardEntry.expectedAgeDivisionId,
      actualAgeDivisionId: carryForwardEntry.actualAgeDivisionId,
      cohortOffset: carryForwardEntry.cohortOffset,
      carryForwardStatus: reviewEntry.carryForwardStatus,
      carryForwardReason: reviewEntry.carryForwardReason,
      reviewStatus: reviewEntry.reviewStatus,
      reviewReason: reviewEntry.reason,
      activeStatus: verdict.activeStatus,
      resetRecommended: verdict.resetRecommended,
      confidence: verdict.confidence,
      reason: verdict.reason,
    });
  }

  return {
    assignments,
    summary: summarizeCohortReclassificationAssignments(assignments),
  };
}

/**
 * Counts assignments by active status, reset recommendation, reclassification
 * type, and confidence. Pure and deterministic; reads only each assignment's
 * `activeStatus`, `resetRecommended`, `reclassificationType`, and `confidence`.
 */
export function summarizeCohortReclassificationAssignments(
  assignments: CohortReclassificationAssignment[]
): CohortReclassificationAssignmentSummary {
  const summary: CohortReclassificationAssignmentSummary = {
    total: assignments.length,
    active: 0,
    firstYear: 0,
    inactive: 0,
    review: 0,
    insufficientData: 0,
    unknown: 0,
    resetRecommended: 0,
    yUp: 0,
    zDown: 0,
    highConfidence: 0,
    lowConfidence: 0,
  };

  for (const assignment of assignments) {
    switch (assignment.activeStatus) {
      case 'active':
        summary.active += 1;
        break;
      case 'first-year':
        summary.firstYear += 1;
        break;
      case 'inactive':
        summary.inactive += 1;
        break;
      case 'review':
        summary.review += 1;
        break;
      case 'insufficient-data':
        summary.insufficientData += 1;
        break;
      case 'unknown':
        summary.unknown += 1;
        break;
    }

    if (assignment.resetRecommended) {
      summary.resetRecommended += 1;
    }

    if (assignment.reclassificationType === 'y-up') {
      summary.yUp += 1;
    } else {
      summary.zDown += 1;
    }

    if (assignment.confidence === 'high') {
      summary.highConfidence += 1;
    } else {
      summary.lowConfidence += 1;
    }
  }

  return summary;
}
