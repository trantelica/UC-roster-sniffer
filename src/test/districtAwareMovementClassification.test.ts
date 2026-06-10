import { describe, it, expect } from 'vitest';
import {
  classifyDistrictAwarePlayerMovement,
  type DistrictAwareMovementEntry,
  type DistrictAwarePlayerMovementResult,
} from '../engine/districtAwareMovementClassification';
import {
  detectExactPriorSeasonPlayerMovement,
  type RosterMovementRecord,
  type TeamSlotContext,
} from '../engine/playerMovementDetection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A 2026 (current) team slot, overriding the team code and any context. */
function curTeam(
  teamCode: string,
  overrides: Partial<TeamSlotContext> = {}
): TeamSlotContext {
  return {
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode,
    ...overrides,
  };
}

/** A 2025 (prior) team slot, overriding the team code and any context. */
function priTeam(
  teamCode: string,
  overrides: Partial<TeamSlotContext> = {}
): TeamSlotContext {
  return {
    seasonId: '2025',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode,
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
  result: DistrictAwarePlayerMovementResult,
  identityKey: string,
  side: 'current' | 'prior'
): DistrictAwareMovementEntry {
  const matches = result.entries.filter(
    (e) => e.identityKey === identityKey && e.side === side
  );
  expect(matches).toHaveLength(1);
  return matches[0];
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - empty input', () => {
  it('returns no entries when both lists are empty', () => {
    const result = classifyDistrictAwarePlayerMovement([], []);
    expect(result.entries).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Same-team returning
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - same-team returning', () => {
  it('classifies an exact match on the same team slot as same-team-returning', () => {
    const cur = rec('John Smith', curTeam('B1'), 'c1');
    const pri = rec('John Smith', priTeam('B1'), 'p1');
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    // One entry per source record (current + prior).
    expect(result.entries).toHaveLength(2);

    const currentSide = entryFor(result, 'john smith', 'current');
    expect(currentSide.classification).toEqual({
      status: 'same-team-returning',
      confidence: 'high',
      reason: 'same-team-slot',
    });
    expect(currentSide.record).toBe(cur);
    expect(currentSide.player).toBe(cur.player);
    expect(currentSide.currentTeam).toBe(cur.team);
    expect(currentSide.priorTeam).toBe(pri.team);

    const priorSide = entryFor(result, 'john smith', 'prior');
    expect(priorSide.classification.status).toBe('same-team-returning');
    expect(priorSide.record).toBe(pri);
    expect(priorSide.currentTeam).toBe(cur.team);
    expect(priorSide.priorTeam).toBe(pri.team);
  });
});

// ---------------------------------------------------------------------------
// 3. Same district, promotion / relegation / lateral
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - same-district hierarchy movement', () => {
  it('classifies a same-district move to a higher team as promoted (B2 -> B1)', () => {
    const cur = rec('Mover Up', curTeam('B1'));
    const pri = rec('Mover Up', priTeam('B2'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    const currentSide = entryFor(result, 'mover up', 'current');
    expect(currentSide.classification).toEqual({
      status: 'promoted',
      confidence: 'high',
      reason: 'same-district-higher-team',
    });
    expect(currentSide.currentTeam).toBe(cur.team);
    expect(currentSide.priorTeam).toBe(pri.team);

    // Prior side describes the same player movement: still promoted.
    const priorSide = entryFor(result, 'mover up', 'prior');
    expect(priorSide.classification.status).toBe('promoted');
    expect(priorSide.currentTeam).toBe(cur.team);
    expect(priorSide.priorTeam).toBe(pri.team);
  });

  it('classifies a same-district move to a lower team as relegated (B1 -> B2)', () => {
    const cur = rec('Mover Down', curTeam('B2'));
    const pri = rec('Mover Down', priTeam('B1'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    const currentSide = entryFor(result, 'mover down', 'current');
    expect(currentSide.classification).toEqual({
      status: 'relegated',
      confidence: 'high',
      reason: 'same-district-lower-team',
    });
  });

  it('classifies a same-district move between equivalent tiers as lateral (C2 -> D2)', () => {
    const cur = rec('Side Step', curTeam('D2'));
    const pri = rec('Side Step', priTeam('C2'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    const currentSide = entryFor(result, 'side step', 'current');
    expect(currentSide.classification).toEqual({
      status: 'lateral',
      confidence: 'high',
      reason: 'same-district-equivalent-team',
    });
  });

  it('treats B3+ as equivalent to C2 (lateral, B3 -> C2)', () => {
    const cur = rec('Tier Equal', curTeam('C2'));
    const pri = rec('Tier Equal', priTeam('B3'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    expect(entryFor(result, 'tier equal', 'current').classification.status).toBe(
      'lateral'
    );
  });

  it('treats C1 and B2 as equivalent under the corrected hierarchy (lateral, C1 -> B2)', () => {
    const cur = rec('Equal Mid', curTeam('B2'));
    const pri = rec('Equal Mid', priTeam('C1'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    expect(entryFor(result, 'equal mid', 'current').classification).toEqual({
      status: 'lateral',
      confidence: 'high',
      reason: 'same-district-equivalent-team',
    });
  });

  it('classifies a move up to an A-code team as promoted (B1 -> A4)', () => {
    const cur = rec('Top Tier', curTeam('A4'));
    const pri = rec('Top Tier', priTeam('B1'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    expect(entryFor(result, 'top tier', 'current').classification).toEqual({
      status: 'promoted',
      confidence: 'high',
      reason: 'same-district-higher-team',
    });
  });

  it('classifies a move down from an A-code team as relegated (A4 -> B1)', () => {
    const cur = rec('Stepped Down', curTeam('B1'));
    const pri = rec('Stepped Down', priTeam('A4'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    expect(entryFor(result, 'stepped down', 'current').classification).toEqual({
      status: 'relegated',
      confidence: 'high',
      reason: 'same-district-lower-team',
    });
  });

  it('treats different A-codes as hierarchy-equivalent (lateral, A2 -> A4)', () => {
    const cur = rec('Same Top', curTeam('A4'));
    const pri = rec('Same Top', priTeam('A2'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    expect(entryFor(result, 'same top', 'current').classification).toEqual({
      status: 'lateral',
      confidence: 'high',
      reason: 'same-district-equivalent-team',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Different district -> transfer
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - different district transfer', () => {
  it('classifies a different-district move as transfer, not promotion/relegation/lateral', () => {
    const cur = rec('Sam Lee', curTeam('B1', { districtId: 'brighton' }));
    const pri = rec('Sam Lee', priTeam('B2', { districtId: 'alta' }));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    const currentSide = entryFor(result, 'sam lee', 'current');
    expect(currentSide.classification).toEqual({
      status: 'transfer',
      confidence: 'high',
      reason: 'different-district',
    });
    expect(currentSide.currentTeam).toBe(cur.team);
    expect(currentSide.priorTeam).toBe(pri.team);

    const priorSide = entryFor(result, 'sam lee', 'prior');
    expect(priorSide.classification.status).toBe('transfer');
  });
});

// ---------------------------------------------------------------------------
// 5. New to conference / not returning preserved
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - new / not-returning preserved', () => {
  it('preserves a current-only identity as new-to-conference', () => {
    const cur = rec('Brand New', curTeam('B3'));
    const result = classifyDistrictAwarePlayerMovement(
      [cur],
      [rec('Someone Else', priTeam('B1'))]
    );

    const e = entryFor(result, 'brand new', 'current');
    expect(e.classification).toEqual({
      status: 'new-to-conference',
      confidence: 'high',
      reason: 'new-current-identity',
    });
    expect(e.currentTeam).toBe(cur.team);
    expect(e.priorTeam).toBeNull();
  });

  it('preserves a prior-only identity as not-returning', () => {
    const pri = rec('Gone Player', priTeam('B2'));
    const result = classifyDistrictAwarePlayerMovement(
      [rec('Someone Else', curTeam('B1'))],
      [pri]
    );

    const e = entryFor(result, 'gone player', 'prior');
    expect(e.classification).toEqual({
      status: 'not-returning',
      confidence: 'high',
      reason: 'missing-current-identity',
    });
    expect(e.currentTeam).toBeNull();
    expect(e.priorTeam).toBe(pri.team);
  });
});

// ---------------------------------------------------------------------------
// 6. Ambiguous / duplicate identities stay unknown only
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - ambiguous identities stay unknown', () => {
  it('classifies a duplicate current identity as unknown only', () => {
    const c1 = rec('John Smith', curTeam('B1'), 'c1');
    const c2 = rec('John Smith', curTeam('B2'), 'c2');
    const pri = rec('John Smith', priTeam('B1'), 'p1');
    const result = classifyDistrictAwarePlayerMovement([c1, c2], [pri]);

    expect(result.entries).toHaveLength(3);
    for (const e of result.entries) {
      expect(e.identityKey).toBe('john smith');
      expect(e.classification).toEqual({
        status: 'unknown',
        confidence: 'low',
        reason: 'ambiguous-identity',
      });
    }
    // No movement verdicts were assigned to the ambiguous key.
    const statuses = result.entries.map((e) => e.classification.status);
    expect(statuses).not.toContain('transfer');
    expect(statuses).not.toContain('promoted');
    expect(statuses).not.toContain('relegated');
    expect(statuses).not.toContain('lateral');
  });

  it('classifies a duplicate prior identity as unknown only', () => {
    const cur = rec('John Smith', curTeam('B1'), 'c1');
    const p1 = rec('John Smith', priTeam('B1'), 'p1');
    const p2 = rec('John Smith', priTeam('B2'), 'p2');
    const result = classifyDistrictAwarePlayerMovement([cur], [p1, p2]);

    expect(result.entries).toHaveLength(3);
    expect(
      result.entries.every((e) => e.classification.status === 'unknown')
    ).toBe(true);
    // Both prior records preserved individually, by reference.
    const priorRecords = result.entries
      .filter((e) => e.side === 'prior')
      .map((e) => e.record);
    expect(priorRecords).toEqual([p1, p2]);
  });
});

// ---------------------------------------------------------------------------
// 7. Age division change handling (conservative — no y-up/z-down)
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - age division change is conservative', () => {
  it('classifies same-district + different-age-division as age-division-change', () => {
    const cur = rec('Grew Up', curTeam('B1', { ageDivisionId: 'PW' }));
    const pri = rec('Grew Up', priTeam('B1', { ageDivisionId: 'GR' }));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    const currentSide = entryFor(result, 'grew up', 'current');
    expect(currentSide.classification).toEqual({
      status: 'age-division-change',
      confidence: 'high',
      reason: 'same-district-different-age-division',
    });
    // Conservative: no promotion/relegation claimed even though codes match.
    expect(currentSide.classification.status).not.toBe('promoted');
    expect(currentSide.classification.status).not.toBe('relegated');
  });

  it('classifies different-district + different-age-division as transfer', () => {
    const cur = rec(
      'Moved Far',
      curTeam('B1', { districtId: 'brighton', ageDivisionId: 'PW' })
    );
    const pri = rec(
      'Moved Far',
      priTeam('B2', { districtId: 'alta', ageDivisionId: 'GR' })
    );
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    const currentSide = entryFor(result, 'moved far', 'current');
    expect(currentSide.classification).toEqual({
      status: 'transfer',
      confidence: 'high',
      reason: 'different-district',
    });
  });

  it('falls back to low-confidence lateral for a same-district, same-age move with a genuinely invalid team code', () => {
    // `C3` is not a supported classification (no C3 exists). It must not produce
    // a false high-confidence promoted/relegated/lateral verdict.
    const cur = rec('Bad Code', curTeam('C3'));
    const pri = rec('Bad Code', priTeam('B1'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    const currentSide = entryFor(result, 'bad code', 'current');
    expect(currentSide.classification).toEqual({
      status: 'lateral',
      confidence: 'low',
      reason: 'same-district-unrankable-team',
    });
  });

  it('classifies a same-district, same-age move between valid A-codes without the unrankable fallback (A2 -> A4 is high-confidence lateral)', () => {
    const cur = rec('Valid A Move', curTeam('A4'));
    const pri = rec('Valid A Move', priTeam('A2'));
    const result = classifyDistrictAwarePlayerMovement([cur], [pri]);

    const currentSide = entryFor(result, 'valid a move', 'current');
    expect(currentSide.classification.confidence).toBe('high');
    expect(currentSide.classification.reason).not.toBe(
      'same-district-unrankable-team'
    );
  });
});

// ---------------------------------------------------------------------------
// 8. Source preservation / no mutation
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - preservation and invariants', () => {
  it('does not mutate input player or team objects', () => {
    const cur = rec('John Smith', curTeam('B1'), 'c1');
    const pri = rec('John Smith', priTeam('B2'), 'p1');
    const curSnap = JSON.parse(JSON.stringify(cur));
    const priSnap = JSON.parse(JSON.stringify(pri));

    classifyDistrictAwarePlayerMovement([cur], [pri]);

    expect(cur).toEqual(curSnap);
    expect(pri).toEqual(priSnap);
  });

  it('preserves source player and record references on every entry', () => {
    const current = [
      rec('Stay Put', curTeam('B1')),
      rec('Mover Up', curTeam('B1')),
      rec('Fresh Face', curTeam('B3')),
    ];
    const prior = [
      rec('Stay Put', priTeam('B1')),
      rec('Mover Up', priTeam('B2')),
      rec('Left Town', priTeam('B1')),
    ];
    const result = classifyDistrictAwarePlayerMovement(current, prior);

    // One entry per source record.
    expect(result.entries).toHaveLength(current.length + prior.length);
    const sourceRecords = [...current, ...prior];
    for (const source of sourceRecords) {
      const matches = result.entries.filter((e) => e.record === source);
      expect(matches).toHaveLength(1);
      expect(matches[0].player).toBe(source.player);
    }
  });

  it('does not change the underlying exact-movement helper behavior', () => {
    const current = [
      rec('Stay Put', curTeam('B1')),
      rec('Mover Up', curTeam('B1')),
    ];
    const prior = [
      rec('Stay Put', priTeam('B1')),
      rec('Mover Up', priTeam('B2')),
    ];

    // Detector output is identical whether or not the classifier ran.
    const before = detectExactPriorSeasonPlayerMovement(current, prior);
    classifyDistrictAwarePlayerMovement(current, prior);
    const after = detectExactPriorSeasonPlayerMovement(current, prior);

    expect(after.sameTeamReturning.map((e) => e.identityKey)).toEqual(
      before.sameTeamReturning.map((e) => e.identityKey)
    );
    expect(after.transferredIn.map((e) => e.identityKey)).toEqual(
      before.transferredIn.map((e) => e.identityKey)
    );
    expect(after.transferredOut.map((e) => e.identityKey)).toEqual(
      before.transferredOut.map((e) => e.identityKey)
    );
  });
});

// ---------------------------------------------------------------------------
// 9. Mixed scenario
// ---------------------------------------------------------------------------

describe('classifyDistrictAwarePlayerMovement - mixed scenario', () => {
  it('classifies same-team, promotion, transfer, new, not-returning, and unknown together', () => {
    const current = [
      rec('Stay Put', curTeam('B1')), // same-team-returning
      rec('Mover Up', curTeam('B1')), // promoted (prior B2)
      rec('Cross Town', curTeam('B1', { districtId: 'brighton' })), // transfer
      rec('Fresh Face', curTeam('B3')), // new-to-conference
      rec('Dup Name', curTeam('B1'), 'c1'), // unknown
      rec('Dup Name', curTeam('B2'), 'c2'), // unknown
    ];
    const prior = [
      rec('Stay Put', priTeam('B1')),
      rec('Mover Up', priTeam('B2')),
      rec('Cross Town', priTeam('B1', { districtId: 'alta' })),
      rec('Left Town', priTeam('B1')), // not-returning
      rec('Dup Name', priTeam('B3'), 'p1'), // unknown
    ];
    const result = classifyDistrictAwarePlayerMovement(current, prior);

    expect(result.entries).toHaveLength(current.length + prior.length);

    expect(entryFor(result, 'stay put', 'current').classification.status).toBe(
      'same-team-returning'
    );
    expect(entryFor(result, 'mover up', 'current').classification.status).toBe(
      'promoted'
    );
    expect(entryFor(result, 'cross town', 'current').classification.status).toBe(
      'transfer'
    );
    expect(entryFor(result, 'fresh face', 'current').classification.status).toBe(
      'new-to-conference'
    );
    expect(entryFor(result, 'left town', 'prior').classification.status).toBe(
      'not-returning'
    );
    expect(
      result.entries
        .filter((e) => e.identityKey === 'dup name')
        .every((e) => e.classification.status === 'unknown')
    ).toBe(true);
  });
});
