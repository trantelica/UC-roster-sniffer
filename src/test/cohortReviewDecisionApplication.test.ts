import { describe, it, expect } from 'vitest';
import {
  applyCohortReviewDecisionsToAssignments,
  summarizeAppliedCohortReviewDecisions,
} from '../engine/cohortReviewDecisionApplication';
import { deriveCohortReclassificationAssignments } from '../engine/cohortReclassificationAssignment';
import type {
  CohortReclassificationAssignment,
  CohortReclassificationAssignmentActiveStatus,
} from '../engine/cohortReclassificationAssignment';
import { classifyCohortReclassificationReview } from '../engine/cohortReclassificationReview';
import { applyCohortReclassificationReviewAction } from '../engine/cohortReclassificationReviewAction';
import type { CohortReclassificationReviewActionInput } from '../engine/cohortReclassificationReviewAction';
import { createCohortReviewDecision } from '../engine/cohortReviewDecision';
import type { CohortReviewDecision } from '../engine/cohortReviewDecision';
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
  return assignmentFor(record, [rec(name, team('2027', 'GI'))], 'active');
}

function inactiveAssignment(
  name = 'Sky High'
): CohortReclassificationAssignment {
  const record = firstYearRecord(name, '2025', 'GR', '2026', 'MM');
  return assignmentFor(record, [rec(name, team('2027', 'MM'))], 'inactive');
}

function reviewAssignment(name = 'Sky High'): CohortReclassificationAssignment {
  const record = firstYearRecord(name, '2025', 'GR', '2026', 'MM');
  return assignmentFor(record, [rec(name, team('2027', 'SC'))], 'review');
}

let decisionCounter = 0;
/** Builds a real decision for an assignment + accepted action with deterministic ids. */
function decisionFor(
  assignment: CohortReclassificationAssignment,
  action: CohortReclassificationReviewActionInput,
  opts: { decisionId?: string; supersedesDecisionId?: string } = {}
): CohortReviewDecision {
  const actionResult = applyCohortReclassificationReviewAction(assignment, action);
  const result = createCohortReviewDecision(actionResult, {
    decisionId: opts.decisionId ?? `decision-${++decisionCounter}`,
    createdAt: '2027-06-01T00:00:00Z',
    supersedesDecisionId: opts.supersedesDecisionId,
  });
  expect(result.created).toBe(true);
  return result.decision!;
}

