import { describe, it, expect } from 'vitest';
import {
  deriveCohortReclassificationAssignments,
  summarizeCohortReclassificationAssignments,
} from '../engine/cohortReclassificationAssignment';
import type { CohortReclassificationAssignment } from '../engine/cohortReclassificationAssignment';
import { classifyCohortReclassificationReview } from '../engine/cohortReclassificationReview';
import type {
  CohortReclassificationReviewEntry,
  CohortReclassificationReviewReason,
  CohortReclassificationReviewStatus,
} from '../engine/cohortReclassificationReview';
import { carryForwardCohortReclassificationStatus } from '../engine/cohortReclassificationCarryForward';
import type {
  CohortReclassificationCarryForwardEntry,
  CohortReclassificationCarryForwardReason,
  CohortReclassificationCarryForwardStatus,
} from '../engine/cohortReclassificationCarryForward';
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

/** Builds a realistic first-year record via the slice 1 + slice 2 pipeline. */
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
 * Runs the full slice 3 -> slice 4 pipeline for one first-year record and asserts
 * the produced review entry's status/reason, then returns it. This keeps the
 * assignment tests anchored to REAL upstream output.
 */
function reviewEntry(
  record: CohortReclassificationRecord,
  current: RosterMovementRecord[],
  expectedReviewStatus: CohortReclassificationReviewStatus,
  expectedReviewReason: CohortReclassificationReviewReason,
  seasonOrder: readonly string[] = SEASON_ORDER
): CohortReclassificationReviewEntry {
  const carryForward = carryForwardCohortReclassificationStatus(
    [record],
    current,
    seasonOrder
  );
  const { entries } = classifyCohortReclassificationReview(carryForward);
  expect(entries).toHaveLength(1);
  expect(entries[0].reviewStatus).toBe(expectedReviewStatus);
  expect(entries[0].reason).toBe(expectedReviewReason);
  return entries[0];
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - empty input', () => {
  it('returns no assignments and a zeroed summary for an empty result', () => {
    const result = deriveCohortReclassificationAssignments({
      entries: [],
      summary: {
        total: 0,
        clean: 0,
        needsReview: 0,
        resetRecommended: 0,
        insufficientData: 0,
        yUp: 0,
        zDown: 0,
        highConfidence: 0,
        lowConfidence: 0,
      },
    });
    expect(result.assignments).toEqual([]);
    expect(result.summary).toEqual({
      total: 0,
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
    });
  });

  it('accepts a bare review entry array as well as a result object', () => {
    const result = deriveCohortReclassificationAssignments([]);
    expect(result.assignments).toEqual([]);
    expect(result.summary.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. clean + first-year -> first-year active
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - first-year active', () => {
  it('maps clean + first-year to a first-year active assignment', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const review = reviewEntry(
      record,
      [rec('Sky High', team('2026', 'MM'))],
      'clean',
      'valid-first-year-record'
    );

    const { assignments } = deriveCohortReclassificationAssignments([review]);
    const a = assignments[0];
    expect(a.activeStatus).toBe('first-year');
    expect(a.resetRecommended).toBe(false);
    expect(a.confidence).toBe('high');
    expect(a.reason).toBe('first-year-active');
    expect(a.reclassificationType).toBe('y-up');
    expect(a.carryForwardStatus).toBe('first-year');
    expect(a.reviewStatus).toBe('clean');
    expect(a.cohortOffset).toBe(1);
    expect(a.firstDetectedAgeDivisionId).toBe('MM');
    expect(a.priorAgeDivisionId).toBe('GR');
    expect(a.firstDetectedSeasonId).toBe('2026');
    expect(a.evaluatedSeasonId).toBe('2026');
  });
});

// ---------------------------------------------------------------------------
// 3. clean + carried-forward -> active
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - carried-forward active', () => {
  it('maps clean + carried-forward to an active assignment', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const review = reviewEntry(
      record,
      [rec('Sky High', team('2027', 'GI'))],
      'clean',
      'valid-carry-forward'
    );

    const { assignments } = deriveCohortReclassificationAssignments([review]);
    const a = assignments[0];
    expect(a.activeStatus).toBe('active');
    expect(a.resetRecommended).toBe(false);
    expect(a.confidence).toBe('high');
    expect(a.reason).toBe('carried-forward-active');
    expect(a.carryForwardStatus).toBe('carried-forward');
    expect(a.expectedAgeDivisionId).toBe('GI');
    expect(a.actualAgeDivisionId).toBe('GI');
  });
});

// ---------------------------------------------------------------------------
// 4. reset-recommended -> inactive / resetRecommended true
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - reset recommended', () => {
  it('maps reset-recommended to inactive with resetRecommended true', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const review = reviewEntry(
      record,
      [rec('Sky High', team('2027', 'MM'))],
      'reset-recommended',
      'path-broken-returned-to-normal'
    );

    const { assignments } = deriveCohortReclassificationAssignments([review]);
    const a = assignments[0];
    expect(a.activeStatus).toBe('inactive');
    expect(a.resetRecommended).toBe(true);
    expect(a.confidence).toBe('high');
    expect(a.reason).toBe('reset-recommended');
  });
});

