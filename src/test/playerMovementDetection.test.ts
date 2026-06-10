import { describe, it, expect } from 'vitest';
import {
  detectExactPriorSeasonPlayerMovement,
  type RosterMovementRecord,
  type TeamSlotContext,
} from '../engine/playerMovementDetection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A 2026 (current) team slot, overriding the team code. */
function curTeam(teamCode: string, overrides: Partial<TeamSlotContext> = {}): TeamSlotContext {
  return {
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode,
    ...overrides,
  };
}

/** A 2025 (prior) team slot, overriding the team code. */
function priTeam(teamCode: string, overrides: Partial<TeamSlotContext> = {}): TeamSlotContext {
  return {
    seasonId: '2025',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode,
    ...overrides,
  };
}

function rec(name: string, team: TeamSlotContext, id?: string): RosterMovementRecord {
  return { player: id ? { name, id } : { name }, team };
}

function allEntries(
  result: ReturnType<typeof detectExactPriorSeasonPlayerMovement>
) {
  return [
    ...result.sameTeamReturning,
    ...result.transferredIn,
    ...result.transferredOut,
    ...result.newToConference,
    ...result.notReturning,
    ...result.unknown,
  ];
}

// ---------------------------------------------------------------------------
// 1. Empty input
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - empty input', () => {
  it('returns all empty buckets when both lists are empty', () => {
    const result = detectExactPriorSeasonPlayerMovement([], []);
    expect(result.sameTeamReturning).toEqual([]);
    expect(result.transferredIn).toEqual([]);
    expect(result.transferredOut).toEqual([]);
    expect(result.newToConference).toEqual([]);
    expect(result.notReturning).toEqual([]);
    expect(result.unknown).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Same-team returning
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - same-team returning', () => {
  it('classifies an exact match on the same team slot as same-team returning', () => {
    const cur = rec('John Smith', curTeam('B1'), 'c1');
    const pri = rec('John Smith', priTeam('B1'), 'p1');
    const result = detectExactPriorSeasonPlayerMovement([cur], [pri]);

    expect(result.transferredIn).toHaveLength(0);
    expect(result.transferredOut).toHaveLength(0);
    expect(result.newToConference).toHaveLength(0);
    expect(result.notReturning).toHaveLength(0);
    expect(result.unknown).toHaveLength(0);

    // One entry per source record: current + prior, both in sameTeamReturning.
    expect(result.sameTeamReturning).toHaveLength(2);
    const currentSide = result.sameTeamReturning.find((e) => e.side === 'current')!;
    const priorSide = result.sameTeamReturning.find((e) => e.side === 'prior')!;

    expect(currentSide.record).toBe(cur);
    expect(currentSide.identityKey).toBe('john smith');
    expect(currentSide.matchedTeam).toBe(pri.team);
    expect(currentSide.derived).toEqual({
      status: 'same-team-returning',
      confidence: 'high',
      reason: 'same-team-exact-match',
    });

    expect(priorSide.record).toBe(pri);
    expect(priorSide.matchedTeam).toBe(cur.team);
  });

  it('treats matching district + age division + team code as same slot despite different seasonId', () => {
    const cur = rec('Jane Doe', curTeam('A4'));
    const pri = rec('Jane Doe', priTeam('A4'));
    const result = detectExactPriorSeasonPlayerMovement([cur], [pri]);

    expect(result.sameTeamReturning).toHaveLength(2);
    expect(result.transferredIn).toHaveLength(0);
    expect(result.transferredOut).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Transferred in / out
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - transfer between two teams', () => {
  it('splits a different-team-slot exact match into transferredIn and transferredOut', () => {
    const cur = rec('John Smith', curTeam('B1'), 'c1');
    const pri = rec('John Smith', priTeam('B2'), 'p1');
    const result = detectExactPriorSeasonPlayerMovement([cur], [pri]);

    expect(result.sameTeamReturning).toHaveLength(0);
    expect(result.newToConference).toHaveLength(0);
    expect(result.notReturning).toHaveLength(0);
    expect(result.unknown).toHaveLength(0);

    expect(result.transferredIn).toHaveLength(1);
    const inEntry = result.transferredIn[0];
    expect(inEntry.side).toBe('current');
    expect(inEntry.record).toBe(cur);
    expect(inEntry.matchedTeam).toBe(pri.team); // came FROM prior team
    expect(inEntry.derived).toEqual({
      status: 'transferred-in',
      confidence: 'high',
      reason: 'different-team-exact-match',
    });

    expect(result.transferredOut).toHaveLength(1);
    const outEntry = result.transferredOut[0];
    expect(outEntry.side).toBe('prior');
    expect(outEntry.record).toBe(pri);
    expect(outEntry.matchedTeam).toBe(cur.team); // went TO current team
    expect(outEntry.derived).toEqual({
      status: 'transferred-out',
      confidence: 'high',
      reason: 'different-team-exact-match',
    });
  });

  it('treats a different district as a transfer (different slot)', () => {
    const cur = rec('Sam Lee', curTeam('B1', { districtId: 'brighton' }));
    const pri = rec('Sam Lee', priTeam('B1', { districtId: 'alta' }));
    const result = detectExactPriorSeasonPlayerMovement([cur], [pri]);

    expect(result.transferredIn).toHaveLength(1);
    expect(result.transferredOut).toHaveLength(1);
    expect(result.sameTeamReturning).toHaveLength(0);
  });

  it('treats a different age division as a transfer (different slot)', () => {
    const cur = rec('Sam Lee', curTeam('B1', { ageDivisionId: 'PW' }));
    const pri = rec('Sam Lee', priTeam('B1', { ageDivisionId: 'GR' }));
    const result = detectExactPriorSeasonPlayerMovement([cur], [pri]);

    expect(result.transferredIn).toHaveLength(1);
    expect(result.transferredOut).toHaveLength(1);
    expect(result.sameTeamReturning).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 4. New to conference
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - new to conference', () => {
  it('classifies a current player with no prior match anywhere as newToConference', () => {
    const cur = rec('Brand New', curTeam('B3'));
    const result = detectExactPriorSeasonPlayerMovement(
      [cur],
      [rec('Someone Else', priTeam('B1'))]
    );

    expect(result.newToConference).toHaveLength(1);
    const e = result.newToConference[0];
    expect(e.side).toBe('current');
    expect(e.record).toBe(cur);
    expect(e.matchedTeam).toBeNull();
    expect(e.derived).toEqual({
      status: 'new-to-conference',
      confidence: 'high',
      reason: 'current-only',
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Not returning
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - not returning', () => {
  it('classifies a prior player with no current match anywhere as notReturning', () => {
    const pri = rec('Gone Player', priTeam('B2'));
    const result = detectExactPriorSeasonPlayerMovement(
      [rec('Someone Else', curTeam('B1'))],
      [pri]
    );

    expect(result.notReturning).toHaveLength(1);
    const e = result.notReturning[0];
    expect(e.side).toBe('prior');
    expect(e.record).toBe(pri);
    expect(e.matchedTeam).toBeNull();
    expect(e.derived).toEqual({
      status: 'not-returning',
      confidence: 'high',
      reason: 'prior-only',
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Mixed movement categories
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - mixed categories', () => {
  it('classifies same-team, transfer, new, not-returning, and unknown together', () => {
    const current = [
      rec('Stay Put', curTeam('B1')), // same-team returning
      rec('Mover Up', curTeam('B1')), // transferred in (prior B2)
      rec('Fresh Face', curTeam('B3')), // new to conference
      rec('Dup Name', curTeam('B1'), 'c1'), // unknown (dup current)
      rec('Dup Name', curTeam('B2'), 'c2'), // unknown (dup current)
    ];
    const prior = [
      rec('Stay Put', priTeam('B1')), // same-team returning
      rec('Mover Up', priTeam('B2')), // transferred out
      rec('Left Town', priTeam('B1')), // not returning
      rec('Dup Name', priTeam('B3'), 'p1'), // unknown
    ];
    const result = detectExactPriorSeasonPlayerMovement(current, prior);

    expect(result.sameTeamReturning.map((e) => e.identityKey).sort()).toEqual([
      'stay put',
      'stay put',
    ]);
    expect(result.transferredIn.map((e) => e.identityKey)).toEqual(['mover up']);
    expect(result.transferredOut.map((e) => e.identityKey)).toEqual(['mover up']);
    expect(result.newToConference.map((e) => e.identityKey)).toEqual(['fresh face']);
    expect(result.notReturning.map((e) => e.identityKey)).toEqual(['left town']);
    expect(result.unknown.map((e) => e.identityKey)).toEqual([
      'dup name',
      'dup name',
      'dup name',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 7. Duplicate identities become unknown only
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - duplicates are unknown only', () => {
  it('marks duplicate current identity as unknown and never as transfer/same-team/new', () => {
    const c1 = rec('John Smith', curTeam('B1'), 'c1');
    const c2 = rec('John Smith', curTeam('B2'), 'c2');
    const pri = rec('John Smith', priTeam('B1'), 'p1');
    const result = detectExactPriorSeasonPlayerMovement([c1, c2], [pri]);

    // All three records (two current dup + the prior single) become unknown.
    expect(result.unknown).toHaveLength(3);
    expect(result.unknown.every((e) => e.identityKey === 'john smith')).toBe(true);
    expect(result.unknown.every((e) => e.derived.status === 'unknown')).toBe(true);
    expect(result.unknown.every((e) => e.derived.confidence === 'low')).toBe(true);

    expect(result.sameTeamReturning).toHaveLength(0);
    expect(result.transferredIn).toHaveLength(0);
    expect(result.transferredOut).toHaveLength(0);
    expect(result.newToConference).toHaveLength(0);
    expect(result.notReturning).toHaveLength(0);

    // Both current records preserved by reference.
    const currentUnknown = result.unknown.filter((e) => e.side === 'current');
    expect(currentUnknown.map((e) => e.record)).toEqual([c1, c2]);
  });

  it('marks duplicate prior identity as unknown and never as transfer/same-team/not-returning', () => {
    const cur = rec('John Smith', curTeam('B1'), 'c1');
    const p1 = rec('John Smith', priTeam('B1'), 'p1');
    const p2 = rec('John Smith', priTeam('B2'), 'p2');
    const result = detectExactPriorSeasonPlayerMovement([cur], [p1, p2]);

    expect(result.unknown).toHaveLength(3);
    expect(result.sameTeamReturning).toHaveLength(0);
    expect(result.transferredIn).toHaveLength(0);
    expect(result.transferredOut).toHaveLength(0);
    expect(result.newToConference).toHaveLength(0);
    expect(result.notReturning).toHaveLength(0);

    const priorUnknown = result.unknown.filter((e) => e.side === 'prior');
    expect(priorUnknown.map((e) => e.record)).toEqual([p1, p2]);
  });

  it('marks duplicates on both sides as unknown only', () => {
    const c1 = rec('John Smith', curTeam('B1'), 'c1');
    const c2 = rec('John Smith', curTeam('B2'), 'c2');
    const p1 = rec('John Smith', priTeam('B1'), 'p1');
    const p2 = rec('John Smith', priTeam('B2'), 'p2');
    const result = detectExactPriorSeasonPlayerMovement([c1, c2], [p1, p2]);

    expect(result.unknown).toHaveLength(4);
    expect(result.unknown.map((e) => e.side)).toEqual([
      'current',
      'current',
      'prior',
      'prior',
    ]);
    expect(result.unknown.map((e) => e.record)).toEqual([c1, c2, p1, p2]);

    expect(result.sameTeamReturning).toHaveLength(0);
    expect(result.transferredIn).toHaveLength(0);
    expect(result.transferredOut).toHaveLength(0);
    expect(result.newToConference).toHaveLength(0);
    expect(result.notReturning).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Identity normalization (casing / spacing) and initials
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - identity normalization', () => {
  it('matches the same name with casing and spacing differences through the identity helpers', () => {
    const cur = rec('  john   SMITH ', curTeam('B1'));
    const pri = rec('John Smith', priTeam('B1'));
    const result = detectExactPriorSeasonPlayerMovement([cur], [pri]);

    expect(result.sameTeamReturning).toHaveLength(2);
    expect(result.newToConference).toHaveLength(0);
    expect(result.notReturning).toHaveLength(0);
  });

  it('does not infer a full-name match from initials', () => {
    const cur = rec('J Smith', curTeam('B1'));
    const pri = rec('John Smith', priTeam('B1'));
    const result = detectExactPriorSeasonPlayerMovement([cur], [pri]);

    // No exact identity match: current is new, prior is not returning.
    expect(result.sameTeamReturning).toHaveLength(0);
    expect(result.transferredIn).toHaveLength(0);
    expect(result.transferredOut).toHaveLength(0);
    expect(result.newToConference.map((e) => e.identityKey)).toEqual(['j smith']);
    expect(result.notReturning.map((e) => e.identityKey)).toEqual(['john smith']);
  });
});

// ---------------------------------------------------------------------------
// 9. Source record preservation, no mutation, one entry per source record
// ---------------------------------------------------------------------------

describe('detectExactPriorSeasonPlayerMovement - preservation and invariants', () => {
  it('does not mutate input player or team objects', () => {
    const cur = rec('John Smith', curTeam('B1'), 'c1');
    const pri = rec('John Smith', priTeam('B2'), 'p1');
    const curSnap = JSON.parse(JSON.stringify(cur));
    const priSnap = JSON.parse(JSON.stringify(pri));

    detectExactPriorSeasonPlayerMovement([cur], [pri]);

    expect(cur).toEqual(curSnap);
    expect(pri).toEqual(priSnap);
  });

  it('produces exactly one output entry per source record', () => {
    const current = [
      rec('Stay Put', curTeam('B1')),
      rec('Mover Up', curTeam('B1')),
      rec('Fresh Face', curTeam('B3')),
      rec('Dup Name', curTeam('B1'), 'c1'),
      rec('Dup Name', curTeam('B2'), 'c2'),
    ];
    const prior = [
      rec('Stay Put', priTeam('B1')),
      rec('Mover Up', priTeam('B2')),
      rec('Left Town', priTeam('B1')),
      rec('Dup Name', priTeam('B3'), 'p1'),
    ];
    const result = detectExactPriorSeasonPlayerMovement(current, prior);

    const entries = allEntries(result);
    expect(entries).toHaveLength(current.length + prior.length);

    // Every source record appears exactly once across all buckets, by reference.
    const sourceRecords = [...current, ...prior];
    for (const source of sourceRecords) {
      const matches = entries.filter((e) => e.record === source);
      expect(matches).toHaveLength(1);
    }
  });

  it('preserves current input order in current-side buckets and prior order in prior-side buckets', () => {
    const current = [
      rec('Beta', curTeam('B1')), // new
      rec('Alpha', curTeam('B1')), // new
      rec('Gamma', curTeam('B1')), // new
    ];
    const prior = [
      rec('Zeta', priTeam('B1')), // not returning
      rec('Yulia', priTeam('B1')), // not returning
    ];
    const result = detectExactPriorSeasonPlayerMovement(current, prior);

    expect(result.newToConference.map((e) => e.identityKey)).toEqual([
      'beta',
      'alpha',
      'gamma',
    ]);
    expect(result.notReturning.map((e) => e.identityKey)).toEqual([
      'zeta',
      'yulia',
    ]);
  });
});