// ---------------------------------------------------------------------------
// 1. Empty inputs
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - empty', () => {
  it('returns empty entries and a zeroed summary for empty inputs', () => {
    const result = applyCohortReviewDecisionsToAssignments([], []);
    expect(result.entries).toEqual([]);
    expect(result.ignoredDecisions).toEqual([]);
    expect(result.summary.totalAssignments).toBe(0);
    expect(result.summary.ignoredDecisions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. No matching decision -> engine-derived
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - engine derived', () => {
  it('keeps an assignment engine-derived when no decision matches', () => {
    const assignment = activeAssignment();
    const result = applyCohortReviewDecisionsToAssignments([assignment], []);
    const e = result.entries[0];
    expect(e.decisionApplied).toBe(false);
    expect(e.effectiveActiveStatus).toBe('active');
    expect(e.effectiveReviewState).toBe('engine-derived');
    expect(e.reason).toBe('no-decision-engine-derived');
    expect(e.matchedDecision).toBeNull();
    expect(e.originalActiveStatus).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// 3-5. Applying the four decision types
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - applying decisions', () => {
  it('applies a confirm decision', () => {
    const assignment = activeAssignment();
    const decision = decisionFor(assignment, { actionType: 'confirm' });
    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [decision]
    );
    const e = result.entries[0];
    expect(e.decisionApplied).toBe(true);
    expect(e.effectiveActiveStatus).toBe('active');
    expect(e.effectiveReviewState).toBe('confirmed');
    expect(e.reason).toBe('confirmed-decision-applied');
    expect(e.confidence).toBe('high');
    expect(e.decisionId).toBe(decision.decisionId);
    expect(e.matchedDecision).toBe(decision);
  });

  it('applies a reset decision and preserves the first-year source record', () => {
    const assignment = inactiveAssignment();
    const firstYearSnapshot = structuredClone(assignment.firstYearRecord);
    const decision = decisionFor(assignment, { actionType: 'reset' });

    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [decision]
    );
    const e = result.entries[0];
    expect(e.decisionApplied).toBe(true);
    expect(e.effectiveActiveStatus).toBe('inactive');
    expect(e.effectiveReviewState).toBe('reset');
    expect(e.reason).toBe('reset-decision-applied');
    expect(e.confidence).toBe('high');
    // The first-year event record is untouched.
    expect(assignment.firstYearRecord).toEqual(firstYearSnapshot);
    expect(e.assignment.firstYearRecord).toBe(assignment.firstYearRecord);
  });

  it('applies a defer decision', () => {
    const assignment = reviewAssignment();
    const decision = decisionFor(assignment, { actionType: 'defer' });
    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [decision]
    );
    const e = result.entries[0];
    expect(e.decisionApplied).toBe(true);
    expect(e.effectiveActiveStatus).toBe('review');
    expect(e.effectiveReviewState).toBe('deferred');
    expect(e.reason).toBe('deferred-decision-applied');
    expect(e.confidence).toBe('low');
  });

  it('applies a mark-insufficient-data decision', () => {
    // insufficient-data with a usable evaluatedSeasonId via the season-order route.
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const carryForward = carryForwardCohortReclassificationStatus(
      [record],
      [rec('Sky High', team('2027', 'GI'))],
      [] // empty season order -> insufficient-history
    );
    const review = classifyCohortReclassificationReview(carryForward);
    const { assignments } = deriveCohortReclassificationAssignments(review);
    const assignment = assignments[0];
    expect(assignment.activeStatus).toBe('insufficient-data');

    const decision = decisionFor(assignment, {
      actionType: 'mark-insufficient-data',
    });
    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [decision]
    );
    const e = result.entries[0];
    expect(e.decisionApplied).toBe(true);
    expect(e.effectiveActiveStatus).toBe('insufficient-data');
    expect(e.effectiveReviewState).toBe('insufficient-data');
    expect(e.reason).toBe('insufficient-data-decision-applied');
  });
});

