import { describe, it, expect } from 'vitest';
import {
  carryForwardCohortReclassificationStatus,
  summarizeCohortReclassificationCarryForward,
} from '../engine/cohortReclassificationCarryForward';
import type { CohortReclassificationCarryForwardEntry } from '../engine/cohortReclassificationCarryForward';
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

/** A team slot for a given season and age division, overriding any context. */
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

/**
 * Builds a realistic first-year record via the slice 1 + slice 2 pipeline from a
 * prior-season and first-detected-season roster pair. Asserts exactly one record
 * was produced so tests fail loudly if the fixture stops being a candidate.
 */
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

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - empty input', () => {
  it('returns no entries and a zeroed summary for empty inputs', () => {
    const result = carryForwardCohortReclassificationStatus([], [], SEASON_ORDER);
    expect(result.entries).toEqual([]);
    expect(result.summary).toEqual({
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
    });
  });
});

// ---------------------------------------------------------------------------
// 2. First-year record evaluated in its first detected season
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - first year', () => {
  it('classifies the first detected season itself as first-year', () => {
    // y-up: 2025 GR -> 2026 MM (offset +1).
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2026', 'MM'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    expect(entries).toHaveLength(1);
    const e = entries[0];
    expect(e.status).toBe('first-year');
    expect(e.reason).toBe('first-year-record');
    expect(e.reclassificationType).toBe('y-up');
    expect(e.firstDetectedSeasonId).toBe('2026');
    expect(e.evaluatedSeasonId).toBe('2026');
    expect(e.cohortOffset).toBe(1);
    expect(e.expectedAgeDivisionId).toBe('MM');
    expect(e.actualAgeDivisionId).toBe('MM');
    expect(e.confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// 3. Y-up carry-forward continues one season later
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - y-up carry-forward', () => {
  it('preserves y-up status one season later on the offset path', () => {
    // first-year: 2025 GR -> 2026 MM; next season 2027 current GI.
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2027', 'GI'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('carried-forward');
    expect(e.reclassificationType).toBe('y-up');
    expect(e.reason).toBe('expected-offset-path');
    expect(e.evaluatedSeasonId).toBe('2027');
    expect(e.expectedAgeDivisionId).toBe('GI');
    expect(e.actualAgeDivisionId).toBe('GI');
    expect(e.confidence).toBe('high');
  });

  it('preserves y-up status multiple seasons later on the offset path', () => {
    // first-year: 2025 GR -> 2026 MM; two seasons later 2028 current BA.
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2028', 'BA'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('carried-forward');
    expect(e.reason).toBe('expected-offset-path');
    expect(e.evaluatedSeasonId).toBe('2028');
    expect(e.expectedAgeDivisionId).toBe('BA'); // MM(4) + 2 steps = BA(6)
    expect(e.actualAgeDivisionId).toBe('BA');
  });
});

// ---------------------------------------------------------------------------
// 4. Z-down carry-forward continues one season later
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - z-down carry-forward', () => {
  it('preserves z-down status one season later on the offset path', () => {
    // first-year: 2025 MM -> 2026 PW (z-down, offset -2). The reclassified path
    // advances +1 from PW, so the next season's expected division is MM.
    const record = firstYearRecord('Down Low', '2025', 'MM', '2026', 'PW');
    expect(record.reclassificationType).toBe('z-down');
    expect(record.currentAgeDivisionId).toBe('PW');

    const current = [rec('Down Low', team('2027', 'MM'))];
    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('carried-forward');
    expect(e.reclassificationType).toBe('z-down');
    expect(e.reason).toBe('expected-offset-path');
    expect(e.cohortOffset).toBe(-2); // PW(3) - (MM(4) + 1)
    expect(e.expectedAgeDivisionId).toBe('MM');
    expect(e.actualAgeDivisionId).toBe('MM');
  });
});

