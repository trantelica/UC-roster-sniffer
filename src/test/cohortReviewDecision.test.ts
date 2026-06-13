import { describe, it, expect } from 'vitest';
import {
  COHORT_REVIEW_DECISION_LOGIC_VERSION,
  createCohortReviewDecision,
  summarizeCohortReviewDecisions,
  validateCohortReviewDecision,
} from '../engine/cohortReviewDecision';
import type { CohortReviewDecision } from '../engine/cohortReviewDecision';
import { applyCohortReclassificationReviewAction } from '../engine/cohortReclassificationReviewAction';
import type { CohortReclassificationReviewActionInput } from '../engine/cohortReclassificationReviewAction';
import { deriveCohortReclassificationAssignments } from '../engine/cohortReclassificationAssignment';
import type {
  CohortReclassificationAssignment,
  CohortReclassificationAssignmentActiveStatus,
} from '../engine/cohortReclassificationAssignment';
import { classifyCohortReclassificationReview } from '../engine/cohortReclassificationReview';
import { carryForwardCohortReclassificationStatus } from '../engine/cohortReclassificationCarryForward';
import { detectCohortReclassificationSignals } from '../engine/cohortReclassificationSignal';
import { deriveFirstYearCohortReclassificationRecords } from '../engine/cohortReclassificationRecord';
import type { CohortReclassificationRecord } from '../engine/cohortReclassificationRecord';
import type {
  RosterMovementRecord,
  TeamSlotContext,
} from '../engine/playerMovementDetection';

// ---------------------------------------------------------------------------
// Helpers (mirror the slice 6 action test scaffolding)
// ---------------------------------------------------------------------------

function team(
  seasonId: string,
  ageDivisionId: string,
  overrides: Partial<TeamSlotContext> = {}
): TeamSlotContext {
  return {
    seasonId,
    districtId: 'alta',
    ageDivisionId,
    teamCode: 'B1',
    ...overrides,
  };
}

function rec(
  name: string,
  teamSlot: TeamSlotContext,
  id?: string
): RosterMovementRecord {
  return { player: id ? { name, id } : { name }, team: teamSlot };
}

function firstYearRecord(
  name: string,
  priorSeasonId: string,
  priorAgeDivisionId: string,
  firstSeasonId: string,
  firstAgeDivisionId: string
): CohortReclassificationRecord {
  const current = rec(name, team(firstSeasonId, firstAgeDivisionId), 'c');
  const prior = rec(name, team(priorSeasonId, priorAgeDivisionId), 'p');
  const signals = detectCohortReclassificationSignals([current], [prior]);
  const { records } = deriveFirstYearCohortReclassificationRecords(signals);
  expect(records).toHaveLength(1);
  return records[0];
}

const SEASON_ORDER = ['2024', '2025', '2026', '2027', '2028'];

function assignmentFor(
  record: CohortReclassificationRecord,
  current: RosterMovementRecord[],
  expectedActiveStatus: CohortReclassificationAssignmentActiveStatus
): CohortReclassificationAssignment {
  const carryForward = carryForwardCohortReclassificationStatus(
    [record],
    current,
    SEASON_ORDER
  );
  const review = classifyCohortReclassificationReview(carryForward);
  const { assignments } = deriveCohortReclassificationAssignments(review);
  expect(assignments[0].activeStatus).toBe(expectedActiveStatus);
  return assignments[0];
}

function activeAssignment(name = 'Sky High'): CohortReclassificationAssignment {
  const record = firstYearRecord(name, '2025', 'GR', '2026', 'MM');
  return assignmentFor(record, [rec(name, team('2027', 'GI'), 'p-sky')], 'active');
}

function inactiveAssignment(): CohortReclassificationAssignment {
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  return assignmentFor(record, [rec('Sky High', team('2027', 'MM'))], 'inactive');
}

function reviewAssignment(): CohortReclassificationAssignment {
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  return assignmentFor(record, [rec('Sky High', team('2027', 'SC'))], 'review');
}

/**
 * Insufficient-data via the UNUSABLE-SEASON-ORDER route (empty seasonOrder), so the
 * current record is still matched and the assignment keeps an evaluatedSeasonId.
 * (The missing-current-record route yields a null evaluatedSeasonId, which the
 * decision contract intentionally refuses — see the dedicated skip test below.)
 */
function insufficientAssignment(): CohortReclassificationAssignment {
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  const carryForward = carryForwardCohortReclassificationStatus(
    [record],
    [rec('Sky High', team('2027', 'GI'))],
    [] // empty season order -> insufficient-history / missing-season-order
  );
  const review = classifyCohortReclassificationReview(carryForward);
  const { assignments } = deriveCohortReclassificationAssignments(review);
  expect(assignments[0].activeStatus).toBe('insufficient-data');
  expect(assignments[0].evaluatedSeasonId).toBe('2027');
  return assignments[0];
}