// ---------------------------------------------------------------------------
// 6. Invalid decision is ignored
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - invalid decision', () => {
  it('ignores an invalid (incoherent) decision and falls back to engine-derived', () => {
    const assignment = activeAssignment();
    const decision = decisionFor(assignment, { actionType: 'confirm' });
    // Make it incoherent: a confirm decision claiming a reset state.
    const invalid: CohortReviewDecision = {
      ...decision,
      reviewActionState: 'reset',
    };

    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [invalid]
    );
    expect(result.entries[0].decisionApplied).toBe(false);
    expect(result.entries[0].effectiveReviewState).toBe('engine-derived');
    expect(result.ignoredDecisions).toHaveLength(1);
    expect(result.ignoredDecisions[0].reason).toBe('invalid-decision-ignored');
    expect(result.ignoredDecisions[0].validationErrors).toContain(
      'confirm-decision-claims-reset-state'
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Superseded decision is ignored; later applies
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - supersession', () => {
  it('ignores a superseded prior decision and applies the later one', () => {
    const assignment = reviewAssignment();
    // Earlier decision: defer. Later decision: confirm, superseding the defer.
    const earlier = decisionFor(
      assignment,
      { actionType: 'defer' },
      { decisionId: 'decision-A' }
    );
    const later = decisionFor(
      assignment,
      { actionType: 'confirm' },
      { decisionId: 'decision-B', supersedesDecisionId: 'decision-A' }
    );

    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [earlier, later]
    );
    const e = result.entries[0];
    expect(e.decisionApplied).toBe(true);
    expect(e.decisionId).toBe('decision-B');
    expect(e.effectiveReviewState).toBe('confirmed');

    expect(result.ignoredDecisions).toHaveLength(1);
    expect(result.ignoredDecisions[0].decisionId).toBe('decision-A');
    expect(result.ignoredDecisions[0].reason).toBe(
      'superseded-decision-ignored'
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Decision with no matching assignment
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - no matching assignment', () => {
  it('ignores a decision whose key matches no assignment', () => {
    const present = activeAssignment('Present Player');
    const absent = activeAssignment('Absent Player');
    const decision = decisionFor(absent, { actionType: 'confirm' });

    const result = applyCohortReviewDecisionsToAssignments(
      [present],
      [decision]
    );
    expect(result.entries[0].decisionApplied).toBe(false);
    expect(result.ignoredDecisions).toHaveLength(1);
    expect(result.ignoredDecisions[0].reason).toBe('no-matching-assignment');
  });

  it('does not apply a decision whose reclassificationType differs', () => {
    const assignment = activeAssignment(); // y-up
    const decision = decisionFor(assignment, { actionType: 'confirm' });
    const mismatched: CohortReviewDecision = {
      ...decision,
      reclassificationType: 'z-down',
    };

    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [mismatched]
    );
    expect(result.entries[0].decisionApplied).toBe(false);
    expect(result.entries[0].effectiveReviewState).toBe('engine-derived');
    expect(result.ignoredDecisions[0].reason).toBe('no-matching-assignment');
  });
});

// ---------------------------------------------------------------------------
// 9. Decision missing usable match key
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - missing key', () => {
  it('ignores a decision with an empty identityKey', () => {
    const assignment = activeAssignment();
    const decision = decisionFor(assignment, { actionType: 'confirm' });
    const keyless: CohortReviewDecision = { ...decision, identityKey: '' };

    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [keyless]
    );
    expect(result.entries[0].decisionApplied).toBe(false);
    expect(result.ignoredDecisions[0].reason).toBe('missing-decision-key');
  });

  it('ignores a decision with an empty evaluatedSeasonId', () => {
    const assignment = activeAssignment();
    const decision = decisionFor(assignment, { actionType: 'confirm' });
    const keyless: CohortReviewDecision = {
      ...decision,
      evaluatedSeasonId: '',
    };

    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [keyless]
    );
    expect(result.ignoredDecisions[0].reason).toBe('missing-decision-key');
  });
});

