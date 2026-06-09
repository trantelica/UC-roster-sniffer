import { describe, it, expect } from 'vitest';
import {
  normalizePlayerName,
  getPlayerIdentityKey,
  parsePlayerName,
} from '../engine/playerIdentity';

describe('normalizePlayerName - basic normalization', () => {
  it('trims leading whitespace', () => {
    expect(normalizePlayerName('  John Smith')).toBe('John Smith');
  });

  it('trims trailing whitespace', () => {
    expect(normalizePlayerName('John Smith  ')).toBe('John Smith');
  });

  it('collapses repeated internal spaces', () => {
    expect(normalizePlayerName('John   Smith')).toBe('John Smith');
  });

  it('normalizes all-uppercase to title case', () => {
    expect(normalizePlayerName('JOHN SMITH')).toBe('John Smith');
  });

  it('normalizes all-lowercase to title case', () => {
    expect(normalizePlayerName('john smith')).toBe('John Smith');
  });

  it('normalizes mixed casing to title case', () => {
    expect(normalizePlayerName('jOhN sMiTh')).toBe('John Smith');
  });

  it('single-word name is title-cased', () => {
    expect(normalizePlayerName('SMITH')).toBe('Smith');
  });
});

describe('normalizePlayerName - punctuation handling', () => {
  it('removes periods', () => {
    expect(normalizePlayerName('J. Smith')).toBe('J Smith');
  });

  it('removes periods from multi-part initial', () => {
    expect(normalizePlayerName('J.R. Smith')).toBe('Jr Smith');
  });

  it('converts commas to spaces', () => {
    expect(normalizePlayerName('Smith, John')).toBe('Smith John');
  });

  it('collapses space created by comma replacement', () => {
    expect(normalizePlayerName('Cary,Hudson')).toBe('Cary Hudson');
  });

  it('preserves apostrophes', () => {
    expect(normalizePlayerName("O'Brien")).toBe("O'brien");
  });

  it('preserves hyphens', () => {
    expect(normalizePlayerName('Smith-Jones')).toBe('Smith-jones');
  });
});

describe('getPlayerIdentityKey - stability', () => {
  it('produces the same key for equivalent spacing', () => {
    expect(getPlayerIdentityKey('John Smith')).toBe(
      getPlayerIdentityKey('  john   smith  ')
    );
  });

  it('produces the same key for all-uppercase vs title case', () => {
    expect(getPlayerIdentityKey('JOHN SMITH')).toBe(
      getPlayerIdentityKey('John Smith')
    );
  });

  it('produces the same key for trailing-comma last-first format', () => {
    expect(getPlayerIdentityKey('Cary, Hudson')).toBe(
      getPlayerIdentityKey('Cary Hudson')
    );
  });

  it('produces different keys for meaningfully different names', () => {
    expect(getPlayerIdentityKey('John Smith')).not.toBe(
      getPlayerIdentityKey('Jane Smith')
    );
  });

  it('produces different keys for different first names', () => {
    expect(getPlayerIdentityKey('John Smith')).not.toBe(
      getPlayerIdentityKey('Jon Smith')
    );
  });

  it('removes apostrophes from identity key', () => {
    expect(getPlayerIdentityKey("O'Brien")).toBe('obrien');
  });

  it('preserves hyphens in identity key', () => {
    expect(getPlayerIdentityKey('Smith-Jones')).toBe('smith-jones');
  });
});

describe('getPlayerIdentityKey - initials', () => {
  it('handles J. Smith predictably by removing the period', () => {
    expect(getPlayerIdentityKey('J. Smith')).toBe('j smith');
  });

  it('J. Smith and John Smith produce different identity keys', () => {
    expect(getPlayerIdentityKey('J. Smith')).not.toBe(
      getPlayerIdentityKey('John Smith')
    );
  });

  it('J Smith (no period) and J. Smith produce the same identity key', () => {
    expect(getPlayerIdentityKey('J Smith')).toBe(getPlayerIdentityKey('J. Smith'));
  });
});

describe('normalizePlayerName and getPlayerIdentityKey - invalid input', () => {
  it('normalizePlayerName throws on empty string', () => {
    expect(() => normalizePlayerName('')).toThrow();
  });

  it('normalizePlayerName throws on whitespace-only string', () => {
    expect(() => normalizePlayerName('   ')).toThrow();
  });

  it('getPlayerIdentityKey throws on empty string', () => {
    expect(() => getPlayerIdentityKey('')).toThrow();
  });

  it('getPlayerIdentityKey throws on whitespace-only string', () => {
    expect(() => getPlayerIdentityKey('   ')).toThrow();
  });
});

describe('parsePlayerName - parsed object', () => {
  it('preserves raw input unchanged', () => {
    const result = parsePlayerName(' john   smith ');
    expect(result.raw).toBe(' john   smith ');
  });

  it('normalized value is deterministic for equivalent inputs', () => {
    expect(parsePlayerName('john smith').normalized).toBe('John Smith');
    expect(parsePlayerName('JOHN SMITH').normalized).toBe('John Smith');
    expect(parsePlayerName('  john   smith  ').normalized).toBe('John Smith');
  });

  it('identityKey is deterministic for equivalent inputs', () => {
    expect(parsePlayerName('john smith').identityKey).toBe('john smith');
    expect(parsePlayerName('JOHN SMITH').identityKey).toBe('john smith');
    expect(parsePlayerName('  john   smith  ').identityKey).toBe('john smith');
  });

  it('apostrophes are removed from identity key but preserved in normalized', () => {
    const result = parsePlayerName("O'Brien");
    expect(result.normalized).toBe("O'brien");
    expect(result.identityKey).toBe('obrien');
  });

  it('hyphens are preserved in both normalized and identity key', () => {
    const result = parsePlayerName('Smith-Jones');
    expect(result.normalized).toBe('Smith-jones');
    expect(result.identityKey).toBe('smith-jones');
  });

  it('throws on empty string', () => {
    expect(() => parsePlayerName('')).toThrow();
  });

  it('throws on whitespace-only string', () => {
    expect(() => parsePlayerName('   ')).toThrow();
  });
});
