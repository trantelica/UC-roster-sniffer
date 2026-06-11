import { describe, it, expect } from 'vitest';
import { deriveFirstYearCohortReclassificationRecords } from '../engine/cohortReclassificationRecord';
import { detectCohortReclassificationSignals } from '../engine/cohortReclassificationSignal';
import type {
  CohortReclassificationEntry,
  CohortReclassificationSignal,
  CohortReclassificationSignalResult,
} from '../engine/cohortReclassificationSignal';
import type {
  RosterMovementRecord,
  TeamSlotContext,
} from '../engine/playerMovementDetection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A 2026 (current) team slot, overriding the age division and any context. */
function curTeam(
  ageDivisionId: string,
  overrides: Partial<TeamSlotContext> = {}
): TeamSlotContext {
  return {
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId,
    teamCode: 'B1',
    ...overrides,
  };
}

/** A 2025 (prior) team slot, overriding the age division and any context. */
function priTeam(
  ageDivisionId: string,
  overrides: Partial<TeamSlotContext> = {}
): TeamSlotContext {
  return {
    seasonId: '2025',
    districtId: 'alta',
    ageDivisionId,
    teamCode: 'B1',
    ...overrides,
  };
}

function rec(
  name: string,
  team: TeamSlotContext,
  id?: string
): RosterMovementRecord {
  return { player: id ? { name, id } : { name }, team };
}

/**
 * Builds a synthetic slice 1 signal entry directly, so tests can exercise
 * skip paths (e.g. low confidence, missing team) that the real detector never
 * emits for a candidate.
 */
function entry(
  overrides: Partial<CohortReclassificationEntry> & {
    signal: CohortReclassificationSignal;
  }
): CohortReclassificationEntry {
  const record = overrides.record ?? rec('Default Name', curTeam('MM'));
  return {
    identityKey: overrides.identityKey ?? 'default name',
    side: overrides.side ?? 'current',
    player: overrides.player ?? record.player,
    record,
    currentTeam:
      overrides.currentTeam !== undefined ? overrides.currentTeam : curTeam('MM'),
    priorTeam:
      overrides.priorTeam !== undefined ? overrides.priorTeam : priTeam('GR'),
    currentAgeDivisionId:
      overrides.currentAgeDivisionId !== undefined
        ? overrides.currentAgeDivisionId
        : 'MM',
    priorAgeDivisionId:
      overrides.priorAgeDivisionId !== undefined
        ? overrides.priorAgeDivisionId
        : 'GR',
    signal: overrides.signal,
  };
}

function signalResult(
  entries: CohortReclassificationEntry[]
): CohortReclassificationSignalResult {
  return { entries };
}

const Y_UP: CohortReclassificationSignal = {
  status: 'y-up-candidate',
  confidence: 'high',
  reason: 'skipped-age-division',
};

const Z_DOWN: CohortReclassificationSignal = {
  status: 'z-down-candidate',
  confidence: 'high',
  reason: 'moved-down-age-division',
};

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - empty input', () => {
  it('returns no records and no skipped entries for an empty signal result', () => {
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. High-confidence y-up candidate -> one y-up record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - y-up', () => {
  it('creates exactly one y-up record from a high-confidence y-up candidate', () => {
    const cur = rec('Sky High', curTeam('MM'), 'c1');
    const pri = rec('Sky High', priTeam('GR'), 'p1');
    const signals = detectCohortReclassificationSignals([cur], [pri]);

    const result = deriveFirstYearCohortReclassificationRecords(signals);

    expect(result.records).toHaveLength(1);
    const record = result.records[0];
    expect(record.reclassificationType).toBe('y-up');
    expect(record.sourceStatus).toBe('y-up-candidate');
    expect(record.firstDetectedSeasonId).toBe('2026');
    expect(record.priorSeasonId).toBe('2025');
    expect(record.priorAgeDivisionId).toBe('GR');
    expect(record.currentAgeDivisionId).toBe('MM');
    expect(record.ageDivisionDelta).toBe(2); // MM(4) - GR(2)
    expect(record.identityKey).toBe('sky high');
    expect(record.confidence).toBe('high');
    expect(record.reason).toBe('first-year-y-up-detected');
  });
});

// ---------------------------------------------------------------------------
// 3. High-confidence z-down candidate -> one z-down record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - z-down', () => {
  it('creates exactly one z-down record from a high-confidence z-down candidate', () => {
    const cur = rec('Down Low', curTeam('PW'), 'c1');
    const pri = rec('Down Low', priTeam('MM'), 'p1');
    const signals = detectCohortReclassificationSignals([cur], [pri]);

    const result = deriveFirstYearCohortReclassificationRecords(signals);

    expect(result.records).toHaveLength(1);
    const record = result.records[0];
    expect(record.reclassificationType).toBe('z-down');
    expect(record.sourceStatus).toBe('z-down-candidate');
    expect(record.firstDetectedSeasonId).toBe('2026');
    expect(record.priorSeasonId).toBe('2025');
    expect(record.priorAgeDivisionId).toBe('MM');
    expect(record.currentAgeDivisionId).toBe('PW');
    expect(record.ageDivisionDelta).toBe(-1); // PW(3) - MM(4)
    expect(record.reason).toBe('first-year-z-down-detected');
  });
});

