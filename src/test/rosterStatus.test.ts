import { describe, it, expect } from 'vitest';
import { deriveRosterStatusFromOverlap } from '../engine/rosterStatus';
import type { PlayerIdentityOverlapResult } from '../engine/playerIdentityOverlap';
import type { PlayerIdentityInput } from '../engine/playerDuplicateDetection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p(name: string, id?: string): PlayerIdentityInput {
  return id ? { name, id } : { name };
}

function emptyResult(): PlayerIdentityOverlapResult {
  return { exactMatches: [], currentOnly: [], priorOnly: [], ambiguous: [] };
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('deriveRosterStatusFromOverlap - empty input', () => {
  it('returns an empty array when the overlap result is fully empty', () => {
    expect(deriveRosterStatusFromOverlap(emptyResult())).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Exact matches
// ---------------------------------------------------------------------------

describe('deriveRosterStatusFromOverlap - exactMatches', () => {
  it('produces two entries per exact match (current and prior)', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('John Smith', 'p1');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      exactMatches: [{ identityKey: 'john smith', current: cur, prior: pri }],
    });
    expect(result).toHaveLength(2);
  });

  it('current entry gets returning / high / exact-identity-match', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('John Smith', 'p1');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      exactMatches: [{ identityKey: 'john smith', current: cur, prior: pri }],
    });
    const currentEntry = result.find((e) => e.side === 'current')!;
    expect(currentEntry.derived.status).toBe('returning');
    expect(currentEntry.derived.confidence).toBe('high');
    expect(currentEntry.derived.reason).toBe('exact-identity-match');
  });

  it('prior entry gets returning / high / exact-identity-match', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('John Smith', 'p1');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      exactMatches: [{ identityKey: 'john smith', current: cur, prior: pri }],
    });
    const priorEntry = result.find((e) => e.side === 'prior')!;
    expect(priorEntry.derived.status).toBe('returning');
    expect(priorEntry.derived.confidence).toBe('high');
    expect(priorEntry.derived.reason).toBe('exact-identity-match');
  });

  it('both entries carry the correct identityKey', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      exactMatches: [{ identityKey: 'john smith', current: p('John Smith'), prior: p('john smith') }],
    });
    expect(result.every((e) => e.identityKey === 'john smith')).toBe(true);
  });

  it('preserves the original player record reference in each entry', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('John Smith', 'p1');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      exactMatches: [{ identityKey: 'john smith', current: cur, prior: pri }],
    });
    expect(result.find((e) => e.side === 'current')!.player).toBe(cur);
    expect(result.find((e) => e.side === 'prior')!.player).toBe(pri);
  });

  it('produces four entries for two distinct exact matches', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      exactMatches: [
        { identityKey: 'john smith', current: p('John Smith'), prior: p('John Smith') },
        { identityKey: 'jane doe', current: p('Jane Doe'), prior: p('Jane Doe') },
      ],
    });
    expect(result).toHaveLength(4);
    expect(result.filter((e) => e.derived.status === 'returning')).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// 3. Current-only
// ---------------------------------------------------------------------------

describe('deriveRosterStatusFromOverlap - currentOnly', () => {
  it('produces one entry per current-only group', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      currentOnly: [{ identityKey: 'john smith', players: [p('John Smith', 'c1')] }],
    });
    expect(result).toHaveLength(1);
  });

  it('entry gets new / high / current-only', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      currentOnly: [{ identityKey: 'john smith', players: [p('John Smith')] }],
    });
    expect(result[0].derived.status).toBe('new');
    expect(result[0].derived.confidence).toBe('high');
    expect(result[0].derived.reason).toBe('current-only');
  });

  it('entry side is current', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      currentOnly: [{ identityKey: 'john smith', players: [p('John Smith')] }],
    });
    expect(result[0].side).toBe('current');
  });

  it('preserves the original player record reference', () => {
    const player = p('John Smith', 'c1');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      currentOnly: [{ identityKey: 'john smith', players: [player] }],
    });
    expect(result[0].player).toBe(player);
  });

  it('produces one entry per player across multiple current-only groups', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      currentOnly: [
        { identityKey: 'alpha', players: [p('Alpha')] },
        { identityKey: 'beta', players: [p('Beta')] },
        { identityKey: 'gamma', players: [p('Gamma')] },
      ],
    });
    expect(result).toHaveLength(3);
    expect(result.every((e) => e.derived.status === 'new')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. Prior-only
// ---------------------------------------------------------------------------

describe('deriveRosterStatusFromOverlap - priorOnly', () => {
  it('produces one entry per prior-only group', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      priorOnly: [{ identityKey: 'john smith', players: [p('John Smith', 'p1')] }],
    });
    expect(result).toHaveLength(1);
  });

  it('entry gets not-returning / high / prior-only', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      priorOnly: [{ identityKey: 'john smith', players: [p('John Smith')] }],
    });
    expect(result[0].derived.status).toBe('not-returning');
    expect(result[0].derived.confidence).toBe('high');
    expect(result[0].derived.reason).toBe('prior-only');
  });

  it('entry side is prior', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      priorOnly: [{ identityKey: 'john smith', players: [p('John Smith')] }],
    });
    expect(result[0].side).toBe('prior');
  });

  it('preserves the original player record reference', () => {
    const player = p('John Smith', 'p1');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      priorOnly: [{ identityKey: 'john smith', players: [player] }],
    });
    expect(result[0].player).toBe(player);
  });
});

