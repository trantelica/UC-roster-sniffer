import { describe, it, expect } from 'vitest';
import {
  COHORT_REVIEW_DECISION_REPOSITORY_VERSION,
  appendCohortReviewDecision,
  appendCohortReviewDecisions,
  createEmptyCohortReviewDecisionRepositoryState,
  exportCohortReviewDecisionRepository,
  getActiveCohortReviewDecisions,
  getCohortReviewDecisions,
  importCohortReviewDecisionRepository,
} from '../engine/cohortReviewDecisionRepository';
import { createCohortReviewDecision } from '../engine/cohortReviewDecision';
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
// Helpers — build REAL decisions through the slice 5-7 pipeline
// ---------------------------------------------------------------------------

function team(seasonId: string, ageDivisionId: string): TeamSlotContext {
  return { seasonId, districtId: 'alta', ageDivisionId, teamCode: 'B1' };
}

function rec(name: string, teamSlot: TeamSlotContext): RosterMovementRecord {
  return { player: { name }, team: teamSlot };
}

function firstYearRecord(
  name: string,
  priorAge: string,
  firstAge: string
): CohortReclassificationRecord {
  const current = rec(name, team('2026', firstAge));
  const prior = rec(name, team('2025', priorAge));
  const signals = detectCohortReclassificationSignals([current], [prior]);
  const { records } = deriveFirstYearCohortReclassificationRecords(signals);
  expect(records).toHaveLength(1);
  return records[0];
}

const SEASON_ORDER = ['2024', '2025', '2026', '2027', '2028'];

