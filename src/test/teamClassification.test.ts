import { describe, it, expect } from 'vitest';
import {
  parseTeamClassification,
  getTeamClassificationRank,
  compareTeamClassifications,
} from '../engine/teamClassification';

describe('parseTeamClassification', () => {
  it.each(['B1', 'C1', 'B2', 'B3', 'B4', 'C2', 'D2'])('parses %s', (code) => {
    const result = parseTeamClassification(code);
    expect(result.normalized).toBe(code.toUpperCase());
  });

  it('normalizes lowercase input', () => {
    expect(parseTeamClassification('b1').normalized).toBe('B1');
    expect(parseTeamClassification('c2').normalized).toBe('C2');
  });

  it('normalizes leading/trailing whitespace', () => {
    expect(parseTeamClassification(' B1 ').normalized).toBe('B1');
    expect(parseTeamClassification('  d2  ').normalized).toBe('D2');
  });

  it('maps B3 to B3_PLUS', () => {
    expect(parseTeamClassification('B3').code).toBe('B3_PLUS');
  });

  it('maps B4 to B3_PLUS', () => {
    expect(parseTeamClassification('B4').code).toBe('B3_PLUS');
  });

  it('maps B5 to B3_PLUS', () => {
    expect(parseTeamClassification('B5').code).toBe('B3_PLUS');
  });

  it('throws on empty string', () => {
    expect(() => parseTeamClassification('')).toThrow();
  });

  it('throws on whitespace-only string', () => {
    expect(() => parseTeamClassification('   ')).toThrow();
  });

  it('throws on unknown letter A1', () => {
    expect(() => parseTeamClassification('A1')).toThrow();
  });

  it('throws on unsupported C3', () => {
    expect(() => parseTeamClassification('C3')).toThrow();
  });

  it('throws on unsupported D1', () => {
    expect(() => parseTeamClassification('D1')).toThrow();
  });

  it('throws on malformed value like "X9"', () => {
    expect(() => parseTeamClassification('X9')).toThrow();
  });

  it('throws on malformed value like "1B"', () => {
    expect(() => parseTeamClassification('1B')).toThrow();
  });
});

describe('getTeamClassificationRank', () => {
  it('B1 ranks higher than C1', () => {
    expect(getTeamClassificationRank('B1')).toBeGreaterThan(getTeamClassificationRank('C1'));
  });

  it('C1 ranks higher than B2', () => {
    expect(getTeamClassificationRank('C1')).toBeGreaterThan(getTeamClassificationRank('B2'));
  });

  it('B2 ranks higher than B3', () => {
    expect(getTeamClassificationRank('B2')).toBeGreaterThan(getTeamClassificationRank('B3'));
  });

  it('B2 ranks higher than C2', () => {
    expect(getTeamClassificationRank('B2')).toBeGreaterThan(getTeamClassificationRank('C2'));
  });

  it('B2 ranks higher than D2', () => {
    expect(getTeamClassificationRank('B2')).toBeGreaterThan(getTeamClassificationRank('D2'));
  });
});

describe('compareTeamClassifications equivalency', () => {
  it('B3 equals B4', () => {
    expect(compareTeamClassifications('B3', 'B4')).toBe(0);
  });

  it('B3 equals C2', () => {
    expect(compareTeamClassifications('B3', 'C2')).toBe(0);
  });

  it('B4 equals D2', () => {
    expect(compareTeamClassifications('B4', 'D2')).toBe(0);
  });

  it('C2 equals D2', () => {
    expect(compareTeamClassifications('C2', 'D2')).toBe(0);
  });
});

describe('compareTeamClassifications ordering', () => {
  it('returns negative when a is stronger than b', () => {
    expect(compareTeamClassifications('B1', 'C1')).toBeLessThan(0);
  });

  it('returns positive when b is stronger than a', () => {
    expect(compareTeamClassifications('C2', 'B1')).toBeGreaterThan(0);
  });

  it('returns 0 when equal', () => {
    expect(compareTeamClassifications('B1', 'B1')).toBe(0);
  });
});
