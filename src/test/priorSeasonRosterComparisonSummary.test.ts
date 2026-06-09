import { describe, it, expect } from 'vitest';
import { comparePriorSeasonRoster } from '../engine/priorSeasonRosterComparison';
import { summarizePriorSeasonRosterComparison } from '../engine/priorSeasonRosterComparisonSummary';
import type { PlayerIdentityInput } from '../engine/priorSeasonRosterComparison';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p(name: string, id?: string): PlayerIdentityInput {
  return id ? { name, id } : { name };
}

// ---------------------------------------------------------------------------
// 1. Empty comparison result
// ---------------------------------------------------------------------------

describe('summarizePriorSeasonRosterComparison - empty', () => {
  it('returns all zero counts for an empty comparison result', () => {
    const summary = summarizePriorSeasonRosterComparison(
      comparePriorSeasonRoster([], [])
    );

    expect(summary).toEqual({
      totalCurrent: 0,
      totalPrior: 0,
      returning: 0,
      newToRoster: 0,
      notReturning: 0,
      unknownCurrent: 0,
      unknownPrior: 0,
      unknownTotal: 0,
      highConfidence: 0,
      lowConfidence: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Returning is not double-counted
// ---------------------------------------------------------------------------

describe('summarizePriorSeasonRosterComparison - returning', () => {
  it('counts a single exact match as returning = 1, not 2', () => {
    const summary = summarizePriorSeasonRosterComparison(
      comparePriorSeasonRoster([p('John Smith')], [p('John Smith')])
    );

    expect(summary.returning).toBe(1);
    expect(summary.totalCurrent).toBe(1);
    expect(summary.totalPrior).toBe(1);
    expect(summary.newToRoster).toBe(0);
    expect(summary.notReturning).toBe(0);
    expect(summary.unknownTotal).toBe(0);
  });

  it('counts multiple returning matches once each', () => {
    const current = [p('Zach Adams'), p('Alice Baker'), p('Mike Chen')];
    const prior = [p('Mike Chen'), p('Alice Baker'), p('Zach Adams')];
    const summary = summarizePriorSeasonRosterComparison(
      comparePriorSeasonRoster(current, prior)
    );

    expect(summary.returning).toBe(3);
    expect(summary.totalCurrent).toBe(3);
    expect(summary.totalPrior).toBe(3);
    expect(summary.highConfidence).toBe(3);
    expect(summary.lowConfidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Current-only and prior-only
// ---------------------------------------------------------------------------

describe('summarizePriorSeasonRosterComparison - new and not-returning', () => {
  it('counts current-only players as newToRoster', () => {
    const summary = summarizePriorSeasonRosterComparison(
      comparePriorSeasonRoster([p('Alpha One'), p('Beta Two')], [])
    );

    expect(summary.newToRoster).toBe(2);
    expect(summary.totalCurrent).toBe(2);
    expect(summary.totalPrior).toBe(0);
    expect(summary.returning).toBe(0);
    expect(summary.notReturning).toBe(0);
  });

  it('counts prior-only players as notReturning', () => {
    const summary = summarizePriorSeasonRosterComparison(
      comparePriorSeasonRoster([], [p('Gamma Three'), p('Delta Four')])
    );

    expect(summary.notReturning).toBe(2);
    expect(summary.totalPrior).toBe(2);
    expect(summary.totalCurrent).toBe(0);
    expect(summary.returning).toBe(0);
    expect(summary.newToRoster).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Unknown current vs prior
// ---------------------------------------------------------------------------

describe('summarizePriorSeasonRosterComparison - unknown', () => {
  it('counts duplicate current records under unknownCurrent and unknownTotal', () => {
    // Two same-name current records + one prior of that name => all ambiguous.
    const summary = summarizePriorSeasonRosterComparison(
      comparePriorSeasonRoster(
        [p('John Smith', 'c1'), p('John Smith', 'c2')],
        [p('John Smith', 'p1')]
      )
    );

    expect(summary.unknownCurrent).toBe(2);
    expect(summary.unknownPrior).toBe(1);
    expect(summary.unknownTotal).toBe(3);
    expect(summary.returning).toBe(0);
  });

  it('counts duplicate prior records under unknownPrior and unknownTotal', () => {
    const summary = summarizePriorSeasonRosterComparison(
      comparePriorSeasonRoster(
        [p('John Smith', 'c1')],
        [p('John Smith', 'p1'), p('John Smith', 'p2')]
      )
    );

    expect(summary.unknownCurrent).toBe(1);
    expect(summary.unknownPrior).toBe(2);
    expect(summary.unknownTotal).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 5. Mixed comparison result with all buckets
// ---------------------------------------------------------------------------

describe('summarizePriorSeasonRosterComparison - mixed', () => {
  it('counts every bucket correctly with totals and confidence', () => {
    const current = [
      p('Returning Player'), // returning
      p('Brand New'), // newToRoster
      p('Dup Name', 'c1'), // unknown (current)
      p('Dup Name', 'c2'), // unknown (current)
    ];
    const prior = [
      p('Returning Player'), // returning
      p('Gone Player'), // notReturning
      p('Dup Name', 'p1'), // unknown (prior)
    ];
    const summary = summarizePriorSeasonRosterComparison(
      comparePriorSeasonRoster(current, prior)
    );

    expect(summary.returning).toBe(1);
    expect(summary.newToRoster).toBe(1);
    expect(summary.notReturning).toBe(1);
    expect(summary.unknownCurrent).toBe(2);
    expect(summary.unknownPrior).toBe(1);
    expect(summary.unknownTotal).toBe(3);

    // totalCurrent = returning(1) + newToRoster(1) + unknownCurrent(2) = 4
    expect(summary.totalCurrent).toBe(4);
    // totalPrior = returning(1) + notReturning(1) + unknownPrior(1) = 3
    expect(summary.totalPrior).toBe(3);

    // Perspective-aware confidence set:
    //   returning(1, high) + newToRoster(1, high) + notReturning(1, high)
    //   + unknown(3, low)
    expect(summary.highConfidence).toBe(3);
    expect(summary.lowConfidence).toBe(3);
    expect(summary.highConfidence + summary.lowConfidence).toBe(
      summary.returning +
        summary.newToRoster +
        summary.notReturning +
        summary.unknownTotal
    );
  });
});

// ---------------------------------------------------------------------------
// 6. No mutation of the comparison result
// ---------------------------------------------------------------------------

describe('summarizePriorSeasonRosterComparison - no mutation', () => {
  it('does not mutate the comparison result or its entries', () => {
    const result = comparePriorSeasonRoster(
      [p('Returning Player'), p('Brand New'), p('Dup Name', 'c1')],
      [p('Returning Player'), p('Gone Player'), p('Dup Name', 'p1')]
    );
    const snapshot = structuredClone(result);

    summarizePriorSeasonRosterComparison(result);

    expect(result).toEqual(snapshot);
  });

  it('preserves bucket array lengths after summarizing', () => {
    const result = comparePriorSeasonRoster(
      [p('A'), p('B')],
      [p('A'), p('C')]
    );
    const lengths = {
      returning: result.returning.length,
      newToRoster: result.newToRoster.length,
      notReturning: result.notReturning.length,
      unknown: result.unknown.length,
    };

    summarizePriorSeasonRosterComparison(result);

    expect(result.returning).toHaveLength(lengths.returning);
    expect(result.newToRoster).toHaveLength(lengths.newToRoster);
    expect(result.notReturning).toHaveLength(lengths.notReturning);
    expect(result.unknown).toHaveLength(lengths.unknown);
  });
});