function assignmentFor(
  name: string,
  current: RosterMovementRecord[],
  expectedActiveStatus: CohortReclassificationAssignmentActiveStatus
): CohortReclassificationAssignment {
  const record = firstYearRecord(name, 'GR', 'MM');
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

let counter = 0;
function decisionFor(
  name: string,
  current: RosterMovementRecord[],
  expectedActiveStatus: CohortReclassificationAssignmentActiveStatus,
  action: CohortReclassificationReviewActionInput,
  opts: { decisionId?: string; supersedesDecisionId?: string } = {}
): CohortReviewDecision {
  const assignment = assignmentFor(name, current, expectedActiveStatus);
  const actionResult = applyCohortReclassificationReviewAction(assignment, action);
  const result = createCohortReviewDecision(actionResult, {
    decisionId: opts.decisionId ?? `decision-${++counter}`,
    createdAt: '2027-06-01T00:00:00Z',
    supersedesDecisionId: opts.supersedesDecisionId,
  });
  expect(result.created).toBe(true);
  return result.decision!;
}

/** A confirm decision on an active y-up assignment. */
function confirmDecision(
  name = 'Sky High',
  opts: { decisionId?: string; supersedesDecisionId?: string } = {}
): CohortReviewDecision {
  return decisionFor(
    name,
    [rec(name, team('2027', 'GI'))],
    'active',
    { actionType: 'confirm' },
    opts
  );
}

/** A reset decision on an inactive assignment (returned-to-normal path). */
function resetDecision(
  name = 'Sky High',
  opts: { decisionId?: string; supersedesDecisionId?: string } = {}
): CohortReviewDecision {
  return decisionFor(
    name,
    [rec(name, team('2027', 'MM'))],
    'inactive',
    { actionType: 'reset' },
    opts
  );
}

// ---------------------------------------------------------------------------
// 1. Empty state
// ---------------------------------------------------------------------------

describe('createEmptyCohortReviewDecisionRepositoryState', () => {
  it('creates a deterministic empty, versioned state', () => {
    const state = createEmptyCohortReviewDecisionRepositoryState();
    expect(state).toEqual({
      version: COHORT_REVIEW_DECISION_REPOSITORY_VERSION,
      decisions: [],
    });
    expect(state.version).toBe('cohort-review-decisions.v1');
  });
});

// ---------------------------------------------------------------------------
// 2-3. Append one / invalid / duplicate
// ---------------------------------------------------------------------------

describe('appendCohortReviewDecision', () => {
  it('accepts a valid decision and returns a new state', () => {
    const state = createEmptyCohortReviewDecisionRepositoryState();
    const decision = confirmDecision();
    const result = appendCohortReviewDecision(state, decision);

    expect(result.ok).toBe(true);
    expect(result.accepted).toEqual([decision]);
    expect(result.rejected).toEqual([]);
    expect(result.state.decisions).toEqual([decision]);
    // Prior state is untouched (immutability).
    expect(state.decisions).toEqual([]);
    expect(result.state).not.toBe(state);
  });

  it('rejects an invalid decision', () => {
    const state = createEmptyCohortReviewDecisionRepositoryState();
    const valid = confirmDecision();
    const invalid: CohortReviewDecision = {
      ...valid,
      reviewActionState: 'reset', // incoherent for a confirm
    };
    const result = appendCohortReviewDecision(state, invalid);

    expect(result.ok).toBe(false);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe('invalid-decision');
    expect(result.rejected[0].validationErrors).toContain(
      'confirm-decision-claims-reset-state'
    );
    expect(result.state.decisions).toEqual([]);
  });

  it('rejects a duplicate decisionId without overwriting', () => {
    const first = confirmDecision('Sky High', { decisionId: 'decision-dup' });
    const second = resetDecision('Other Player', { decisionId: 'decision-dup' });

    let state = createEmptyCohortReviewDecisionRepositoryState();
    state = appendCohortReviewDecision(state, first).state;
    const result = appendCohortReviewDecision(state, second);

    expect(result.ok).toBe(false);
    expect(result.rejected[0].reason).toBe('duplicate-decision-id');
    // The original decision is unchanged and still the only one.
    expect(result.state.decisions).toEqual([first]);
    expect(result.state.decisions[0]).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// 4. Append multiple (mixed valid/invalid + in-batch duplicate)
// ---------------------------------------------------------------------------

describe('appendCohortReviewDecisions', () => {
  it('accepts valid, rejects invalid, and rejects duplicates within the batch', () => {
    const a = confirmDecision('Alpha', { decisionId: 'decision-A' });
    const b = resetDecision('Beta', { decisionId: 'decision-B' });
    const invalid: CohortReviewDecision = {
      ...confirmDecision('Gamma', { decisionId: 'decision-C' }),
      identityKey: '', // invalid: missing identity key
    };
    const dupOfA = confirmDecision('Alpha Again', { decisionId: 'decision-A' });

    const state = createEmptyCohortReviewDecisionRepositoryState();
    const result = appendCohortReviewDecisions(state, [a, b, invalid, dupOfA]);

    expect(result.ok).toBe(false);
    expect(result.accepted).toEqual([a, b]);
    expect(result.state.decisions).toEqual([a, b]);
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0].reason).toBe('invalid-decision');
    expect(result.rejected[1].reason).toBe('duplicate-decision-id');
  });

  it('preserves append order across calls', () => {
    let state = createEmptyCohortReviewDecisionRepositoryState();
    const a = confirmDecision('Alpha', { decisionId: 'd-1' });
    const b = confirmDecision('Beta', { decisionId: 'd-2' });
    const c = confirmDecision('Gamma', { decisionId: 'd-3' });
    state = appendCohortReviewDecisions(state, [a, b]).state;
    state = appendCohortReviewDecision(state, c).state;
    expect(getCohortReviewDecisions(state).map((d) => d.decisionId)).toEqual([
      'd-1',
      'd-2',
      'd-3',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 5-6. Get all / get active (supersession)
// ---------------------------------------------------------------------------

describe('getCohortReviewDecisions / getActiveCohortReviewDecisions', () => {
  it('returns all decisions in order, as a fresh array', () => {
    const a = confirmDecision('Alpha', { decisionId: 'd-1' });
    const b = confirmDecision('Beta', { decisionId: 'd-2' });
    const state = appendCohortReviewDecisions(
      createEmptyCohortReviewDecisionRepositoryState(),
      [a, b]
    ).state;

    const all = getCohortReviewDecisions(state);
    expect(all).toEqual([a, b]);
    expect(all).not.toBe(state.decisions); // fresh array
  });

  it('excludes superseded decisions from active but keeps them in history', () => {
    const earlier = confirmDecision('Sky High', { decisionId: 'decision-A' });
    const later = resetDecision('Sky High', {
      decisionId: 'decision-B',
      supersedesDecisionId: 'decision-A',
    });
    const state = appendCohortReviewDecisions(
      createEmptyCohortReviewDecisionRepositoryState(),
      [earlier, later]
    ).state;

    // History keeps both.
    expect(getCohortReviewDecisions(state).map((d) => d.decisionId)).toEqual([
      'decision-A',
      'decision-B',
    ]);
    // Active excludes the superseded earlier decision.
    expect(
      getActiveCohortReviewDecisions(state).map((d) => d.decisionId)
    ).toEqual(['decision-B']);
  });
});

// ---------------------------------------------------------------------------
// 7-8. Export / import
// ---------------------------------------------------------------------------

describe('exportCohortReviewDecisionRepository', () => {
  it('returns a JSON-compatible payload preserving version and order', () => {
    const a = confirmDecision('Alpha', { decisionId: 'd-1' });
    const b = confirmDecision('Beta', { decisionId: 'd-2' });
    const state = appendCohortReviewDecisions(
      createEmptyCohortReviewDecisionRepositoryState(),
      [a, b]
    ).state;

    const payload = exportCohortReviewDecisionRepository(state);
    expect(payload.version).toBe(COHORT_REVIEW_DECISION_REPOSITORY_VERSION);
    expect(payload.decisions.map((d) => d.decisionId)).toEqual(['d-1', 'd-2']);
    // Round-trips through JSON without loss.
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

describe('importCohortReviewDecisionRepository', () => {
  it('imports a valid exported payload', () => {
    const a = confirmDecision('Alpha', { decisionId: 'd-1' });
    const b = confirmDecision('Beta', { decisionId: 'd-2' });
    const source = appendCohortReviewDecisions(
      createEmptyCohortReviewDecisionRepositoryState(),
      [a, b]
    ).state;
    const payload = JSON.parse(
      JSON.stringify(exportCohortReviewDecisionRepository(source))
    );

    const result = importCohortReviewDecisionRepository(payload);
    expect(result.ok).toBe(true);
    expect(result.accepted).toHaveLength(2);
    expect(result.state.decisions.map((d) => d.decisionId)).toEqual([
      'd-1',
      'd-2',
    ]);
  });

  it('rejects an unsupported repository version', () => {
    const result = importCohortReviewDecisionRepository({
      version: 'cohort-review-decisions.v999',
      decisions: [],
    });
    expect(result.ok).toBe(false);
    expect(result.rejected[0].reason).toBe('unsupported-repository-version');
    expect(result.state.decisions).toEqual([]);
  });

  it('rejects a payload missing the decisions list', () => {
    const result = importCohortReviewDecisionRepository({
      version: COHORT_REVIEW_DECISION_REPOSITORY_VERSION,
    });
    expect(result.ok).toBe(false);
    expect(result.rejected[0].reason).toBe('missing-decision-list');
  });

  it('rejects a non-object payload', () => {
    const result = importCohortReviewDecisionRepository(null);
    expect(result.ok).toBe(false);
    expect(result.rejected[0].reason).toBe('invalid-repository-payload');
  });

  it('partially imports a mix of valid and invalid decisions', () => {
    const valid = confirmDecision('Alpha', { decisionId: 'd-1' });
    const invalid: CohortReviewDecision = {
      ...confirmDecision('Beta', { decisionId: 'd-2' }),
      evaluatedSeasonId: '', // invalid
    };
    const result = importCohortReviewDecisionRepository({
      version: COHORT_REVIEW_DECISION_REPOSITORY_VERSION,
      decisions: [valid, invalid],
    });
    expect(result.ok).toBe(false);
    expect(result.accepted.map((d) => d.decisionId)).toEqual(['d-1']);
    expect(result.rejected[0].reason).toBe('invalid-decision');
    expect(result.state.decisions.map((d) => d.decisionId)).toEqual(['d-1']);
  });
});

// ---------------------------------------------------------------------------
// 9. Immutability of inputs
// ---------------------------------------------------------------------------

describe('cohortReviewDecisionRepository - immutability', () => {
  it('does not mutate the prior state or the decision objects on append', () => {
    const decision = confirmDecision();
    const decisionSnapshot = structuredClone(decision);
    const state = createEmptyCohortReviewDecisionRepositoryState();
    const stateSnapshot = structuredClone(state);

    appendCohortReviewDecision(state, decision);

    expect(state).toEqual(stateSnapshot);
    expect(decision).toEqual(decisionSnapshot);
  });

  it('does not mutate decisions on export or import', () => {
    const a = confirmDecision('Alpha', { decisionId: 'd-1' });
    const state = appendCohortReviewDecision(
      createEmptyCohortReviewDecisionRepositoryState(),
      a
    ).state;
    const snapshot = structuredClone(a);

    const payload = exportCohortReviewDecisionRepository(state);
    importCohortReviewDecisionRepository(
      JSON.parse(JSON.stringify(payload))
    );

    expect(a).toEqual(snapshot);
  });

  it('is deterministic for the same inputs', () => {
    const a = confirmDecision('Alpha', { decisionId: 'd-1' });
    const b = resetDecision('Beta', { decisionId: 'd-2' });
    const first = appendCohortReviewDecisions(
      createEmptyCohortReviewDecisionRepositoryState(),
      [a, b]
    );
    const second = appendCohortReviewDecisions(
      createEmptyCohortReviewDecisionRepositoryState(),
      [a, b]
    );
    expect(second.state).toEqual(first.state);
    expect(second.accepted).toEqual(first.accepted);
  });
});