// ---------------------------------------------------------------------------
// 4. Non-candidate statuses produce no record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - non-candidate statuses', () => {
  it('creates no record for expected-age-progression', () => {
    const signals = detectCohortReclassificationSignals(
      [rec('Step Up', curTeam('PW'))],
      [rec('Step Up', priTeam('GR'))]
    );
    const result = deriveFirstYearCohortReclassificationRecords(signals);
    expect(result.records).toEqual([]);
    expect(result.skipped.every((s) => s.reason === 'not-a-candidate')).toBe(
      true
    );
  });

  it('creates no record for same-age-division', () => {
    const signals = detectCohortReclassificationSignals(
      [rec('Stay Put', curTeam('PW'))],
      [rec('Stay Put', priTeam('PW'))]
    );
    const result = deriveFirstYearCohortReclassificationRecords(signals);
    expect(result.records).toEqual([]);
  });

  it('creates no record for unknown (missing prior record)', () => {
    const signals = detectCohortReclassificationSignals(
      [rec('New Kid', curTeam('PW'))],
      []
    );
    const result = deriveFirstYearCohortReclassificationRecords(signals);
    expect(result.records).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('not-a-candidate');
  });
});

// ---------------------------------------------------------------------------
// 5. Low-confidence candidates produce no record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - low confidence', () => {
  it('creates no record for a low-confidence y-up candidate', () => {
    const lowYUp = entry({
      identityKey: 'low yup',
      signal: { ...Y_UP, confidence: 'low' },
    });
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([lowYUp])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toBe('low-confidence');
  });

  it('creates no record for a low-confidence z-down candidate', () => {
    const lowZDown = entry({
      identityKey: 'low zdown',
      currentAgeDivisionId: 'PW',
      priorAgeDivisionId: 'MM',
      currentTeam: curTeam('PW'),
      priorTeam: priTeam('MM'),
      signal: { ...Z_DOWN, confidence: 'low' },
    });
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([lowZDown])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped[0].reason).toBe('low-confidence');
  });
});

// ---------------------------------------------------------------------------
// 6. Ambiguous identity produces no record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - ambiguous identity', () => {
  it('creates no record when slice 1 marked the identity ambiguous', () => {
    // Duplicate current key -> every entry is unknown / ambiguous-identity.
    const cur1 = rec('Same Name', curTeam('MM'), 'c1');
    const cur2 = rec('Same Name', curTeam('GI'), 'c2');
    const pri = rec('Same Name', priTeam('GR'), 'p1');
    const signals = detectCohortReclassificationSignals([cur1, cur2], [pri]);

    const result = deriveFirstYearCohortReclassificationRecords(signals);
    expect(result.records).toEqual([]);
    expect(result.skipped.every((s) => s.reason === 'not-a-candidate')).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// 7. Duplicate current/prior perspectives collapse to one record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - perspective dedupe', () => {
  it('creates only one record for the matched current/prior perspective pair', () => {
    const cur = rec('Sky High', curTeam('MM'), 'c1');
    const pri = rec('Sky High', priTeam('GR'), 'p1');
    const signals = detectCohortReclassificationSignals([cur], [pri]);

    // Slice 1 emits two entries (current + prior) for this exact match.
    expect(signals.entries).toHaveLength(2);

    const result = deriveFirstYearCohortReclassificationRecords(signals);

    expect(result.records).toHaveLength(1);
    // The redundant prior-side perspective is recorded as a duplicate.
    const dup = result.skipped.filter(
      (s) => s.reason === 'duplicate-perspective'
    );
    expect(dup).toHaveLength(1);
    expect(dup[0].side).toBe('prior');
  });

  it('prefers the current-side entry as the canonical record source', () => {
    const cur = rec('Sky High', curTeam('MM'), 'c1');
    const pri = rec('Sky High', priTeam('GR'), 'p1');
    const signals = detectCohortReclassificationSignals([cur], [pri]);

    const result = deriveFirstYearCohortReclassificationRecords(signals);

    expect(result.records).toHaveLength(1);
    // Canonical record carries the current-side player reference.
    expect(result.records[0].player).toBe(cur.player);
    expect(result.records[0].currentTeam).toBe(cur.team);
    expect(result.records[0].priorTeam).toBe(pri.team);
  });
});

