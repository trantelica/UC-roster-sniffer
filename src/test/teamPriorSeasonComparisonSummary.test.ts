import { describe, it, expect } from 'vitest';
import { summarizeTeamPriorSeasonComparison } from '../engine/priorSeasonRosterComparisonSummary';
import type { PlayerIdentityInput } from '../engine/priorSeasonRosterComparison';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p(name: string, id?: string): PlayerIdentityInput {
  return id ? { name, id } : { name };
}

// ---------------------------------------------------------------------------
// 1. Unavailable state (no prior-season same-slot team)
// ---------------------------------------------------------------------------

describe('summarizeTeamPriorSeasonComparison - unavailable state', () => {
  it('reports unavailable when priorPlayers is null', () => {
    const result = summarizeTeamPriorSeasonComparison([p('Alex Kim')], null);
    expect(result).toEqual({ available: false, reason: 'no-prior-season' });
  });

  it('reports unavailable when priorPlayers is undefined', () => {
    const result = summarizeTeamPriorSeasonComparison([p('Alex Kim')], undefined);
    expect(result).toEqual({ available: false, reason: 'no-prior-season' });
  });

  it('does not throw on unavailable even when current roster is empty', () => {
    expect(summarizeTeamPriorSeasonComparison([], null)).toEqual({
      available: false,
      reason: 'no-prior-season',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Available summary when a prior same-slot roster exists
// ---------------------------------------------------------------------------

describe('summarizeTeamPriorSeasonComparison - available summary', () => {
  it('reports available with a summary when a prior roster is provided', () => {
    const result = summarizeTeamPriorSeasonComparison(
      [p('Alex Kim')],
      [p('Alex Kim')]
    );
    expect(result.available).toBe(true);
  });

  it('reports an available all-zero summary when both rosters are empty', () => {
    const result = summarizeTeamPriorSeasonComparison([], []);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.totalCurrent).toBe(0);
    expect(result.summary.totalPrior).toBe(0);
    expect(result.summary.returning).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Perspective-aware counts (no double-counting)
// ---------------------------------------------------------------------------

describe('summarizeTeamPriorSeasonComparison - counts', () => {
  it('counts a single exact match as Returning = 1, not 2', () => {
    const result = summarizeTeamPriorSeasonComparison(
      [p('Alex Kim')],
      [p('Alex Kim')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.returning).toBe(1);
    expect(result.summary.totalCurrent).toBe(1);
    expect(result.summary.totalPrior).toBe(1);
  });

  it('counts current-only players under New to roster', () => {
    const result = summarizeTeamPriorSeasonComparison(
      [p('Alex Kim'), p('Blair Doe')],
      [p('Alex Kim')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.newToRoster).toBe(1);
    expect(result.summary.returning).toBe(1);
  });

  it('counts prior-only players under Not returning', () => {
    const result = summarizeTeamPriorSeasonComparison(
      [p('Alex Kim')],
      [p('Alex Kim'), p('Casey Lee')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.notReturning).toBe(1);
    expect(result.summary.returning).toBe(1);
  });

  it('counts ambiguous current records under Unknown current', () => {
    const result = summarizeTeamPriorSeasonComparison(
      [p('Sam Rivera', 'c1'), p('Sam Rivera', 'c2')],
      [p('Other Name')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.unknownCurrent).toBe(2);
    expect(result.summary.lowConfidence).toBeGreaterThan(0);
    expect(result.summary.returning).toBe(0);
  });

  it('counts ambiguous prior records under Unknown prior', () => {
    const result = summarizeTeamPriorSeasonComparison(
      [p('Alex Kim')],
      [p('Sam Rivera', 'p1'), p('Sam Rivera', 'p2')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.unknownPrior).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 4. Source preservation and current-roster accounting
// ---------------------------------------------------------------------------

describe('summarizeTeamPriorSeasonComparison - source preservation', () => {
  it('does not mutate the current or prior input arrays', () => {
    const current = [p('Alex Kim'), p('Blair Doe')];
    const prior = [p('Alex Kim'), p('Casey Lee')];
    const currentSnapshot = structuredClone(current);
    const priorSnapshot = structuredClone(prior);

    summarizeTeamPriorSeasonComparison(current, prior);

    expect(current).toEqual(currentSnapshot);
    expect(prior).toEqual(priorSnapshot);
    expect(current).toHaveLength(2);
    expect(prior).toHaveLength(2);
  });

  it('accounts for every current rostered record, including unknown/ambiguous', () => {
    // Returning + newToRoster + unknownCurrent === number of current records,
    // so no current roster record is dropped or hidden because it is ambiguous.
    const current = [p('Sam Rivera', 'c1'), p('Sam Rivera', 'c2'), p('Jordan Pat')];
    const prior = [p('Sam Rivera', 'p1')];

    const result = summarizeTeamPriorSeasonComparison(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;
    const { summary } = result;
    expect(
      summary.returning + summary.newToRoster + summary.unknownCurrent
    ).toBe(current.length);
  });

  it('represents prior-only players only on the prior side (never as current)', () => {
    // A prior-only player adds to notReturning / totalPrior but never to any
    // current-side count, so it can never be rendered as a current player card.
    const result = summarizeTeamPriorSeasonComparison(
      [p('Alex Kim')],
      [p('Alex Kim'), p('Gone Player')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    const { summary } = result;
    expect(summary.notReturning).toBe(1);
    expect(summary.totalCurrent).toBe(1);
    expect(
      summary.returning + summary.newToRoster + summary.unknownCurrent
    ).toBe(1);
  });
});
