import { describe, it, expect } from 'vitest';
import {
  applyCohortReclassificationReviewAction,
  summarizeCohortReclassificationReviewActions,
} from '../engine/cohortReclassificationReviewAction';
import type { CohortReclassificationReviewActionResult } from '../engine/cohortReclassificationReviewAction';
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
// Helpers
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

/**
 * Builds a REAL slice 5 assignment through the full slice 1-5 pipeline and asserts
 * its derived activeStatus matches, so the action tests stay anchored to real
 * upstream output.
 */
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
  expect(assignments).toHaveLength(1);
  expect(assignments[0].activeStatus).toBe(expectedActiveStatus);
  return assignments[0];
}

function activeAssignment(): CohortReclassificationAssignment {
  // y-up Sky High GR(2025) -> MM(2026); 2027 GI is the offset path -> active.
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  return assignmentFor(record, [rec('Sky High', team('2027', 'GI'))], 'active');
}

function firstYearAssignment(): CohortReclassificationAssignment {
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  return assignmentFor(
    record,
    [rec('Sky High', team('2026', 'MM'))],
    'first-year'
  );
}

function inactiveAssignment(): CohortReclassificationAssignment {
  // returned-to-normal path -> reset-recommended -> inactive, resetRecommended true.
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  return assignmentFor(
    record,
    [rec('Sky High', team('2027', 'MM'))],
    'inactive'
  );
}

function reviewAssignment(): CohortReclassificationAssignment {
  // unexpected division -> needs-review -> review.
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  return assignmentFor(record, [rec('Sky High', team('2027', 'SC'))], 'review');
}

function insufficientDataAssignment(): CohortReclassificationAssignment {
  // missing current record -> insufficient-data.
  const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
  return assignmentFor(
    record,
    [rec('Someone Else', team('2027', 'GI'))],
    'insufficient-data'
  );
}

/** A synthetic assignment with a forced activeStatus for defensive coverage. */
function syntheticAssignment(
  activeStatus: CohortReclassificationAssignmentActiveStatus,
  resetRecommended = false
): CohortReclassificationAssignment {
  return {
    reviewEntry: {} as CohortReclassificationAssignment['reviewEntry'],
    carryForwardEntry: {} as CohortReclassificationAssignment['carryForwardEntry'],
    player: { name: 'Synthetic One' },
    firstYearRecord: {} as CohortReclassificationRecord,
    currentRecord: null,
    identityKey: 'synthetic one',
    reclassificationType: 'y-up',
    firstDetectedSeasonId: '2026',
    evaluatedSeasonId: '2027',
    priorAgeDivisionId: 'GR',
    firstDetectedAgeDivisionId: 'MM',
    expectedAgeDivisionId: 'GI',
    actualAgeDivisionId: 'GI',
    cohortOffset: 1,
    carryForwardStatus: 'carried-forward',
    carryForwardReason: 'expected-offset-path',
    reviewStatus: 'clean',
    reviewReason: 'valid-carry-forward',
    activeStatus,
    resetRecommended,
    confidence: 'high',
    reason: 'carried-forward-active',
  };
}

// ---------------------------------------------------------------------------
// 1. confirm
// ---------------------------------------------------------------------------

describe('applyCohortReclassificationReviewAction - confirm', () => {
  it('accepts confirm on an active assignment', () => {
    const result = applyCohortReclassificationReviewAction(activeAssignment(), {
      actionType: 'confirm',
    });
    expect(result.accepted).toBe(true);
    expect(result.resultingReviewState).toBe('confirmed');
    expect(result.resultingActiveStatus).toBe('active');
    expect(result.reason).toBe('clean-assignment-confirmed');
    expect(result.confidence).toBe('high');
    expect(result.requestedAction).toBe('confirm');
  });

  it('accepts confirm on a first-year assignment and keeps first-year status', () => {
    const result = applyCohortReclassificationReviewAction(
      firstYearAssignment(),
      { actionType: 'confirm' }
    );
    expect(result.accepted).toBe(true);
    expect(result.resultingReviewState).toBe('confirmed');
    expect(result.resultingActiveStatus).toBe('first-year');
    expect(result.reason).toBe('clean-assignment-confirmed');
  });

  it('accepts confirm on a review assignment and promotes it to active', () => {
    const result = applyCohortReclassificationReviewAction(reviewAssignment(), {
      actionType: 'confirm',
    });
    expect(result.accepted).toBe(true);
    expect(result.resultingReviewState).toBe('confirmed');
    expect(result.resultingActiveStatus).toBe('active');
    expect(result.reason).toBe('review-assignment-confirmed');
    expect(result.confidence).toBe('high');
  });

  it('rejects confirm on an inactive assignment as invalid', () => {
    const result = applyCohortReclassificationReviewAction(
      inactiveAssignment(),
      { actionType: 'confirm' }
    );
    expect(result.accepted).toBe(false);
    expect(result.resultingReviewState).toBe('rejected');
    expect(result.resultingActiveStatus).toBe('inactive'); // unchanged
    expect(result.reason).toBe('invalid-action-for-assignment');
  });
});