/** Insufficient-data via a MISSING current record, so evaluatedSeasonId is null. */
function insufficientNoEvaluatedSeasonAssignment(): CohortReclassificationAssignment {
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  const assignment = assignmentFor(
    record,
    [rec('Someone Else', team('2027', 'GI'))],
    'insufficient-data'
  );
  expect(assignment.evaluatedSeasonId).toBeNull();
  return assignment;
}

/** Runs slice 6 then attempts to build a decision with default deterministic opts. */
function decisionFrom(
  assignment: CohortReclassificationAssignment,
  action: CohortReclassificationReviewActionInput,
  opts: Partial<{
    decisionId: string;
    createdAt: string;
    createdBy?: string;
    supersedesDecisionId?: string;
    lockedSourceSeasonIds?: string[];
  }> = {}
) {
  const actionResult = applyCohortReclassificationReviewAction(assignment, action);
  return createCohortReviewDecision(actionResult, {
    decisionId: 'decision-1',
    createdAt: '2026-06-13T00:00:00Z',
    ...opts,
  });
}

// ---------------------------------------------------------------------------
// 1. Accepted actions create decisions
// ---------------------------------------------------------------------------

describe('createCohortReviewDecision - accepted actions', () => {
  it('creates a decision from an accepted confirm', () => {
    const result = decisionFrom(activeAssignment(), { actionType: 'confirm' });
    expect(result.created).toBe(true);
    expect(result.reason).toBe('created');
    const d = result.decision!;
    expect(d.decisionType).toBe('confirm');
    expect(d.reviewActionState).toBe('confirmed');
    expect(d.resultingActiveStatus).toBe('active');
    expect(d.identityKey).toBe('sky high');
    expect(d.reclassificationType).toBe('y-up');
    expect(d.evaluatedSeasonId).toBe('2027');
    expect(d.firstDetectedSeasonId).toBe('2026');
    expect(d.priorAgeDivisionId).toBe('GR');
    expect(d.firstDetectedAgeDivisionId).toBe('MM');
    expect(d.cohortOffset).toBe(1);
    expect(d.source.logicVersion).toBe(COHORT_REVIEW_DECISION_LOGIC_VERSION);
    expect(d.audit.createdAt).toBe('2026-06-13T00:00:00Z');
    expect(d.audit.lockedSourceSeasonIds).toEqual([]);
  });

  it('creates a decision from an accepted reset', () => {
    const result = decisionFrom(inactiveAssignment(), { actionType: 'reset' });
    expect(result.created).toBe(true);
    const d = result.decision!;
    expect(d.decisionType).toBe('reset');
    expect(d.reviewActionState).toBe('reset');
    expect(d.resultingActiveStatus).toBe('inactive');
    expect(d.resetRecommendedAtDecisionTime).toBe(true);
  });

  it('creates a decision from an accepted defer', () => {
    const result = decisionFrom(reviewAssignment(), { actionType: 'defer' });
    expect(result.created).toBe(true);
    const d = result.decision!;
    expect(d.decisionType).toBe('defer');
    expect(d.reviewActionState).toBe('deferred');
    expect(d.resultingActiveStatus).toBe('review');
  });

  it('creates a decision from an accepted mark-insufficient-data', () => {
    const result = decisionFrom(insufficientAssignment(), {
      actionType: 'mark-insufficient-data',
    });
    expect(result.created).toBe(true);
    const d = result.decision!;
    expect(d.decisionType).toBe('mark-insufficient-data');
    expect(d.reviewActionState).toBe('insufficient-data');
    expect(d.resultingActiveStatus).toBe('insufficient-data');
  });
});

// ---------------------------------------------------------------------------
// 2. Rejected / invalid actions do not create decisions
// ---------------------------------------------------------------------------

