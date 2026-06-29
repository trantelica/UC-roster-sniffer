import { describe, it, expect } from 'vitest';
import {
  getDistinctSeasons,
  getDistinctDistricts,
  getDistinctAgeDivisions,
  filterTeams,
  isMaterializedTeam,
  getMaterializedTeams,
} from '../engine/filters';
import type { Team } from '../domain/types';

const teamA: Team = {
  teamId: '2026-alta-GR-B1',
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GR',
  teamCode: 'B1',
  draftOrder: 2,
  divisionTeamCount: 4,
  headCoach: { name: 'Coach A' },
  assistantCoaches: [],
  players: [{ name: 'Player One' }],
};

const teamB: Team = {
  teamId: '2026-brighton-GR-B1',
  seasonId: '2026',
  districtId: 'brighton',
  ageDivisionId: 'GR',
  teamCode: 'B1',
  draftOrder: 1,
  divisionTeamCount: 4,
  headCoach: null,
  assistantCoaches: [],
  players: [],
};

const teamC: Team = {
  teamId: '2025-alta-PW-C1',
  seasonId: '2025',
  districtId: 'alta',
  ageDivisionId: 'PW',
  teamCode: 'C1',
  draftOrder: 3,
  divisionTeamCount: 3,
  headCoach: { name: 'Coach C' },
  assistantCoaches: [{ name: 'Asst C' }],
  players: [{ name: 'Player Two' }, { name: 'Player Three' }],
};

const teams = [teamA, teamB, teamC];

describe('getDistinctSeasons', () => {
  it('returns all unique season IDs sorted', () => {
    expect(getDistinctSeasons(teams)).toEqual(['2025', '2026']);
  });

  it('returns empty array for no teams', () => {
    expect(getDistinctSeasons([])).toEqual([]);
  });
});

describe('getDistinctDistricts', () => {
  it('returns districts for a given season', () => {
    const result = getDistinctDistricts(teams, '2026');
    expect(result.sort()).toEqual(['alta', 'brighton']);
  });

  it('returns only districts in the given season', () => {
    const result = getDistinctDistricts(teams, '2025');
    expect(result).toEqual(['alta']);
  });

  it('returns empty array if season has no teams', () => {
    expect(getDistinctDistricts(teams, '2020')).toEqual([]);
  });
});

describe('getDistinctAgeDivisions', () => {
  it('returns age divisions for season+district', () => {
    const result = getDistinctAgeDivisions(teams, '2026', 'alta');
    expect(result).toEqual(['GR']);
  });

  it('returns empty array if district has no teams in season', () => {
    expect(getDistinctAgeDivisions(teams, '2026', 'unknown')).toEqual([]);
  });
});

describe('filterTeams', () => {
  it('filters by season only', () => {
    const result = filterTeams(teams, '2026', null, null);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.teamId)).toContain('2026-alta-GR-B1');
    expect(result.map((t) => t.teamId)).toContain('2026-brighton-GR-B1');
  });

  it('filters by season and district', () => {
    const result = filterTeams(teams, '2026', 'alta', null);
    expect(result).toHaveLength(1);
    expect(result[0].teamId).toBe('2026-alta-GR-B1');
  });

  it('filters by season, district, and age division', () => {
    const result = filterTeams(teams, '2026', 'alta', 'GR');
    expect(result).toHaveLength(1);
    expect(result[0].teamId).toBe('2026-alta-GR-B1');
  });

  it('returns empty array when no match', () => {
    const result = filterTeams(teams, '2026', 'alta', 'PW');
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty teams', () => {
    expect(filterTeams([], '2026', null, null)).toHaveLength(0);
  });
});

describe('materialized teams', () => {
  function shell(overrides: Partial<Team>): Team {
    return {
      teamId: 't',
      seasonId: '2026',
      districtId: 'corner-canyon',
      ageDivisionId: 'GI',
      teamCode: 'A3',
      draftOrder: 1,
      divisionTeamCount: 11,
      headCoach: null,
      assistantCoaches: [],
      players: [],
      ...overrides,
    };
  }

  it('treats an empty seed shell (no players/coaches) as NOT materialized', () => {
    expect(isMaterializedTeam(shell({}))).toBe(false);
  });

  it('treats a team with players as materialized', () => {
    expect(isMaterializedTeam(shell({ players: [{ name: 'Cary, Hudson' }] }))).toBe(true);
  });

  it('treats a team with a head or assistant coach as materialized', () => {
    expect(isMaterializedTeam(shell({ headCoach: { name: 'Coach' } }))).toBe(true);
    expect(isMaterializedTeam(shell({ assistantCoaches: [{ name: 'Asst' }] }))).toBe(true);
  });

  it('keeps only materialized teams and preserves order (hides empty shells)', () => {
    const emptyA3 = shell({ teamId: '2026-corner-canyon-GI-A3' }); // seeded shell
    const realA3 = shell({ teamId: '2025-corner-canyon-GI-A3', seasonId: '2025', players: [{ name: 'P1' }, { name: 'P2' }] });
    const realC1 = shell({ teamId: '2025-corner-canyon-GI-C1', seasonId: '2025', teamCode: 'C1', players: [{ name: 'P3' }] });
    const result = getMaterializedTeams([emptyA3, realA3, realC1]);
    expect(result.map((t) => t.teamId)).toEqual([
      '2025-corner-canyon-GI-A3',
      '2025-corner-canyon-GI-C1',
    ]);
  });
});