// ---------------------------------------------------------------------------
// 2. reset
// ---------------------------------------------------------------------------

describe('applyCohortReclassificationReviewAction - reset', () => {
  it('accepts reset on an inactive assignment with resetRecommended true', () => {
    const assignment = inactiveAssignment();
    expect(assignment.resetRecommended).toBe(true);

    const result = applyCohortReclassificationReviewAction(assignment, {
      actionType: 'reset',
    });
    expect(result.accepted).toBe(true);
    expect(result.resultingReviewState).toBe('reset');
    expect(result.resultingActiveStatus).toBe('inactive');
    expect(result.resetRecommended).toBe(false);
    expect(result.reason).toBe('reset-recommendation-accepted');
    expect(result.confidence).toBe('high');
  });

  it('rejects reset on an active assignment', () => {
    const result = applyCohortReclassificationReviewAction(activeAssignment(), {
      actionType: 'reset',
    });
    expect(result.accepted).toBe(false);
    expect(result.resultingReviewState).toBe('rejected');
    expect(result.resultingActiveStatus).toBe('active'); // unchanged
    expect(result.reason).toBe('reset-not-allowed-for-clean-assignment');
  });

  it('rejects reset on a first-year assignment', () => {
    const result = applyCohortReclassificationReviewAction(
      firstYearAssignment(),
      { actionType: 'reset' }
    );
    expect(result.accepted).toBe(false);
    expect(result.resultingReviewState).toBe('rejected');
    expect(result.resultingActiveStatus).toBe('first-year'); // unchanged
    expect(result.reason).toBe('reset-not-allowed-for-clean-assignment');
  });

  it('rejects reset on a review assignment as invalid', () => {
    const result = applyCohortReclassificationReviewAction(reviewAssignment(), {
      actionType: 'reset',
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('invalid-action-for-assignment');
  });
});

// ---------------------------------------------------------------------------
// 3. defer
// ---------------------------------------------------------------------------

describe('applyCohortReclassificationReviewAction - defer', () => {
  it('accepts defer on a review assignment', () => {
    const result = applyCohortReclassificationReviewAction(reviewAssignment(), {
      actionType: 'defer',
    });
    expect(result.accepted).toBe(true);
    expect(result.resultingReviewState).toBe('deferred');
    expect(result.resultingActiveStatus).toBe('review');
    expect(result.reason).toBe('review-deferred');
    expect(result.confidence).toBe('low');
  });

  it('rejects defer on a clean active assignment', () => {
    const result = applyCohortReclassificationReviewAction(activeAssignment(), {
      actionType: 'defer',
    });
    expect(result.accepted).toBe(false);
    expect(result.resultingReviewState).toBe('rejected');
    expect(result.resultingActiveStatus).toBe('active'); // unchanged
    expect(result.reason).toBe('invalid-action-for-assignment');
  });
});

// ---------------------------------------------------------------------------
// 4. mark-insufficient-data
// ---------------------------------------------------------------------------

describe('applyCohortReclassificationReviewAction - mark-insufficient-data', () => {
  it('accepts mark-insufficient-data on an insufficient-data assignment', () => {
    const result = applyCohortReclassificationReviewAction(
      insufficientDataAssignment(),
      { actionType: 'mark-insufficient-data' }
    );
    expect(result.accepted).toBe(true);
    expect(result.resultingReviewState).toBe('insufficient-data');
    expect(result.resultingActiveStatus).toBe('insufficient-data');
    expect(result.reason).toBe('insufficient-data-marked');
  });

  it('rejects mark-insufficient-data on a non-insufficient assignment', () => {
    const result = applyCohortReclassificationReviewAction(activeAssignment(), {
      actionType: 'mark-insufficient-data',
    });
    expect(result.accepted).toBe(false);
    expect(result.resultingReviewState).toBe('rejected');
    expect(result.resultingActiveStatus).toBe('active'); // unchanged
    expect(result.reason).toBe('insufficient-data-action-not-needed');
  });
});

// ---------------------------------------------------------------------------
// 5. Unknown assignment state and missing assignment
// ---------------------------------------------------------------------------

describe('applyCohortReclassificationReviewAction - unknown / missing', () => {
  it('rejects any action on an unknown assignment state', () => {
    const unknown = syntheticAssignment('unknown');
    for (const actionType of [
      'confirm',
      'reset',
      'defer',
      'mark-insufficient-data',
    ] as const) {
      const result = applyCohortReclassificationReviewAction(unknown, {
        actionType,
      });
      expect(result.accepted).toBe(false);
      expect(result.resultingReviewState).toBe('rejected');
      expect(result.resultingActiveStatus).toBe('unknown'); // unchanged
      expect(result.reason).toBe('unknown-assignment-state');
    }
  });

  it('rejects an action when no assignment is supplied', () => {
    const result = applyCohortReclassificationReviewAction(null, {
      actionType: 'confirm',
    });
    expect(result.accepted).toBe(false);
    expect(result.assignment).toBeNull();
    expect(result.reclassificationType).toBeNull();
    expect(result.resultingReviewState).toBe('rejected');
    expect(result.reason).toBe('missing-assignment');
  });
});

// ---------------------------------------------------------------------------
// 6. Reviewer metadata passthrough
// ---------------------------------------------------------------------------

describe('applyCohortReclassificationReviewAction - reviewer metadata', () => {
  it('echoes reviewerNote, reviewedAt, and reviewerId when provided', () => {
    const result = applyCohortReclassificationReviewAction(activeAssignment(), {
      actionType: 'confirm',
      reviewerNote: 'looks right',
      reviewedAt: '2026-06-12T00:00:00Z',
      reviewerId: 'coach-1',
    });
    expect(result.reviewerNote).toBe('looks right');
    expect(result.reviewedAt).toBe('2026-06-12T00:00:00Z');
    expect(result.reviewerId).toBe('coach-1');
  });

  it('omits reviewer fields entirely when not provided', () => {
    const result = applyCohortReclassificationReviewAction(activeAssignment(), {
      actionType: 'confirm',
    });
    expect('reviewerNote' in result).toBe(false);
    expect('reviewedAt' in result).toBe(false);
    expect('reviewerId' in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Reference preservation and immutability
// ---------------------------------------------------------------------------

describe('applyCohortReclassificationReviewAction - roster authority', () => {
  it('preserves the source assignment reference and mirrors its identity', () => {
    const assignment = activeAssignment();
    const result = applyCohortReclassificationReviewAction(assignment, {
      actionType: 'confirm',
    });
    expect(result.assignment).toBe(assignment);
    expect(result.identityKey).toBe(assignment.identityKey);
    expect(result.reclassificationType).toBe(assignment.reclassificationType);
    expect(result.evaluatedSeasonId).toBe(assignment.evaluatedSeasonId);
  });

  it('does not mutate the input assignment', () => {
    const assignment = inactiveAssignment();
    const snapshot = structuredClone(assignment);

    applyCohortReclassificationReviewAction(assignment, { actionType: 'reset' });

    expect(assignment).toEqual(snapshot);
  });

  it('is deterministic for the same assignment and action', () => {
    const assignment = reviewAssignment();
    const first = applyCohortReclassificationReviewAction(assignment, {
      actionType: 'confirm',
    });
    const second = applyCohortReclassificationReviewAction(assignment, {
      actionType: 'confirm',
    });
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// 8. Summary counts
// ---------------------------------------------------------------------------

describe('summarizeCohortReclassificationReviewActions - counts', () => {
  it('counts acceptance, resulting states, and action types across a mixed set', () => {
    const results = [
      applyCohortReclassificationReviewAction(activeAssignment(), {
        actionType: 'confirm',
      }), // accepted, confirmed
      applyCohortReclassificationReviewAction(reviewAssignment(), {
        actionType: 'confirm',
      }), // accepted, confirmed
      applyCohortReclassificationReviewAction(inactiveAssignment(), {
        actionType: 'reset',
      }), // accepted, reset
      applyCohortReclassificationReviewAction(reviewAssignment(), {
        actionType: 'defer',
      }), // accepted, deferred
      applyCohortReclassificationReviewAction(insufficientDataAssignment(), {
        actionType: 'mark-insufficient-data',
      }), // accepted, insufficient-data
      applyCohortReclassificationReviewAction(activeAssignment(), {
        actionType: 'reset',
      }), // rejected
    ];

    const summary = summarizeCohortReclassificationReviewActions(results);
    expect(summary.total).toBe(6);
    expect(summary.accepted).toBe(5);
    expect(summary.rejected).toBe(1);
    expect(summary.confirmed).toBe(2);
    expect(summary.reset).toBe(1);
    expect(summary.deferred).toBe(1);
    expect(summary.insufficientData).toBe(1);
    expect(summary.byAction).toEqual({
      confirm: 2,
      reset: 2,
      defer: 1,
      markInsufficientData: 1,
    });
  });

  it('summarizes an empty result list as all zeros', () => {
    const results: CohortReclassificationReviewActionResult[] = [];
    expect(summarizeCohortReclassificationReviewActions(results)).toEqual({
      total: 0,
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
    });
  });
});