// ---------------------------------------------------------------------------
// 5. needs-review -> review
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - review required', () => {
  it('maps needs-review to a review assignment with low confidence', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const review = reviewEntry(
      record,
      [rec('Sky High', team('2027', 'SC'))],
      'needs-review',
      'path-broken-unexpected-age-division'
    );

    const { assignments } = deriveCohortReclassificationAssignments([review]);
    const a = assignments[0];
    expect(a.activeStatus).toBe('review');
    expect(a.resetRecommended).toBe(false);
    expect(a.confidence).toBe('low');
    expect(a.reason).toBe('review-required');
  });
});

// ---------------------------------------------------------------------------
// 6. insufficient-data -> insufficient-data
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - insufficient data', () => {
  it('maps insufficient-data to an insufficient-data assignment with low confidence', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const review = reviewEntry(
      record,
      [rec('Someone Else', team('2027', 'GI'))],
      'insufficient-data',
      'missing-current-record'
    );

    const { assignments } = deriveCohortReclassificationAssignments([review]);
    const a = assignments[0];
    expect(a.activeStatus).toBe('insufficient-data');
    expect(a.resetRecommended).toBe(false);
    expect(a.confidence).toBe('low');
    expect(a.reason).toBe('insufficient-data');
    expect(a.currentRecord).toBeNull();
    expect(a.evaluatedSeasonId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Synthetic unmapped combinations -> unknown
// ---------------------------------------------------------------------------

/** A minimal synthetic carry-forward entry for defensive branch coverage. */
function syntheticCarryForward(
  overrides: Partial<CohortReclassificationCarryForwardEntry>
): CohortReclassificationCarryForwardEntry {
  return {
    identityKey: 'synthetic one',
    reclassificationType: 'y-up',
    player: { name: 'Synthetic One' },
    firstYearRecord: {} as CohortReclassificationRecord,
    currentRecord: null,
    firstDetectedSeasonId: '2026',
    evaluatedSeasonId: '2027',
    priorAgeDivisionId: 'GR',
    firstDetectedAgeDivisionId: 'MM',
    expectedAgeDivisionId: 'GI',
    actualAgeDivisionId: 'GI',
    cohortOffset: 1,
    status: 'carried-forward',
    confidence: 'high',
    reason: 'expected-offset-path',
    ...overrides,
  };
}

/** A synthetic review entry wrapping a synthetic carry-forward entry. */
function syntheticReview(
  reviewStatus: CohortReclassificationReviewStatus,
  carryForwardStatus: CohortReclassificationCarryForwardStatus,
  carryForwardReason: CohortReclassificationCarryForwardReason = 'expected-offset-path'
): CohortReclassificationReviewEntry {
  const carryForwardEntry = syntheticCarryForward({
    status: carryForwardStatus,
    reason: carryForwardReason,
  });
  return {
    carryForwardEntry,
    identityKey: carryForwardEntry.identityKey,
    reclassificationType: carryForwardEntry.reclassificationType,
    player: carryForwardEntry.player,
    firstYearRecord: carryForwardEntry.firstYearRecord,
    currentRecord: carryForwardEntry.currentRecord,
    evaluatedSeasonId: carryForwardEntry.evaluatedSeasonId,
    carryForwardStatus,
    carryForwardReason,
    reviewStatus,
    confidence: 'low',
    reason: 'unknown-carry-forward-result',
  };
}

describe('deriveCohortReclassificationAssignments - unknown / unmapped', () => {
  it('maps clean review over a non-first-year, non-carried-forward status to unknown', () => {
    // clean is only emitted for first-year/carried-forward by slice 4, so a clean
    // review paired with a path-broken carry-forward is an unmapped combination.
    const review = syntheticReview('clean', 'path-broken');

    const { assignments } = deriveCohortReclassificationAssignments([review]);
    const a = assignments[0];
    expect(a.activeStatus).toBe('unknown');
    expect(a.resetRecommended).toBe(false);
    expect(a.confidence).toBe('low');
    expect(a.reason).toBe('unknown-status');
  });
});

// ---------------------------------------------------------------------------
// 8. Low confidence propagation for review / insufficient / unknown
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - low confidence propagation', () => {
  it('keeps confidence low for review, insufficient-data, and unknown assignments', () => {
    const reviewReq = syntheticReview('needs-review', 'path-broken');
    const insufficient = syntheticReview('insufficient-data', 'insufficient-history');
    const unknown = syntheticReview('clean', 'unknown');

    const { assignments } = deriveCohortReclassificationAssignments([
      reviewReq,
      insufficient,
      unknown,
    ]);
    expect(assignments.map((a) => a.activeStatus)).toEqual([
      'review',
      'insufficient-data',
      'unknown',
    ]);
    expect(assignments.every((a) => a.confidence === 'low')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. References preserved; inputs not mutated
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - roster authority', () => {
  it('preserves review, carry-forward, player, first-year, and current record references', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const currentRecord = rec('Sky High', team('2027', 'GI'));
    const carryForward = carryForwardCohortReclassificationStatus(
      [record],
      [currentRecord],
      SEASON_ORDER
    );
    const { entries: reviewEntries } =
      classifyCohortReclassificationReview(carryForward);
    const review = reviewEntries[0];

    const { assignments } = deriveCohortReclassificationAssignments([review]);
    const a = assignments[0];
    expect(a.reviewEntry).toBe(review);
    expect(a.carryForwardEntry).toBe(review.carryForwardEntry);
    expect(a.player).toBe(review.player);
    expect(a.firstYearRecord).toBe(review.firstYearRecord);
    expect(a.currentRecord).toBe(review.currentRecord);
    expect(a.currentRecord).toBe(currentRecord);
  });

  it('does not mutate the review entries it consumes', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const carryForward = carryForwardCohortReclassificationStatus(
      [record],
      [rec('Sky High', team('2027', 'GI'))],
      SEASON_ORDER
    );
    const { entries: reviewEntries } =
      classifyCohortReclassificationReview(carryForward);
    const snapshot = structuredClone(reviewEntries);

    deriveCohortReclassificationAssignments(reviewEntries);

    expect(reviewEntries).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 10. Deterministic output ordering
// ---------------------------------------------------------------------------

describe('deriveCohortReclassificationAssignments - determinism', () => {
  it('emits one assignment per review entry in input order, repeatably', () => {
    const records = [
      firstYearRecord('Alpha One', '2025', 'GR', '2026', 'MM'),
      firstYearRecord('Beta Two', '2025', 'MM', '2026', 'PW'),
    ];
    const current = [
      rec('Beta Two', team('2027', 'MM')),
      rec('Alpha One', team('2027', 'GI')),
    ];
    const carryForward = carryForwardCohortReclassificationStatus(
      records,
      current,
      SEASON_ORDER
    );
    const review = classifyCohortReclassificationReview(carryForward);

    const first = deriveCohortReclassificationAssignments(review);
    expect(first.assignments.map((a) => a.identityKey)).toEqual([
      'alpha one',
      'beta two',
    ]);

    const second = deriveCohortReclassificationAssignments(review);
    expect(second.assignments.map((a) => a.identityKey)).toEqual(
      first.assignments.map((a) => a.identityKey)
    );
  });
});

// ---------------------------------------------------------------------------
// 11. Summary counts
// ---------------------------------------------------------------------------

describe('summarizeCohortReclassificationAssignments - counts', () => {
  it('counts active statuses, reset recommendations, types, and confidence correctly', () => {
    const records = [
      firstYearRecord('Active Up', '2025', 'GR', '2026', 'MM'), // y-up
      firstYearRecord('Active Down', '2025', 'MM', '2026', 'PW'), // z-down
      firstYearRecord('Reset Me', '2025', 'GR', '2026', 'MM'), // y-up
      firstYearRecord('Bad Move', '2025', 'GR', '2026', 'MM'), // y-up
      firstYearRecord('No Show', '2025', 'GR', '2026', 'MM'), // y-up
    ];
    const current = [
      rec('Active Up', team('2027', 'GI')), // carried-forward -> active
      rec('Active Down', team('2027', 'MM')), // carried-forward -> active
      rec('Reset Me', team('2027', 'MM')), // returned-to-normal -> reset-recommended
      rec('Bad Move', team('2027', 'SC')), // unexpected -> review
      // No Show absent -> insufficient-data
    ];

    const carryForward = carryForwardCohortReclassificationStatus(
      records,
      current,
      SEASON_ORDER
    );
    const review = classifyCohortReclassificationReview(carryForward);
    const { assignments, summary } =
      deriveCohortReclassificationAssignments(review);

    expect(summary.total).toBe(5);
    expect(summary.active).toBe(2);
    expect(summary.firstYear).toBe(0);
    expect(summary.inactive).toBe(1);
    expect(summary.review).toBe(1);
    expect(summary.insufficientData).toBe(1);
    expect(summary.unknown).toBe(0);
    expect(summary.resetRecommended).toBe(1);
    expect(summary.yUp).toBe(4);
    expect(summary.zDown).toBe(1);
    expect(summary.highConfidence).toBe(3); // 2 active + 1 reset-recommended
    expect(summary.lowConfidence).toBe(2); // review + insufficient-data

    // The standalone summarizer matches the bundled summary.
    expect(summarizeCohortReclassificationAssignments(assignments)).toEqual(
      summary
    );
  });

  it('summarizes an explicit empty assignment list as all zeros', () => {
    const assignments: CohortReclassificationAssignment[] = [];
    expect(summarizeCohortReclassificationAssignments(assignments)).toEqual({
      total: 0,
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
    });
  });

  it('counts a first-year active assignment under firstYear, not active', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const review = reviewEntry(
      record,
      [rec('Sky High', team('2026', 'MM'))],
      'clean',
      'valid-first-year-record'
    );

    const { summary } = deriveCohortReclassificationAssignments([review]);
    expect(summary.firstYear).toBe(1);
    expect(summary.active).toBe(0);
    expect(summary.highConfidence).toBe(1);
  });
});
