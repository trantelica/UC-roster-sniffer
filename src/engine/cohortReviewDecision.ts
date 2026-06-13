import type { CohortReclassificationAssignmentActiveStatus } from './cohortReclassificationAssignment';
import type {
  CohortReclassificationCarryForwardReason,
  CohortReclassificationCarryForwardStatus,
  CohortReclassificationCarryForwardType,
} from './cohortReclassificationCarryForward';
import type {
  CohortReclassificationReviewReason,
  CohortReclassificationReviewStatus,
} from './cohortReclassificationReview';
import type { CohortReclassificationReviewActionResult } from './cohortReclassificationReviewAction';

/**
 * Phase 4 slice 7: cohort review decision PERSISTENCE CONTRACT — ENGINE ONLY.
 *
 * Slices 1–6 build the full derivation chain and end at a validated review-ACTION
 * result (`applyCohortReclassificationReviewAction`). This slice defines the
 * persistable shape of an ACCEPTED review decision and provides small pure helpers
 * to build, validate, and summarize those decisions. See `docs/data-model.md`
 * ("Cohort Review Decision") and `docs/derived-logic.md` ("Cohort review decision
 * persistence contract (Phase 4 slice 7)") for the governing contract.
 *
 * This slice defines the CONTRACT only. It does NOT write to storage
 * (no localStorage / IndexedDB / file), add UI, mutate roster records, unlock prior
 * seasons, or perform any reset side effect. A reset DECISION ends the active cohort
 * status from the evaluated-season perspective but never deletes the first-year
 * reclassification event record.
 *
 * Contract invariants enforced here:
 *   - Only ACCEPTED action results may become decisions (rejected ones are skipped).
 *   - Decisions are append-only: a later decision may reference an earlier one via
 *     `audit.supersedesDecisionId`, but this helper never mutates an earlier
 *     decision or any source object.
 *   - Decisions carry enough source metadata (assignment / review / carry-forward
 *     status + reason, plus a logic version) to re-audit why the decision was made.
 *   - Purity: ids and timestamps are CALLER-PROVIDED. This module never calls
 *     `Date.now()` or generates ids, so output is fully deterministic.
 */

/** Bump when the decision derivation or contract shape changes. */
export const COHORT_REVIEW_DECISION_LOGIC_VERSION =
  'phase4-slice7-cohort-review-decision-v1';

export type CohortReviewDecisionType =
  | 'confirm'
  | 'reset'
  | 'defer'
  | 'mark-insufficient-data';

export type CohortReviewDecisionState =
  | 'confirmed'
  | 'reset'
  | 'deferred'
  | 'insufficient-data';

/**
 * Source metadata preserved on every decision so a reviewer can re-audit the
 * derived state the decision was made against. All values are copied (not
 * referenced) from the upstream assignment.
 */
export type CohortReviewDecisionSource = {
  logicVersion: string;
  sourceAssignmentStatus: CohortReclassificationAssignmentActiveStatus;
  sourceReviewStatus: CohortReclassificationReviewStatus;
  sourceReviewReason: CohortReclassificationReviewReason;
  sourceCarryForwardStatus: CohortReclassificationCarryForwardStatus;
  sourceCarryForwardReason: CohortReclassificationCarryForwardReason;
};

/**
 * Append-only audit envelope. `createdAt` / `createdBy` / `supersedesDecisionId`
 * are caller-provided; `lockedSourceSeasonIds` records prior seasons that remain
 * locked and must not be edited because of this decision (a fresh copy of the
 * caller's array, never the caller's reference).
 */
export type CohortReviewDecisionAudit = {
  createdAt: string;
  createdBy?: string;
  supersedesDecisionId?: string;
  lockedSourceSeasonIds: string[];
};

/**
 * A persistable cohort review decision. This is a SEPARATE record from any roster
 * row — it preserves a reviewer's decision about derived cohort status and never
 * rewrites source rosters, players, teams, or prior seasons.
 */
