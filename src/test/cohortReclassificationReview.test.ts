import { describe, it, expect } from 'vitest';
import {
  classifyCohortReclassificationReview,
  summarizeCohortReclassificationReview,
} from '../engine/cohortReclassificationReview';
import type { CohortReclassificationReviewEntry } from '../engine/cohortReclassificationReview';
import {
  carryForwardCohortReclassificationStatus,
} from '../engine/cohortReclassificationCarryForward';
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
 * Runs the slice 3 carry-forward and asserts the produced entry has the expected
 * status/reason, then returns that single carry-forward entry. This keeps the
 * review tests anchored to REAL carry-forward output rather than hand-rolled data.
 */
function carryForwardEntry(
  record: CohortReclassificationRecord,
  current: RosterMovementRecord[],
  expectedStatus: CohortReclassificationCarryForwardStatus,
  expectedReason: CohortReclassificationCarryForwardReason,
  seasonOrder: readonly string[] = SEASON_ORDER
): CohortReclassificationCarryForwardEntry {
  const { entries } = carryForwardCohortReclassificationStatus(
    [record],
    current,
    seasonOrder
  );
  expect(entries).toHaveLength(1);
  expect(entries[0].status).toBe(expectedStatus);
  expect(entries[0].reason).toBe(expectedReason);
  return entries[0];
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - empty input', () => {
  it('returns no entries and a zeroed summary for an empty result', () => {
    const result = classifyCohortReclassificationReview({
      entries: [],
      summary: {
        total: 0,
        firstYear: 0,
        carriedForward: 0,
        pathBroken: 0,
        insufficientHistory: 0,
        unknown: 0,
        yUp: 0,
        zDown: 0,
        highConfidence: 0,
        lowConfidence: 0,
      },
    });
    expect(result.entries).toEqual([]);
    expect(result.summary).toEqual({
      total: 0,
      clean: 0,
      needsReview: 0,
      resetRecommended: 0,
      insufficientData: 0,
      yUp: 0,
      zDown: 0,
      highConfidence: 0,
      lowConfidence: 0,
    });
  });

  it('accepts a bare entry array as well as a result object', () => {
    const result = classifyCohortReclassificationReview([]);
    expect(result.entries).toEqual([]);
    expect(result.summary.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. first-year -> clean
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - first-year', () => {
  it('maps first-year to clean / valid-first-year-record (high)', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2026', 'MM'))],
      'first-year',
      'first-year-record'
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    const e = entries[0];
    expect(e.reviewStatus).toBe('clean');
    expect(e.reason).toBe('valid-first-year-record');
    expect(e.confidence).toBe('high');
    expect(e.carryForwardStatus).toBe('first-year');
    expect(e.reclassificationType).toBe('y-up');
  });
});

// ---------------------------------------------------------------------------
// 3. carried-forward -> clean
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - carried-forward', () => {
  it('maps carried-forward to clean / valid-carry-forward (high)', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2027', 'GI'))],
      'carried-forward',
      'expected-offset-path'
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    const e = entries[0];
    expect(e.reviewStatus).toBe('clean');
    expect(e.reason).toBe('valid-carry-forward');
    expect(e.confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// 4. path-broken / returned-to-normal -> reset-recommended
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - returned to normal path', () => {
  it('maps path-broken returned-to-normal to reset-recommended (high)', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2027', 'MM'))],
      'path-broken',
      'returned-to-normal-path'
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    const e = entries[0];
    expect(e.reviewStatus).toBe('reset-recommended');
    expect(e.reason).toBe('path-broken-returned-to-normal');
    expect(e.confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// 5. path-broken / unexpected-age-division -> needs-review
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - unexpected age division', () => {
  it('maps path-broken unexpected-age-division to needs-review (low)', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2027', 'SC'))],
      'path-broken',
      'unexpected-age-division'
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    const e = entries[0];
    expect(e.reviewStatus).toBe('needs-review');
    expect(e.reason).toBe('path-broken-unexpected-age-division');
    expect(e.confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// 6. insufficient-history / missing-current-record
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - missing current record', () => {
  it('maps insufficient-history missing-current-record to insufficient-data', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Someone Else', team('2027', 'GI'))],
      'insufficient-history',
      'missing-current-record'
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    const e = entries[0];
    expect(e.reviewStatus).toBe('insufficient-data');
    expect(e.reason).toBe('missing-current-record');
    expect(e.confidence).toBe('low');
    expect(e.currentRecord).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. insufficient-history season-order reasons -> unusable-season-order
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - unusable season order', () => {
  it('maps missing-season-order to insufficient-data / unusable-season-order', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2027', 'GI'))],
      'insufficient-history',
      'missing-season-order',
      []
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('insufficient-data');
    expect(entries[0].reason).toBe('unusable-season-order');
    expect(entries[0].confidence).toBe('low');
  });

  it('maps first-season-not-in-order to insufficient-data / unusable-season-order', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2027', 'GI'))],
      'insufficient-history',
      'first-season-not-in-order',
      ['2027', '2028'] // missing 2026
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('insufficient-data');
    expect(entries[0].reason).toBe('unusable-season-order');
  });

  it('maps evaluated-season-not-in-order to insufficient-data / unusable-season-order', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2027', 'GI'))],
      'insufficient-history',
      'evaluated-season-not-in-order',
      ['2025', '2026'] // missing 2027
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('insufficient-data');
    expect(entries[0].reason).toBe('unusable-season-order');
  });

  it('maps evaluated-season-before-first-detection to insufficient-data / unusable-season-order', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2025', 'GR'))],
      'insufficient-history',
      'evaluated-season-before-first-detection'
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('insufficient-data');
    expect(entries[0].reason).toBe('unusable-season-order');
  });
});

// ---------------------------------------------------------------------------
// 8. unknown / invalid-age-division and ambiguous-identity -> needs-review
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - unknown carry-forward', () => {
  it('maps unknown invalid-age-division to needs-review / invalid-age-division', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [rec('Sky High', team('2027', 'XX'))],
      'unknown',
      'invalid-age-division'
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('needs-review');
    expect(entries[0].reason).toBe('invalid-age-division');
    expect(entries[0].confidence).toBe('low');
  });

  it('maps unknown ambiguous-identity to needs-review / ambiguous-identity', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const cf = carryForwardEntry(
      record,
      [
        rec('Sky High', team('2027', 'GI'), 'a'),
        rec('Sky High', team('2027', 'PW'), 'b'),
      ],
      'unknown',
      'ambiguous-identity'
    );

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('needs-review');
    expect(entries[0].reason).toBe('ambiguous-identity');
    expect(entries[0].confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// 9. Synthetic fallbacks: unknown-reason and low-confidence clean entries
// ---------------------------------------------------------------------------

/** A minimal synthetic carry-forward entry used to exercise defensive branches. */
function syntheticEntry(
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

describe('classifyCohortReclassificationReview - fallbacks', () => {
  it('maps an unknown carry-forward result with an unmapped reason to needs-review / unknown-carry-forward-result', () => {
    const cf = syntheticEntry({
      status: 'unknown',
      confidence: 'low',
      // A reason that is not invalid-age-division or ambiguous-identity.
      reason: 'first-year-record',
    });

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('needs-review');
    expect(entries[0].reason).toBe('unknown-carry-forward-result');
    expect(entries[0].confidence).toBe('low');
  });

  it('maps insufficient-history with an unmapped reason to insufficient-data / unknown-carry-forward-result', () => {
    const cf = syntheticEntry({
      status: 'insufficient-history',
      confidence: 'low',
      reason: 'expected-offset-path',
    });

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('insufficient-data');
    expect(entries[0].reason).toBe('unknown-carry-forward-result');
  });

  it('demotes a low-confidence carried-forward entry to needs-review / low-confidence-carry-forward', () => {
    const cf = syntheticEntry({
      status: 'carried-forward',
      confidence: 'low',
      reason: 'expected-offset-path',
    });

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('needs-review');
    expect(entries[0].reason).toBe('low-confidence-carry-forward');
    expect(entries[0].confidence).toBe('low');
  });

  it('demotes a low-confidence first-year entry to needs-review / low-confidence-carry-forward', () => {
    const cf = syntheticEntry({
      status: 'first-year',
      confidence: 'low',
      reason: 'first-year-record',
    });

    const { entries } = classifyCohortReclassificationReview([cf]);
    expect(entries[0].reviewStatus).toBe('needs-review');
    expect(entries[0].reason).toBe('low-confidence-carry-forward');
  });
});

// ---------------------------------------------------------------------------
// 10. References preserved; inputs not mutated
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - roster authority', () => {
  it('preserves the carry-forward entry, player, and record references', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const currentRecord = rec('Sky High', team('2027', 'GI'));
    const { entries: cfEntries } = carryForwardCohortReclassificationStatus(
      [record],
      [currentRecord],
      SEASON_ORDER
    );
    const cf = cfEntries[0];

    const { entries } = classifyCohortReclassificationReview([cf]);
    const e = entries[0];
    expect(e.carryForwardEntry).toBe(cf);
    expect(e.player).toBe(cf.player);
    expect(e.firstYearRecord).toBe(cf.firstYearRecord);
    expect(e.currentRecord).toBe(cf.currentRecord);
    expect(e.currentRecord).toBe(currentRecord);
  });

  it('does not mutate the carry-forward entries it classifies', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const { entries: cfEntries } = carryForwardCohortReclassificationStatus(
      [record],
      [rec('Sky High', team('2027', 'GI'))],
      SEASON_ORDER
    );
    const snapshot = structuredClone(cfEntries);

    classifyCohortReclassificationReview(cfEntries);

    expect(cfEntries).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 11. Deterministic output ordering
// ---------------------------------------------------------------------------

describe('classifyCohortReclassificationReview - determinism', () => {
  it('emits one review entry per carry-forward entry in input order, repeatably', () => {
    const records = [
      firstYearRecord('Alpha One', '2025', 'GR', '2026', 'MM'),
      firstYearRecord('Beta Two', '2025', 'MM', '2026', 'PW'),
    ];
    const current = [
      rec('Beta Two', team('2027', 'MM')),
      rec('Alpha One', team('2027', 'GI')),
    ];
    const cf = carryForwardCohortReclassificationStatus(
      records,
      current,
      SEASON_ORDER
    );

    const first = classifyCohortReclassificationReview(cf);
    expect(first.entries.map((e) => e.identityKey)).toEqual([
      'alpha one',
      'beta two',
    ]);

    const second = classifyCohortReclassificationReview(cf);
    expect(second.entries.map((e) => e.identityKey)).toEqual(
      first.entries.map((e) => e.identityKey)
    );
  });
});

// ---------------------------------------------------------------------------
// 12. Summary counts
// ---------------------------------------------------------------------------

describe('summarizeCohortReclassificationReview - counts', () => {
  it('counts review statuses, types, and confidence correctly across a mixed set', () => {
    const records = [
      firstYearRecord('Carry Up', '2025', 'GR', '2026', 'MM'), // y-up
      firstYearRecord('Carry Down', '2025', 'MM', '2026', 'PW'), // z-down
      firstYearRecord('Reset Me', '2025', 'GR', '2026', 'MM'), // y-up
      firstYearRecord('No Show', '2025', 'GR', '2026', 'MM'), // y-up
      firstYearRecord('Bad Move', '2025', 'GR', '2026', 'MM'), // y-up
    ];
    const current = [
      rec('Carry Up', team('2027', 'GI')), // carried-forward -> clean
      rec('Carry Down', team('2027', 'MM')), // carried-forward -> clean
      rec('Reset Me', team('2027', 'MM')), // returned-to-normal -> reset-recommended
      rec('Bad Move', team('2027', 'SC')), // unexpected -> needs-review
      // No Show absent -> insufficient-history -> insufficient-data
    ];

    const cf = carryForwardCohortReclassificationStatus(
      records,
      current,
      SEASON_ORDER
    );
    const { entries, summary } = classifyCohortReclassificationReview(cf);

    expect(summary.total).toBe(5);
    expect(summary.clean).toBe(2);
    expect(summary.resetRecommended).toBe(1);
    expect(summary.needsReview).toBe(1);
    expect(summary.insufficientData).toBe(1);
    expect(summary.yUp).toBe(4);
    expect(summary.zDown).toBe(1);
    expect(summary.highConfidence).toBe(3); // 2 clean + 1 reset-recommended
    expect(summary.lowConfidence).toBe(2); // needs-review + insufficient-data

    // The standalone summarizer matches the bundled summary.
    expect(summarizeCohortReclassificationReview(entries)).toEqual(summary);
  });

  it('summarizes an explicit empty entry list as all zeros', () => {
    const entries: CohortReclassificationReviewEntry[] = [];
    expect(summarizeCohortReclassificationReview(entries)).toEqual({
      total: 0,
      clean: 0,
      needsReview: 0,
      resetRecommended: 0,
      insufficientData: 0,
      yUp: 0,
      zDown: 0,
      highConfidence: 0,
      lowConfidence: 0,
    });
  });
});