// ---------------------------------------------------------------------------
// 10. Multiple current decisions -> conservative conflict
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - conflict', () => {
  it('applies none when two current decisions match and neither supersedes', () => {
    const assignment = reviewAssignment();
    const confirmD = decisionFor(
      assignment,
      { actionType: 'confirm' },
      { decisionId: 'decision-confirm' }
    );
    const deferD = decisionFor(
      assignment,
      { actionType: 'defer' },
      { decisionId: 'decision-defer' }
    );

    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [confirmD, deferD]
    );
    const e = result.entries[0];
    expect(e.decisionApplied).toBe(false);
    expect(e.effectiveActiveStatus).toBe('review'); // engine-derived value
    expect(e.effectiveReviewState).toBe('unresolved-review');
    expect(e.reason).toBe('multiple-current-decisions');

    expect(result.ignoredDecisions).toHaveLength(2);
    expect(
      result.ignoredDecisions.every(
        (d) => d.reason === 'multiple-current-decisions'
      )
    ).toBe(true);
    expect(result.summary.multipleCurrentDecisionConflicts).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 11. Immutability and references
// ---------------------------------------------------------------------------

describe('applyCohortReviewDecisionsToAssignments - immutability', () => {
  it('does not mutate assignments or decisions', () => {
    const assignment = inactiveAssignment();
    const decision = decisionFor(assignment, { actionType: 'reset' });
    const aSnapshot = structuredClone(assignment);
    const dSnapshot = structuredClone(decision);

    applyCohortReviewDecisionsToAssignments([assignment], [decision]);

    expect(assignment).toEqual(aSnapshot);
    expect(decision).toEqual(dSnapshot);
  });

  it('preserves source references on entries and ignored decisions', () => {
    const assignment = activeAssignment();
    const decision = decisionFor(assignment, { actionType: 'confirm' });
    const result = applyCohortReviewDecisionsToAssignments(
      [assignment],
      [decision]
    );
    expect(result.entries[0].assignment).toBe(assignment);
    expect(result.entries[0].matchedDecision).toBe(decision);
  });

  it('is deterministic and preserves assignment input order', () => {
    const a = activeAssignment('Alpha One');
    const b = reviewAssignment('Beta Two');
    const decisionB = decisionFor(b, { actionType: 'confirm' });

    const first = applyCohortReviewDecisionsToAssignments([a, b], [decisionB]);
    const second = applyCohortReviewDecisionsToAssignments([a, b], [decisionB]);
    expect(first.entries.map((e) => e.identityKey)).toEqual([
      'alpha one',
      'beta two',
    ]);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// 12. Summary counts
// ---------------------------------------------------------------------------

describe('summarizeAppliedCohortReviewDecisions - counts', () => {
  it('counts effective states, applied decisions, ignored reasons, and confidence', () => {
    const confirmA = activeAssignment('Confirm Me');
    const resetA = inactiveAssignment('Reset Me');
    const engineA = activeAssignment('Engine Only');

    const confirmD = decisionFor(confirmA, { actionType: 'confirm' });
    const resetD = decisionFor(resetA, { actionType: 'reset' });
    // An invalid decision that matches no assignment context cleanly.
    const orphan = decisionFor(activeAssignment('Orphan'), {
      actionType: 'confirm',
    });

    const result = applyCohortReviewDecisionsToAssignments(
      [confirmA, resetA, engineA],
      [confirmD, resetD, orphan]
    );

    const summary = result.summary;
    expect(summary.totalAssignments).toBe(3);
    expect(summary.decisionApplied).toBe(2);
    expect(summary.confirmed).toBe(1);
    expect(summary.reset).toBe(1);
    expect(summary.engineDerived).toBe(1);
    expect(summary.deferred).toBe(0);
    expect(summary.insufficientData).toBe(0);
    expect(summary.unresolvedReview).toBe(0);
    expect(summary.ignoredDecisions).toBe(1);
    expect(summary.decisionsWithoutMatchingAssignment).toBe(1);
    // confirm (high) + reset (high) + engine-derived active (carries the
    // assignment's high confidence) = 3 high, 0 low.
    expect(summary.highConfidence).toBe(3);
    expect(summary.lowConfidence).toBe(0);

    // The standalone summarizer matches the bundled summary.
    expect(
      summarizeAppliedCohortReviewDecisions({
        entries: result.entries,
        ignoredDecisions: result.ignoredDecisions,
      })
    ).toEqual(summary);
  });

  it('summarizes empty input as all zeros', () => {
    expect(
      summarizeAppliedCohortReviewDecisions({ entries: [], ignoredDecisions: [] })
    ).toEqual({
      totalAssignments: 0,
      decisionApplied: 0,
      engineDerived: 0,
      confirmed: 0,
      reset: 0,
      deferred: 0,
      insufficientData: 0,
      unresolvedReview: 0,
      ignoredDecisions: 0,
      invalidDecisions: 0,
      supersededDecisions: 0,
      decisionsWithoutMatchingAssignment: 0,
      multipleCurrentDecisionConflicts: 0,
      missingDecisionKey: 0,
      highConfidence: 0,
      lowConfidence: 0,
    });
  });
});