describe('createCohortReviewDecision - skipped creations', () => {
  it('does not create a decision from a rejected action result', () => {
    // reset on a clean active assignment is rejected by slice 6.
    const result = decisionFrom(activeAssignment(), { actionType: 'reset' });
    expect(result.created).toBe(false);
    expect(result.decision).toBeNull();
    expect(result.reason).toBe('action-not-accepted');
  });

  it('does not create a decision when no assignment is supplied', () => {
    const actionResult = applyCohortReclassificationReviewAction(null, {
      actionType: 'confirm',
    });
    // A missing assignment is already rejected, so it stops at action-not-accepted.
    const result = createCohortReviewDecision(actionResult, {
      decisionId: 'decision-1',
      createdAt: '2026-06-13T00:00:00Z',
    });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('action-not-accepted');
  });

  it('does not create a decision when identityKey is empty', () => {
    const actionResult = applyCohortReclassificationReviewAction(
      activeAssignment(),
      { actionType: 'confirm' }
    );
    const tampered = { ...actionResult, identityKey: '   ' };
    const result = createCohortReviewDecision(tampered, {
      decisionId: 'decision-1',
      createdAt: '2026-06-13T00:00:00Z',
    });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('missing-identity-key');
  });

  it('does not create a decision when evaluatedSeasonId is missing', () => {
    // A missing-current-record insufficient-data assignment has no evaluated season,
    // so even an accepted mark-insufficient-data action cannot become a decision.
    const result = decisionFrom(insufficientNoEvaluatedSeasonAssignment(), {
      actionType: 'mark-insufficient-data',
    });
    expect(result.created).toBe(false);
    expect(result.reason).toBe('missing-evaluated-season');
  });

  it('does not create a decision when decisionId is missing', () => {
    const result = decisionFrom(
      activeAssignment(),
      { actionType: 'confirm' },
      { decisionId: '' }
    );
    expect(result.created).toBe(false);
    expect(result.reason).toBe('missing-decision-id');
  });

  it('does not create a decision when createdAt is missing', () => {
    const result = decisionFrom(
      activeAssignment(),
      { actionType: 'confirm' },
      { createdAt: '' }
    );
    expect(result.created).toBe(false);
    expect(result.reason).toBe('missing-created-at');
  });
});

// ---------------------------------------------------------------------------
// 3. Metadata preservation
// ---------------------------------------------------------------------------

