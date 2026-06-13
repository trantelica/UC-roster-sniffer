import type {
  CohortReclassificationAssignment,
  CohortReclassificationAssignmentActiveStatus,
} from './cohortReclassificationAssignment';
import type { CohortReclassificationCarryForwardType } from './cohortReclassificationCarryForward';

/**
 * Phase 4 slice 6: cohort assignment REVIEW ACTION MODEL — ENGINE ONLY.
 *
 * Slices 1–5 detect candidate signals, record first-year events, carry the status
 * forward, classify a review outcome, and fold everything into a derived
 * per-player-season assignment. This slice defines what a FUTURE manual review
 * workflow may DO with one of those assignments: it turns an assignment plus a
 * requested action into an explicit, validated review-action RESULT.
 *
 * This is NOT persistence and NOT UI. The helper is pure and deterministic: it does
 * not save anything, does not reset anything (a `reset` action that is accepted
 * only RECORDS that the reset recommendation was accepted; no cohort status is
 * mutated), does not mutate roster records, and adds no UI. Future slices may
 * persist accepted actions or wire a manual review screen.
 *
 * Conceptual product rule: a clean assignment (active / first-year) can be
 * confirmed; a questionable one (review) can be confirmed anyway or deferred; a
 * broken one (inactive with a reset recommendation) can have its reset accepted;
 * an insufficient-data one can be marked as such. Anything else is rejected with an
 * explicit reason rather than silently coerced.
 *
 * Roster authority rule (carried forward): loaded roster records are
 * authoritative. This helper never alters, removes, suppresses, merges, nullifies,
 * rewrites, reorders, or ignores the source assignment or any upstream object. The
 * source `assignment` is preserved by reference; action-result metadata is fresh.
 */

export type CohortReclassificationReviewActionType =
  | 'confirm'
  | 'reset'
  | 'defer'
  | 'mark-insufficient-data';

export type CohortReclassificationReviewActionInput = {
  actionType: CohortReclassificationReviewActionType;
  reviewerNote?: string;
  reviewedAt?: string;
  reviewerId?: string;
};

export type CohortReclassificationReviewActionState =
  | 'confirmed'
  | 'reset'
  | 'deferred'
  | 'insufficient-data'
  | 'rejected';

export type CohortReclassificationReviewActionConfidence = 'high' | 'low';

export type CohortReclassificationReviewActionReason =
  | 'clean-assignment-confirmed'
  | 'review-assignment-confirmed'
  | 'reset-recommendation-accepted'
  | 'reset-not-allowed-for-clean-assignment'
  | 'review-deferred'
  | 'insufficient-data-marked'
  | 'insufficient-data-action-not-needed'
  | 'invalid-action-for-assignment'
  | 'missing-assignment'
  | 'unknown-assignment-state';

/**
 * The explicit outcome of validating one requested review action against one
 * derived assignment.
 *
 * - `assignment` is the source slice 5 assignment, preserved by reference (`null`
 *   only when no assignment was supplied).
 * - `identityKey` / `reclassificationType` / `evaluatedSeasonId` mirror the
 *   assignment (`reclassificationType` is `null` only for a missing assignment).
 * - `requestedAction` is the action type that was evaluated.
 * - `accepted` is whether the action is allowed for this assignment state.
 * - `resultingReviewState` / `resultingActiveStatus` / `resetRecommended` describe
 *   the state the assignment WOULD take if the action were committed. Nothing is
 *   committed here. For a rejected action the active status is left unchanged.
 * - `confidence` / `reason` are the derived verdict.
 * - `reviewerNote` / `reviewedAt` / `reviewerId` are echoed back only when supplied.
 */
export type CohortReclassificationReviewActionResult = {
  assignment: CohortReclassificationAssignment | null;
  identityKey: string;
  reclassificationType: CohortReclassificationCarryForwardType | null;
  evaluatedSeasonId: string | null;
  requestedAction: CohortReclassificationReviewActionType;
  accepted: boolean;
  resultingReviewState: CohortReclassificationReviewActionState;
  resultingActiveStatus: CohortReclassificationAssignmentActiveStatus;
  resetRecommended: boolean;
  confidence: CohortReclassificationReviewActionConfidence;
  reason: CohortReclassificationReviewActionReason;
  reviewerNote?: string;
  reviewedAt?: string;
  reviewerId?: string;
};

