import { describe, it, expect } from 'vitest';
import { countPlayers, countHeadCoaches, countAssistantCoaches } from '../engine/summaries';
import type { Team } from '../domain/types';

const fullTeam: Team = {
  teamId: 'test-team',
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GR',
  teamCode: 'B1',
  draftOrder: 1,
  divisionTeamCount: 4,
  headCoach: { name: 'Head Coach' },
  assistantCoaches: [{ name: 'Asst 1' }, { name: 'Asst 2' }],
  players: [{ name: 'Player A' }, { name: 'Player B' }, { name: 'Player C' }],
};

const emptyTeam: Team = {
  teamId: 'empty-team',
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GR',
  teamCode: 'C1',
  draftOrder: 2,
  divisionTeamCount: 4,
  headCoach: null,
  assistantCoaches: [],
  players: [],
};

describe('countPlayers', () => {
  it('counts players correctly', () => {
    expect(countPlayers(fullTeam)).toBe(3);
  });

  it('returns 0 when no players', () => {
    expect(countPlayers(emptyTeam)).toBe(0);
  });
});

describe('countHeadCoaches', () => {
  it('returns 1 when head coach is present', () => {
    expect(countHeadCoaches(fullTeam)).toBe(1);
  });

  it('returns 0 when head coach is null', () => {
    expect(countHeadCoaches(emptyTeam)).toBe(0);
  });
});

describe('countAssistantCoaches', () => {
  it('counts assistant coaches correctly', () => {
    expect(countAssistantCoaches(fullTeam)).toBe(2);
  });

  it('returns 0 when no assistant coaches', () => {
    expect(countAssistantCoaches(emptyTeam)).toBe(0);
  });
});
