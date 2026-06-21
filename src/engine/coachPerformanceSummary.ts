import type {
  AgeDivision,
  CoachRole,
  District,
  Game,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import {
  deriveGameType,
  deriveTeamGameResult,
  formatTeamDisplayName,
  validateScheduleReferences,
  type ContextRecord,
  type TeamGameResult,
  type UnresolvedScheduleReference,
} from './teamScheduleSummary';
import {
  validateCoachAssignments,
  type UnresolvedCoachReference,
} from './coachHistorySummary';

/**
 * Phase 7 slice 28: PURE, deterministic COACH PERFORMANCE analytics — ENGINE ONLY.
 *
 * Connects coach assignments to game results so the app can report how coaches performed
 * across their assigned teams, seasons, roles, and playoff/championship contexts. A coach
 * earns credit for the FINAL games of every team they are assigned to; scheduled, postponed,
 * and cancelled games never count. Championship games count toward both the championship and
 * the playoff-context records; the regular-season record excludes playoff/championship games.
 *
 * Guardrails: never mutates inputs; never touches rosters, games, or coach assignments (read
 * only); opponents are resolved only through existing teams (an unresolved reference is counted
 * and flagged, never invented); preserves coach/team names exactly; deterministic ordering.
 *
 * Dedup semantics:
 *  - The unit of credit is one (coach, team) pairing. For the overall record, a team's games
 *    are counted once per coach no matter how many assignments/roles tie that coach to the team
 *    (duplicate assignments and multiple roles on the same team/season do not double-count the
 *    overall record).
 *  - Role-specific records reflect each role bucket: a coach who is both head and assistant on
 *    one team contributes that team's games to BOTH role records while the overall record counts
 *    them once.
 *  - Edge case: if a single coach is assigned to BOTH teams of one game, that game is counted
 *    once per team perspective (i.e. twice). This is intentional and rare; it is documented here
 *    rather than silently collapsed.
 */

export const COACH_PERFORMANCE_SUMMARY_LOGIC_VERSION =
  'phase7-slice28-coach-performance-summary-v1';

const ROLE_ORDER: Record<CoachRole, number> = { headCoach: 0, assistantCoach: 1, unknown: 2 };

/** A win/loss/tie record with point totals plus a deterministic win percentage. */
export type CoachPerformanceRecord = ContextRecord & {
  /** (wins + 0.5*ties) / gamesPlayed, or 0 when no games played. */
  winPercentage: number;
};

function emptyContextRecord(): ContextRecord {
  return {
    wins: 0,
    losses: 0,
    ties: 0,
    gamesPlayed: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
  };
}

function winPct(wins: number, ties: number, gamesPlayed: number): number {
  if (gamesPlayed === 0) return 0;
  return (wins + 0.5 * ties) / gamesPlayed;
}

function toPerformanceRecord(record: ContextRecord): CoachPerformanceRecord {
  return { ...record, winPercentage: winPct(record.wins, record.ties, record.gamesPlayed) };
}

/** Adds one final game's result into a context record. Mutates the accumulator only. */
function accumulate(
  record: ContextRecord,
  result: TeamGameResult,
  teamScore: number,
  opponentScore: number
): void {
  record.gamesPlayed += 1;
  record.pointsFor += teamScore;
  record.pointsAgainst += opponentScore;
  record.pointDifferential = record.pointsFor - record.pointsAgainst;
  if (result === 'win') record.wins += 1;
  else if (result === 'loss') record.losses += 1;
  else record.ties += 1;
}

function teamScores(
  game: Game,
  teamId: string
): { teamScore: number; opponentScore: number } {
  const isHome = game.homeTeamId === teamId;
  return {
    teamScore: (isHome ? game.homeScore : game.awayScore) as number,
    opponentScore: (isHome ? game.awayScore : game.homeScore) as number,
  };
}

type AccrualResult = {
  overall: ContextRecord;
  regularSeason: ContextRecord;
  playoff: ContextRecord;
  championship: ContextRecord;
  unresolvedGameReferenceCount: number;
};

/**
 * Accrues final-game results for a SET of distinct teams. Each distinct team's final games are
 * counted once (so the same team reached through multiple assignments/roles does not double the
 * overall record). Pure; never mutates inputs.
 */
function accrueForTeams(
  teamIds: Set<string>,
  games: Game[],
  teamsById: Map<string, Team>
): AccrualResult {
  const overall = emptyContextRecord();
  const regularSeason = emptyContextRecord();
  const playoff = emptyContextRecord();
  const championship = emptyContextRecord();
  let unresolvedGameReferenceCount = 0;

  for (const teamId of teamIds) {
    for (const game of games) {
      const result = deriveTeamGameResult(game, teamId);
      if (!result) continue;
      const { teamScore, opponentScore } = teamScores(game, teamId);
      accumulate(overall, result, teamScore, opponentScore);
      const type = deriveGameType(game);
      if (type === 'championship') {
        accumulate(championship, result, teamScore, opponentScore);
        accumulate(playoff, result, teamScore, opponentScore);
      } else if (type === 'playoff') {
        accumulate(playoff, result, teamScore, opponentScore);
      } else {
        accumulate(regularSeason, result, teamScore, opponentScore);
      }
      const opponentTeamId =
        game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId;
      if (!teamsById.has(opponentTeamId)) unresolvedGameReferenceCount += 1;
    }
  }

  return { overall, regularSeason, playoff, championship, unresolvedGameReferenceCount };
}

function distinctSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

// ---------------------------------------------------------------------------
// Coach performance (single coach + directory)
// ---------------------------------------------------------------------------

export type CoachLatestAssignment = {
  seasonId: string;
  teamId: string;
  teamDisplayName: string;
  role: CoachRole;
};

export type CoachPerformanceSummary = {
  coachId: string;
  displayName: string;
  /** True when the coachId resolves to a coach in the coaches list. */
  available: boolean;
  totalAssignments: number;
  seasonsActive: string[];
  /** Distinct teams the coach was assigned to (resolved or not). */
  teamAssignments: number;
  rolesHeld: CoachRole[];
  latestAssignment: CoachLatestAssignment | null;
  overallRecord: CoachPerformanceRecord;
  regularSeasonRecord: CoachPerformanceRecord;
  playoffRecord: CoachPerformanceRecord;
  championshipRecord: CoachPerformanceRecord;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  headCoachRecord: CoachPerformanceRecord;
  assistantCoachRecord: CoachPerformanceRecord;
  unknownRoleRecord: CoachPerformanceRecord;
  /** Assignments whose team reference could not be resolved (no games could be credited). */
  unresolvedAssignmentCount: number;
  /** Final games credited to this coach whose opponent reference could not be resolved. */
  unresolvedGameReferenceCount: number;
};

export type SummarizeCoachPerformanceInput = {
  coachId: string;
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  teams: Team[];
  games: Game[];
  districts: District[];
  ageDivisions: AgeDivision[];
};

function compareAssignmentsForLatest(
  a: TeamCoachAssignment,
  b: TeamCoachAssignment
): number {
  if (a.seasonId !== b.seasonId) return a.seasonId < b.seasonId ? -1 : 1;
  if (a.teamId !== b.teamId) return a.teamId < b.teamId ? -1 : 1;
  if (a.role !== b.role) return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
  return a.assignmentId < b.assignmentId ? -1 : a.assignmentId > b.assignmentId ? 1 : 0;
}

/**
 * Role-bucketed records for one coach (head / assistant / unknown). Pure; never mutates inputs.
 * Each role record reflects the final games of every team where the coach held that role.
 */
export function summarizeCoachRolePerformance(input: SummarizeCoachPerformanceInput): {
  headCoachRecord: CoachPerformanceRecord;
  assistantCoachRecord: CoachPerformanceRecord;
  unknownRoleRecord: CoachPerformanceRecord;
} {
  const { coachId, coachAssignments, teams, games } = input;
  const teamsById = new Map(teams.map((t) => [t.teamId, t]));
  const roleTeamIds: Record<CoachRole, Set<string>> = {
    headCoach: new Set(),
    assistantCoach: new Set(),
    unknown: new Set(),
  };
  for (const a of coachAssignments) {
    if (a.coachId !== coachId) continue;
    if (!teamsById.has(a.teamId)) continue;
    roleTeamIds[a.role].add(a.teamId);
  }
  return {
    headCoachRecord: toPerformanceRecord(
      accrueForTeams(roleTeamIds.headCoach, games, teamsById).overall
    ),
    assistantCoachRecord: toPerformanceRecord(
      accrueForTeams(roleTeamIds.assistantCoach, games, teamsById).overall
    ),
    unknownRoleRecord: toPerformanceRecord(
      accrueForTeams(roleTeamIds.unknown, games, teamsById).overall
    ),
  };
}

/**
 * Summarizes one coach's performance across all assigned teams/seasons/roles. Pure; never
 * mutates inputs. Only final games count; unresolved assignment/game references are surfaced.
 */
export function summarizeCoachPerformance(
  input: SummarizeCoachPerformanceInput
): CoachPerformanceSummary {
  const { coachId, coaches, coachAssignments, teams, games, districts, ageDivisions } = input;
  const coach = coaches.find((c) => c.coachId === coachId) ?? null;
  const teamsById = new Map(teams.map((t) => [t.teamId, t]));
  const myAssignments = coachAssignments.filter((a) => a.coachId === coachId);

  const allTeamIds = new Set<string>();
  let unresolvedAssignmentCount = 0;
  for (const a of myAssignments) {
    if (!teamsById.has(a.teamId)) {
      unresolvedAssignmentCount += 1;
      continue;
    }
    allTeamIds.add(a.teamId);
  }

  const acc = accrueForTeams(allTeamIds, games, teamsById);
  const roles = summarizeCoachRolePerformance(input);

  const sortedAssignments = [...myAssignments].sort(compareAssignmentsForLatest);
  const latest =
    sortedAssignments.length > 0 ? sortedAssignments[sortedAssignments.length - 1] : null;
  const latestTeam = latest ? teamsById.get(latest.teamId) ?? null : null;
  const latestAssignment: CoachLatestAssignment | null = latest
    ? {
        seasonId: latest.seasonId,
        teamId: latest.teamId,
        teamDisplayName: latestTeam
          ? formatTeamDisplayName(latestTeam, districts, ageDivisions)
          : latest.teamId,
        role: latest.role,
      }
    : null;

  return {
    coachId,
    displayName: coach ? coach.displayName : coachId,
    available: coach !== null,
    totalAssignments: myAssignments.length,
    seasonsActive: distinctSorted(myAssignments.map((a) => a.seasonId)),
    teamAssignments: distinctSorted(myAssignments.map((a) => a.teamId)).length,
    rolesHeld: distinctSorted(myAssignments.map((a) => a.role)) as CoachRole[],
    latestAssignment,
    overallRecord: toPerformanceRecord(acc.overall),
    regularSeasonRecord: toPerformanceRecord(acc.regularSeason),
    playoffRecord: toPerformanceRecord(acc.playoff),
    championshipRecord: toPerformanceRecord(acc.championship),
    pointsFor: acc.overall.pointsFor,
    pointsAgainst: acc.overall.pointsAgainst,
    pointDifferential: acc.overall.pointDifferential,
    headCoachRecord: roles.headCoachRecord,
    assistantCoachRecord: roles.assistantCoachRecord,
    unknownRoleRecord: roles.unknownRoleRecord,
    unresolvedAssignmentCount,
    unresolvedGameReferenceCount: acc.unresolvedGameReferenceCount,
  };
}

export type BuildCoachPerformanceDirectoryInput = {
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  teams: Team[];
  games: Game[];
  districts: District[];
  ageDivisions: AgeDivision[];
};

function compareByNameThenId(a: CoachPerformanceSummary, b: CoachPerformanceSummary): number {
  if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
  return a.coachId < b.coachId ? -1 : a.coachId > b.coachId ? 1 : 0;
}

/**
 * Builds the coach performance directory (one row per coach). Pure; deterministic ordering by
 * display name then coachId; never mutates inputs.
 */
export function summarizeCoachPerformanceDirectory(
  input: BuildCoachPerformanceDirectoryInput
): CoachPerformanceSummary[] {
  return input.coaches
    .map((coach) => summarizeCoachPerformance({ ...input, coachId: coach.coachId }))
    .sort(compareByNameThenId);
}

// ---------------------------------------------------------------------------
// Team-specific coach performance
// ---------------------------------------------------------------------------

export type TeamCoachPerformanceMember = {
  assignmentId: string;
  coachId: string;
  displayName: string;
  role: CoachRole;
  /** True when the assignment's coachId is not in the coach list. */
  unresolvedCoach: boolean;
  /** Record earned WITH THIS TEAM only (this team's final games). */
  withTeamRecord: CoachPerformanceRecord;
  withTeamRegularSeasonRecord: ContextRecord;
  withTeamPlayoffRecord: ContextRecord;
  withTeamChampionshipRecord: ContextRecord;
  /** Record across ALL of the coach's assignments (career / all-assignment overall). */
  careerRecord: CoachPerformanceRecord;
  /** Seasons this coach is assigned to this team. */
  seasonsWithTeam: string[];
};

export type TeamCoachPerformanceSummary = {
  teamId: string;
  seasonId: string;
  members: TeamCoachPerformanceMember[];
  totalAssignedCoaches: number;
  unresolvedCoachReferences: number;
  unresolvedGameReferenceCount: number;
  hasFinalGames: boolean;
};

export type SummarizeTeamCoachPerformanceInput = {
  teamId: string;
  seasonId: string;
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  teams: Team[];
  games: Game[];
  districts: District[];
  ageDivisions: AgeDivision[];
};

/**
 * Summarizes how a selected team's assigned staff have performed. Distinguishes the
 * "with this team" record (this team's final games) from each coach's career / all-assignment
 * record. Pure; never mutates inputs.
 */
export function summarizeTeamCoachPerformance(
  input: SummarizeTeamCoachPerformanceInput
): TeamCoachPerformanceSummary {
  const { teamId, seasonId, coaches, coachAssignments, teams, games, districts, ageDivisions } =
    input;
  const teamsById = new Map(teams.map((t) => [t.teamId, t]));
  const coachesById = new Map(coaches.map((c) => [c.coachId, c]));
  const teamAssignments = coachAssignments.filter((a) => a.teamId === teamId);

  // The with-this-team record is identical for every member (it is this team's final games).
  const teamAccrual = accrueForTeams(new Set([teamId]), games, teamsById);
  const withTeamRecord = toPerformanceRecord(teamAccrual.overall);

  // Cache career records so a team with several assignment rows for one coach computes once.
  const careerByCoachId = new Map<string, CoachPerformanceRecord>();
  const careerFor = (coachId: string): CoachPerformanceRecord => {
    const cached = careerByCoachId.get(coachId);
    if (cached) return cached;
    const record = summarizeCoachPerformance({
      coachId,
      coaches,
      coachAssignments,
      teams,
      games,
      districts,
      ageDivisions,
    }).overallRecord;
    careerByCoachId.set(coachId, record);
    return record;
  };

  const members: TeamCoachPerformanceMember[] = teamAssignments
    .map((a): TeamCoachPerformanceMember => {
      const coach = coachesById.get(a.coachId) ?? null;
      const seasonsWithTeam = distinctSorted(
        teamAssignments.filter((x) => x.coachId === a.coachId).map((x) => x.seasonId)
      );
      return {
        assignmentId: a.assignmentId,
        coachId: a.coachId,
        displayName: coach ? coach.displayName : a.coachId,
        role: a.role,
        unresolvedCoach: coach === null,
        withTeamRecord,
        withTeamRegularSeasonRecord: teamAccrual.regularSeason,
        withTeamPlayoffRecord: teamAccrual.playoff,
        withTeamChampionshipRecord: teamAccrual.championship,
        careerRecord: careerFor(a.coachId),
        seasonsWithTeam,
      };
    })
    .sort((a, b) => {
      if (a.role !== b.role) return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
      return a.assignmentId < b.assignmentId ? -1 : a.assignmentId > b.assignmentId ? 1 : 0;
    });

  return {
    teamId,
    seasonId,
    members,
    totalAssignedCoaches: members.length,
    unresolvedCoachReferences: members.filter((m) => m.unresolvedCoach).length,
    unresolvedGameReferenceCount: teamAccrual.unresolvedGameReferenceCount,
    hasFinalGames: teamAccrual.overall.gamesPlayed > 0,
  };
}

// ---------------------------------------------------------------------------
// Reference validation
// ---------------------------------------------------------------------------

export type CoachPerformanceReferenceReport = {
  unresolvedAssignments: UnresolvedCoachReference[];
  unresolvedGames: UnresolvedScheduleReference[];
  unresolvedAssignmentCount: number;
  unresolvedGameReferenceCount: number;
};

/**
 * Reports unresolved coach-assignment references (unknown coach/team) and unresolved game
 * references (unknown home/away team) used by the analytics. Pure; never mutates inputs. These
 * are surfaced for display — records are still derived for whatever does resolve.
 */
export function validateCoachPerformanceReferences(input: {
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  teams: Team[];
  games: Game[];
}): CoachPerformanceReferenceReport {
  const unresolvedAssignments = validateCoachAssignments(
    input.coachAssignments,
    input.coaches,
    input.teams
  );
  const unresolvedGames = validateScheduleReferences(input.games, input.teams);
  return {
    unresolvedAssignments,
    unresolvedGames,
    unresolvedAssignmentCount: unresolvedAssignments.length,
    unresolvedGameReferenceCount: unresolvedGames.length,
  };
}
