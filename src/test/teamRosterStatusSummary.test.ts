import { describe, it, expect } from 'vitest';
import {
  summarizeTeamRosterStatus,
  findPriorSeasonTeam,
} from '../engine/teamRosterStatusSummary';
import type { PlayerIdentityInput } from '../engine/playerIdentityOverlap';
import type { Team, Player } from '../domain/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function p(name: string): PlayerIdentityInput {
  return { name };
}

function makeTeam(overrides: Partial<Team>): Team {
  return {
    teamId: 'team',
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 4,
    headCoach: null,
    assistantCoaches: [],
    players: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Unavailable state (no prior-season roster)
// ---------------------------------------------------------------------------

describe('summarizeTeamRosterStatus - unavailable state', () => {
  it('reports unavailable when priorPlayers is null', () => {
    const result = summarizeTeamRosterStatus([p('Alex Kim')], null);
    expect(result).toEqual({ available: false, reason: 'no-prior-season' });
  });

  it('reports unavailable when priorPlayers is undefined', () => {
    const result = summarizeTeamRosterStatus([p('Alex Kim')], undefined);
    expect(result).toEqual({ available: false, reason: 'no-prior-season' });
  });

  it('does not throw on unavailable even when current roster is empty', () => {
    expect(summarizeTeamRosterStatus([], null)).toEqual({
      available: false,
      reason: 'no-prior-season',
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Available summary with derivable data
// ---------------------------------------------------------------------------

describe('summarizeTeamRosterStatus - available summary', () => {
  it('summarizes returning, new, and not-returning from the team perspective', () => {
    // Alex is in both seasons (returning), Blair is current-only (new),
    // Casey is prior-only (not returning).
    const current = [p('Alex Kim'), p('Blair Doe')];
    const prior = [p('Alex Kim'), p('Casey Lee')];

    const result = summarizeTeamRosterStatus(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;

    const { summary } = result;
    // Returning is counted once per current player, not per source record.
    expect(summary.returning).toBe(1);
    expect(summary.new).toBe(1);
    expect(summary.notReturning).toBe(1);
    expect(summary.unknown).toBe(0);
    expect(summary.total).toBe(3);
    expect(summary.highConfidence).toBe(3);
    expect(summary.lowConfidence).toBe(0);
  });

  it('reports an empty (all-zero) summary when both rosters are empty', () => {
    const result = summarizeTeamRosterStatus([], []);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.total).toBe(0);
    expect(result.summary.returning).toBe(0);
    expect(result.summary.new).toBe(0);
    expect(result.summary.notReturning).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Ambiguous data -> unknown / low confidence
// ---------------------------------------------------------------------------

describe('summarizeTeamRosterStatus - ambiguous data', () => {
  it('counts duplicate identities as unknown and low confidence', () => {
    // Two players share the same identity key in the current roster.
    const current = [p('Sam Rivera'), p('Sam Rivera')];
    const prior = [p('Sam Rivera')];

    const result = summarizeTeamRosterStatus(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;

    const { summary } = result;
    expect(summary.unknown).toBeGreaterThan(0);
    expect(summary.lowConfidence).toBeGreaterThan(0);
    expect(summary.returning).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Source preservation (no mutation, rostered players retained)
// ---------------------------------------------------------------------------

describe('summarizeTeamRosterStatus - source preservation', () => {
  it('does not mutate the current or prior input arrays', () => {
    const current = [p('Alex Kim'), p('Blair Doe')];
    const prior = [p('Alex Kim'), p('Casey Lee')];
    const currentSnapshot = JSON.parse(JSON.stringify(current));
    const priorSnapshot = JSON.parse(JSON.stringify(prior));

    summarizeTeamRosterStatus(current, prior);

    expect(current).toEqual(currentSnapshot);
    expect(prior).toEqual(priorSnapshot);
    expect(current).toHaveLength(2);
    expect(prior).toHaveLength(2);
  });

  it('accounts for every current rostered player regardless of derived status', () => {
    // Every current player lands in exactly one of returning / new / unknown.
    const current = [p('Sam Rivera'), p('Sam Rivera'), p('Jordan Pat')];
    const prior = [p('Sam Rivera')];

    const result = summarizeTeamRosterStatus(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;
    const { summary } = result;
    expect(summary.returning + summary.new + summary.unknown).toBe(current.length);
  });
});

// ---------------------------------------------------------------------------
// 4b. Perspective-aware counts (no double counting)
// ---------------------------------------------------------------------------

describe('summarizeTeamRosterStatus - perspective-aware counts', () => {
  it('counts a single exact current/prior match as Returning = 1 (not 2)', () => {
    const result = summarizeTeamRosterStatus([p('Alex Kim')], [p('Alex Kim')]);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.returning).toBe(1);
    expect(result.summary.total).toBe(1);
    expect(result.summary.highConfidence).toBe(1);
    expect(result.summary.lowConfidence).toBe(0);
  });

  it('counts multiple exact matches once per current player', () => {
    const current = [p('Alex Kim'), p('Blair Doe'), p('Casey Lee')];
    const prior = [p('Alex Kim'), p('Blair Doe'), p('Casey Lee')];
    const result = summarizeTeamRosterStatus(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.returning).toBe(3);
    expect(result.summary.new).toBe(0);
    expect(result.summary.notReturning).toBe(0);
    expect(result.summary.total).toBe(3);
  });

  it('counts current-only players as New', () => {
    const result = summarizeTeamRosterStatus(
      [p('Alex Kim'), p('Blair Doe')],
      [p('Alex Kim')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.new).toBe(1);
    expect(result.summary.returning).toBe(1);
  });

  it('counts ambiguous current players as Unknown (low confidence)', () => {
    const result = summarizeTeamRosterStatus(
      [p('Sam Rivera'), p('Sam Rivera')],
      [p('Other Name')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.unknown).toBe(2);
    expect(result.summary.lowConfidence).toBe(2);
    expect(result.summary.returning).toBe(0);
    expect(result.summary.new).toBe(0);
  });

  it('counts prior-only players as Not returning', () => {
    const result = summarizeTeamRosterStatus(
      [p('Alex Kim')],
      [p('Alex Kim'), p('Casey Lee')]
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.summary.notReturning).toBe(1);
    expect(result.summary.returning).toBe(1);
  });

  it('produces intuitive counts for mixed current/prior data', () => {
    // Returning: Alex. New: Blair. Unknown: duplicate Sam (x2). Not returning: Casey.
    const current = [p('Alex Kim'), p('Blair Doe'), p('Sam Rivera'), p('Sam Rivera')];
    const prior = [p('Alex Kim'), p('Casey Lee')];
    const result = summarizeTeamRosterStatus(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;
    const { summary } = result;
    expect(summary.returning).toBe(1);
    expect(summary.new).toBe(1);
    expect(summary.unknown).toBe(2);
    expect(summary.notReturning).toBe(1);
    expect(summary.total).toBe(5);
    expect(summary.highConfidence).toBe(3); // returning + new + notReturning
    expect(summary.lowConfidence).toBe(2); // unknown
    expect(summary.highConfidence + summary.lowConfidence).toBe(summary.total);
  });
});

// ---------------------------------------------------------------------------
// 5. findPriorSeasonTeam
// ---------------------------------------------------------------------------

describe('findPriorSeasonTeam', () => {
  it('returns null when there is no earlier season', () => {
    const teams = [makeTeam({ teamId: '2026-alta-GR-B1', seasonId: '2026' })];
    const current = teams[0];
    expect(findPriorSeasonTeam(teams, current)).toBeNull();
  });

  it('finds the prior-season team in the same district/age-division/team-code slot', () => {
    const prior = makeTeam({
      teamId: '2025-alta-GR-B1',
      seasonId: '2025',
      players: [p('Alex Kim') as Player],
    });
    const current = makeTeam({ teamId: '2026-alta-GR-B1', seasonId: '2026' });
    const teams = [prior, current];

    expect(findPriorSeasonTeam(teams, current)).toBe(prior);
  });

  it('returns null when no prior-season team matches the same slot', () => {
    const priorOtherCode = makeTeam({
      teamId: '2025-alta-GR-B2',
      seasonId: '2025',
      teamCode: 'B2',
    });
    const current = makeTeam({ teamId: '2026-alta-GR-B1', seasonId: '2026', teamCode: 'B1' });
    const teams = [priorOtherCode, current];

    expect(findPriorSeasonTeam(teams, current)).toBeNull();
  });

  it('uses the immediately prior season when multiple earlier seasons exist', () => {
    const oldest = makeTeam({ teamId: '2024-alta-GR-B1', seasonId: '2024' });
    const prior = makeTeam({ teamId: '2025-alta-GR-B1', seasonId: '2025' });
    const current = makeTeam({ teamId: '2026-alta-GR-B1', seasonId: '2026' });
    const teams = [oldest, prior, current];

    expect(findPriorSeasonTeam(teams, current)).toBe(prior);
  });
});
