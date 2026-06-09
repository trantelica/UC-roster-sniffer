import { describe, it, expect } from 'vitest';
import { deriveCurrentRosterPlayerStatuses } from '../engine/currentRosterPlayerStatus';
import type { Player } from '../domain/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p(name: string, notes?: string): Player {
  return notes ? { name, notes } : { name };
}

// ---------------------------------------------------------------------------
// 1. Unavailable state (no prior-season roster)
// ---------------------------------------------------------------------------

describe('deriveCurrentRosterPlayerStatuses - unavailable state', () => {
  it('reports unavailable when priorPlayers is null', () => {
    const result = deriveCurrentRosterPlayerStatuses([p('Alex Kim')], null);
    expect(result).toEqual({ available: false, reason: 'no-prior-season' });
  });

  it('reports unavailable when priorPlayers is undefined', () => {
    const result = deriveCurrentRosterPlayerStatuses([p('Alex Kim')], undefined);
    expect(result).toEqual({ available: false, reason: 'no-prior-season' });
  });

  it('does not throw on unavailable even when current roster is empty', () => {
    expect(deriveCurrentRosterPlayerStatuses([], null)).toEqual({
      available: false,
      reason: 'no-prior-season',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Derived status values for current players
// ---------------------------------------------------------------------------

describe('deriveCurrentRosterPlayerStatuses - derived status', () => {
  it('derives Returning for an exact current/prior identity match', () => {
    const result = deriveCurrentRosterPlayerStatuses([p('Alex Kim')], [p('Alex Kim')]);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses[0].derived).toEqual({
      status: 'returning',
      confidence: 'high',
      reason: 'exact-identity-match',
    });
  });

  it('derives New for a current-only player', () => {
    const result = deriveCurrentRosterPlayerStatuses([p('Blair Doe')], [p('Alex Kim')]);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.statuses[0].derived).toEqual({
      status: 'new',
      confidence: 'high',
      reason: 'current-only',
    });
  });

  it('derives Unknown (low confidence) for ambiguous duplicate current players and keeps both records', () => {
    const current = [p('Sam Rivera'), p('Sam Rivera')];
    const result = deriveCurrentRosterPlayerStatuses(current, [p('Other Name')]);
    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.statuses).toHaveLength(2);
    for (const entry of result.statuses) {
      expect(entry.derived).toEqual({
        status: 'unknown',
        confidence: 'low',
        reason: 'ambiguous-identity',
      });
    }
    // Both duplicate records remain individually present.
    expect(result.statuses[0].player).toBe(current[0]);
    expect(result.statuses[1].player).toBe(current[1]);
  });

  it('never produces not-returning for a current card', () => {
    // Casey is prior-only; it must NOT appear as a current player entry.
    const current = [p('Alex Kim')];
    const prior = [p('Alex Kim'), p('Casey Lee')];
    const result = deriveCurrentRosterPlayerStatuses(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.statuses).toHaveLength(1);
    expect(result.statuses.map((s) => s.player.name)).toEqual(['Alex Kim']);
    expect(result.statuses[0].derived.status).toBe('returning');
    expect(
      result.statuses.some((s) => s.derived.status === 'not-returning')
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Order preservation and one-entry-per-current-player
// ---------------------------------------------------------------------------

describe('deriveCurrentRosterPlayerStatuses - ordering and completeness', () => {
  it('preserves current roster order', () => {
    const current = [p('Zed Last'), p('Alex Kim'), p('Blair Doe'), p('Mia North')];
    const prior = [p('Alex Kim')];
    const result = deriveCurrentRosterPlayerStatuses(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.statuses.map((s) => s.player.name)).toEqual([
      'Zed Last',
      'Alex Kim',
      'Blair Doe',
      'Mia North',
    ]);
  });

  it('emits exactly one entry per current player regardless of status', () => {
    const current = [p('Alex Kim'), p('Blair Doe'), p('Sam Rivera'), p('Sam Rivera')];
    const prior = [p('Alex Kim'), p('Casey Lee')];
    const result = deriveCurrentRosterPlayerStatuses(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.statuses).toHaveLength(current.length);
    // Returning: Alex. New: Blair. Unknown: both Sam records. None hidden.
    const byName = result.statuses.map((s) => ({
      name: s.player.name,
      status: s.derived.status,
    }));
    expect(byName).toEqual([
      { name: 'Alex Kim', status: 'returning' },
      { name: 'Blair Doe', status: 'new' },
      { name: 'Sam Rivera', status: 'unknown' },
      { name: 'Sam Rivera', status: 'unknown' },
    ]);
  });

  it('returns an empty status list when the current roster is empty', () => {
    const result = deriveCurrentRosterPlayerStatuses([], [p('Alex Kim')]);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.statuses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Source preservation (no mutation, references retained)
// ---------------------------------------------------------------------------

describe('deriveCurrentRosterPlayerStatuses - source preservation', () => {
  it('preserves the original player record reference without mutation', () => {
    const current = [p('Alex Kim', 'captain'), p('Blair Doe')];
    const prior = [p('Alex Kim')];
    const currentSnapshot = JSON.parse(JSON.stringify(current));

    const result = deriveCurrentRosterPlayerStatuses(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;

    // Same object references, not copies.
    expect(result.statuses[0].player).toBe(current[0]);
    expect(result.statuses[1].player).toBe(current[1]);
    // No derived metadata leaked onto the player records.
    expect(current).toEqual(currentSnapshot);
    expect(current[0]).not.toHaveProperty('status');
    expect(current[0]).not.toHaveProperty('derived');
  });

  it('does not mutate the current or prior input arrays', () => {
    const current = [p('Alex Kim'), p('Blair Doe')];
    const prior = [p('Alex Kim'), p('Casey Lee')];
    const currentSnapshot = JSON.parse(JSON.stringify(current));
    const priorSnapshot = JSON.parse(JSON.stringify(prior));

    deriveCurrentRosterPlayerStatuses(current, prior);

    expect(current).toEqual(currentSnapshot);
    expect(prior).toEqual(priorSnapshot);
    expect(current).toHaveLength(2);
    expect(prior).toHaveLength(2);
  });
});
