import { describe, it, expect } from 'vitest';
import { comparePriorSeasonRoster } from '../engine/priorSeasonRosterComparison';
import type { PlayerIdentityInput } from '../engine/priorSeasonRosterComparison';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p(name: string, id?: string): PlayerIdentityInput {
  return id ? { name, id } : { name };
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('comparePriorSeasonRoster - empty input', () => {
  it('returns all empty buckets when both lists are empty', () => {
    const result = comparePriorSeasonRoster([], []);
    expect(result.returning).toEqual([]);
    expect(result.newToRoster).toEqual([]);
    expect(result.notReturning).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it('places every prior player into notReturning when current is empty', () => {
    const result = comparePriorSeasonRoster([], [p('John Smith'), p('Jane Doe')]);
    expect(result.returning).toHaveLength(0);
    expect(result.newToRoster).toHaveLength(0);
    expect(result.notReturning).toHaveLength(2);
    expect(result.notReturning.map((e) => e.identityKey)).toEqual([
      'john smith',
      'jane doe',
    ]);
    expect(result.unknown).toHaveLength(0);
  });

  it('places every current player into newToRoster when prior is empty', () => {
    const result = comparePriorSeasonRoster([p('John Smith'), p('Jane Doe')], []);
    expect(result.returning).toHaveLength(0);
    expect(result.newToRoster).toHaveLength(2);
    expect(result.newToRoster.map((e) => e.identityKey)).toEqual([
      'john smith',
      'jane doe',
    ]);
    expect(result.notReturning).toHaveLength(0);
    expect(result.unknown).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Returning (exact matches)
// ---------------------------------------------------------------------------

describe('comparePriorSeasonRoster - returning', () => {
  it('pairs an exact current/prior match as a single returning entry', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('John Smith', 'p1');
    const result = comparePriorSeasonRoster([cur], [pri]);

    expect(result.returning).toHaveLength(1);
    const entry = result.returning[0];
    expect(entry.identityKey).toBe('john smith');
    expect(entry.current).toBe(cur);
    expect(entry.prior).toBe(pri);
    expect(entry.derived).toEqual({
      status: 'returning',
      confidence: 'high',
      reason: 'exact-identity-match',
    });

    expect(result.newToRoster).toHaveLength(0);
    expect(result.notReturning).toHaveLength(0);
    expect(result.unknown).toHaveLength(0);
  });

  it('returns multiple returning entries in current roster order', () => {
    const current = [p('Zach Adams'), p('Alice Baker'), p('Mike Chen')];
    const prior = [p('Mike Chen'), p('Alice Baker'), p('Zach Adams')];
    const result = comparePriorSeasonRoster(current, prior);

    expect(result.returning).toHaveLength(3);
    expect(result.returning.map((e) => e.identityKey)).toEqual([
      'zach adams',
      'alice baker',
      'mike chen',
    ]);
    expect(result.newToRoster).toHaveLength(0);
    expect(result.notReturning).toHaveLength(0);
    expect(result.unknown).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. newToRoster and notReturning
// ---------------------------------------------------------------------------

describe('comparePriorSeasonRoster - newToRoster and notReturning', () => {
  it('classifies current-only players as newToRoster', () => {
    const result = comparePriorSeasonRoster([p('John Smith')], [p('Jane Doe')]);

    expect(result.newToRoster).toHaveLength(1);
    expect(result.newToRoster[0].identityKey).toBe('john smith');
    expect(result.newToRoster[0].side).toBe('current');
    expect(result.newToRoster[0].derived).toEqual({
      status: 'new',
      confidence: 'high',
      reason: 'current-only',
    });

    expect(result.notReturning).toHaveLength(1);
    expect(result.notReturning[0].identityKey).toBe('jane doe');
    expect(result.notReturning[0].side).toBe('prior');
    expect(result.notReturning[0].derived).toEqual({
      status: 'not-returning',
      confidence: 'high',
      reason: 'prior-only',
    });
  });

  it('orders newToRoster by current order and notReturning by prior order', () => {
    const current = [p('Alpha One'), p('Beta Two')];
    const prior = [p('Gamma Three'), p('Delta Four')];
    const result = comparePriorSeasonRoster(current, prior);

    expect(result.newToRoster.map((e) => e.identityKey)).toEqual([
      'alpha one',
      'beta two',
    ]);
    expect(result.notReturning.map((e) => e.identityKey)).toEqual([
      'gamma three',
      'delta four',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. Unknown (ambiguous duplicates)
// ---------------------------------------------------------------------------

describe('comparePriorSeasonRoster - unknown', () => {
  it('marks duplicate current records as unknown and preserves both', () => {
    const c1 = p('John Smith', 'c1');
    const c2 = p('John Smith', 'c2');
    const pri = p('John Smith', 'p1');
    const result = comparePriorSeasonRoster([c1, c2], [pri]);

    expect(result.unknown).toHaveLength(3);
    const currentUnknown = result.unknown.filter((e) => e.side === 'current');
    expect(currentUnknown.map((e) => e.player)).toEqual([c1, c2]);
    expect(result.unknown.every((e) => e.identityKey === 'john smith')).toBe(true);
    expect(result.unknown.every((e) => e.derived.status === 'unknown')).toBe(true);
    expect(result.unknown.every((e) => e.derived.confidence === 'low')).toBe(true);
    expect(
      result.unknown.every((e) => e.derived.reason === 'ambiguous-identity')
    ).toBe(true);
  });

  it('marks duplicate prior records as unknown and preserves both', () => {
    const cur = p('John Smith', 'c1');
    const p1 = p('John Smith', 'p1');
    const p2 = p('John Smith', 'p2');
    const result = comparePriorSeasonRoster([cur], [p1, p2]);

    const priorUnknown = result.unknown.filter((e) => e.side === 'prior');
    expect(priorUnknown.map((e) => e.player)).toEqual([p1, p2]);
    expect(result.unknown).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// 5. Mixed comparison and bucket exclusivity
// ---------------------------------------------------------------------------

describe('comparePriorSeasonRoster - mixed and exclusivity', () => {
  it('classifies returning, newToRoster, notReturning, and unknown together', () => {
    const current = [
      p('Returning Player'), // returning
      p('Brand New'), // newToRoster
      p('Dup Name', 'c1'), // unknown (duplicate current)
      p('Dup Name', 'c2'), // unknown (duplicate current)
    ];
    const prior = [
      p('Returning Player'), // returning
      p('Gone Player'), // notReturning
      p('Dup Name', 'p1'), // unknown
    ];
    const result = comparePriorSeasonRoster(current, prior);

    expect(result.returning.map((e) => e.identityKey)).toEqual([
      'returning player',
    ]);
    expect(result.newToRoster.map((e) => e.identityKey)).toEqual(['brand new']);
    expect(result.notReturning.map((e) => e.identityKey)).toEqual([
      'gone player',
    ]);
    expect(result.unknown.map((e) => e.identityKey)).toEqual([
      'dup name',
      'dup name',
      'dup name',
    ]);
  });

  it('keeps ambiguous keys out of returning, newToRoster, and notReturning', () => {
    const current = [p('Dup Name', 'c1'), p('Dup Name', 'c2'), p('Solo Current')];
    const prior = [p('Dup Name', 'p1'), p('Solo Prior')];
    const result = comparePriorSeasonRoster(current, prior);

    const ambiguousKey = 'dup name';
    expect(result.returning.map((e) => e.identityKey)).not.toContain(ambiguousKey);
    expect(result.newToRoster.map((e) => e.identityKey)).not.toContain(
      ambiguousKey
    );
    expect(result.notReturning.map((e) => e.identityKey)).not.toContain(
      ambiguousKey
    );
    expect(result.unknown.every((e) => e.identityKey === ambiguousKey)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Source record preservation and no mutation
// ---------------------------------------------------------------------------

describe('comparePriorSeasonRoster - record preservation', () => {
  it('preserves source player record references across all buckets', () => {
    const ret = p('Returning Player', 'rc');
    const retPrior = p('Returning Player', 'rp');
    const fresh = p('Brand New', 'nc');
    const gone = p('Gone Player', 'gp');
    const dupC = p('Dup Name', 'dc');
    const dupP1 = p('Dup Name', 'dp1');
    const dupP2 = p('Dup Name', 'dp2');

    const result = comparePriorSeasonRoster(
      [ret, fresh, dupC],
      [retPrior, gone, dupP1, dupP2]
    );

    expect(result.returning[0].current).toBe(ret);
    expect(result.returning[0].prior).toBe(retPrior);
    expect(result.newToRoster[0].player).toBe(fresh);
    expect(result.notReturning[0].player).toBe(gone);
    expect(result.unknown.map((e) => e.player)).toEqual([dupC, dupP1, dupP2]);
  });

  it('does not mutate input player objects', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('John Smith', 'p1');
    const curSnapshot = { ...cur };
    const priSnapshot = { ...pri };

    comparePriorSeasonRoster([cur], [pri]);

    expect(cur).toEqual(curSnapshot);
    expect(pri).toEqual(priSnapshot);
  });

  it('does not reorder, drop, or merge source records', () => {
    const current = [p('Beta', 'b'), p('Alpha', 'a'), p('Gamma', 'g')];
    const prior = [p('Alpha', 'pa')];
    const result = comparePriorSeasonRoster(current, prior);

    // Alpha returns; Beta and Gamma are new, preserved in current order.
    expect(result.returning.map((e) => e.identityKey)).toEqual(['alpha']);
    expect(result.newToRoster.map((e) => e.identityKey)).toEqual([
      'beta',
      'gamma',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 7. Deterministic ordering of unknown groups
// ---------------------------------------------------------------------------

describe('comparePriorSeasonRoster - unknown ordering', () => {
  it('orders unknown groups current-first, then prior-only ambiguous keys', () => {
    // 'John Smith': duplicate in current (seen current-first).
    // 'Jane Doe': duplicate only in prior (seen second).
    const result = comparePriorSeasonRoster(
      [p('John Smith', 'c1'), p('John Smith', 'c2')],
      [p('Jane Doe', 'p1'), p('Jane Doe', 'p2'), p('John Smith', 'p3')]
    );

    expect(result.unknown.map((e) => e.identityKey)).toEqual([
      'john smith',
      'john smith',
      'john smith',
      'jane doe',
      'jane doe',
    ]);
  });

  it('lists current records before prior records within an ambiguous group', () => {
    const c1 = p('John Smith', 'c1');
    const c2 = p('John Smith', 'c2');
    const p1 = p('John Smith', 'p1');
    const p2 = p('John Smith', 'p2');
    const result = comparePriorSeasonRoster([c1, c2], [p1, p2]);

    expect(result.unknown.map((e) => e.side)).toEqual([
      'current',
      'current',
      'prior',
      'prior',
    ]);
    expect(result.unknown.map((e) => e.player)).toEqual([c1, c2, p1, p2]);
  });
});
