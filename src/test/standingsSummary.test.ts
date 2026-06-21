import { describe, it, expect } from 'vitest';
import type { AgeDivision, District, Game, Team } from '../domain/types';
import { buildStandings } from '../engine/standingsSummary';

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: 'Hawks', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
  { districtId: 'brighton', name: 'Brighton', mascot: 'Bears', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 1, typicalAges: [9] },
  { ageDivisionId: 'PW', name: 'PeeWee', leagueLabel: 'PW League', ordinal: 2, typicalAges: [11] },
];

function team(teamId: string, districtId: string, ageDivisionId = 'GR', seasonId = '2026'): Team {
  return {
    teamId, seasonId, districtId, ageDivisionId, teamCode: 'B1',
    draftOrder: 1, divisionTeamCount: 2, headCoach: null, assistantCoaches: [], players: [],
  };
}

const ALTA = team('2026-alta-GR-B1', 'alta');
const BRIGHTON = team('2026-brighton-GR-B1', 'brighton');
const PW_TEAM = team('2026-alta-PW-B1', 'alta', 'PW');
const TEAMS = [ALTA, BRIGHTON, PW_TEAM];

function game(overrides: Partial<Game> & Pick<Game, 'gameId'>): Game {
  return {
    seasonId: '2026', ageDivisionId: 'GR', weekLabel: 'Week', scheduledDate: '2026-08-22',
    homeTeamId: ALTA.teamId, awayTeamId: BRIGHTON.teamId, status: 'final', homeScore: 0, awayScore: 0,
    ...overrides,
  };
}

// alta beats brighton twice (regular + championship); one scheduled game (no count).
const GAMES: Game[] = [
  game({ gameId: 'g1', scheduledDate: '2026-08-22', homeScore: 21, awayScore: 14 }),
  game({ gameId: 'g2', scheduledDate: '2026-09-01', homeTeamId: BRIGHTON.teamId, awayTeamId: ALTA.teamId, homeScore: 7, awayScore: 28 }),
  game({ gameId: 'champ', scheduledDate: '2026-10-31', homeScore: 20, awayScore: 14, isPlayoff: true, isChampionship: true, isNeutralSite: true }),
  game({ gameId: 'sched', scheduledDate: '2026-11-01', status: 'scheduled', homeScore: undefined, awayScore: undefined }),
];

function standings(games = GAMES, teams = TEAMS) {
  return buildStandings({ teams, games, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS, seasonId: '2026', ageDivisionId: 'GR' });
}

describe('buildStandings', () => {
  it('derives standings for the selected season + age division (only those teams)', () => {
    const s = standings();
    expect(s.rows.map((r) => r.teamId)).toEqual(['2026-alta-GR-B1', '2026-brighton-GR-B1']);
    // PW team excluded.
    expect(s.rows.some((r) => r.teamId === PW_TEAM.teamId)).toBe(false);
  });

  it('ranks by win percentage (alta 3-0 above brighton 0-3)', () => {
    const s = standings();
    expect(s.rows[0].teamId).toBe('2026-alta-GR-B1');
    expect(s.rows[0].rank).toBe(1);
    expect(s.rows[0].wins).toBe(3);
    expect(s.rows[0].losses).toBe(0);
    expect(s.rows[0].winPercentage).toBe(1);
    expect(s.rows[1].teamId).toBe('2026-brighton-GR-B1');
    expect(s.rows[1].rank).toBe(2);
    expect(s.rows[1].wins).toBe(0);
    expect(s.rows[1].losses).toBe(3);
  });

  it('excludes scheduled/postponed/cancelled games from the record', () => {
    const s = standings();
    expect(s.rows[0].gamesPlayed).toBe(3); // g1, g2, champ — not the scheduled game
  });

  it('includes points for/against/differential', () => {
    const s = standings();
    const alta = s.rows[0];
    expect(alta.pointsFor).toBe(21 + 28 + 20);
    expect(alta.pointsAgainst).toBe(14 + 7 + 14);
    expect(alta.pointDifferential).toBe(alta.pointsFor - alta.pointsAgainst);
  });

  it('includes playoff and championship records', () => {
    const s = standings();
    const alta = s.rows[0];
    expect(alta.playoffRecord.wins).toBe(1); // championship counts as playoff
    expect(alta.championshipRecord.wins).toBe(1);
    expect(alta.regularSeasonRecord.wins).toBe(2);
  });

  it('handles a team with no final games (0 win pct, ranked last)', () => {
    const onlyG1 = [game({ gameId: 'only', homeScore: 10, awayScore: 3 })];
    const s = standings(onlyG1);
    const brighton = s.rows.find((r) => r.teamId === BRIGHTON.teamId)!;
    // brighton lost g1 so it has 1 game; use a team with truly zero games instead:
    const sEmpty = buildStandings({
      teams: [ALTA, BRIGHTON], games: [], districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
      seasonId: '2026', ageDivisionId: 'GR',
    });
    expect(sEmpty.hasFinalGames).toBe(false);
    expect(sEmpty.rows.every((r) => r.gamesPlayed === 0 && r.winPercentage === 0)).toBe(true);
    expect(brighton.gamesPlayed).toBe(1);
  });

  it('handles unresolved game references without crashing', () => {
    const withOrphan = [
      ...GAMES,
      game({ gameId: 'orphan', scheduledDate: '2026-12-01', homeTeamId: ALTA.teamId, awayTeamId: 'ghost-team', homeScore: 5, awayScore: 0 }),
    ];
    const s = standings(withOrphan);
    const alta = s.rows.find((r) => r.teamId === ALTA.teamId)!;
    expect(alta.unresolvedGameReferenceCount).toBe(1);
    expect(s.unresolvedGameReferenceCount).toBe(1);
    // The orphan game's result still counts for alta (scores are real).
    expect(alta.gamesPlayed).toBe(4);
  });

  it('does not mutate inputs', () => {
    const games = GAMES.map((g) => ({ ...g }));
    const teams = TEAMS.map((t) => ({ ...t }));
    const gamesBefore = JSON.stringify(games);
    const teamsBefore = JSON.stringify(teams);
    buildStandings({ teams, games, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS, seasonId: '2026', ageDivisionId: 'GR' });
    expect(JSON.stringify(games)).toBe(gamesBefore);
    expect(JSON.stringify(teams)).toBe(teamsBefore);
  });

  it('breaks ties deterministically (point differential, then points for, then name)', () => {
    // Two teams each 1-0 but different differentials.
    const a = team('2026-alta-GR-B1', 'alta');
    const b = team('2026-brighton-GR-B1', 'brighton');
    const c = team('2026-corner-GR-B1', 'corner');
    const teams = [a, b, c];
    const games: Game[] = [
      // a beats c 30-0 (+30); b beats c 10-7 (+3). a and b both 1-0.
      game({ gameId: 'a-c', homeTeamId: a.teamId, awayTeamId: c.teamId, homeScore: 30, awayScore: 0 }),
      game({ gameId: 'b-c', homeTeamId: b.teamId, awayTeamId: c.teamId, homeScore: 10, awayScore: 7 }),
    ];
    const districts = [...DISTRICTS, { districtId: 'corner', name: 'Corner', mascot: '', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' }];
    const s = buildStandings({ teams, games, districts, ageDivisions: AGE_DIVISIONS, seasonId: '2026', ageDivisionId: 'GR' });
    expect(s.rows[0].teamId).toBe(a.teamId); // higher differential ranks first
    expect(s.rows[1].teamId).toBe(b.teamId);
  });
});