export type CohortReviewDecision = {
  decisionId: string;
  decisionType: CohortReviewDecisionType;
  reclassificationType: CohortReclassificationCarryForwardType | null;
  identityKey: string;
  playerId: string | null;
  playerDisplayName: string | null;
  firstDetectedSeasonId: string | null;
  evaluatedSeasonId: string;
  priorAgeDivisionId: string | null;
  firstDetectedAgeDivisionId: string | null;
  expectedAgeDivisionId: string | null;
  actualAgeDivisionId: string | null;
  cohortOffset: number | null;
  reviewActionState: CohortReviewDecisionState;
  resultingActiveStatus: CohortReclassificationAssignmentActiveStatus;
  resetRecommendedAtDecisionTime: boolean;
  reviewerNote?: string;
  reviewedAt?: string;
  reviewerId?: string;
  source: CohortReviewDecisionSource;
  audit: CohortReviewDecisionAudit;
};

export type CreateCohortReviewDecisionOptions = {
  decisionId: string;
  createdAt: string;
  createdBy?: string;
  supersedesDecisionId?: string;
  lockedSourceSeasonIds?: readonly string[];
};

export type CreateCohortReviewDecisionReason =
  | 'created'
  | 'action-not-accepted'
  | 'missing-assignment'
  | 'missing-identity-key'
  | 'missing-evaluated-season'
  | 'missing-decision-id'
  | 'missing-created-at';

/**
 * The outcome of attempting to build a decision. `created` is false (with `decision`
 * null and an explaining `reason` + `messages`) for any normal validation failure;
 * the helper never throws for those.
 */
export type CreateCohortReviewDecisionResult = {
  created: boolean;
  decision: CohortReviewDecision | null;
  reason: CreateCohortReviewDecisionReason;
  messages: string[];
};

