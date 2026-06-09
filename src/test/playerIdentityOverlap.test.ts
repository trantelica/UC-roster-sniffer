import { describe, it, expect } from 'vitest';
import { comparePlayerIdentityOverlap } from '../engine/playerIdentityOverlap';
import type { PlayerIdentityInput } from '../engine/playerIdentityOverlap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p(name: string, id?: string): PlayerIdentityInput {
  return id ? { name, id } : { name };
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('comparePlayerIdentityOverlap - empty input', () => {
  it('returns all empty arrays when both lists are empty', () => {
    const result = comparePlayerIdentityOverlap([], []);
    expect(result.exactMatches).toEqual([]);
    expect(result.currentOnly).toEqual([]);
    expect(result.priorOnly).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it('places all prior players into priorOnly when current list is empty', () => {
    const result = comparePlayerIdentityOverlap([], [p('John Smith'), p('Jane Doe')]);
    expect(result.exactMatches).toHaveLength(0);
    expect(result.currentOnly).toHaveLength(0);
    expect(result.priorOnly).toHaveLength(2);
    expect(result.priorOnly.map((g) => g.identityKey)).toEqual(['john smith', 'jane doe']);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('places all current players into currentOnly when prior list is empty', () => {
    const result = comparePlayerIdentityOverlap([p('John Smith'), p('Jane Doe')], []);
    expect(result.exactMatches).toHaveLength(0);
    expect(result.currentOnly).toHaveLength(2);
    expect(result.currentOnly.map((g) => g.identityKey)).toEqual(['john smith', 'jane doe']);
    expect(result.priorOnly).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Exact matches
// ---------------------------------------------------------------------------

describe('comparePlayerIdentityOverlap - exact matches', () => {
  it('returns an exact match for identical names', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('John Smith', 'p1');
    const result = comparePlayerIdentityOverlap([cur], [pri]);
    expect(result.exactMatches).toHaveLength(1);
    expect(result.exactMatches[0].identityKey).toBe('john smith');
    expect(result.exactMatches[0].current).toBe(cur);
    expect(result.exactMatches[0].prior).toBe(pri);
    expect(result.currentOnly).toHaveLength(0);
    expect(result.priorOnly).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it('treats names that differ only by casing as an exact match', () => {
    const result = comparePlayerIdentityOverlap([p('JOHN SMITH')], [p('john smith')]);
    expect(result.exactMatches).toHaveLength(1);
    expect(result.exactMatches[0].identityKey).toBe('john smith');
  });

  it('treats names that differ only by spacing as an exact match', () => {
    const result = comparePlayerIdentityOverlap([p('John Smith')], [p('  john   smith  ')]);
    expect(result.exactMatches).toHaveLength(1);
    expect(result.exactMatches[0].identityKey).toBe('john smith');
  });

  it('returns multiple distinct exact matches', () => {
    const current = [p('John Smith'), p('Jane Doe')];
    const prior = [p('John Smith'), p('Jane Doe')];
    const result = comparePlayerIdentityOverlap(current, prior);
    expect(result.exactMatches).toHaveLength(2);
    expect(result.currentOnly).toHaveLength(0);
    expect(result.priorOnly).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Current-only and prior-only
// ---------------------------------------------------------------------------

describe('comparePlayerIdentityOverlap - currentOnly and priorOnly', () => {
  it('returns currentOnly when a key appears only in current', () => {
    const result = comparePlayerIdentityOverlap([p('John Smith')], [p('Jane Doe')]);
    expect(result.currentOnly).toHaveLength(1);
    expect(result.currentOnly[0].identityKey).toBe('john smith');
    expect(result.priorOnly).toHaveLength(1);
    expect(result.priorOnly[0].identityKey).toBe('jane doe');
  });

  it('returns priorOnly when a key appears only in prior', () => {
    const result = comparePlayerIdentityOverlap([], [p('Bob Jones')]);
    expect(result.priorOnly).toHaveLength(1);
    expect(result.priorOnly[0].identityKey).toBe('bob jones');
    expect(result.currentOnly).toHaveLength(0);
  });

  it('handles multiple distinct currentOnly and priorOnly groups simultaneously', () => {
    const current = [p('Alpha One'), p('Beta Two'), p('Shared Player')];
    const prior = [p('Gamma Three'), p('Delta Four'), p('Shared Player')];
    const result = comparePlayerIdentityOverlap(current, prior);
    expect(result.exactMatches).toHaveLength(1);
    expect(result.exactMatches[0].identityKey).toBe('shared player');
    expect(result.currentOnly).toHaveLength(2);
    expect(result.currentOnly.map((g) => g.identityKey)).toEqual(['alpha one', 'beta two']);
    expect(result.priorOnly).toHaveLength(2);
    expect(result.priorOnly.map((g) => g.identityKey)).toEqual(['gamma three', 'delta four']);
  });

  it('preserves original player record references in currentOnly and priorOnly', () => {
    const cur = p('John Smith', 'c1');
    const pri = p('Jane Doe', 'p1');
    const result = comparePlayerIdentityOverlap([cur], [pri]);
    expect(result.currentOnly[0].players[0]).toBe(cur);
    expect(result.priorOnly[0].players[0]).toBe(pri);
  });
});

// ---------------------------------------------------------------------------
// 4. Ambiguous identity keys
// ---------------------------------------------------------------------------

describe('comparePlayerIdentityOverlap - ambiguous', () => {
  it('marks as ambiguous with reason duplicate-current when current has 2, prior has 1', () => {
    const result = comparePlayerIdentityOverlap(
      [p('John Smith', 'c1'), p('John Smith', 'c2')],
      [p('John Smith', 'p1')]
    );
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].identityKey).toBe('john smith');
    expect(result.ambiguous[0].reason).toBe('duplicate-current');
    expect(result.ambiguous[0].current).toHaveLength(2);
    expect(result.ambiguous[0].prior).toHaveLength(1);
    expect(result.exactMatches).toHaveLength(0);
    expect(result.currentOnly).toHaveLength(0);
    expect(result.priorOnly).toHaveLength(0);
  });

  it('marks as ambiguous with reason duplicate-prior when current has 1, prior has 2', () => {
    const result = comparePlayerIdentityOverlap(
      [p('John Smith', 'c1')],
      [p('John Smith', 'p1'), p('John Smith', 'p2')]
    );
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].reason).toBe('duplicate-prior');
    expect(result.ambiguous[0].current).toHaveLength(1);
    expect(result.ambiguous[0].prior).toHaveLength(2);
  });

  it('marks as ambiguous with reason duplicate-both when both sides have 2+', () => {
    const result = comparePlayerIdentityOverlap(
      [p('John Smith', 'c1'), p('John Smith', 'c2')],
      [p('John Smith', 'p1'), p('John Smith', 'p2')]
    );
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].reason).toBe('duplicate-both');
    expect(result.ambiguous[0].current).toHaveLength(2);
    expect(result.ambiguous[0].prior).toHaveLength(2);
  });

  it('marks as ambiguous when a key appears only in current with duplicates (reason duplicate-current)', () => {
    const result = comparePlayerIdentityOverlap(
      [p('John Smith', 'c1'), p('John Smith', 'c2')],
      []
    );
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].identityKey).toBe('john smith');
    expect(result.ambiguous[0].reason).toBe('duplicate-current');
    expect(result.ambiguous[0].current).toHaveLength(2);
    expect(result.ambiguous[0].prior).toHaveLength(0);
    expect(result.currentOnly).toHaveLength(0);
  });

  it('marks as ambiguous when a key appears only in prior with duplicates (reason duplicate-prior)', () => {
    const result = comparePlayerIdentityOverlap(
      [],
      [p('John Smith', 'p1'), p('John Smith', 'p2')]
    );
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].identityKey).toBe('john smith');
    expect(result.ambiguous[0].reason).toBe('duplicate-prior');
    expect(result.ambiguous[0].current).toHaveLength(0);
    expect(result.ambiguous[0].prior).toHaveLength(2);
    expect(result.priorOnly).toHaveLength(0);
  });

  it('ambiguous keys do not also appear in exactMatches, currentOnly, or priorOnly', () => {
    const result = comparePlayerIdentityOverlap(
      [p('John Smith', 'c1'), p('John Smith', 'c2'), p('Jane Doe')],
      [p('John Smith', 'p1'), p('Bob Jones')]
    );
    const ambiguousKey = result.ambiguous[0]?.identityKey;
    expect(result.exactMatches.map((m) => m.identityKey)).not.toContain(ambiguousKey);
    expect(result.currentOnly.map((g) => g.identityKey)).not.toContain(ambiguousKey);
    expect(result.priorOnly.map((g) => g.identityKey)).not.toContain(ambiguousKey);
  });

  it('preserves original player record references in ambiguous groups', () => {
    const c1 = p('John Smith', 'c1');
    const c2 = p('John Smith', 'c2');
    const p1 = p('John Smith', 'p1');
    const result = comparePlayerIdentityOverlap([c1, c2], [p1]);
    expect(result.ambiguous[0].current[0]).toBe(c1);
    expect(result.ambiguous[0].current[1]).toBe(c2);
    expect(result.ambiguous[0].prior[0]).toBe(p1);
  });
});

// ---------------------------------------------------------------------------
// 5. Punctuation behavior inherited from playerIdentity
// ---------------------------------------------------------------------------

describe('comparePlayerIdentityOverlap - punctuation behavior', () => {
  it("treats O'Brien and Obrien as an exact match because apostrophe is removed from key", () => {
    const result = comparePlayerIdentityOverlap([p("O'Brien")], [p('Obrien')]);
    expect(result.exactMatches).toHaveLength(1);
    expect(result.exactMatches[0].identityKey).toBe('obrien');
  });

  it('does not match Smith-Jones with Smith Jones because hyphen is preserved in key', () => {
    const result = comparePlayerIdentityOverlap([p('Smith-Jones')], [p('Smith Jones')]);
    expect(result.exactMatches).toHaveLength(0);
    expect(result.currentOnly).toHaveLength(1);
    expect(result.priorOnly).toHaveLength(1);
    expect(result.currentOnly[0].identityKey).toBe('smith-jones');
    expect(result.priorOnly[0].identityKey).toBe('smith jones');
  });

  it('does not match J. Smith with John Smith because they produce different identity keys', () => {
    const result = comparePlayerIdentityOverlap([p('J. Smith')], [p('John Smith')]);
    expect(result.exactMatches).toHaveLength(0);
    expect(result.currentOnly).toHaveLength(1);
    expect(result.priorOnly).toHaveLength(1);
    expect(result.currentOnly[0].identityKey).toBe('j smith');
    expect(result.priorOnly[0].identityKey).toBe('john smith');
  });

  it('treats J Smith and J. Smith as an exact match (period removed from key)', () => {
    const result = comparePlayerIdentityOverlap([p('J Smith')], [p('J. Smith')]);
    expect(result.exactMatches).toHaveLength(1);
    expect(result.exactMatches[0].identityKey).toBe('j smith');
  });
});

// ---------------------------------------------------------------------------
// 6. Ordering
// ---------------------------------------------------------------------------

describe('comparePlayerIdentityOverlap - ordering', () => {
  it('exactMatches follow current list first-appearance order', () => {
    const current = [p('Zach Adams'), p('Alice Baker'), p('Mike Chen')];
    const prior = [p('Mike Chen'), p('Alice Baker'), p('Zach Adams')];
    const result = comparePlayerIdentityOverlap(current, prior);
    expect(result.exactMatches.map((m) => m.identityKey)).toEqual([
      'zach adams',
      'alice baker',
      'mike chen',
    ]);
  });

  it('currentOnly follows current list first-appearance order', () => {
    const current = [p('Zach Adams'), p('Alice Baker'), p('Mike Chen')];
    const prior = [p('Other Player')];
    const result = comparePlayerIdentityOverlap(current, prior);
    expect(result.currentOnly.map((g) => g.identityKey)).toEqual([
      'zach adams',
      'alice baker',
      'mike chen',
    ]);
  });

  it('priorOnly follows prior list first-appearance order', () => {
    const prior = [p('Zach Adams'), p('Alice Baker'), p('Mike Chen')];
    const current = [p('Other Player')];
    const result = comparePlayerIdentityOverlap(current, prior);
    expect(result.priorOnly.map((g) => g.identityKey)).toEqual([
      'zach adams',
      'alice baker',
      'mike chen',
    ]);
  });

  it('ambiguous keys follow current first-appearance order, then prior for keys not seen in current', () => {
    // 'John Smith': current has 2, prior has 1 → ambiguous (seen in current first).
    // 'Jane Doe': prior has 2, absent from current → ambiguous (seen in prior second).
    const result = comparePlayerIdentityOverlap(
      [p('John Smith', 'c1'), p('John Smith', 'c2')],
      [p('Jane Doe', 'p1'), p('Jane Doe', 'p2'), p('John Smith', 'p3')]
    );
    expect(result.ambiguous).toHaveLength(2);
    expect(result.ambiguous[0].identityKey).toBe('john smith');
    expect(result.ambiguous[1].identityKey).toBe('jane doe');
  });

  it('players within exactMatches preserve original input order', () => {
    const c1 = p('John Smith', 'c1');
    const p1 = p('John Smith', 'p1');
    const result = comparePlayerIdentityOverlap([c1], [p1]);
    expect(result.exactMatches[0].current).toBe(c1);
    expect(result.exactMatches[0].prior).toBe(p1);
  });

  it('players within ambiguous groups preserve original input order', () => {
    const c1 = p('John Smith', 'c1');
    const c2 = p('John Smith', 'c2');
    const p1 = p('John Smith', 'p1');
    const p2 = p('John Smith', 'p2');
    const result = comparePlayerIdentityOverlap([c1, c2], [p1, p2]);
    expect(result.ambiguous[0].current[0]).toBe(c1);
    expect(result.ambiguous[0].current[1]).toBe(c2);
    expect(result.ambiguous[0].prior[0]).toBe(p1);
    expect(result.ambiguous[0].prior[1]).toBe(p2);
  });
});

// ---------------------------------------------------------------------------
// 7. Invalid input
// ---------------------------------------------------------------------------

describe('comparePlayerIdentityOverlap - invalid input', () => {
  it('throws when current list contains a player with an empty name', () => {
    expect(() => comparePlayerIdentityOverlap([{ name: '' }], [])).toThrow();
  });

  it('throws when prior list contains a player with an empty name', () => {
    expect(() => comparePlayerIdentityOverlap([], [{ name: '' }])).toThrow();
  });

  it('throws when current list contains a whitespace-only name', () => {
    expect(() => comparePlayerIdentityOverlap([{ name: '   ' }], [])).toThrow();
  });

  it('throws when prior list contains a whitespace-only name', () => {
    expect(() => comparePlayerIdentityOverlap([], [{ name: '   ' }])).toThrow();
  });

  it('throws even when invalid record is mixed with valid records in current', () => {
    expect(() =>
      comparePlayerIdentityOverlap([p('John Smith'), { name: '' }], [p('John Smith')])
    ).toThrow();
  });
});
