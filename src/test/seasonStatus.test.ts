import { describe, it, expect } from 'vitest';
import {
  isSeasonLocked,
  getSeasonEditStatus,
  assertSeasonEditable,
} from '../engine/seasonStatus';

describe('isSeasonLocked', () => {
  it('returns false when seasonId matches activeSeasonId', () => {
    expect(isSeasonLocked('2026', '2026')).toBe(false);
  });

  it('returns true when seasonId does not match activeSeasonId', () => {
    expect(isSeasonLocked('2025', '2026')).toBe(true);
  });

  it('returns true for any non-active prior season', () => {
    expect(isSeasonLocked('2024', '2026')).toBe(true);
  });

  it('normalizes leading/trailing whitespace on seasonId', () => {
    expect(isSeasonLocked(' 2026 ', '2026')).toBe(false);
    expect(isSeasonLocked(' 2025 ', '2026')).toBe(true);
  });

  it('normalizes leading/trailing whitespace on activeSeasonId', () => {
    expect(isSeasonLocked('2026', ' 2026 ')).toBe(false);
    expect(isSeasonLocked('2025', ' 2026 ')).toBe(true);
  });

  it('throws on empty seasonId', () => {
    expect(() => isSeasonLocked('', '2026')).toThrow();
  });

  it('throws on whitespace-only seasonId', () => {
    expect(() => isSeasonLocked('   ', '2026')).toThrow();
  });

  it('throws on empty activeSeasonId', () => {
    expect(() => isSeasonLocked('2026', '')).toThrow();
  });

  it('throws on whitespace-only activeSeasonId', () => {
    expect(() => isSeasonLocked('2026', '   ')).toThrow();
  });
});

describe('getSeasonEditStatus', () => {
  it('returns editable for active season', () => {
    expect(getSeasonEditStatus('2026', '2026')).toBe('editable');
  });

  it('returns locked for non-active season', () => {
    expect(getSeasonEditStatus('2025', '2026')).toBe('locked');
  });

  it('returns locked for any other non-active season', () => {
    expect(getSeasonEditStatus('2024', '2026')).toBe('locked');
  });

  it('throws on empty seasonId', () => {
    expect(() => getSeasonEditStatus('', '2026')).toThrow();
  });

  it('throws on empty activeSeasonId', () => {
    expect(() => getSeasonEditStatus('2026', '')).toThrow();
  });
});

describe('assertSeasonEditable', () => {
  it('does not throw for the active season', () => {
    expect(() => assertSeasonEditable('2026', '2026')).not.toThrow();
  });

  it('throws for a locked prior season', () => {
    expect(() => assertSeasonEditable('2025', '2026')).toThrow();
  });

  it('throws for any other non-active season', () => {
    expect(() => assertSeasonEditable('2024', '2026')).toThrow();
  });

  it('thrown message identifies the locked season', () => {
    expect(() => assertSeasonEditable('2025', '2026')).toThrow(/2025/);
  });

  it('thrown message identifies the active season', () => {
    expect(() => assertSeasonEditable('2025', '2026')).toThrow(/2026/);
  });

  it('throws on empty seasonId', () => {
    expect(() => assertSeasonEditable('', '2026')).toThrow();
  });

  it('throws on empty activeSeasonId', () => {
    expect(() => assertSeasonEditable('2026', '')).toThrow();
  });
});
