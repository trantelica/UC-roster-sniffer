import { describe, it, expect } from 'vitest';
import type {
  AgeDivision,
  District,
  Game,
  Player,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import { buildStaffCoach } from '../engine/coachModel';
import { buildMyTeamSummary } from '../engine/myTeamSummary';

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: 'Hawks', logoAssetPath: '', helmetAssetPath: '', primaryColor: '#111', secondaryColor: '#222' },
  { districtId: 'brighton', name: 'Brighton', mascot: 'Bears', logoAssetPath: '', helmetAssetPath: '', primaryColor: '#333', secondaryColor: '#444' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 1, typicalAges: [9] },
];

function team(
  teamId: string,
  districtId: string,
  seasonId: string,
  players: Player[] = [],
  head: string | null = null,
  assistants: string[] = []
): Team {
  return {
    teamId, seasonId, districtId, ageDivisionId: 'GR', teamCode: 'B1',
    draftOrder: 1, divisionTeamCount: 2,
    headCoach: head ? { name: head } : null,
    assistantCoaches: assistants.map((name) => ({ name })),
    players,
  };
}

const P = (name: string): Player => ({ name });

// 2025 Alta: Jordan Smith, Taylor Johnson. 2026 Alta: Jordan Smith (returning), Casey Brown (new).
const ALTA_2025 = team('2025-alta-GR-B1', 'alta', '2025', [P('Jordan Smith'), P('Taylor Johnson')], 'Jane Smith', ['Sam Lee']);
const ALTA_2026 = team('2026-alta-GR-B1', 'alta', '2026', [P('Jordan Smith'), P('Casey Brown')], 'Jane Smith', ['Sam Lee', 'Morgan Davis']);
const BRIGHTON_2026 = team('2026-brighton-GR-B1', 'brighton', '2026', [P('Pat Jones')], 'Alex Martinez', []);
const TEAMS = [ALTA_2025, ALTA_2026, BRIGHTON_2026];

const JANE = buildStaffCoach('Jane Smith');
const SAM = buildStaffCoach('Sam Lee');
const MORGAN = buildStaffCoach('Morgan Davis');
const ALEX = buildStaffCoach('Alex Martinez');
const COACHES: StaffCoach[] = [JANE, SAM, MORGAN, ALEX];

function head(teamId: string, seasonId: string, c: StaffCoach): TeamCoachAssignment {
  return { assignmentId: `${seasonId}:${teamId}:${c.coachId}:h`, seasonId, teamId, coachId: c.coachId, role: 'headCoach' };
}
function asst(teamId: string, seasonId: string, c: StaffCoach): TeamCoachAssignment {
  return { assignmentId: `${seasonId}:${teamId}:${c.coachId}:a`, seasonId, teamId, coachId: c.coachId, role: 'assistantCoach' };
}

const ASSIGNMENTS: TeamCoachAssignment[] = [
  head(ALTA_2025.teamId, '2025', JANE),
  asst(ALTA_2025.teamId, '2025', SAM),
  head(ALTA_2026.teamId, '2026', JANE),
  asst(ALTA_2026.teamId, '2026', SAM),
  asst(ALTA_2026.teamId, '2026', MORGAN),
  head(BRIGHTON_2026.teamId, '2026', ALEX),
];

function game(overrides: Partial<Game> & Pick<Game, 'gameId'>): Game {
  return {
    seasonId: '2026', ageDivisionId: 'GR', weekLabel: 'Week 1', scheduledDate: '2026-08-22',
    homeTeamId: ALTA_2026.teamId, awayTeamId: BRIGHTON_2026.teamId, status: 'final', homeScore: 0, awayScore: 0,
    ...overrides,
  };
}

// Alta 2026: regular win, playoff win, championship win, one upcoming, one cancelled.
const GAMES: Game[] = [
  game({ gameId: 'reg', scheduledDate: '2026-08-22', homeScore: 21, awayScore: 14 }),
  game({ gameId: 'po', scheduledDate: '2026-09-15', homeScore: 28, awayScore: 7, isPlayoff: true }),
  game({ gameId: 'champ', scheduledDate: '2026-10-31', homeScore: 20, awayScore: 14, isPlayoff: true, isChampionship: true }),
  game({ gameId: 'next', scheduledDate: '2026-11-05', status: 'scheduled', homeScore: undefined, awayScore: undefined }),
  game({ gameId: 'canc', scheduledDate: '2026-11-12', status: 'cancelled', homeScore: undefined, awayScore: undefined }),
];

