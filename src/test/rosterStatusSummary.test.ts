import { describe, it, expect } from 'vitest';
import { summarizeRosterStatuses } from '../engine/rosterStatusSummary';
import type {
  RosterStatusEntry,
  RosterStatusValue,
  RosterConfidenceValue,
  RosterStatusReason,
} from '../engine/rosterStatus';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reasonFor(status: RosterStatusValue): RosterStatusReason {
  switch (status) {
    case 'returning':
      return 'exact-identity-match';
    case 'new':
      return 'current-only';
    case 'not-returning':
      return 'prior-only';
    case 'unknown':
      return 'ambiguous-identity';
  }
}

let seq = 0;

function makeEntry(
  status: RosterStatusValue,
  confidence: RosterConfidenceValue = status === 'unknown' ? 'low' : 'high'
): RosterStatusEntry {
  seq += 1;
  const side: 'current' | 'prior' = status === 'not-returning' ? 'prior' : 'current';
  return {
    player: { name: `Player ${seq}` },
    side,
    identityKey: `player ${seq}`,
    derived: { status, confidence, reason: reasonFor(status) },
  };
}

const emptySummary = {
  total: 0,
  returning: 0,
  new: 0,
  notReturning: 0,
  unknown: 0,
  highConfidence: 0,
  lowConfidence: 0,
};

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('summarizeRosterStatuses - empty input', () => {
  it('returns all-zero counts for an empty array', () => {
    expect(summarizeRosterStatuses([])).toEqual(emptySummary);
  });
});

// ---------------------------------------------------------------------------
// 2. Single-entry per status
// ---------------------------------------------------------------------------