// ---------------------------------------------------------------------------
// 5. Path broken by returning to the normal path
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - returned to normal path', () => {
  it('flags path-broken when the player rejoins the normal age path', () => {
    // first-year: 2025 GR -> 2026 MM (y-up). The normal age path from prior GR is
    // GR(2025) -> PW(2026) -> MM(2027), so the normal division in 2027 is MM
    // (priorRank + 1 + steps = 2 + 1 + 1). The offset path would be GI; the
    // player at MM has rejoined the normal path.
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2027', 'MM'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('path-broken');
    expect(e.reason).toBe('returned-to-normal-path');
    expect(e.expectedAgeDivisionId).toBe('GI'); // offset path
    expect(e.actualAgeDivisionId).toBe('MM'); // normal path
    expect(e.confidence).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// 6. Path broken by an unexpected age division
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - unexpected age division', () => {
  it('flags path-broken when the player moves somewhere unexpected', () => {
    // first-year: 2025 GR -> 2026 MM (y-up). One season later the offset path is
    // GI and the normal path is PW; SC is neither.
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2027', 'SC'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('path-broken');
    expect(e.reason).toBe('unexpected-age-division');
    expect(e.expectedAgeDivisionId).toBe('GI');
    expect(e.actualAgeDivisionId).toBe('SC');
  });
});

// ---------------------------------------------------------------------------
// 7. Missing current record
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - missing current record', () => {
  it('reports insufficient-history when no later-season record matches', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Someone Else', team('2027', 'GI'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('insufficient-history');
    expect(e.reason).toBe('missing-current-record');
    expect(e.currentRecord).toBeNull();
    expect(e.evaluatedSeasonId).toBeNull();
    expect(e.actualAgeDivisionId).toBeNull();
    expect(e.confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// 8. Invalid current age division
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - invalid current age division', () => {
  it('reports unknown / invalid-age-division and still preserves the record', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2027', 'XX'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('unknown');
    expect(e.reason).toBe('invalid-age-division');
    expect(e.actualAgeDivisionId).toBe('XX'); // raw value preserved
    expect(e.expectedAgeDivisionId).toBeNull();
    expect(e.currentRecord).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 9. Missing season ordering
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - missing season order', () => {
  it('reports insufficient-history when the season order is empty', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2027', 'GI'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      []
    );

    const e = entries[0];
    expect(e.status).toBe('insufficient-history');
    expect(e.reason).toBe('missing-season-order');
    expect(e.evaluatedSeasonId).toBe('2027'); // matched record still surfaced
  });
});

// ---------------------------------------------------------------------------
// 10. First detected season missing from season order
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - first season not in order', () => {
  it('reports insufficient-history when the first detected season is absent', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2027', 'GI'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      ['2027', '2028'] // missing 2026
    );

    const e = entries[0];
    expect(e.status).toBe('insufficient-history');
    expect(e.reason).toBe('first-season-not-in-order');
  });
});

// ---------------------------------------------------------------------------
// 11. Evaluated season missing from season order
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - evaluated season not in order', () => {
  it('reports insufficient-history when the evaluated season is absent', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2027', 'GI'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      ['2025', '2026'] // missing 2027
    );

    const e = entries[0];
    expect(e.status).toBe('insufficient-history');
    expect(e.reason).toBe('evaluated-season-not-in-order');
  });
});

// ---------------------------------------------------------------------------
// 12. Evaluated season before first detection
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - evaluated before first detection', () => {
  it('reports insufficient-history when the evaluated season precedes first detection', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2025', 'GR'))];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('insufficient-history');
    expect(e.reason).toBe('evaluated-season-before-first-detection');
  });
});

// ---------------------------------------------------------------------------
// 13. Duplicate / ambiguous current identity blocks carry-forward
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - ambiguous identity', () => {
  it('does not carry forward when the later season has duplicate identities', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [
      rec('Sky High', team('2027', 'GI'), 'a'),
      rec('Sky High', team('2027', 'PW'), 'b'),
    ];

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('unknown');
    expect(e.reason).toBe('ambiguous-identity');
    expect(e.currentRecord).toBeNull();
    expect(e.evaluatedSeasonId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 14. BA top cap behavior
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - top cap', () => {
  it('treats a player already at BA who remains BA as carried-forward (capped)', () => {
    // first-year: 2025 MM -> 2026 BA (y-up, delta +2; firstDetected BA = top).
    const record = firstYearRecord('Top Cap', '2025', 'MM', '2026', 'BA');
    expect(record.currentAgeDivisionId).toBe('BA');

    const current = [rec('Top Cap', team('2027', 'BA'))];
    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      current,
      SEASON_ORDER
    );

    const e = entries[0];
    expect(e.status).toBe('carried-forward');
    expect(e.reason).toBe('capped-at-top-division');
    expect(e.expectedAgeDivisionId).toBe('BA');
    expect(e.actualAgeDivisionId).toBe('BA');
  });
});

