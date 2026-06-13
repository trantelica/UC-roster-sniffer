import { describe, it, expect } from 'vitest';
import {
  parseAgeDivisionId,
  getAgeDivisionRank,
  getAgeDivisionIdByRank,
  compareAgeDivisions,
  AGE_DIVISION_IDS_IN_ORDER,
} from '../engine/ageDivision';

describe('parseAgeDivisionId - valid input', () => {
  it.each(['SC', 'GR', 'PW', 'MM', 'GI', 'BA'])('parses %s', (id) => {
    const result = parseAgeDivisionId(id);
    expect(result.id).toBe(id);
    expect(result.normalized).toBe(id);
  });

  it('normalizes lowercase sc', () => {
    expect(parseAgeDivisionId('sc').id).toBe('SC');
  });

  it('normalizes lowercase ba', () => {
    expect(parseAgeDivisionId('ba').id).toBe('BA');
  });

  it('normalizes leading/trailing whitespace', () => {
    expect(parseAgeDivisionId(' SC ').id).toBe('SC');
    expect(parseAgeDivisionId('  mm  ').id).toBe('MM');
  });

  it('preserves raw input', () => {
    expect(parseAgeDivisionId(' gr ').raw).toBe(' gr ');
  });
});

describe('parseAgeDivisionId - invalid input', () => {
  it('throws on empty string', () => {
    expect(() => parseAgeDivisionId('')).toThrow();
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseAgeDivisionId('   ')).toThrow();
  });

  it('throws on unknown code JR', () => {
    expect(() => parseAgeDivisionId('JR')).toThrow();
  });

  it('throws on unknown code SR', () => {
    expect(() => parseAgeDivisionId('SR')).toThrow();
  });

  it('throws on unknown code XX', () => {
    expect(() => parseAgeDivisionId('XX')).toThrow();
  });

  it('throws on malformed value "S C"', () => {
    expect(() => parseAgeDivisionId('S C')).toThrow();
  });

  it('throws on malformed value "1"', () => {
    expect(() => parseAgeDivisionId('1')).toThrow();
  });

  it('throws on malformed value "SC1"', () => {
    expect(() => parseAgeDivisionId('SC1')).toThrow();
  });
});

describe('getAgeDivisionRank - ordering', () => {
  it('GR ranks above SC', () => {
    expect(getAgeDivisionRank('GR')).toBeGreaterThan(getAgeDivisionRank('SC'));
  });

  it('PW ranks above GR', () => {
    expect(getAgeDivisionRank('PW')).toBeGreaterThan(getAgeDivisionRank('GR'));
  });

  it('MM ranks above PW', () => {
    expect(getAgeDivisionRank('MM')).toBeGreaterThan(getAgeDivisionRank('PW'));
  });

  it('GI ranks above MM', () => {
    expect(getAgeDivisionRank('GI')).toBeGreaterThan(getAgeDivisionRank('MM'));
  });

  it('BA ranks above GI', () => {
    expect(getAgeDivisionRank('BA')).toBeGreaterThan(getAgeDivisionRank('GI'));
  });
});

describe('getAgeDivisionIdByRank - reverse lookup', () => {
  it.each(AGE_DIVISION_IDS_IN_ORDER)(
    'round-trips %s through its rank',
    (id) => {
      expect(getAgeDivisionIdByRank(getAgeDivisionRank(id))).toBe(id);
    }
  );

  it('returns SC for rank 1 and BA for rank 6', () => {
    expect(getAgeDivisionIdByRank(1)).toBe('SC');
    expect(getAgeDivisionIdByRank(6)).toBe('BA');
  });

  it('returns null for out-of-range ranks', () => {
    expect(getAgeDivisionIdByRank(0)).toBeNull();
    expect(getAgeDivisionIdByRank(7)).toBeNull();
    expect(getAgeDivisionIdByRank(-1)).toBeNull();
  });

  it('returns null for non-integer ranks', () => {
    expect(getAgeDivisionIdByRank(2.5)).toBeNull();
    expect(getAgeDivisionIdByRank(NaN)).toBeNull();
  });
});

describe('compareAgeDivisions', () => {
  it('SC is lower/younger than GR', () => {
    expect(compareAgeDivisions('SC', 'GR')).toBeLessThan(0);
  });

  it('BA is higher/older than GI', () => {
    expect(compareAgeDivisions('BA', 'GI')).toBeGreaterThan(0);
  });

  it('MM compared to MM is equivalent', () => {
    expect(compareAgeDivisions('MM', 'MM')).toBe(0);
  });
});