// ---------------------------------------------------------------------------
// 5. Ambiguous — preservation
// ---------------------------------------------------------------------------

describe('deriveRosterStatusFromOverlap - ambiguous', () => {
  it('produces one entry per player in the current array of an ambiguous group', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      ambiguous: [{
        identityKey: 'john smith',
        current: [p('John Smith', 'c1'), p('John Smith', 'c2')],
        prior: [p('John Smith', 'p1')],
        reason: 'duplicate-current',
      }],
    });
    const currentEntries = result.filter((e) => e.side === 'current');
    expect(currentEntries).toHaveLength(2);
  });

  it('produces one entry per player in the prior array of an ambiguous group', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      ambiguous: [{
        identityKey: 'john smith',
        current: [p('John Smith', 'c1')],
        prior: [p('John Smith', 'p1'), p('John Smith', 'p2')],
        reason: 'duplicate-prior',
      }],
    });
    const priorEntries = result.filter((e) => e.side === 'prior');
    expect(priorEntries).toHaveLength(2);
  });

  it('all ambiguous entries get unknown / low / ambiguous-identity', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      ambiguous: [{
        identityKey: 'john smith',
        current: [p('John Smith', 'c1'), p('John Smith', 'c2')],
        prior: [p('John Smith', 'p1'), p('John Smith', 'p2')],
        reason: 'duplicate-both',
      }],
    });
    for (const e of result) {
      expect(e.derived.status).toBe('unknown');
      expect(e.derived.confidence).toBe('low');
      expect(e.derived.reason).toBe('ambiguous-identity');
    }
  });

  it('ambiguous records are never dropped — all source records appear in output', () => {
    const c1 = p('John Smith', 'c1');
    const c2 = p('John Smith', 'c2');
    const p1 = p('John Smith', 'p1');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      ambiguous: [{ identityKey: 'john smith', current: [c1, c2], prior: [p1], reason: 'duplicate-current' }],
    });
    expect(result).toHaveLength(3);
    const players = result.map((e) => e.player);
    expect(players).toContain(c1);
    expect(players).toContain(c2);
    expect(players).toContain(p1);
  });

  it('ambiguous group with empty current (prior-only duplicates) still produces entries', () => {
    const p1 = p('John Smith', 'p1');
    const p2 = p('John Smith', 'p2');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      ambiguous: [{ identityKey: 'john smith', current: [], prior: [p1, p2], reason: 'duplicate-prior' }],
    });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.derived.status === 'unknown')).toBe(true);
    expect(result.every((e) => e.side === 'prior')).toBe(true);
  });

  it('ambiguous group with empty prior (current-only duplicates) still produces entries', () => {
    const c1 = p('John Smith', 'c1');
    const c2 = p('John Smith', 'c2');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      ambiguous: [{ identityKey: 'john smith', current: [c1, c2], prior: [], reason: 'duplicate-current' }],
    });
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.derived.status === 'unknown')).toBe(true);
    expect(result.every((e) => e.side === 'current')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Source record preservation
// ---------------------------------------------------------------------------

describe('deriveRosterStatusFromOverlap - source record preservation', () => {
  it('player object is not mutated — derived is a separate field', () => {
    const player = p('John Smith', 'c1');
    const original = { ...player };
    deriveRosterStatusFromOverlap({
      ...emptyResult(),
      currentOnly: [{ identityKey: 'john smith', players: [player] }],
    });
    expect(player).toEqual(original);
  });

  it('derived object does not appear on the player object', () => {
    const player = p('John Smith', 'c1');
    deriveRosterStatusFromOverlap({
      ...emptyResult(),
      currentOnly: [{ identityKey: 'john smith', players: [player] }],
    });
    expect((player as Record<string, unknown>)['derived']).toBeUndefined();
    expect((player as Record<string, unknown>)['status']).toBeUndefined();
  });

  it('player name is preserved exactly as supplied', () => {
    const raw = '  JOHN   smith ';
    const player: PlayerIdentityInput = { name: raw };
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      currentOnly: [{ identityKey: 'john smith', players: [player] }],
    });
    expect(result[0].player.name).toBe(raw);
  });
});

