import { describe, it, expect } from 'vitest';
import type { AgeDivision, District, Game, Team } from '../domain/types';
import {
  summarizeTeamSchedule,
  getTeamSchedule,
  deriveTeamGameResult,
  validateScheduleReferences,
} from '../engine/teamScheduleSummary';

// ---------------------------------------------------------------------------
// Fixtures: two existing teams (alta, brighton) in 2026 GR.
// ---------------------------------------------------------------------------

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: '', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
  { districtId: 'brighton', name: 'Brighton', mascot: '', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 1, typicalAges: [9] },
];

function makeTeam(teamId: string, districtId: string): Team {
  return {
    teamId,
    seasonId: '2026',
    districtId,
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 2,
    headCoach: null,
    assistantCoaches: [],
    players: [],
  };
}

const ALTA = makeTeam('2026-alta-GR-B1', 'alta');
const BRIGHTON = makeTeam('2026-brighton-GR-B1', 'brighton');
const TEAMS = [ALTA, BRIGHTON];

function game(overrides: Partial<Game> & Pick<Game, 'gameId' | 'status'>): Game {
  return {
    seasonId: '2026',
    ageDivisionId: 'GR',
    weekLabel: 'Week',
    scheduledDate: '2026-08-22',
    homeTeamId: ALTA.teamId,
    awayTeamId: BRIGHTON.teamId,
    ...overrides,
  };
}

// alta: W (home 21-14), T (away 28-28), upcoming (scheduled), cancelled, postponed.
const GAMES: Game[] = [
  game({ gameId: 'w1', weekLabel: 'Week 1', scheduledDate: '2026-08-22', status: 'final', homeTeamId: ALTA.teamId, awayTeamId: BRIGHTON.teamId, homeScore: 21, awayScore: 14 }),
  game({ gameId: 'w2', weekLabel: 'Week 2', scheduledDate: '2026-08-29', status: 'final', homeTeamId: BRIGHTON.teamId, awayTeamId: ALTA.teamId, homeScore: 28, awayScore: 28 }),
  game({ gameId: 'w3', weekLabel: 'Week 3', scheduledDate: '2026-09-05', status: 'scheduled', homeTeamId: ALTA.teamId, awayTeamId: BRIGHTON.teamId }),
  game({ gameId: 'w4', weekLabel: 'Week 4', scheduledDate: '2026-09-12', status: 'cancelled', homeTeamId: BRIGHTON.teamId, awayTeamId: ALTA.teamId }),
  game({ gameId: 'w5', weekLabel: 'Week 5', scheduledDate: '2026-09-19', status: 'postponed', homeTeamId: ALTA.teamId, awayTeamId: BRIGHTON.teamId }),
];

function altaSummary(games = GAMES, teams = TEAMS) {
  return summarizeTeamSchedule({
    teamId: ALTA.teamId,
    games,
    teams,
    districts: DISTRICTS,
    ageDivisions: AGE_DIVISIONS,
  });
}

describe('deriveTeamGameResult', () => {
  it('derives win/loss/tie for final games from the team perspective', () => {
    expect(deriveTeamGameResult(GAMES[0], ALTA.teamId)).toBe('win');
    expect(deriveTeamGameResult(GAMES[0], BRIGHTON.teamId)).toBe('loss');
    expect(deriveTeamGameResult(GAMES[1], ALTA.teamId)).toBe('tie');
  });

  it('returns null for non-final games and non-participants', () => {
    expect(deriveTeamGameResult(GAMES[2], ALTA.teamId)).toBeNull(); // scheduled
    expect(deriveTeamGameResult(GAMES[3], ALTA.teamId)).toBeNull(); // cancelled
    expect(deriveTeamGameResult(GAMES[4], ALTA.teamId)).toBeNull(); // postponed
    expect(deriveTeamGameResult(GAMES[0], 'not-a-team')).toBeNull();
  });

  it('returns null for a final game missing usable scores', () => {
    const noScores = game({ gameId: 'x', status: 'final' });
    expect(deriveTeamGameResult(noScores, ALTA.teamId)).toBeNull();
  });
});

