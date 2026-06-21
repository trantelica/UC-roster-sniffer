import { describe, it, expect } from 'vitest';
import type {
  AgeDivision,
  District,
  Game,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import { buildStaffCoach } from '../engine/coachModel';
import {
  summarizeCoachPerformance,
  summarizeCoachPerformanceDirectory,
  summarizeCoachRolePerformance,
  summarizeTeamCoachPerformance,
  validateCoachPerformanceReferences,
} from '../engine/coachPerformanceSummary';

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: 'Hawks', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
  { districtId: 'brighton', name: 'Brighton', mascot: 'Bears', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 1, typicalAges: [9] },
];

function team(teamId: string, districtId: string, seasonId: string): Team {
  return {
    teamId, seasonId, districtId, ageDivisionId: 'GR', teamCode: 'B1',
    draftOrder: 1, divisionTeamCount: 2, headCoach: null, assistantCoaches: [], players: [],
  };
}

// Alta GR B1 across 2025 + 2026; Brighton GR B1 (the opponent) in both seasons.
const ALTA_2025 = team('2025-alta-GR-B1', 'alta', '2025');
const ALTA_2026 = team('2026-alta-GR-B1', 'alta', '2026');
const BRIGHTON_2025 = team('2025-brighton-GR-B1', 'brighton', '2025');
const BRIGHTON_2026 = team('2026-brighton-GR-B1', 'brighton', '2026');
const TEAMS = [ALTA_2025, ALTA_2026, BRIGHTON_2025, BRIGHTON_2026];

function game(overrides: Partial<Game> & Pick<Game, 'gameId'>): Game {
  return {
    seasonId: '2026', ageDivisionId: 'GR', weekLabel: 'Week', scheduledDate: '2026-08-22',
    homeTeamId: ALTA_2026.teamId, awayTeamId: BRIGHTON_2026.teamId,
    status: 'final', homeScore: 0, awayScore: 0,
    ...overrides,
  };
}

// 2026 Alta: regular win (21-14), playoff win (28-7), championship win (20-14), a scheduled,
// a postponed, and a cancelled game (none of which count).
// 2025 Alta: regular loss (3-10).
const GAMES: Game[] = [
  game({ gameId: 'reg', seasonId: '2026', scheduledDate: '2026-08-22', homeScore: 21, awayScore: 14 }),
  game({ gameId: 'po', seasonId: '2026', scheduledDate: '2026-09-15', homeScore: 28, awayScore: 7, isPlayoff: true }),
  game({ gameId: 'champ', seasonId: '2026', scheduledDate: '2026-10-31', homeScore: 20, awayScore: 14, isPlayoff: true, isChampionship: true, isNeutralSite: true }),
  game({ gameId: 'sched', seasonId: '2026', scheduledDate: '2026-11-05', status: 'scheduled', homeScore: undefined, awayScore: undefined }),
  game({ gameId: 'postp', seasonId: '2026', scheduledDate: '2026-11-06', status: 'postponed', homeScore: undefined, awayScore: undefined }),
  game({ gameId: 'canc', seasonId: '2026', scheduledDate: '2026-11-07', status: 'cancelled', homeScore: undefined, awayScore: undefined }),
  game({ gameId: 'reg25', seasonId: '2025', scheduledDate: '2025-08-22', homeTeamId: ALTA_2025.teamId, awayTeamId: BRIGHTON_2025.teamId, homeScore: 3, awayScore: 10 }),
];

const JANE = buildStaffCoach('Jane Smith'); // head coach of Alta in both seasons
const SAM = buildStaffCoach('Sam Lee'); // assistant on Alta 2026
const COACHES: StaffCoach[] = [JANE, SAM];

function headAssignment(teamId: string, seasonId: string, coach: StaffCoach): TeamCoachAssignment {
  return { assignmentId: `${seasonId}:${teamId}:${coach.coachId}:head`, seasonId, teamId, coachId: coach.coachId, role: 'headCoach' };
}
function asstAssignment(teamId: string, seasonId: string, coach: StaffCoach): TeamCoachAssignment {
  return { assignmentId: `${seasonId}:${teamId}:${coach.coachId}:asst`, seasonId, teamId, coachId: coach.coachId, role: 'assistantCoach' };
}