function build(overrides: Partial<Parameters<typeof buildMyTeamSummary>[0]> = {}) {
  return buildMyTeamSummary({
    teamId: ALTA_2026.teamId, teams: TEAMS, games: GAMES, districts: DISTRICTS,
    ageDivisions: AGE_DIVISIONS, coaches: COACHES, coachAssignments: ASSIGNMENTS, ...overrides,
  });
}

describe('buildMyTeamSummary', () => {
  it('returns null when the team is not found', () => {
    expect(build({ teamId: 'ghost-team' })).toBeNull();
  });

  it('builds a team identity summary', () => {
    const s = build()!;
    expect(s.identity.teamId).toBe(ALTA_2026.teamId);
    expect(s.identity.seasonId).toBe('2026');
    expect(s.identity.districtName).toBe('Alta');
    expect(s.identity.ageDivisionName).toBe('Gremlin');
    expect(s.identity.teamCode).toBe('B1');
    expect(s.identity.displayName).toBe('Alta Gremlin B1');
    expect(s.identity.mascot).toBe('Hawks');
    expect(s.identity.primaryColor).toBe('#111');
  });

  it('builds roster summary with prior-season comparison (returning/new)', () => {
    const s = build()!;
    expect(s.roster.totalPlayers).toBe(2);
    expect(s.roster.priorSeasonComparison.available).toBe(true);
    if (s.roster.priorSeasonComparison.available) {
      expect(s.roster.priorSeasonComparison.returning).toBe(1); // Jordan Smith
      expect(s.roster.priorSeasonComparison.newToRoster).toBe(1); // Casey Brown
      expect(s.roster.priorSeasonComparison.notReturning).toBe(1); // Taylor Johnson
    }
  });

  it('reports unavailable prior-season comparison when there is no prior team', () => {
    const s = build({ teamId: ALTA_2025.teamId })!;
    expect(s.roster.priorSeasonComparison.available).toBe(false);
    // and surfaces a no-prior-team attention item.
    expect(s.attentionItems.some((i) => i.code === 'no-prior-team')).toBe(true);
  });

  it('builds schedule summary with record splits, next game and last result', () => {
    const s = build()!;
    expect(s.schedule.totalGames).toBe(5);
    expect(s.schedule.completedGames).toBe(3);
    expect(s.schedule.overallRecord.wins).toBe(3);
    expect(s.schedule.regularSeasonRecord.wins).toBe(1);
    expect(s.schedule.playoffRecord.gamesPlayed).toBe(2); // playoff + championship
    expect(s.schedule.championshipRecord.gamesPlayed).toBe(1);
    expect(s.schedule.upcomingGames).toBe(1);
    expect(s.schedule.cancelledGames).toBe(1);
    expect(s.schedule.nextGame?.gameId).toBe('next');
    expect(s.schedule.lastGame?.gameId).toBe('champ');
    expect(s.schedule.pointDifferential).toBe(21 + 28 + 20 - (14 + 7 + 14));
  });

  it('handles a team with no schedule data', () => {
    const s = build({ games: [] })!;
    expect(s.schedule.totalGames).toBe(0);
    expect(s.schedule.overallRecord.gamesPlayed).toBe(0);
    expect(s.schedule.nextGame).toBeNull();
    expect(s.attentionItems.some((i) => i.code === 'no-schedule-loaded')).toBe(true);
  });

  it('derives standings rank within the season + age division', () => {
    const s = build()!;
    expect(s.standings.available).toBe(true);
    expect(s.standings.rank).toBe(1); // Alta 3-0 ranks above Brighton 0-3
    expect(s.standings.totalTeams).toBe(2);
    expect(s.standings.hasFinalGames).toBe(true);
  });

  it('flags standings as provisional when there are no final games', () => {
    const s = build({ games: [] })!;
    expect(s.standings.hasFinalGames).toBe(false);
    expect(s.attentionItems.some((i) => i.code === 'standings-unavailable')).toBe(true);
  });

  it('includes coach staff and with-this-team performance', () => {
    const s = build()!;
    expect(s.coaches.totalAssignedCoaches).toBe(3); // Jane + Sam + Morgan
    expect(s.coaches.headCoaches.map((m) => m.displayName)).toEqual(['Jane Smith']);
    expect(s.coaches.assistantCoaches.map((m) => m.displayName)).toEqual(['Morgan Davis', 'Sam Lee']);
    expect(s.coaches.continuity.available).toBe(true);
    expect(s.coaches.withTeamRecord.wins).toBe(3); // team's final-game record
    expect(s.coaches.members.length).toBe(3);
  });

  it('handles a team with no coach data', () => {
    const s = build({ coaches: [], coachAssignments: [] })!;
    expect(s.coaches.totalAssignedCoaches).toBe(0);
    expect(s.coaches.headCoaches).toEqual([]);
    expect(s.attentionItems.some((i) => i.code === 'no-coach-data')).toBe(true);
  });

  it('surfaces unresolved schedule references as an attention item', () => {
    const withOrphan = [
      ...GAMES,
      game({ gameId: 'orphan', scheduledDate: '2026-12-01', awayTeamId: 'ghost-team', homeScore: 5, awayScore: 0 }),
    ];
    const s = build({ games: withOrphan })!;
    expect(s.schedule.unresolvedScheduleReferenceCount).toBe(1);
    expect(s.attentionItems.some((i) => i.code === 'unresolved-schedule-reference')).toBe(true);
  });

  it('surfaces unresolved coach references as an attention item', () => {
    const orphan: TeamCoachAssignment = {
      assignmentId: 'ghost', seasonId: '2026', teamId: ALTA_2026.teamId, coachId: 'coach:ghost', role: 'assistantCoach',
    };
    const s = build({ coachAssignments: [...ASSIGNMENTS, orphan] })!;
    expect(s.coaches.unresolvedCoachReferences).toBe(1);
    expect(s.attentionItems.some((i) => i.code === 'unresolved-coach-reference')).toBe(true);
  });

  it('surfaces roster identity duplicates as an attention item', () => {
    const dupTeam = team('2026-dup-GR-B1', 'alta', '2026', [P('Jordan Smith'), P('Jordan Smith')]);
    const s = buildMyTeamSummary({
      teamId: dupTeam.teamId, teams: [...TEAMS, dupTeam], games: [], districts: DISTRICTS,
      ageDivisions: AGE_DIVISIONS, coaches: COACHES, coachAssignments: ASSIGNMENTS,
    })!;
    expect(s.roster.duplicateGroupCount).toBe(1);
    expect(s.attentionItems.some((i) => i.code === 'roster-identity-duplicates')).toBe(true);
  });

  it('adds an imported-workspace-only attention item when flagged', () => {
    const s = build({ importedWorkspace: true })!;
    expect(s.attentionItems.some((i) => i.code === 'imported-workspace-only')).toBe(true);
  });

  it('orders attention items deterministically (warnings before info)', () => {
    const s = build({ games: [], coaches: [], coachAssignments: [] })!;
    const severities = s.attentionItems.map((i) => i.severity);
    const firstInfo = severities.indexOf('info');
    const lastWarning = severities.lastIndexOf('warning');
    if (firstInfo !== -1 && lastWarning !== -1) {
      expect(lastWarning).toBeLessThan(firstInfo);
    }
    // Same input yields identical ordering.
    const s2 = build({ games: [], coaches: [], coachAssignments: [] })!;
    expect(s2.attentionItems.map((i) => i.code)).toEqual(s.attentionItems.map((i) => i.code));
  });

  it('does not mutate inputs', () => {
    const teams = TEAMS.map((t) => ({ ...t, players: [...t.players] }));
    const games = GAMES.map((g) => ({ ...g }));
    const assignments = ASSIGNMENTS.map((a) => ({ ...a }));
    const before = JSON.stringify({ teams, games, assignments });
    buildMyTeamSummary({
      teamId: ALTA_2026.teamId, teams, games, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
      coaches: COACHES, coachAssignments: assignments,
    });
    expect(JSON.stringify({ teams, games, assignments })).toBe(before);
  });
});