export type CohortReclassificationReviewActionSummary = {
  total: number;
  accepted: number;
  rejected: number;
  confirmed: number;
  reset: number;
  deferred: number;
  insufficientData: number;
  byAction: {
    confirm: number;
    reset: number;
    defer: number;
    markInsufficientData: number;
  };
};

type Verdict = {
  accepted: boolean;
  resultingReviewState: CohortReclassificationReviewActionState;
  resultingActiveStatus: CohortReclassificationAssignmentActiveStatus;
  resetRecommended: boolean;
  confidence: CohortReclassificationReviewActionConfidence;
  reason: CohortReclassificationReviewActionReason;
};

/**
 * Validates a requested action against an assignment's derived state and returns
 * the verdict. Pure: it reads only the assignment's `activeStatus` and
 * `resetRecommended` and never mutates anything.
 *
 * Precedence:
 *   1. An `unknown` assignment state rejects every action with
 *      `unknown-assignment-state`.
 *   2. Otherwise the action type decides:
 *      - confirm: active / first-year stay clean-confirmed; review is confirmed and
 *        becomes active; anything else is an invalid action.
 *      - reset: inactive WITH a reset recommendation is accepted (and the
 *        recommendation is cleared in the would-be state); active / first-year are
 *        rejected as reset-not-allowed-for-clean-assignment; anything else is an
 *        invalid action.
 *      - defer: only a review assignment can be deferred; anything else is invalid.
 *      - mark-insufficient-data: only an insufficient-data assignment accepts it;
 *        anything else reports insufficient-data-action-not-needed.
 *
 * A rejected verdict leaves `resultingActiveStatus` / `resetRecommended` unchanged.
 */
function classifyAction(
  assignment: CohortReclassificationAssignment,
  actionType: CohortReclassificationReviewActionType
): Verdict {
  const activeStatus = assignment.activeStatus;
  const resetRecommended = assignment.resetRecommended;

  const rejected = (
    reason: CohortReclassificationReviewActionReason
  ): Verdict => ({
    accepted: false,
    resultingReviewState: 'rejected',
    resultingActiveStatus: activeStatus,
    resetRecommended,
    confidence: 'low',
    reason,
  });

  // 1. An unknown assignment state cannot be acted on.
  if (activeStatus === 'unknown') {
    return rejected('unknown-assignment-state');
  }

  switch (actionType) {
    case 'confirm':
      if (activeStatus === 'active' || activeStatus === 'first-year') {
        return {
          accepted: true,
          resultingReviewState: 'confirmed',
          resultingActiveStatus: activeStatus,
          resetRecommended,
          confidence: 'high',
          reason: 'clean-assignment-confirmed',
        };
      }
      if (activeStatus === 'review') {
        return {
          accepted: true,
          resultingReviewState: 'confirmed',
          resultingActiveStatus: 'active',
          resetRecommended,
          confidence: 'high',
          reason: 'review-assignment-confirmed',
        };
      }
      return rejected('invalid-action-for-assignment');

    case 'reset':
      if (activeStatus === 'inactive' && resetRecommended) {
        return {
          accepted: true,
          resultingReviewState: 'reset',
          resultingActiveStatus: 'inactive',
          resetRecommended: false,
          confidence: 'high',
          reason: 'reset-recommendation-accepted',
        };
      }
      if (activeStatus === 'active' || activeStatus === 'first-year') {
        return rejected('reset-not-allowed-for-clean-assignment');
      }
      return rejected('invalid-action-for-assignment');

    case 'defer':
      if (activeStatus === 'review') {
        return {
          accepted: true,
          resultingReviewState: 'deferred',
          resultingActiveStatus: 'review',
          resetRecommended,
          confidence: 'low',
          reason: 'review-deferred',
        };
      }
      return rejected('invalid-action-for-assignment');

    case 'mark-insufficient-data':
      if (activeStatus === 'insufficient-data') {
        return {
          accepted: true,
          resultingReviewState: 'insufficient-data',
          resultingActiveStatus: 'insufficient-data',
          resetRecommended,
          confidence: 'low',
          reason: 'insufficient-data-marked',
        };
      }
      return rejected('insufficient-data-action-not-needed');

    default:
      return rejected('unknown-assignment-state');
  }
}

