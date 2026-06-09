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
  it('summarizes returning, new, and not-returning across both seasons', () => {
    // Alex is in both seasons (returning), Blair is current-only (new),
    // Casey is prior-only (not returning).
    const current = [p('Alex Kim'), p('Blair Doe')];
    const prior = [p('Alex Kim'), p('Casey Lee')];

    const result = summarizeTeamRosterStatus(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;

    const { summary } = result;
    // One returning player contributes both its current and prior record.
    expect(summary.returning).toBe(2);
    expect(summary.new).toBe(1);
    expect(summary.notReturning).toBe(1);
    expect(summary.unknown).toBe(0);
    expect(summary.total).toBe(4);
    expect(summary.highConfidence).toBe(4);
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

  it('accounts for every rostered record regardless of derived status', () => {
    // Even fully ambiguous rosters keep all records represented in the totals.
    const current = [p('Sam Rivera'), p('Sam Rivera'), p('Jordan Pat')];
    const prior = [p('Sam Rivera')];

    const result = summarizeTeamRosterStatus(current, prior);
    expect(result.available).toBe(true);
    if (!result.available) return;
    // 3 current records + 1 prior record = 4 records counted, none dropped.
    expect(result.summary.total).toBe(current.length + prior.length);
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