// ---------------------------------------------------------------------------
// 8. Missing team context produces no record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - missing team context', () => {
  it('creates no record when the current team context is missing', () => {
    const noCurTeam = entry({
      identityKey: 'no cur team',
      currentTeam: null,
      currentAgeDivisionId: null,
      signal: Y_UP,
    });
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([noCurTeam])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped[0].reason).toBe('missing-current-team');
  });

  it('creates no record when the prior team context is missing', () => {
    const noPriTeam = entry({
      identityKey: 'no pri team',
      priorTeam: null,
      priorAgeDivisionId: null,
      signal: Y_UP,
    });
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([noPriTeam])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped[0].reason).toBe('missing-prior-team');
  });
});

// ---------------------------------------------------------------------------
// 9. Missing season ids produce no record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - missing season ids', () => {
  it('creates no record when the current season id is missing', () => {
    const noCurSeason = entry({
      identityKey: 'no cur season',
      currentTeam: curTeam('MM', { seasonId: '' }),
      signal: Y_UP,
    });
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([noCurSeason])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped[0].reason).toBe('missing-current-season');
  });

  it('creates no record when the prior season id is missing', () => {
    const noPriSeason = entry({
      identityKey: 'no pri season',
      priorTeam: priTeam('GR', { seasonId: '   ' }),
      signal: Y_UP,
    });
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([noPriSeason])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped[0].reason).toBe('missing-prior-season');
  });
});

// ---------------------------------------------------------------------------
// 10. Invalid age division produces no record
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - invalid age division', () => {
  it('creates no record when an age division is unsupported', () => {
    const badDiv = entry({
      identityKey: 'bad div',
      currentAgeDivisionId: 'XX',
      currentTeam: curTeam('XX'),
      signal: Y_UP,
    });
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([badDiv])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped[0].reason).toBe('invalid-age-division');
  });

  it('creates no record when an age division id is null', () => {
    const nullDiv = entry({
      identityKey: 'null div',
      priorAgeDivisionId: null,
      signal: Y_UP,
    });
    const result = deriveFirstYearCohortReclassificationRecords(
      signalResult([nullDiv])
    );
    expect(result.records).toEqual([]);
    expect(result.skipped[0].reason).toBe('invalid-age-division');
  });
});

// ---------------------------------------------------------------------------
// 11. ageDivisionDelta sign
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - delta sign', () => {
  it('is positive for y-up and negative for z-down', () => {
    const yUp = detectCohortReclassificationSignals(
      [rec('Up One', curTeam('GI'))],
      [rec('Up One', priTeam('GR'))]
    );
    const zDown = detectCohortReclassificationSignals(
      [rec('Down One', curTeam('GR'))],
      [rec('Down One', priTeam('BA'))]
    );

    const upResult = deriveFirstYearCohortReclassificationRecords(yUp);
    const downResult = deriveFirstYearCohortReclassificationRecords(zDown);

    expect(upResult.records[0].ageDivisionDelta).toBeGreaterThan(0);
    expect(downResult.records[0].ageDivisionDelta).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// 12. Source references preserved; inputs not mutated
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - roster authority', () => {
  it('preserves source player and team references', () => {
    const cur = rec('Sky High', curTeam('MM'), 'c1');
    const pri = rec('Sky High', priTeam('GR'), 'p1');
    const signals = detectCohortReclassificationSignals([cur], [pri]);

    const result = deriveFirstYearCohortReclassificationRecords(signals);
    const record = result.records[0];

    expect(record.player).toBe(cur.player);
    expect(record.currentTeam).toBe(cur.team);
    expect(record.priorTeam).toBe(pri.team);
  });

  it('does not mutate the source signal entries', () => {
    const cur = rec('Sky High', curTeam('MM'), 'c1');
    const pri = rec('Sky High', priTeam('GR'), 'p1');
    const signals = detectCohortReclassificationSignals([cur], [pri]);
    const snapshot = structuredClone(signals);

    deriveFirstYearCohortReclassificationRecords(signals);

    expect(signals).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 13. Deterministic ordering
// ---------------------------------------------------------------------------

describe('deriveFirstYearCohortReclassificationRecords - determinism', () => {
  it('orders records by canonical (current-side) entry order and is repeatable', () => {
    const current = [
      rec('Sky High', curTeam('MM')), // y-up
      rec('Down Low', curTeam('PW')), // z-down
    ];
    const prior = [
      rec('Sky High', priTeam('GR')),
      rec('Down Low', priTeam('MM')),
    ];
    const signals = detectCohortReclassificationSignals(current, prior);

    const result = deriveFirstYearCohortReclassificationRecords(signals);
    expect(result.records.map((r) => r.identityKey)).toEqual([
      'sky high',
      'down low',
    ]);

    const rerun = deriveFirstYearCohortReclassificationRecords(signals);
    expect(rerun.records.map((r) => [r.identityKey, r.reclassificationType])).toEqual(
      result.records.map((r) => [r.identityKey, r.reclassificationType])
    );
  });
});