describe('summarizeTeamSchedule', () => {
  it('derives W-L-T from final games only', () => {
    const s = altaSummary();
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(0);
    expect(s.ties).toBe(1);
    expect(s.completedGames).toBe(2);
  });

  it('does not count scheduled, postponed, or cancelled games toward the record', () => {
    const s = altaSummary();
    expect(s.upcomingGames).toBe(2); // scheduled (w3) + postponed (w5)
    expect(s.cancelledGames).toBe(1); // w4
    expect(s.wins + s.losses + s.ties).toBe(s.completedGames);
  });

  it('derives points for/against and point differential', () => {
    const s = altaSummary();
    expect(s.pointsFor).toBe(49); // 21 + 28
    expect(s.pointsAgainst).toBe(42); // 14 + 28
    expect(s.pointDifferential).toBe(7);
  });

  it('resolves opponents from existing team references with display names', () => {
    const s = altaSummary();
    const w1 = s.games.find((g) => g.gameId === 'w1')!;
    expect(w1.opponentTeamId).toBe(BRIGHTON.teamId);
    expect(w1.opponentDisplayName).toBe('Brighton Gremlin B1');
    expect(w1.unresolvedReference).toBe(false);
    expect(w1.homeAway).toBe('home');
    expect(w1.scoreDisplay).toBe('21–14');
    expect(w1.resultDisplay).toBe('W');
  });

  it('reports unresolved opponent references without crashing', () => {
    const orphan = game({ gameId: 'orphan', weekLabel: 'Week 9', scheduledDate: '2026-10-01', status: 'final', homeTeamId: ALTA.teamId, awayTeamId: 'ghost-team', homeScore: 10, awayScore: 7 });
    const s = altaSummary([...GAMES, orphan], TEAMS);
    const view = s.games.find((g) => g.gameId === 'orphan')!;
    expect(view.unresolvedReference).toBe(true);
    expect(view.opponentDisplayName).toBe('ghost-team');
    // The team's own result is still derivable from scores.
    expect(view.result).toBe('win');
  });

  it('sorts games deterministically by date, then week, then gameId', () => {
    const shuffled = [GAMES[4], GAMES[0], GAMES[2], GAMES[1], GAMES[3]];
    const s = altaSummary(shuffled, TEAMS);
    expect(s.games.map((g) => g.gameId)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
  });

  it('derives next game (first upcoming) and last result (latest completed)', () => {
    const s = altaSummary();
    expect(s.nextGame?.gameId).toBe('w3'); // first scheduled/postponed by order
    expect(s.lastGame?.gameId).toBe('w2'); // latest final
  });

  it('handles a team with no games (clean empty summary)', () => {
    const s = summarizeTeamSchedule({
      teamId: 'team-with-no-games',
      games: GAMES,
      teams: TEAMS,
      districts: DISTRICTS,
      ageDivisions: AGE_DIVISIONS,
    });
    expect(s.totalGames).toBe(0);
    expect(s.games).toEqual([]);
    expect(s.nextGame).toBeNull();
    expect(s.lastGame).toBeNull();
    expect(s.wins).toBe(0);
  });

  it('does not mutate the input games or teams', () => {
    const games = GAMES.map((g) => ({ ...g }));
    const teams = TEAMS.map((t) => ({ ...t }));
    const gamesBefore = JSON.stringify(games);
    const teamsBefore = JSON.stringify(teams);
    altaSummary(games, teams);
    expect(JSON.stringify(games)).toBe(gamesBefore);
    expect(JSON.stringify(teams)).toBe(teamsBefore);
  });

  it('computes the away perspective score order correctly', () => {
    const s = altaSummary();
    const w2 = s.games.find((g) => g.gameId === 'w2')!; // alta away, 28-28 tie
    expect(w2.homeAway).toBe('away');
    expect(w2.scoreDisplay).toBe('28–28');
    expect(w2.resultDisplay).toBe('T');
  });
});

describe('record splits (Phase 6 slice 26)', () => {
  // alta: regular W (w1 21-14), regular T (w2 28-28), playoff W (semifinal 14-7),
  // championship W (final 20-14, neutral).
  const CONTEXT_GAMES: Game[] = [
    ...GAMES,
    game({ gameId: 'semi', weekLabel: 'Semifinal', scheduledDate: '2026-10-10', status: 'final', homeTeamId: ALTA.teamId, awayTeamId: BRIGHTON.teamId, homeScore: 14, awayScore: 7, isPlayoff: true }),
    game({ gameId: 'champ', weekLabel: 'Championship', scheduledDate: '2026-10-31', status: 'final', homeTeamId: ALTA.teamId, awayTeamId: BRIGHTON.teamId, homeScore: 20, awayScore: 14, isPlayoff: true, isChampionship: true, isNeutralSite: true }),
  ];

  it('regular-season record excludes playoff and championship games', () => {
    const s = altaSummary(CONTEXT_GAMES);
    expect(s.regularSeasonRecord.wins).toBe(1); // w1 only (w2 is a tie)
    expect(s.regularSeasonRecord.ties).toBe(1); // w2
    expect(s.regularSeasonRecord.gamesPlayed).toBe(2);
  });

  it('playoff record includes playoff AND championship games', () => {
    const s = altaSummary(CONTEXT_GAMES);
    expect(s.playoffRecord.wins).toBe(2); // semifinal + championship
    expect(s.playoffRecord.gamesPlayed).toBe(2);
  });

  it('championship record includes championship games only', () => {
    const s = altaSummary(CONTEXT_GAMES);
    expect(s.championshipRecord.wins).toBe(1);
    expect(s.championshipRecord.gamesPlayed).toBe(1);
  });

  it('overall record sums all final games', () => {
    const s = altaSummary(CONTEXT_GAMES);
    expect(s.overallRecord.wins).toBe(3);
    expect(s.overallRecord.ties).toBe(1);
    expect(s.overallRecord.gamesPlayed).toBe(4);
    expect(s.wins).toBe(3); // flat field stays = overall
  });

  it('marks neutral-site and game type in derived game rows', () => {
    const s = altaSummary(CONTEXT_GAMES);
    const champ = s.games.find((g) => g.gameId === 'champ')!;
    expect(champ.gameType).toBe('championship');
    expect(champ.isNeutralSite).toBe(true);
    const semi = s.games.find((g) => g.gameId === 'semi')!;
    expect(semi.gameType).toBe('playoff');
    const w1 = s.games.find((g) => g.gameId === 'w1')!;
    expect(w1.gameType).toBe('regular');
    expect(w1.isNeutralSite).toBe(false);
  });

  it('scheduled/postponed/cancelled games do not count toward any record', () => {
    const s = altaSummary(CONTEXT_GAMES);
    expect(s.overallRecord.gamesPlayed).toBe(4); // w1, w2, semi, champ — not w3/w4/w5
    expect(s.upcomingGames).toBe(2); // w3 scheduled + w5 postponed
    expect(s.cancelledGames).toBe(1); // w4
  });

  it('does not mutate inputs', () => {
    const before = JSON.stringify(CONTEXT_GAMES);
    altaSummary(CONTEXT_GAMES);
    expect(JSON.stringify(CONTEXT_GAMES)).toBe(before);
  });
});

describe('getTeamSchedule', () => {
  it('returns only the team’s games, sorted, without mutating input', () => {
    const input = [...GAMES].reverse();
    const before = JSON.stringify(input);
    const result = getTeamSchedule(ALTA.teamId, input);
    expect(result.map((g) => g.gameId)).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('validateScheduleReferences', () => {
  it('returns empty when all references resolve', () => {
    expect(validateScheduleReferences(GAMES, TEAMS)).toEqual([]);
  });

  it('reports games with unresolved team references', () => {
    const orphan = game({ gameId: 'orphan', status: 'scheduled', homeTeamId: 'ghost', awayTeamId: ALTA.teamId });
    const unresolved = validateScheduleReferences([orphan], TEAMS);
    expect(unresolved).toEqual([{ gameId: 'orphan', missingTeamIds: ['ghost'] }]);
  });
});