const ASSIGNMENTS: TeamCoachAssignment[] = [
  headAssignment(ALTA_2025.teamId, '2025', JANE),
  headAssignment(ALTA_2026.teamId, '2026', JANE),
  asstAssignment(ALTA_2026.teamId, '2026', SAM),
];

function perf(coachId: string, assignments = ASSIGNMENTS, games = GAMES, coaches = COACHES) {
  return summarizeCoachPerformance({
    coachId, coaches, coachAssignments: assignments, teams: TEAMS, games,
    districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
  });
}

describe('summarizeCoachPerformance', () => {
  it('credits a coach with the final games of their assigned teams (only final games count)', () => {
    const jane = perf(JANE.coachId);
    // 2026: reg W, playoff W, champ W; 2025: reg L. scheduled/postponed/cancelled excluded.
    expect(jane.overallRecord.gamesPlayed).toBe(4);
    expect(jane.overallRecord.wins).toBe(3);
    expect(jane.overallRecord.losses).toBe(1);
    expect(jane.overallRecord.ties).toBe(0);
  });

  it('excludes scheduled/postponed/cancelled games', () => {
    const jane = perf(JANE.coachId);
    // 7 games in the array, only 4 are final.
    expect(jane.overallRecord.gamesPlayed).toBe(4);
  });

  it('splits regular / playoff / championship records (championship counts as playoff)', () => {
    const jane = perf(JANE.coachId);
    expect(jane.regularSeasonRecord.wins).toBe(1); // 2026 reg win only counts as regular
    expect(jane.regularSeasonRecord.losses).toBe(1); // 2025 reg loss
    expect(jane.playoffRecord.gamesPlayed).toBe(2); // playoff + championship
    expect(jane.playoffRecord.wins).toBe(2);
    expect(jane.championshipRecord.gamesPlayed).toBe(1);
    expect(jane.championshipRecord.wins).toBe(1);
    // regular excludes playoff/championship.
    expect(jane.regularSeasonRecord.gamesPlayed).toBe(2);
  });

  it('accumulates points for/against/differential and win percentage', () => {
    const jane = perf(JANE.coachId);
    expect(jane.pointsFor).toBe(21 + 28 + 20 + 3);
    expect(jane.pointsAgainst).toBe(14 + 7 + 14 + 10);
    expect(jane.pointDifferential).toBe(jane.pointsFor - jane.pointsAgainst);
    expect(jane.overallRecord.winPercentage).toBeCloseTo(3 / 4);
  });

  it('separates head / assistant / unknown role records', () => {
    const jane = perf(JANE.coachId);
    expect(jane.headCoachRecord.gamesPlayed).toBe(4); // all games as head coach
    expect(jane.assistantCoachRecord.gamesPlayed).toBe(0);
    expect(jane.unknownRoleRecord.gamesPlayed).toBe(0);

    const sam = perf(SAM.coachId);
    expect(sam.assistantCoachRecord.gamesPlayed).toBe(3); // 2026 final games only
    expect(sam.headCoachRecord.gamesPlayed).toBe(0);
  });

  it('gives each coach on the same team credit for that team\'s games', () => {
    const jane = perf(JANE.coachId);
    const sam = perf(SAM.coachId);
    // Both coach Alta 2026 (3 final games); each is credited.
    expect(jane.overallRecord.wins).toBeGreaterThanOrEqual(3);
    expect(sam.overallRecord.gamesPlayed).toBe(3);
    expect(sam.overallRecord.wins).toBe(3);
  });

  it('does not double-count overall games for a duplicate same-team assignment', () => {
    const dup = [...ASSIGNMENTS, headAssignment(ALTA_2026.teamId, '2026', JANE)];
    const jane = perf(JANE.coachId, dup);
    expect(jane.totalAssignments).toBe(3); // Jane's raw assignment rows (2 original + 1 dup)
    expect(jane.overallRecord.gamesPlayed).toBe(4); // games still counted once per team
  });

  it('does not double-count overall for multiple roles on the same team, but role buckets reflect each role', () => {
    const multiRole = [...ASSIGNMENTS, asstAssignment(ALTA_2026.teamId, '2026', JANE)];
    const jane = perf(JANE.coachId, multiRole);
    expect(jane.overallRecord.gamesPlayed).toBe(4); // overall counts each game once
    expect(jane.headCoachRecord.gamesPlayed).toBe(4); // head on both seasons
    expect(jane.assistantCoachRecord.gamesPlayed).toBe(3); // assistant on Alta 2026
  });

  it('accumulates a career record across multiple seasons', () => {
    const jane = perf(JANE.coachId);
    expect(jane.seasonsActive).toEqual(['2025', '2026']);
    expect(jane.teamAssignments).toBe(2); // distinct teams
    expect(jane.overallRecord.gamesPlayed).toBe(4); // 2025 + 2026 final games
    expect(jane.latestAssignment?.seasonId).toBe('2026');
  });

  it('returns 0-0-0 for a coach with assignments but no final games', () => {
    const onlyUpcoming: Game[] = [
      game({ gameId: 's1', status: 'scheduled', homeScore: undefined, awayScore: undefined }),
    ];
    const jane = perf(JANE.coachId, ASSIGNMENTS, onlyUpcoming);
    expect(jane.overallRecord.gamesPlayed).toBe(0);
    expect(jane.overallRecord.wins).toBe(0);
    expect(jane.overallRecord.winPercentage).toBe(0);
    expect(jane.totalAssignments).toBeGreaterThan(0);
  });

  it('surfaces unresolved assignment references without crashing', () => {
    const orphan: TeamCoachAssignment = {
      assignmentId: 'orphan', seasonId: '2026', teamId: 'ghost-team', coachId: JANE.coachId, role: 'headCoach',
    };
    const jane = perf(JANE.coachId, [...ASSIGNMENTS, orphan]);
    expect(jane.unresolvedAssignmentCount).toBe(1);
    expect(jane.overallRecord.gamesPlayed).toBe(4); // resolved teams still count
  });

  it('surfaces unresolved game references without crashing', () => {
    const orphanGame = game({ gameId: 'orphan', seasonId: '2026', scheduledDate: '2026-12-01', awayTeamId: 'ghost-team', homeScore: 5, awayScore: 0 });
    const jane = perf(JANE.coachId, ASSIGNMENTS, [...GAMES, orphanGame]);
    expect(jane.unresolvedGameReferenceCount).toBe(1);
    expect(jane.overallRecord.gamesPlayed).toBe(5); // orphan game's scores still count for Alta
  });

  it('does not mutate inputs', () => {
    const teams = TEAMS.map((t) => ({ ...t }));
    const games = GAMES.map((g) => ({ ...g }));
    const assignments = ASSIGNMENTS.map((a) => ({ ...a }));
    const before = JSON.stringify({ teams, games, assignments });
    summarizeCoachPerformance({
      coachId: JANE.coachId, coaches: COACHES, coachAssignments: assignments, teams, games,
      districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(JSON.stringify({ teams, games, assignments })).toBe(before);
  });
});

describe('summarizeCoachRolePerformance', () => {
  it('returns role-bucketed records', () => {
    const roles = summarizeCoachRolePerformance({
      coachId: JANE.coachId, coaches: COACHES, coachAssignments: ASSIGNMENTS, teams: TEAMS,
      games: GAMES, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(roles.headCoachRecord.gamesPlayed).toBe(4);
    expect(roles.assistantCoachRecord.gamesPlayed).toBe(0);
    expect(roles.unknownRoleRecord.gamesPlayed).toBe(0);
  });
});

describe('summarizeCoachPerformanceDirectory', () => {
  it('orders rows by display name then coachId', () => {
    const rows = summarizeCoachPerformanceDirectory({
      coaches: COACHES, coachAssignments: ASSIGNMENTS, teams: TEAMS, games: GAMES,
      districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(rows.map((r) => r.displayName)).toEqual(['Jane Smith', 'Sam Lee']);
  });

  it('returns an empty list when there are no coaches', () => {
    const rows = summarizeCoachPerformanceDirectory({
      coaches: [], coachAssignments: [], teams: TEAMS, games: GAMES,
      districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(rows).toEqual([]);
  });
});

describe('summarizeTeamCoachPerformance', () => {
  it('distinguishes with-this-team record from career record', () => {
    const summary = summarizeTeamCoachPerformance({
      teamId: ALTA_2025.teamId, seasonId: '2025', coaches: COACHES, coachAssignments: ASSIGNMENTS,
      teams: TEAMS, games: GAMES, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    const jane = summary.members.find((m) => m.coachId === JANE.coachId)!;
    // With Alta 2025: just the one regular loss.
    expect(jane.withTeamRecord.gamesPlayed).toBe(1);
    expect(jane.withTeamRecord.losses).toBe(1);
    // Career: all 4 final games across both seasons.
    expect(jane.careerRecord.gamesPlayed).toBe(4);
    expect(jane.careerRecord.wins).toBe(3);
  });

  it('orders members by role then name and reports counts', () => {
    const summary = summarizeTeamCoachPerformance({
      teamId: ALTA_2026.teamId, seasonId: '2026', coaches: COACHES, coachAssignments: ASSIGNMENTS,
      teams: TEAMS, games: GAMES, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(summary.members.map((m) => m.displayName)).toEqual(['Jane Smith', 'Sam Lee']);
    expect(summary.members[0].role).toBe('headCoach');
    expect(summary.totalAssignedCoaches).toBe(2);
    expect(summary.hasFinalGames).toBe(true);
    // With Alta 2026: reg W + playoff W + champ W = 3.
    expect(summary.members[0].withTeamRecord.gamesPlayed).toBe(3);
    expect(summary.members[0].withTeamChampionshipRecord.wins).toBe(1);
  });

  it('reports unresolved coach references without crashing', () => {
    const orphan: TeamCoachAssignment = {
      assignmentId: 'ghost', seasonId: '2026', teamId: ALTA_2026.teamId, coachId: 'coach:ghost', role: 'assistantCoach',
    };
    const summary = summarizeTeamCoachPerformance({
      teamId: ALTA_2026.teamId, seasonId: '2026', coaches: COACHES,
      coachAssignments: [...ASSIGNMENTS, orphan], teams: TEAMS, games: GAMES,
      districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(summary.unresolvedCoachReferences).toBe(1);
  });

  it('returns a clean empty summary for a team with no assignments', () => {
    const summary = summarizeTeamCoachPerformance({
      teamId: BRIGHTON_2026.teamId, seasonId: '2026', coaches: COACHES, coachAssignments: ASSIGNMENTS,
      teams: TEAMS, games: GAMES, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(summary.members).toEqual([]);
    expect(summary.totalAssignedCoaches).toBe(0);
  });

  it('does not mutate inputs', () => {
    const teams = TEAMS.map((t) => ({ ...t }));
    const games = GAMES.map((g) => ({ ...g }));
    const assignments = ASSIGNMENTS.map((a) => ({ ...a }));
    const before = JSON.stringify({ teams, games, assignments });
    summarizeTeamCoachPerformance({
      teamId: ALTA_2026.teamId, seasonId: '2026', coaches: COACHES, coachAssignments: assignments,
      teams, games, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(JSON.stringify({ teams, games, assignments })).toBe(before);
  });
});

describe('validateCoachPerformanceReferences', () => {
  it('reports unresolved assignment and game references', () => {
    const orphanAssignment: TeamCoachAssignment = {
      assignmentId: 'a', seasonId: '2026', teamId: 'ghost', coachId: 'coach:ghost', role: 'headCoach',
    };
    const orphanGame = game({ gameId: 'g', awayTeamId: 'ghost-team', homeScore: 1, awayScore: 0 });
    const report = validateCoachPerformanceReferences({
      coaches: COACHES, coachAssignments: [...ASSIGNMENTS, orphanAssignment],
      teams: TEAMS, games: [...GAMES, orphanGame],
    });
    expect(report.unresolvedAssignmentCount).toBe(1);
    expect(report.unresolvedGameReferenceCount).toBe(1);
  });

  it('returns zero counts when everything resolves', () => {
    const report = validateCoachPerformanceReferences({
      coaches: COACHES, coachAssignments: ASSIGNMENTS, teams: TEAMS, games: GAMES,
    });
    expect(report.unresolvedAssignmentCount).toBe(0);
    expect(report.unresolvedGameReferenceCount).toBe(0);
  });
});