describe('summarizeRosterStatuses - single entry per status', () => {
  it('counts a single returning entry', () => {
    const summary = summarizeRosterStatuses([makeEntry('returning')]);
    expect(summary.total).toBe(1);
    expect(summary.returning).toBe(1);
    expect(summary.new).toBe(0);
    expect(summary.notReturning).toBe(0);
    expect(summary.unknown).toBe(0);
    expect(summary.highConfidence).toBe(1);
    expect(summary.lowConfidence).toBe(0);
  });

  it('counts a single new entry', () => {
    const summary = summarizeRosterStatuses([makeEntry('new')]);
    expect(summary.total).toBe(1);
    expect(summary.new).toBe(1);
    expect(summary.returning).toBe(0);
    expect(summary.notReturning).toBe(0);
    expect(summary.unknown).toBe(0);
  });

  it('counts a single not-returning entry', () => {
    const summary = summarizeRosterStatuses([makeEntry('not-returning')]);
    expect(summary.total).toBe(1);
    expect(summary.notReturning).toBe(1);
    expect(summary.returning).toBe(0);
    expect(summary.new).toBe(0);
    expect(summary.unknown).toBe(0);
  });

  it('counts a single unknown entry (low confidence)', () => {
    const summary = summarizeRosterStatuses([makeEntry('unknown')]);
    expect(summary.total).toBe(1);
    expect(summary.unknown).toBe(1);
    expect(summary.returning).toBe(0);
    expect(summary.new).toBe(0);
    expect(summary.notReturning).toBe(0);
    expect(summary.highConfidence).toBe(0);
    expect(summary.lowConfidence).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Mixed statuses
// ---------------------------------------------------------------------------

describe('summarizeRosterStatuses - mixed statuses', () => {
  it('tallies each status independently in a mixed set', () => {
    const entries = [
      makeEntry('returning'),
      makeEntry('new'),
      makeEntry('not-returning'),
      makeEntry('unknown'),
    ];
    const summary = summarizeRosterStatuses(entries);
    expect(summary.total).toBe(4);
    expect(summary.returning).toBe(1);
    expect(summary.new).toBe(1);
    expect(summary.notReturning).toBe(1);
    expect(summary.unknown).toBe(1);
  });

  it('status counts sum to total in a mixed set', () => {
    const entries = [
      makeEntry('returning'),
      makeEntry('new'),
      makeEntry('not-returning'),
      makeEntry('unknown'),
    ];
    const summary = summarizeRosterStatuses(entries);
    expect(
      summary.returning + summary.new + summary.notReturning + summary.unknown
    ).toBe(summary.total);
  });
});

// ---------------------------------------------------------------------------
// 4. Confidence counts
// ---------------------------------------------------------------------------

describe('summarizeRosterStatuses - confidence counts', () => {
  it('counts high- and low-confidence entries independently of status', () => {
    const entries = [
      makeEntry('returning', 'high'),
      makeEntry('new', 'high'),
      makeEntry('unknown', 'low'),
      makeEntry('unknown', 'low'),
    ];
    const summary = summarizeRosterStatuses(entries);
    expect(summary.highConfidence).toBe(2);
    expect(summary.lowConfidence).toBe(2);
  });

  it('confidence counts sum to total', () => {
    const entries = [
      makeEntry('returning', 'high'),
      makeEntry('unknown', 'low'),
      makeEntry('not-returning', 'high'),
    ];
    const summary = summarizeRosterStatuses(entries);
    expect(summary.highConfidence + summary.lowConfidence).toBe(summary.total);
  });

  it('counts a low-confidence entry that is not unknown (defensive: status/confidence are independent)', () => {
    const entries = [makeEntry('returning', 'low')];
    const summary = summarizeRosterStatuses(entries);
    expect(summary.returning).toBe(1);
    expect(summary.lowConfidence).toBe(1);
    expect(summary.highConfidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. All ambiguous (unknown / low confidence)
// ---------------------------------------------------------------------------

describe('summarizeRosterStatuses - all ambiguous', () => {
  it('counts every entry as unknown and low confidence', () => {
    const entries = [
      makeEntry('unknown'),
      makeEntry('unknown'),
      makeEntry('unknown'),
    ];
    const summary = summarizeRosterStatuses(entries);
    expect(summary.total).toBe(3);
    expect(summary.unknown).toBe(3);
    expect(summary.lowConfidence).toBe(3);
    expect(summary.returning).toBe(0);
    expect(summary.new).toBe(0);
    expect(summary.notReturning).toBe(0);
    expect(summary.highConfidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. Multiple entries in each category
// ---------------------------------------------------------------------------

describe('summarizeRosterStatuses - multiple entries per category', () => {
  it('counts multiple entries in every status and confidence bucket', () => {
    const entries = [
      makeEntry('returning'),
      makeEntry('returning'),
      makeEntry('new'),
      makeEntry('new'),
      makeEntry('new'),
      makeEntry('not-returning'),
      makeEntry('not-returning'),
      makeEntry('unknown'),
      makeEntry('unknown'),
      makeEntry('unknown'),
      makeEntry('unknown'),
    ];
    const summary = summarizeRosterStatuses(entries);
    expect(summary.total).toBe(11);
    expect(summary.returning).toBe(2);
    expect(summary.new).toBe(3);
    expect(summary.notReturning).toBe(2);
    expect(summary.unknown).toBe(4);
    // returning + new + not-returning = 7 high; 4 unknown = 4 low
    expect(summary.highConfidence).toBe(7);
    expect(summary.lowConfidence).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 7. No mutation / source preservation
// ---------------------------------------------------------------------------

describe('summarizeRosterStatuses - no mutation', () => {
  it('does not mutate the input array length', () => {
    const entries = [makeEntry('returning'), makeEntry('new')];
    summarizeRosterStatuses(entries);
    expect(entries).toHaveLength(2);
  });

  it('does not mutate any entry or its derived metadata', () => {
    const entries = [makeEntry('returning'), makeEntry('unknown')];
    const snapshot = JSON.parse(JSON.stringify(entries));
    summarizeRosterStatuses(entries);
    expect(entries).toEqual(snapshot);
  });

  it('preserves the original player record references (records are not dropped)', () => {
    const entries = [makeEntry('returning'), makeEntry('new'), makeEntry('unknown')];
    const refs = entries.map((e) => e.player);
    summarizeRosterStatuses(entries);
    entries.forEach((e, i) => expect(e.player).toBe(refs[i]));
  });
});

// ---------------------------------------------------------------------------
// 8. total always matches entries.length
// ---------------------------------------------------------------------------

describe('summarizeRosterStatuses - total invariant', () => {
  it('total matches entries.length across varied inputs', () => {
    const cases: RosterStatusEntry[][] = [
      [],
      [makeEntry('returning')],
      [makeEntry('new'), makeEntry('unknown')],
      [
        makeEntry('returning'),
        makeEntry('not-returning'),
        makeEntry('unknown'),
        makeEntry('new'),
        makeEntry('new'),
      ],
    ];
    for (const entries of cases) {
      expect(summarizeRosterStatuses(entries).total).toBe(entries.length);
    }
  });
});