// ---------------------------------------------------------------------------
// 15. Deterministic output ordering
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - determinism', () => {
  it('emits one entry per first-year record in input order, repeatably', () => {
    const records = [
      firstYearRecord('Alpha One', '2025', 'GR', '2026', 'MM'),
      firstYearRecord('Beta Two', '2025', 'MM', '2026', 'PW'),
    ];
    const current = [
      rec('Beta Two', team('2027', 'MM')),
      rec('Alpha One', team('2027', 'GI')),
    ];

    const first = carryForwardCohortReclassificationStatus(
      records,
      current,
      SEASON_ORDER
    );
    expect(first.entries.map((e) => e.identityKey)).toEqual([
      'alpha one',
      'beta two',
    ]);

    const second = carryForwardCohortReclassificationStatus(
      records,
      current,
      SEASON_ORDER
    );
    expect(second.entries.map((e) => e.identityKey)).toEqual(
      first.entries.map((e) => e.identityKey)
    );
  });
});

// ---------------------------------------------------------------------------
// 16. Source references preserved; inputs not mutated
// ---------------------------------------------------------------------------

describe('carryForwardCohortReclassificationStatus - roster authority', () => {
  it('preserves the source first-year record and current record references', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const currentRecord = rec('Sky High', team('2027', 'GI'));

    const { entries } = carryForwardCohortReclassificationStatus(
      [record],
      [currentRecord],
      SEASON_ORDER
    );

    expect(entries[0].firstYearRecord).toBe(record);
    expect(entries[0].player).toBe(record.player);
    expect(entries[0].currentRecord).toBe(currentRecord);
  });

  it('does not mutate the source first-year records or current records', () => {
    const record = firstYearRecord('Sky High', '2025', 'GR', '2026', 'MM');
    const current = [rec('Sky High', team('2027', 'GI'))];
    const recordSnapshot = structuredClone(record);
    const currentSnapshot = structuredClone(current);

    carryForwardCohortReclassificationStatus([record], current, SEASON_ORDER);

    expect(record).toEqual(recordSnapshot);
    expect(current).toEqual(currentSnapshot);
  });
});

// ---------------------------------------------------------------------------
// 17. Summary counts
// ---------------------------------------------------------------------------

describe('summarizeCohortReclassificationCarryForward - counts', () => {
  it('counts statuses, types, and confidence correctly across a mixed set', () => {
    const records = [
      firstYearRecord('Carry Up', '2025', 'GR', '2026', 'MM'), // y-up
      firstYearRecord('Carry Down', '2025', 'MM', '2026', 'PW'), // z-down
      firstYearRecord('Broke Path', '2025', 'GR', '2026', 'MM'), // y-up
      firstYearRecord('No Show', '2025', 'GR', '2026', 'MM'), // y-up
    ];
    const current = [
      rec('Carry Up', team('2027', 'GI')), // carried-forward (offset path)
      rec('Carry Down', team('2027', 'MM')), // carried-forward (offset path)
      rec('Broke Path', team('2027', 'PW')), // path-broken (returned to normal)
      // No Show absent -> insufficient-history
    ];

    const { entries, summary } = carryForwardCohortReclassificationStatus(
      records,
      current,
      SEASON_ORDER
    );

    expect(summary.total).toBe(4);
    expect(summary.carriedForward).toBe(2);
    expect(summary.pathBroken).toBe(1);
    expect(summary.insufficientHistory).toBe(1);
    expect(summary.firstYear).toBe(0);
    expect(summary.unknown).toBe(0);
    expect(summary.yUp).toBe(3);
    expect(summary.zDown).toBe(1);
    expect(summary.highConfidence).toBe(3); // 2 carried + 1 broken
    expect(summary.lowConfidence).toBe(1); // insufficient-history

    // The standalone summarizer matches the bundled summary.
    expect(summarizeCohortReclassificationCarryForward(entries)).toEqual(summary);
  });

  it('summarizes an explicit empty entry list as all zeros', () => {
    const entries: CohortReclassificationCarryForwardEntry[] = [];
    expect(summarizeCohortReclassificationCarryForward(entries)).toEqual({
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
    });
  });
});
