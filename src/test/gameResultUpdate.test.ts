import { describe, it, expect } from 'vitest';
import type { AgeDivision, District, Game, Team } from '../domain/types';
import { updateGameResult } from '../engine/gameResultUpdate';
import { summarizeTeamSchedule } from '../engine/teamScheduleSummary';

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: '', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
  { districtId: 'brighton', name: 'Brighton', mascot: '', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 1, typicalAges: [9] },
];
function team(teamId: string, districtId: string): Team {
  return {
    teamId, seasonId: '2026', districtId, ageDivisionId: 'GR', teamCode: 'B1',
    draftOrder: 1, divisionTeamCount: 2, headCoach: null, assistantCoaches: [], players: [],
  };
}
const TEAMS = [team('2026-alta-GR-B1', 'alta'), team('2026-brighton-GR-B1', 'brighton')];

function game(overrides: Partial<Game> & Pick<Game, 'gameId'>): Game {
  return {
    seasonId: '2026', ageDivisionId: 'GR', weekLabel: 'Week 1', scheduledDate: '2026-08-22',
    homeTeamId: '2026-alta-GR-B1', awayTeamId: '2026-brighton-GR-B1', status: 'scheduled',
    ...overrides,
  };
}

describe('updateGameResult', () => {
  it('updates a scheduled game to final with valid scores', () => {
    const games = [game({ gameId: 'g1', status: 'scheduled' })];
    const result = updateGameResult({ games, gameId: 'g1', patch: { status: 'final', homeScore: 21, awayScore: 14 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedGame.status).toBe('final');
    expect(result.updatedGame.homeScore).toBe(21);
  });

  it('rejects a final game with missing scores and leaves games unchanged', () => {
    const games = [game({ gameId: 'g1', status: 'scheduled' })];
    const result = updateGameResult({ games, gameId: 'g1', patch: { status: 'final' } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0].code).toBe('invalid-final-scores');
  });

  it('rejects a non-numeric score', () => {
    const games = [game({ gameId: 'g1' })];
    const result = updateGameResult({ games, gameId: 'g1', patch: { homeScore: Number('abc') } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid-score');
  });

  it('rejects an unknown game id', () => {
    const result = updateGameResult({ games: [], gameId: 'missing', patch: { status: 'cancelled' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('game-not-found');
  });

  it('updates a final score and recalculates the team summary', () => {
    const games = [game({ gameId: 'g1', status: 'final', homeScore: 7, awayScore: 7 })];
    const updated = updateGameResult({ games, gameId: 'g1', patch: { homeScore: 28, awayScore: 0 } });
    if (!updated.ok) throw new Error('expected ok');
    const summary = summarizeTeamSchedule({
      teamId: '2026-alta-GR-B1', games: updated.games, teams: TEAMS, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(summary.wins).toBe(1);
    expect(summary.ties).toBe(0);
    expect(summary.pointsFor).toBe(28);
    expect(summary.pointsAgainst).toBe(0);
  });

  it('cancelled games do not count toward the record', () => {
    const games = [game({ gameId: 'g1', status: 'final', homeScore: 21, awayScore: 0 })];
    const updated = updateGameResult({ games, gameId: 'g1', patch: { status: 'cancelled', homeScore: null, awayScore: null } });
    if (!updated.ok) throw new Error('expected ok');
    const summary = summarizeTeamSchedule({
      teamId: '2026-alta-GR-B1', games: updated.games, teams: TEAMS, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(summary.wins).toBe(0);
    expect(summary.completedGames).toBe(0);
    expect(summary.cancelledGames).toBe(1);
  });

  it('does not mutate the input games', () => {
    const games = [game({ gameId: 'g1', status: 'scheduled' })];
    const before = JSON.stringify(games);
    updateGameResult({ games, gameId: 'g1', patch: { status: 'final', homeScore: 1, awayScore: 0 } });
    expect(JSON.stringify(games)).toBe(before);
  });

  it('preserves context fields (neutral/playoff/championship) on a result edit (slice 26)', () => {
    const games = [
      game({ gameId: 'g1', status: 'scheduled', isPlayoff: true, isChampionship: true, isNeutralSite: true }),
    ];
    const result = updateGameResult({ games, gameId: 'g1', patch: { status: 'final', homeScore: 20, awayScore: 14 } });
    if (!result.ok) throw new Error('expected ok');
    expect(result.updatedGame.isPlayoff).toBe(true);
    expect(result.updatedGame.isChampionship).toBe(true);
    expect(result.updatedGame.isNeutralSite).toBe(true);
    expect(result.updatedGame.status).toBe('final');
  });
});
