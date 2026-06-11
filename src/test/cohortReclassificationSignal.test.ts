import { describe, it, expect } from 'vitest';
import {
  detectCohortReclassificationSignals,
  type CohortReclassificationEntry,
  type CohortReclassificationSignalResult,
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

/** Finds the single entry for an identity key on a given side. */
function entryFor(
  result: CohortReclassificationSignalResult,
  identityKey: string,
  side: 'current' | 'prior'
): CohortReclassificationEntry {
  const matches = result.entries.filter(
    (e) => e.identityKey === identityKey && e.side === side
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - empty input', () => {
  it('returns no entries when both lists are empty', () => {
    const result = detectCohortReclassificationSignals([], []);
    expect(result.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Expected one-division age progression
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - expected progression', () => {
  it('classifies prior GR -> current PW as expected-age-progression (high)', () => {
    const cur = rec('John Smith', curTeam('PW'), 'c1');
    const pri = rec('John Smith', priTeam('GR'), 'p1');
    const result = detectCohortReclassificationSignals([cur], [pri]);

    expect(result.entries).toHaveLength(2);

    const currentSide = entryFor(result, 'john smith', 'current');
    expect(currentSide.signal).toEqual({
      status: 'expected-age-progression',
      confidence: 'high',
      reason: 'normal-one-division-progression',
    });
    expect(currentSide.currentAgeDivisionId).toBe('PW');
    expect(currentSide.priorAgeDivisionId).toBe('GR');
    expect(currentSide.currentTeam).toBe(cur.team);
    expect(currentSide.priorTeam).toBe(pri.team);

    const priorSide = entryFor(result, 'john smith', 'prior');
    expect(priorSide.signal).toEqual(currentSide.signal);
    expect(priorSide.currentAgeDivisionId).toBe('PW');
    expect(priorSide.priorAgeDivisionId).toBe('GR');
  });
});

// ---------------------------------------------------------------------------
// 3. Same age division
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - same age division', () => {
  it('classifies prior PW -> current PW as same-age-division (high)', () => {
    const cur = rec('Jane Doe', curTeam('PW'));
    const pri = rec('Jane Doe', priTeam('PW'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    const currentSide = entryFor(result, 'jane doe', 'current');
    expect(currentSide.signal).toEqual({
      status: 'same-age-division',
      confidence: 'high',
      reason: 'unchanged-age-division',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Y-up candidate (skipped division)
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - y-up candidate', () => {
  it('classifies prior GR -> current MM as y-up-candidate (high, skipped)', () => {
    const cur = rec('Sky High', curTeam('MM'));
    const pri = rec('Sky High', priTeam('GR'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    const currentSide = entryFor(result, 'sky high', 'current');
    expect(currentSide.signal).toEqual({
      status: 'y-up-candidate',
      confidence: 'high',
      reason: 'skipped-age-division',
    });
  });

  it('classifies a multi-division jump (GR -> GI) as y-up-candidate', () => {
    const cur = rec('Sky High', curTeam('GI'));
    const pri = rec('Sky High', priTeam('GR'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    const currentSide = entryFor(result, 'sky high', 'current');
    expect(currentSide.signal.status).toBe('y-up-candidate');
    expect(currentSide.signal.reason).toBe('skipped-age-division');
  });
});

// ---------------------------------------------------------------------------
// 5. Z-down candidate (moved down)
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - z-down candidate', () => {
  it('classifies prior MM -> current PW as z-down-candidate (high, moved down)', () => {
    const cur = rec('Down Low', curTeam('PW'));
    const pri = rec('Down Low', priTeam('MM'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    const currentSide = entryFor(result, 'down low', 'current');
    expect(currentSide.signal).toEqual({
      status: 'z-down-candidate',
      confidence: 'high',
      reason: 'moved-down-age-division',
    });
  });

  it('classifies a multi-division drop (BA -> GR) as z-down-candidate', () => {
    const cur = rec('Down Low', curTeam('GR'));
    const pri = rec('Down Low', priTeam('BA'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    const currentSide = entryFor(result, 'down low', 'current');
    expect(currentSide.signal.status).toBe('z-down-candidate');
    expect(currentSide.signal.reason).toBe('moved-down-age-division');
  });
});

// ---------------------------------------------------------------------------
// 6. Current-only -> missing-prior-record
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - current only', () => {
  it('classifies a current record with no prior match as unknown / missing-prior-record', () => {
    const cur = rec('New Kid', curTeam('PW'));
    const result = detectCohortReclassificationSignals([cur], []);

    expect(result.entries).toHaveLength(1);
    const currentSide = entryFor(result, 'new kid', 'current');
    expect(currentSide.signal).toEqual({
      status: 'unknown',
      confidence: 'low',
      reason: 'missing-prior-record',
    });
    expect(currentSide.currentTeam).toBe(cur.team);
    expect(currentSide.priorTeam).toBeNull();
    expect(currentSide.currentAgeDivisionId).toBe('PW');
    expect(currentSide.priorAgeDivisionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7. Prior-only -> missing-current-record
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - prior only', () => {
  it('classifies a prior record with no current match as unknown / missing-current-record', () => {
    const pri = rec('Gone Away', priTeam('PW'));
    const result = detectCohortReclassificationSignals([], [pri]);

    expect(result.entries).toHaveLength(1);
    const priorSide = entryFor(result, 'gone away', 'prior');
    expect(priorSide.signal).toEqual({
      status: 'unknown',
      confidence: 'low',
      reason: 'missing-current-record',
    });
    expect(priorSide.currentTeam).toBeNull();
    expect(priorSide.priorTeam).toBe(pri.team);
    expect(priorSide.currentAgeDivisionId).toBeNull();
    expect(priorSide.priorAgeDivisionId).toBe('PW');
  });
});

// ---------------------------------------------------------------------------
// 8. Duplicate current identity -> unknown only
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - duplicate current identity', () => {
  it('marks every record with a duplicated current key as unknown / ambiguous-identity', () => {
    const cur1 = rec('Same Name', curTeam('PW'), 'c1');
    const cur2 = rec('Same Name', curTeam('MM'), 'c2');
    const pri = rec('Same Name', priTeam('GR'), 'p1');
    const result = detectCohortReclassificationSignals([cur1, cur2], [pri]);

    // 2 current + 1 prior = 3 entries, all ambiguous.
    expect(result.entries).toHaveLength(3);
    for (const e of result.entries) {
      expect(e.identityKey).toBe('same name');
      expect(e.signal).toEqual({
        status: 'unknown',
        confidence: 'low',
        reason: 'ambiguous-identity',
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Duplicate prior identity -> unknown only
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - duplicate prior identity', () => {
  it('marks every record with a duplicated prior key as unknown / ambiguous-identity', () => {
    const cur = rec('Same Name', curTeam('PW'), 'c1');
    const pri1 = rec('Same Name', priTeam('GR'), 'p1');
    const pri2 = rec('Same Name', priTeam('MM'), 'p2');
    const result = detectCohortReclassificationSignals([cur], [pri1, pri2]);

    expect(result.entries).toHaveLength(3);
    for (const e of result.entries) {
      expect(e.signal.status).toBe('unknown');
      expect(e.signal.reason).toBe('ambiguous-identity');
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Duplicate both sides -> unknown only
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - duplicate both sides', () => {
  it('marks every record as unknown / ambiguous-identity when both sides duplicate', () => {
    const cur1 = rec('Same Name', curTeam('PW'), 'c1');
    const cur2 = rec('Same Name', curTeam('MM'), 'c2');
    const pri1 = rec('Same Name', priTeam('GR'), 'p1');
    const pri2 = rec('Same Name', priTeam('BA'), 'p2');
    const result = detectCohortReclassificationSignals(
      [cur1, cur2],
      [pri1, pri2]
    );

    expect(result.entries).toHaveLength(4);
    for (const e of result.entries) {
      expect(e.signal.status).toBe('unknown');
      expect(e.signal.reason).toBe('ambiguous-identity');
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Invalid current age division -> unknown
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - invalid current age division', () => {
  it('classifies a matched pair with an unsupported current division as invalid-age-division', () => {
    const cur = rec('Bad Div', curTeam('XX'));
    const pri = rec('Bad Div', priTeam('GR'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    const currentSide = entryFor(result, 'bad div', 'current');
    expect(currentSide.signal).toEqual({
      status: 'unknown',
      confidence: 'low',
      reason: 'invalid-age-division',
    });
    // Raw (unsupported) source value is still reported, not suppressed.
    expect(currentSide.currentAgeDivisionId).toBe('XX');

    const priorSide = entryFor(result, 'bad div', 'prior');
    expect(priorSide.signal.reason).toBe('invalid-age-division');
  });
});

// ---------------------------------------------------------------------------
// 12. Invalid prior age division -> unknown
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - invalid prior age division', () => {
  it('classifies a matched pair with an unsupported prior division as invalid-age-division', () => {
    const cur = rec('Bad Prior', curTeam('PW'));
    const pri = rec('Bad Prior', priTeam(''));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    const currentSide = entryFor(result, 'bad prior', 'current');
    expect(currentSide.signal.status).toBe('unknown');
    expect(currentSide.signal.reason).toBe('invalid-age-division');
  });
});

// ---------------------------------------------------------------------------
// 13. Casing / spacing normalization still matches
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - name normalization', () => {
  it('matches through casing and spacing differences via the identity helper', () => {
    const cur = rec('  john   SMITH ', curTeam('PW'));
    const pri = rec('John Smith', priTeam('GR'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    // Both normalize to the same key, so this is a matched pair (not two
    // missing-record entries).
    expect(result.entries).toHaveLength(2);
    const currentSide = entryFor(result, 'john smith', 'current');
    expect(currentSide.signal.status).toBe('expected-age-progression');
  });

  it('matches "Cary, Hudson" comma form to "Hudson Cary" only when keys agree', () => {
    // Comma form normalizes to "Cary Hudson", so it does NOT match "Hudson Cary".
    const cur = rec('Cary, Hudson', curTeam('PW'));
    const pri = rec('Hudson Cary', priTeam('GR'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    // Different keys -> two unmatched entries, no candidate inference.
    const currentSide = entryFor(result, 'cary hudson', 'current');
    expect(currentSide.signal.reason).toBe('missing-prior-record');
    const priorSide = entryFor(result, 'hudson cary', 'prior');
    expect(priorSide.signal.reason).toBe('missing-current-record');
  });
});

// ---------------------------------------------------------------------------
// 14. Initials do not infer full-name matches
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - no initial inference', () => {
  it('does not match an initialed name to a full name', () => {
    const cur = rec('J Smith', curTeam('PW'));
    const pri = rec('John Smith', priTeam('GR'));
    const result = detectCohortReclassificationSignals([cur], [pri]);

    // Distinct keys -> no candidate, each is an unmatched unknown.
    const currentSide = entryFor(result, 'j smith', 'current');
    expect(currentSide.signal.reason).toBe('missing-prior-record');
    const priorSide = entryFor(result, 'john smith', 'prior');
    expect(priorSide.signal.reason).toBe('missing-current-record');
  });
});

// ---------------------------------------------------------------------------
// 15. Source records are not mutated; references preserved
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - roster authority', () => {
  it('does not mutate source records and preserves player/team references', () => {
    const cur = rec('John Smith', curTeam('MM'), 'c1');
    const pri = rec('John Smith', priTeam('GR'), 'p1');
    const curSnapshot = structuredClone(cur);
    const priSnapshot = structuredClone(pri);

    const result = detectCohortReclassificationSignals([cur], [pri]);

    // Source records untouched.
    expect(cur).toEqual(curSnapshot);
    expect(pri).toEqual(priSnapshot);

    // References preserved (not copies).
    const currentSide = entryFor(result, 'john smith', 'current');
    expect(currentSide.record).toBe(cur);
    expect(currentSide.player).toBe(cur.player);
    expect(currentSide.currentTeam).toBe(cur.team);
    expect(currentSide.priorTeam).toBe(pri.team);

    const priorSide = entryFor(result, 'john smith', 'prior');
    expect(priorSide.record).toBe(pri);
    expect(priorSide.player).toBe(pri.player);
  });
});

// ---------------------------------------------------------------------------
// 16. Deterministic, perspective-aware entry count and order
// ---------------------------------------------------------------------------

describe('detectCohortReclassificationSignals - determinism', () => {
  it('emits exactly one entry per source record in current-then-prior order', () => {
    const current = [
      rec('Alpha One', curTeam('PW')),
      rec('Bravo Two', curTeam('MM')),
    ];
    const prior = [
      rec('Alpha One', priTeam('GR')),
      rec('Charlie Three', priTeam('PW')),
    ];
    const result = detectCohortReclassificationSignals(current, prior);

    // 2 current + 2 prior source records => 4 entries.
    expect(result.entries).toHaveLength(current.length + prior.length);

    // Current-side entries come first, in input order, then prior-side.
    expect(result.entries.map((e) => [e.side, e.identityKey])).toEqual([
      ['current', 'alpha one'],
      ['current', 'bravo two'],
      ['prior', 'alpha one'],
      ['prior', 'charlie three'],
    ]);

    // Re-running yields an identical structure (deterministic).
    const rerun = detectCohortReclassificationSignals(current, prior);
    expect(rerun.entries.map((e) => [e.side, e.identityKey, e.signal.status])).toEqual(
      result.entries.map((e) => [e.side, e.identityKey, e.signal.status])
    );
  });
});