/**
 * Validates one requested review action against one derived cohort assignment and
 * returns an explicit accepted/rejected result. Pure and deterministic: the same
 * assignment + action always yields the same result.
 *
 * Guarantees:
 *   - The source `assignment` (and every upstream object it references) is
 *     preserved by reference and never mutated. Result metadata is fresh.
 *   - Nothing is persisted and nothing is reset. `resultingReviewState` /
 *     `resultingActiveStatus` / `resetRecommended` describe the state the
 *     assignment WOULD take if a future slice committed the action.
 *   - `reviewerNote` / `reviewedAt` / `reviewerId` are echoed back only when
 *     supplied (and only non-empty strings), never invented.
 *
 * A missing assignment yields a rejected `missing-assignment` result rather than
 * throwing, so callers stay deterministic.
 */
export function applyCohortReclassificationReviewAction(
  assignment: CohortReclassificationAssignment | null | undefined,
  action: CohortReclassificationReviewActionInput
): CohortReclassificationReviewActionResult {
  if (assignment == null) {
    return withReviewerFields(
      {
        assignment: null,
        identityKey: '',
        reclassificationType: null,
        evaluatedSeasonId: null,
        requestedAction: action.actionType,
        accepted: false,
        resultingReviewState: 'rejected',
        resultingActiveStatus: 'unknown',
        resetRecommended: false,
        confidence: 'low',
        reason: 'missing-assignment',
      },
      action
    );
  }

  const verdict = classifyAction(assignment, action.actionType);

  return withReviewerFields(
    {
      assignment,
      identityKey: assignment.identityKey,
      reclassificationType: assignment.reclassificationType,
      evaluatedSeasonId: assignment.evaluatedSeasonId,
      requestedAction: action.actionType,
      accepted: verdict.accepted,
      resultingReviewState: verdict.resultingReviewState,
      resultingActiveStatus: verdict.resultingActiveStatus,
      resetRecommended: verdict.resetRecommended,
      confidence: verdict.confidence,
      reason: verdict.reason,
    },
    action
  );
}

/**
 * Attaches the optional reviewer fields to a result, but only when the action
 * supplied a non-empty string for each. This keeps absent metadata absent rather
 * than echoing back empty strings.
 */
function withReviewerFields(
  result: CohortReclassificationReviewActionResult,
  action: CohortReclassificationReviewActionInput
): CohortReclassificationReviewActionResult {
  if (typeof action.reviewerNote === 'string' && action.reviewerNote !== '') {
    result.reviewerNote = action.reviewerNote;
  }
  if (typeof action.reviewedAt === 'string' && action.reviewedAt !== '') {
    result.reviewedAt = action.reviewedAt;
  }
  if (typeof action.reviewerId === 'string' && action.reviewerId !== '') {
    result.reviewerId = action.reviewerId;
  }
  return result;
}

/**
 * Counts review-action results by acceptance, resulting review state, and
 * requested action type. Pure and deterministic; reads only each result's
 * `accepted`, `resultingReviewState`, and `requestedAction`.
 */
export function summarizeCohortReclassificationReviewActions(
  results: CohortReclassificationReviewActionResult[]
): CohortReclassificationReviewActionSummary {
  const summary: CohortReclassificationReviewActionSummary = {
    total: results.length,
    accepted: 0,
    rejected: 0,
    confirmed: 0,
    reset: 0,
    deferred: 0,
    insufficientData: 0,
    byAction: {
      confirm: 0,
      reset: 0,
      defer: 0,
      markInsufficientData: 0,
    },
  };

  for (const result of results) {
    if (result.accepted) {
      summary.accepted += 1;
    } else {
      summary.rejected += 1;
    }

    switch (result.resultingReviewState) {
      case 'confirmed':
        summary.confirmed += 1;
        break;
      case 'reset':
        summary.reset += 1;
        break;
      case 'deferred':
        summary.deferred += 1;
        break;
      case 'insufficient-data':
        summary.insufficientData += 1;
        break;
      // 'rejected' is already counted under summary.rejected.
    }

    switch (result.requestedAction) {
      case 'confirm':
        summary.byAction.confirm += 1;
        break;
      case 'reset':
        summary.byAction.reset += 1;
        break;
      case 'defer':
        summary.byAction.defer += 1;
        break;
      case 'mark-insufficient-data':
        summary.byAction.markInsufficientData += 1;
        break;
    }
  }

  return summary;
}
