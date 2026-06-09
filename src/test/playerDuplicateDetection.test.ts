import { describe, it, expect } from 'vitest';
import {
  findDuplicatePlayerIdentityGroups,
  hasDuplicatePlayerIdentities,
} from '../engine/playerDuplicateDetection';

describe('findDuplicatePlayerIdentityGroups - no duplicates', () => {
  it('returns empty array for empty input', () => {
    expect(findDuplicatePlayerIdentityGroups([])).toEqual([]);
  });

  it('returns empty array for a single player', () => {
    expect(findDuplicatePlayerIdentityGroups([{ name: 'John Smith' }])).toEqual([]);
  });

  it('returns empty array for multiple distinct names', () => {
    const players = [
      { name: 'John Smith' },
      { name: 'Jane Doe' },
      { name: 'Bob Jones' },
    ];
    expect(findDuplicatePlayerIdentityGroups(players)).toEqual([]);
  });
});

describe('findDuplicatePlayerIdentityGroups - basic duplicates', () => {
  it('detects the same exact name appearing twice', () => {
    const players = [{ name: 'John Smith' }, { name: 'John Smith' }];
    const result = findDuplicatePlayerIdentityGroups(players);
    expect(result).toHaveLength(1);
    expect(result[0].identityKey).toBe('john smith');
    expect(result[0].players).toHaveLength(2);
  });

  it('detects duplicates with casing differences', () => {
    const players = [{ name: 'John Smith' }, { name: 'JOHN SMITH' }];
    const result = findDuplicatePlayerIdentityGroups(players);
    expect(result).toHaveLength(1);
    expect(result[0].identityKey).toBe('john smith');
  });

  it('detects duplicates with spacing differences', () => {
    const players = [{ name: 'John Smith' }, { name: '  john   smith  ' }];
    const result = findDuplicatePlayerIdentityGroups(players);
    expect(result).toHaveLength(1);
    expect(result[0].identityKey).toBe('john smith');
  });
});

describe('findDuplicatePlayerIdentityGroups - punctuation behavior inherited from playerIdentity', () => {
  it("groups O'Brien and Obrien together because apostrophe is removed from the key", () => {
    const players = [{ name: "O'Brien" }, { name: 'Obrien' }];
    const result = findDuplicatePlayerIdentityGroups(players);
    expect(result).toHaveLength(1);
    expect(result[0].identityKey).toBe('obrien');
  });

  it('does not group Smith-Jones and Smith Jones because hyphen is preserved in the key', () => {
    const players = [{ name: 'Smith-Jones' }, { name: 'Smith Jones' }];
    const result = findDuplicatePlayerIdentityGroups(players);
    expect(result).toHaveLength(0);
  });

  it('does not group J. Smith and John Smith because they produce different identity keys', () => {
    const players = [{ name: 'J. Smith' }, { name: 'John Smith' }];
    const result = findDuplicatePlayerIdentityGroups(players);
    expect(result).toHaveLength(0);
  });
});

describe('findDuplicatePlayerIdentityGroups - grouping behavior', () => {
  it('returns only groups with 2 or more players, skipping unique keys', () => {
    const players = [
      { name: 'John Smith' },
      { name: 'Jane Doe' },
      { name: 'Jane Doe' },
    ];
    const result = findDuplicatePlayerIdentityGroups(players);
    expect(result).toHaveLength(1);
    expect(result[0].identityKey).toBe('jane doe');
  });

  it('preserves original player record references in returned groups', () => {
    const p1 = { name: 'John Smith', id: 'abc', teamId: 't1', jerseyNumber: 12 };
    const p2 = { name: 'John Smith', id: 'def', teamId: 't2', jerseyNumber: 34 };
    const result = findDuplicatePlayerIdentityGroups([p1, p2]);
    expect(result[0].players[0]).toBe(p1);
    expect(result[0].players[1]).toBe(p2);
  });

  it('orders duplicate groups by first appearance of their key in the input', () => {
    const players = [
      { name: 'John Smith' },
      { name: 'Jane Doe' },
      { name: 'Jane Doe' },
      { name: 'JOHN SMITH' },
    ];
    const result = findDuplicatePlayerIdentityGroups(players);
    expect(result).toHaveLength(2);
    expect(result[0].identityKey).toBe('john smith');
    expect(result[1].identityKey).toBe('jane doe');
  });

  it('preserves player order within each duplicate group', () => {
    const p1 = { name: 'John Smith', id: '1' };
    const p2 = { name: 'JOHN SMITH', id: '2' };
    const p3 = { name: 'john smith', id: '3' };
    const result = findDuplicatePlayerIdentityGroups([p1, p2, p3]);
    expect(result[0].players[0]).toBe(p1);
    expect(result[0].players[1]).toBe(p2);
    expect(result[0].players[2]).toBe(p3);
  });
});

describe('hasDuplicatePlayerIdentities', () => {
  it('returns false for empty input', () => {
    expect(hasDuplicatePlayerIdentities([])).toBe(false);
  });

  it('returns false when all names are distinct', () => {
    const players = [{ name: 'John Smith' }, { name: 'Jane Doe' }];
    expect(hasDuplicatePlayerIdentities(players)).toBe(false);
  });

  it('returns true when duplicates exist', () => {
    const players = [{ name: 'John Smith' }, { name: 'JOHN SMITH' }];
    expect(hasDuplicatePlayerIdentities(players)).toBe(true);
  });
});

describe('findDuplicatePlayerIdentityGroups - invalid input', () => {
  it('throws on a player with an empty name', () => {
    expect(() => findDuplicatePlayerIdentityGroups([{ name: '' }])).toThrow();
  });

  it('throws on a player with a whitespace-only name', () => {
    expect(() => findDuplicatePlayerIdentityGroups([{ name: '   ' }])).toThrow();
  });
});