// ---------------------------------------------------------------------------
// 7. Mixed result
// ---------------------------------------------------------------------------

describe('deriveRosterStatusFromOverlap - mixed result', () => {
  it('correctly assigns all four statuses in a mixed overlap result', () => {
    const cur = p('Returning Player', 'c1');
    const pri = p('Returning Player', 'p1');
    const result = deriveRosterStatusFromOverlap({
      exactMatches: [{ identityKey: 'returning player', current: cur, prior: pri }],
      currentOnly: [{ identityKey: 'new player', players: [p('New Player')] }],
      priorOnly: [{ identityKey: 'gone player', players: [p('Gone Player')] }],
      ambiguous: [{
        identityKey: 'duplicate',
        current: [p('Duplicate', 'ca'), p('Duplicate', 'cb')],
        prior: [p('Duplicate', 'pa')],
        reason: 'duplicate-current',
      }],
    });

    const returningEntries = result.filter((e) => e.derived.status === 'returning');
    const newEntries = result.filter((e) => e.derived.status === 'new');
    const notReturningEntries = result.filter((e) => e.derived.status === 'not-returning');
    const unknownEntries = result.filter((e) => e.derived.status === 'unknown');

    expect(returningEntries).toHaveLength(2); // current + prior of exact match
    expect(newEntries).toHaveLength(1);
    expect(notReturningEntries).toHaveLength(1);
    expect(unknownEntries).toHaveLength(3); // 2 current + 1 prior in ambiguous group
  });

  it('total entry count equals sum of all source records in the overlap result', () => {
    // exactMatches: 1 match × 2 sides = 2
    // currentOnly: 1 group × 1 player = 1
    // priorOnly: 1 group × 1 player = 1
    // ambiguous: 2 current + 1 prior = 3
    // Total: 7
    const result = deriveRosterStatusFromOverlap({
      exactMatches: [{ identityKey: 'a', current: p('A'), prior: p('A') }],
      currentOnly: [{ identityKey: 'b', players: [p('B')] }],
      priorOnly: [{ identityKey: 'c', players: [p('C')] }],
      ambiguous: [{
        identityKey: 'd',
        current: [p('D', 'd1'), p('D', 'd2')],
        prior: [p('D', 'd3')],
        reason: 'duplicate-current',
      }],
    });
    expect(result).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// 8. Ordering
// ---------------------------------------------------------------------------

describe('deriveRosterStatusFromOverlap - ordering', () => {
  it('exactMatches entries appear before currentOnly entries', () => {
    const result = deriveRosterStatusFromOverlap({
      exactMatches: [{ identityKey: 'a', current: p('A'), prior: p('A') }],
      currentOnly: [{ identityKey: 'b', players: [p('B')] }],
      priorOnly: [],
      ambiguous: [],
    });
    expect(result[0].derived.status).toBe('returning');
    expect(result[1].derived.status).toBe('returning');
    expect(result[2].derived.status).toBe('new');
  });

  it('currentOnly entries appear before priorOnly entries', () => {
    const result = deriveRosterStatusFromOverlap({
      exactMatches: [],
      currentOnly: [{ identityKey: 'a', players: [p('A')] }],
      priorOnly: [{ identityKey: 'b', players: [p('B')] }],
      ambiguous: [],
    });
    expect(result[0].derived.status).toBe('new');
    expect(result[1].derived.status).toBe('not-returning');
  });

  it('priorOnly entries appear before ambiguous entries', () => {
    const result = deriveRosterStatusFromOverlap({
      exactMatches: [],
      currentOnly: [],
      priorOnly: [{ identityKey: 'a', players: [p('A')] }],
      ambiguous: [{
        identityKey: 'b',
        current: [p('B', 'b1'), p('B', 'b2')],
        prior: [],
        reason: 'duplicate-current',
      }],
    });
    expect(result[0].derived.status).toBe('not-returning');
    expect(result[1].derived.status).toBe('unknown');
  });

  it('within an exact match, current entry appears before prior entry', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('John Smith', 'p1');
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      exactMatches: [{ identityKey: 'john smith', current: cur, prior: pri }],
    });
    expect(result[0].side).toBe('current');
    expect(result[1].side).toBe('prior');
  });

  it('within an ambiguous group, current entries appear before prior entries', () => {
    const result = deriveRosterStatusFromOverlap({
      ...emptyResult(),
      ambiguous: [{
        identityKey: 'john smith',
        current: [p('John Smith', 'c1'), p('John Smith', 'c2')],
        prior: [p('John Smith', 'p1')],
        reason: 'duplicate-current',
      }],
    });
    expect(result[0].side).toBe('current');
    expect(result[1].side).toBe('current');
    expect(result[2].side).toBe('prior');
  });
});