/** Maps the four accepted action states to their decision state. */
const ACCEPTED_STATES: ReadonlySet<string> = new Set([
  'confirmed',
  'reset',
  'deferred',
  'insufficient-data',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Builds a persistable cohort review decision from an ACCEPTED slice 6 review
 * action result plus caller-provided deterministic ids/timestamps. Pure: reads
 * only its inputs, never mutates them, never generates ids or timestamps, and
 * returns a result object instead of throwing on normal validation failures.
 *
 * Validation precedence (each returns `created: false`):
 *   1. Action result not accepted (or rejected state)  -> action-not-accepted.
 *   2. No source assignment on the action result        -> missing-assignment.
 *   3. Empty / whitespace identity key                  -> missing-identity-key.
 *   4. Missing evaluated season                         -> missing-evaluated-season.
 *   5. Missing caller decision id                       -> missing-decision-id.
 *   6. Missing caller createdAt timestamp               -> missing-created-at.
 */
export function createCohortReviewDecision(
  actionResult: CohortReclassificationReviewActionResult,
  options: CreateCohortReviewDecisionOptions
): CreateCohortReviewDecisionResult {
  const skip = (
    reason: CreateCohortReviewDecisionReason,
    message: string
  ): CreateCohortReviewDecisionResult => ({
    created: false,
    decision: null,
    reason,
    messages: [message],
  });

  // 1. Only accepted action results may become decisions.
  if (
    !actionResult.accepted ||
    !ACCEPTED_STATES.has(actionResult.resultingReviewState)
  ) {
    return skip(
      'action-not-accepted',
      'Only accepted review action results can become persisted decisions.'
    );
  }

  // 2. An accepted result always carries an assignment, but guard defensively.
  const assignment = actionResult.assignment;
  if (assignment == null) {
    return skip(
      'missing-assignment',
      'The review action result has no source assignment to derive a decision from.'
    );
  }

  // 3. Identity key must be usable.
  if (!isNonEmptyString(actionResult.identityKey)) {
    return skip(
      'missing-identity-key',
      'A decision requires a non-empty identity key.'
    );
  }

  // 4. Evaluated season must be present.
  if (!isNonEmptyString(actionResult.evaluatedSeasonId)) {
    return skip(
      'missing-evaluated-season',
      'A decision requires an evaluated season id.'
    );
  }

  // 5/6. Deterministic caller-provided id and timestamp are required.
  if (!isNonEmptyString(options.decisionId)) {
    return skip(
      'missing-decision-id',
      'A caller-provided decisionId is required (this helper never generates ids).'
    );
  }
  if (!isNonEmptyString(options.createdAt)) {
    return skip(
      'missing-created-at',
      'A caller-provided createdAt is required (this helper never calls Date.now()).'
    );
  }

  const decision: CohortReviewDecision = {
    decisionId: options.decisionId,
    decisionType: actionResult.requestedAction,
    reclassificationType: actionResult.reclassificationType,
    identityKey: actionResult.identityKey,
    playerId: isNonEmptyString(assignment.player.id)
      ? assignment.player.id
      : null,
    playerDisplayName: isNonEmptyString(assignment.player.name)
      ? assignment.player.name
      : null,
    firstDetectedSeasonId: assignment.firstDetectedSeasonId ?? null,
    evaluatedSeasonId: actionResult.evaluatedSeasonId as string,
    priorAgeDivisionId: assignment.priorAgeDivisionId ?? null,
    firstDetectedAgeDivisionId: assignment.firstDetectedAgeDivisionId ?? null,
    expectedAgeDivisionId: assignment.expectedAgeDivisionId,
    actualAgeDivisionId: assignment.actualAgeDivisionId,
    cohortOffset:
      typeof assignment.cohortOffset === 'number'
        ? assignment.cohortOffset
        : null,
    reviewActionState:
      actionResult.resultingReviewState as CohortReviewDecisionState,
    resultingActiveStatus: actionResult.resultingActiveStatus,
    // The recommendation as it stood at review time (the assignment's flag),
    // not the would-be post-action flag.
    resetRecommendedAtDecisionTime: assignment.resetRecommended,
    source: {
      logicVersion: COHORT_REVIEW_DECISION_LOGIC_VERSION,
      sourceAssignmentStatus: assignment.activeStatus,
      sourceReviewStatus: assignment.reviewStatus,
      sourceReviewReason: assignment.reviewReason,
      sourceCarryForwardStatus: assignment.carryForwardStatus,
      sourceCarryForwardReason: assignment.carryForwardReason,
    },
    audit: {
      createdAt: options.createdAt,
      lockedSourceSeasonIds: [...(options.lockedSourceSeasonIds ?? [])],
    },
  };

  if (isNonEmptyString(actionResult.reviewerNote)) {
    decision.reviewerNote = actionResult.reviewerNote;
  }
  if (isNonEmptyString(actionResult.reviewedAt)) {
    decision.reviewedAt = actionResult.reviewedAt;
  }
  if (isNonEmptyString(actionResult.reviewerId)) {
    decision.reviewerId = actionResult.reviewerId;
  }
  if (isNonEmptyString(options.createdBy)) {
    decision.audit.createdBy = options.createdBy;
  }
  if (isNonEmptyString(options.supersedesDecisionId)) {
    decision.audit.supersedesDecisionId = options.supersedesDecisionId;
  }

  return {
    created: true,
    decision,
    reason: 'created',
    messages: [],
  };
}

export type CohortReviewDecisionValidationError =
  | 'missing-decision-id'
  | 'missing-identity-key'
  | 'missing-evaluated-season'
  | 'missing-created-at'
  | 'invalid-decision-type'
  | 'invalid-review-action-state'
  | 'incoherent-decision-type-and-state'
  | 'reset-decision-claims-active-status'
  | 'confirm-decision-claims-reset-state';

export type ValidateCohortReviewDecisionResult = {
  valid: boolean;
  errors: CohortReviewDecisionValidationError[];
};

const DECISION_TYPES: ReadonlySet<string> = new Set([
  'confirm',
  'reset',
  'defer',
  'mark-insufficient-data',
]);
const DECISION_STATES: ReadonlySet<string> = new Set([
  'confirmed',
  'reset',
  'deferred',
  'insufficient-data',
]);

/** The single coherent review-action state for each decision type. */
const COHERENT_STATE: Record<
  CohortReviewDecisionType,
  CohortReviewDecisionState
> = {
  confirm: 'confirmed',
  reset: 'reset',
  defer: 'deferred',
  'mark-insufficient-data': 'insufficient-data',
};

/**
 * Validates a persisted (or candidate) cohort review decision against the contract.
 * Pure: reads only the decision and returns a structured result; never throws and
 * never mutates the decision.
 *
 * Checks: required identity / season / id / timestamp fields, valid `decisionType`
 * and `reviewActionState`, their coherence, and the two contract-specific guards —
 * a `reset` decision must not claim an active/first-year status, and a `confirm`
 * decision must not claim a `reset` state.
 */
export function validateCohortReviewDecision(
  decision: CohortReviewDecision
): ValidateCohortReviewDecisionResult {
  const errors: CohortReviewDecisionValidationError[] = [];

  if (!isNonEmptyString(decision.decisionId)) {
    errors.push('missing-decision-id');
  }
  if (!isNonEmptyString(decision.identityKey)) {
    errors.push('missing-identity-key');
  }
  if (!isNonEmptyString(decision.evaluatedSeasonId)) {
    errors.push('missing-evaluated-season');
  }
  if (!isNonEmptyString(decision.audit?.createdAt)) {
    errors.push('missing-created-at');
  }

  const validType = DECISION_TYPES.has(decision.decisionType);
  const validState = DECISION_STATES.has(decision.reviewActionState);
  if (!validType) {
    errors.push('invalid-decision-type');
  }
  if (!validState) {
    errors.push('invalid-review-action-state');
  }

  // Coherence between type and state (only when both are individually valid).
  if (
    validType &&
    validState &&
    COHERENT_STATE[decision.decisionType] !== decision.reviewActionState
  ) {
    errors.push('incoherent-decision-type-and-state');
  }

  // A reset decision must not claim an active cohort status.
  if (
    decision.decisionType === 'reset' &&
    (decision.resultingActiveStatus === 'active' ||
      decision.resultingActiveStatus === 'first-year')
  ) {
    errors.push('reset-decision-claims-active-status');
  }

  // A confirm decision must not claim a reset state.
  if (
    decision.decisionType === 'confirm' &&
    decision.reviewActionState === 'reset'
  ) {
    errors.push('confirm-decision-claims-reset-state');
  }

  return { valid: errors.length === 0, errors };
}

export type CohortReviewDecisionSummary = {
  total: number;
  confirm: number;
  reset: number;
  defer: number;
  markInsufficientData: number;
  yUp: number;
  zDown: number;
  withReviewerNote: number;
  superseding: number;
  invalid: number;
};

/**
 * Counts decisions by type, reclassification type, reviewer-note presence,
 * supersession, and validity. Pure and deterministic; validity is computed via
 * {@link validateCohortReviewDecision} and does not mutate the decisions.
 */
export function summarizeCohortReviewDecisions(
  decisions: CohortReviewDecision[]
): CohortReviewDecisionSummary {
  const summary: CohortReviewDecisionSummary = {
    total: decisions.length,
    confirm: 0,
    reset: 0,
    defer: 0,
    markInsufficientData: 0,
    yUp: 0,
    zDown: 0,
    withReviewerNote: 0,
    superseding: 0,
    invalid: 0,
  };

  for (const decision of decisions) {
    switch (decision.decisionType) {
      case 'confirm':
        summary.confirm += 1;
        break;
      case 'reset':
        summary.reset += 1;
        break;
      case 'defer':
        summary.defer += 1;
        break;
      case 'mark-insufficient-data':
        summary.markInsufficientData += 1;
        break;
    }

    if (decision.reclassificationType === 'y-up') {
      summary.yUp += 1;
    } else if (decision.reclassificationType === 'z-down') {
      summary.zDown += 1;
    }

    if (isNonEmptyString(decision.reviewerNote)) {
      summary.withReviewerNote += 1;
    }
    if (isNonEmptyString(decision.audit?.supersedesDecisionId)) {
      summary.superseding += 1;
    }
    if (!validateCohortReviewDecision(decision).valid) {
      summary.invalid += 1;
    }
  }

  return summary;
}
