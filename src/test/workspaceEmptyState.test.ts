import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import {
  assessWorkspaceEmptiness,
  recommendedFirstRunActions,
} from '../engine/workspaceEmptyState';

function team(seasonId: string, districtId: string): Team {
  return {
    teamId: `${seasonId}-${districtId}`,
    seasonId,
    districtId,
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 1,
    headCoach: null,
    assistantCoaches: [],
    players: [],
  };
}

const empty = () => ({ districts: [], teams: [], games: [], coaches: [] });

describe('assessWorkspaceEmptiness', () => {
  it('detects an empty workspace (no teams) as empty for roster', () => {
    const signal = assessWorkspaceEmptiness(empty());
    expect(signal.hasTeams).toBe(false);
    expect(signal.hasSeasons).toBe(false);
    expect(signal.isEmptyForRoster).toBe(true);
  });

  it('does not treat a populated (sample-like) workspace as empty', () => {
    const signal = assessWorkspaceEmptiness({
      districts: [{ districtId: 'alta' }] as never,
      teams: [team('2025', 'alta'), team('2026', 'alta')],
      games: [],
      coaches: [],
    });
    expect(signal.hasTeams).toBe(true);
    expect(signal.hasSeasons).toBe(true);
    expect(signal.hasDistricts).toBe(true);
    expect(signal.isEmptyForRoster).toBe(false);
  });

  it('does not mutate the input', () => {
    const ws = Object.freeze(empty());
    assessWorkspaceEmptiness(ws);
    expect(ws.teams).toHaveLength(0);
  });
});

describe('recommendedFirstRunActions', () => {
  it('offers dataset import + roster import + districts for a fresh empty workspace', () => {
    const actions = recommendedFirstRunActions(assessWorkspaceEmptiness(empty()));
    expect(actions).toEqual(['import-dataset', 'roster-import', 'districts']);
  });

  it('drops the districts action once districts exist', () => {
    const actions = recommendedFirstRunActions(
      assessWorkspaceEmptiness({
        districts: [{ districtId: 'alta' }] as never,
        teams: [],
        games: [],
        coaches: [],
      })
    );
    expect(actions).toEqual(['import-dataset', 'roster-import']);
  });

  it('offers schedule import when teams exist but no games do', () => {
    const actions = recommendedFirstRunActions(
      assessWorkspaceEmptiness({
        districts: [{ districtId: 'alta' }] as never,
        teams: [team('2026', 'alta')],
        games: [],
        coaches: [],
      })
    );
    expect(actions).toContain('schedule-import');
  });
});