describe('createCohortReviewDecision - metadata preservation', () => {
  it('preserves reviewer note / timestamp / id from the action result', () => {
    const result = decisionFrom(activeAssignment(), {
      actionType: 'confirm',
      reviewerNote: 'confirmed by coach',
      reviewedAt: '2026-06-12T00:00:00Z',
      reviewerId: 'coach-1',
    });
    const d = result.decision!;
    expect(d.reviewerNote).toBe('confirmed by coach');
    expect(d.reviewedAt).toBe('2026-06-12T00:00:00Z');
    expect(d.reviewerId).toBe('coach-1');
  });

  it('preserves source pipeline metadata for re-audit', () => {
    const result = decisionFrom(reviewAssignment(), { actionType: 'confirm' });
    const d = result.decision!;
    expect(d.source.sourceAssignmentStatus).toBe('review');
    expect(d.source.sourceReviewStatus).toBe('needs-review');
    expect(d.source.sourceReviewReason).toBe(
      'path-broken-unexpected-age-division'
    );
    expect(d.source.sourceCarryForwardStatus).toBe('path-broken');
    expect(d.source.sourceCarryForwardReason).toBe('unexpected-age-division');
  });

  it('carries audit createdBy, supersedesDecisionId, and a copied lockedSourceSeasonIds', () => {
    const locked = ['2025', '2026'];
    const result = decisionFrom(
      activeAssignment(),
      { actionType: 'confirm' },
      {
        createdBy: 'coach-1',
        supersedesDecisionId: 'decision-0',
        lockedSourceSeasonIds: locked,
      }
    );
    const d = result.decision!;
    expect(d.audit.createdBy).toBe('coach-1');
    expect(d.audit.supersedesDecisionId).toBe('decision-0');
    expect(d.audit.lockedSourceSeasonIds).toEqual(['2025', '2026']);
    // A copy, not the caller's array reference.
    expect(d.audit.lockedSourceSeasonIds).not.toBe(locked);
  });

  it('omits optional fields when not supplied', () => {
    const result = decisionFrom(activeAssignment(), { actionType: 'confirm' });
    const d = result.decision!;
    expect('reviewerNote' in d).toBe(false);
    expect('reviewedAt' in d).toBe(false);
    expect('reviewerId' in d).toBe(false);
    expect('createdBy' in d.audit).toBe(false);
    expect('supersedesDecisionId' in d.audit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Roster authority: a reset decision does not delete/mutate the first-year record
// ---------------------------------------------------------------------------

describe('createCohortReviewDecision - roster authority', () => {
  it('does not delete or mutate the first-year source record on a reset decision', () => {
    const assignment = inactiveAssignment();
    const firstYearSnapshot = structuredClone(assignment.firstYearRecord);

    const actionResult = applyCohortReclassificationReviewAction(assignment, {
      actionType: 'reset',
    });
    const actionSnapshot = structuredClone(actionResult);

    const result = createCohortReviewDecision(actionResult, {
      decisionId: 'decision-1',
      createdAt: '2026-06-13T00:00:00Z',
    });

    expect(result.created).toBe(true);
    // The first-year event record still exists and is unchanged.
    expect(assignment.firstYearRecord).toEqual(firstYearSnapshot);
    // The action result (and thus the whole upstream chain) is not mutated.
    expect(actionResult).toEqual(actionSnapshot);
  });

  it('does not mutate the action result it consumes', () => {
    const actionResult = applyCohortReclassificationReviewAction(
      activeAssignment(),
      { actionType: 'confirm' }
    );
    const snapshot = structuredClone(actionResult);
    createCohortReviewDecision(actionResult, {
      decisionId: 'decision-1',
      createdAt: '2026-06-13T00:00:00Z',
    });
    expect(actionResult).toEqual(snapshot);
  });

  it('is deterministic for the same inputs', () => {
    const actionResult = applyCohortReclassificationReviewAction(
      activeAssignment(),
      { actionType: 'confirm' }
    );
    const opts = { decisionId: 'decision-1', createdAt: '2026-06-13T00:00:00Z' };
    const a = createCohortReviewDecision(actionResult, opts);
    const b = createCohortReviewDecision(actionResult, opts);
    expect(b).toEqual(a);
  });
});

// ---------------------------------------------------------------------------
// 5. validateCohortReviewDecision
// ---------------------------------------------------------------------------

function validDecision(): CohortReviewDecision {
  return createCohortReviewDecision(
    applyCohortReclassificationReviewAction(activeAssignment(), {
      actionType: 'confirm',
    }),
    { decisionId: 'decision-1', createdAt: '2026-06-13T00:00:00Z' }
  ).decision!;
}

describe('validateCohortReviewDecision', () => {
  it('accepts a well-formed decision', () => {
    const result = validateCohortReviewDecision(validDecision());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a confirm decision that claims a reset state', () => {
    const decision = { ...validDecision(), reviewActionState: 'reset' as const };
    const result = validateCohortReviewDecision(decision);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('confirm-decision-claims-reset-state');
    expect(result.errors).toContain('incoherent-decision-type-and-state');
  });

  it('rejects a reset decision that claims active status', () => {
    const base = createCohortReviewDecision(
      applyCohortReclassificationReviewAction(inactiveAssignment(), {
        actionType: 'reset',
      }),
      { decisionId: 'decision-1', createdAt: '2026-06-13T00:00:00Z' }
    ).decision!;
    const decision = { ...base, resultingActiveStatus: 'active' as const };
    const result = validateCohortReviewDecision(decision);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('reset-decision-claims-active-status');
  });

  it('rejects missing identity / season / id / timestamp', () => {
    const decision: CohortReviewDecision = {
      ...validDecision(),
      decisionId: '',
      identityKey: '',
      evaluatedSeasonId: '',
      audit: { createdAt: '', lockedSourceSeasonIds: [] },
    };
    const result = validateCohortReviewDecision(decision);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'missing-decision-id',
        'missing-identity-key',
        'missing-evaluated-season',
        'missing-created-at',
      ])
    );
  });

  it('does not mutate the decision it validates', () => {
    const decision = validDecision();
    const snapshot = structuredClone(decision);
    validateCohortReviewDecision(decision);
    expect(decision).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 6. summarizeCohortReviewDecisions
// ---------------------------------------------------------------------------

describe('summarizeCohortReviewDecisions', () => {
  it('counts types, reclassification, notes, supersession, and invalid', () => {
    const confirm = decisionFrom(activeAssignment('Up One'), {
      actionType: 'confirm',
      reviewerNote: 'ok',
    }).decision!;
    const reset = decisionFrom(inactiveAssignment(), {
      actionType: 'reset',
    }).decision!;
    const defer = decisionFrom(
      reviewAssignment(),
      { actionType: 'defer' },
      { supersedesDecisionId: 'decision-0' }
    ).decision!;
    const insufficient = decisionFrom(insufficientAssignment(), {
      actionType: 'mark-insufficient-data',
    }).decision!;
    // An invalid decision (incoherent type/state) to exercise the invalid count.
    const invalid: CohortReviewDecision = {
      ...confirm,
      reviewActionState: 'reset',
    };

    const summary = summarizeCohortReviewDecisions([
      confirm,
      reset,
      defer,
      insufficient,
      invalid,
    ]);
    expect(summary.total).toBe(5);
    expect(summary.confirm).toBe(2); // confirm + invalid (still a confirm type)
    expect(summary.reset).toBe(1);
    expect(summary.defer).toBe(1);
    expect(summary.markInsufficientData).toBe(1);
    expect(summary.yUp).toBe(5); // all fixtures are y-up
    expect(summary.zDown).toBe(0);
    expect(summary.withReviewerNote).toBe(2); // confirm + its invalid clone
    expect(summary.superseding).toBe(1);
    expect(summary.invalid).toBe(1);
  });

  it('summarizes an empty list as all zeros', () => {
    expect(summarizeCohortReviewDecisions([])).toEqual({
      total: 0,
      confirm: 0,
      reset: 0,
      defer: 0,
      markInsufficientData: 0,
      yUp: 0,
      zDown: 0,
      withReviewerNote: 0,
      superseding: 0,
      invalid: 0,
    });
  });
});
