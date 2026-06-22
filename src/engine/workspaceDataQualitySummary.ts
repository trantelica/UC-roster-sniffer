import type {
  AgeDivision,
  District,
  Game,
  Player,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import { getDistinctSeasons } from './filters';
import {
  summarizeTeamSchedule,
  formatTeamDisplayName,
  validateScheduleReferences,
} from './teamScheduleSummary';
import { buildStandings } from './standingsSummary';
import { summarizeTeamPriorSeasonComparison } from './priorSeasonRosterComparisonSummary';
import { findPriorSeasonTeam } from './teamRosterStatusSummary';
import {
  deriveCurrentRosterPlayerStatuses,
  currentPlayerNeedsIdentityReview,
} from './currentRosterPlayerStatus';
import { findDuplicatePlayerIdentityGroups } from './playerDuplicateDetection';
import { summarizeTeamCoachStaff, validateCoachAssignments } from './coachHistorySummary';
import { summarizeCoachPerformance } from './coachPerformanceSummary';
import {
  detectCohortReclassificationSignals,
  type RosterMovementRecord,
} from './cohortReclassificationSignal';

/**
 * Phase 10 slice 32: PURE, deterministic WORKSPACE DATA-QUALITY / REVIEW summary — ENGINE ONLY.
 *
 * Consolidates the data-quality / attention signals already detected across rosters, schedules,
 * coaches, standings, and analytics into one deterministic list of review items, each carrying a
 * stable id/code, severity, category, entity reference, plain-language message, and (where
 * resolvable) a navigation target. It is READ-ONLY and derives everything at runtime from existing
 * workspace data by composing the existing helpers; it does NOT mutate inputs, invent missing
 * records, drop ambiguity, or persist anything.
 *
 * Loaded roster records remain authoritative: ambiguity/duplicates/low-confidence matches affect
 * derived review metadata only and never alter, remove, or reorder source records.
 */

export const WORKSPACE_DATA_QUALITY_LOGIC_VERSION = 'phase10-slice32-workspace-data-quality-v1';

export type ReviewSeverity = 'blocker' | 'warning' | 'info';

export type ReviewCategory =
  | 'roster'
  | 'import'
  | 'schedule'
  | 'coach'
  | 'standings'
  | 'analytics'
  | 'workspace';

export type ReviewEntityType =
  | 'team'
  | 'player'
  | 'game'
  | 'coach'
  | 'coachAssignment'
  | 'importSession'
  | 'workspace'
  | 'season'
  | 'district'
  | 'ageDivision';

/**
 * Where a review item points. The UI maps `team` → My Team, `coach` → Coaches, and `view` → the
 * named tab. Navigation only changes selection/view state — it never mutates data.
 */
export type ReviewNavigationTarget =
  | { kind: 'team'; teamId: string }
  | { kind: 'coach'; coachId: string }
  | { kind: 'view'; view: 'standings' | 'analytics' | 'coaches' };

export type ReviewItem = {
  /** Stable, deterministic id: `${code}|${entityKey}`. */
  issueId: string;
  code: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  entityType: ReviewEntityType;
  entityId: string | null;
  seasonId: string | null;
  teamId: string | null;
  coachId: string | null;
  gameId: string | null;
  title: string;
  message: string;
  detail: string | null;
  recommendedAction: string | null;
  navigationTarget: ReviewNavigationTarget | null;
};

export type ReviewSeverityCounts = { total: number; blocker: number; warning: number; info: number };

export type WorkspaceDataQualitySummary = {
  counts: ReviewSeverityCounts;
  byCategory: Record<ReviewCategory, number>;
  bySeverity: Record<ReviewSeverity, number>;
  items: ReviewItem[];
  /** Plain-language overall status for the header. */
  status: 'clean' | 'review-recommended' | 'blocking';
};

export type WorkspaceImportState = {
  /** True when an in-memory roster import is currently executed (not yet exported). */
  inMemoryRosterImportActive?: boolean;
  /** True when the current workspace was restored from an imported snapshot. */
  importedWorkspace?: boolean;
};

export type BuildWorkspaceDataQualityInput = {
  teams: Team[];
  games: Game[];
  districts: District[];
  ageDivisions: AgeDivision[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  importState?: WorkspaceImportState;
};

const SEVERITY_RANK: Record<ReviewSeverity, number> = { blocker: 0, warning: 1, info: 2 };
const CATEGORY_ORDER: ReviewCategory[] = [
  'roster',
  'import',
  'schedule',
  'coach',
  'standings',
  'analytics',
  'workspace',
];

const EMPTY_CATEGORY_COUNTS = (): Record<ReviewCategory, number> => ({
  roster: 0,
  import: 0,
  schedule: 0,
  coach: 0,
  standings: 0,
  analytics: 0,
  workspace: 0,
});

function namedPlayers(players: Player[]): Player[] {
  return players.filter((p) => p.name.trim() !== '');
}

function slotKey(districtId: string, ageDivisionId: string, teamCode: string): string {
  return `${districtId}|${ageDivisionId}|${teamCode}`;
}

function seasonMovementRecords(seasonTeams: Team[]): RosterMovementRecord[] {
  const records: RosterMovementRecord[] = [];
  for (const team of seasonTeams) {
    for (const player of namedPlayers(team.players)) {
      records.push({
        player: { name: player.name },
        team: {
          seasonId: team.seasonId,
          districtId: team.districtId,
          ageDivisionId: team.ageDivisionId,
          teamCode: team.teamCode,
        },
      });
    }
  }
  return records;
}

/** Per-team y-up / z-down candidate counts (season-wide, attributed to the current team slot). */
function buildCohortCandidateCounts(
  teams: Team[],
  seasons: string[]
): Map<string, { yUp: number; zDown: number }> {
  const result = new Map<string, { yUp: number; zDown: number }>();
  const teamsBySeason = new Map<string, Team[]>();
  for (const season of seasons) teamsBySeason.set(season, teams.filter((t) => t.seasonId === season));

  for (let i = 1; i < seasons.length; i += 1) {
    const currentTeams = teamsBySeason.get(seasons[i]) ?? [];
    const priorTeams = teamsBySeason.get(seasons[i - 1]) ?? [];
    const slotToTeamId = new Map<string, string>();
    for (const team of currentTeams) {
      slotToTeamId.set(slotKey(team.districtId, team.ageDivisionId, team.teamCode), team.teamId);
    }
    const signals = detectCohortReclassificationSignals(
      seasonMovementRecords(currentTeams),
      seasonMovementRecords(priorTeams)
    );
    for (const e of signals.entries) {
      if (e.side !== 'current' || e.currentTeam === null) continue;
      const teamId = slotToTeamId.get(
        slotKey(e.currentTeam.districtId, e.currentTeam.ageDivisionId, e.currentTeam.teamCode)
      );
      if (teamId === undefined) continue;
      const bucket = result.get(teamId) ?? { yUp: 0, zDown: 0 };
      if (e.signal.status === 'y-up-candidate') bucket.yUp += 1;
      else if (e.signal.status === 'z-down-candidate') bucket.zDown += 1;
      result.set(teamId, bucket);
    }
  }
  return result;
}

function hasUsableScore(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Builds the consolidated workspace data-quality review summary. Pure; never mutates inputs.
 */
export function buildWorkspaceDataQualitySummary(
  input: BuildWorkspaceDataQualityInput
): WorkspaceDataQualitySummary {
  const { teams, games, districts, ageDivisions, coaches, coachAssignments } = input;
  const importState = input.importState ?? {};
  const items: ReviewItem[] = [];

  const teamsById = new Map(teams.map((t) => [t.teamId, t]));
  const coachesById = new Map(coaches.map((c) => [c.coachId, c]));
  const seasons = getDistinctSeasons(teams);
  const cohortCounts = buildCohortCandidateCounts(teams, seasons);
  const displayName = (team: Team): string => formatTeamDisplayName(team, districts, ageDivisions);

  const push = (item: Omit<ReviewItem, 'issueId'> & { entityKey: string }): void => {
    const { entityKey, ...rest } = item;
    items.push({ ...rest, issueId: `${rest.code}|${entityKey}` });
  };

  // ----- Per-team roster / schedule / coach signals -----
  for (const team of teams) {
    const name = displayName(team);
    const teamTarget: ReviewNavigationTarget = { kind: 'team', teamId: team.teamId };

    // Roster: no players.
    if (team.players.length === 0) {
      push({
        entityKey: team.teamId,
        code: 'team-no-players',
        severity: 'warning',
        category: 'roster',
        entityType: 'team',
        entityId: team.teamId,
        seasonId: team.seasonId,
        teamId: team.teamId,
        coachId: null,
        gameId: null,
        title: 'Team has no players',
        message: `${name} has no roster players loaded.`,
        detail: null,
        recommendedAction: 'Import this team’s roster.',
        navigationTarget: teamTarget,
      });
    }

    // Roster: duplicate identity groups.
    const duplicateGroups = findDuplicatePlayerIdentityGroups(
      namedPlayers(team.players).map((p) => ({ name: p.name }))
    );
    if (duplicateGroups.length > 0) {
      push({
        entityKey: team.teamId,
        code: 'roster-identity-duplicates',
        severity: 'warning',
        category: 'roster',
        entityType: 'team',
        entityId: team.teamId,
        seasonId: team.seasonId,
        teamId: team.teamId,
        coachId: null,
        gameId: null,
        title: 'Duplicate player identities',
        message: `${name} has ${duplicateGroups.length} duplicate-name group(s) on the roster.`,
        detail:
          'Duplicate names are kept as authoritative records; this flags them for identity review only.',
        recommendedAction: 'Review the duplicate-name players on this team.',
        navigationTarget: teamTarget,
      });
    }

    // Roster: prior-season comparison availability + movement ambiguity.
    const priorTeam = findPriorSeasonTeam(teams, team);
    const comparison = summarizeTeamPriorSeasonComparison(
      team.players,
      priorTeam ? priorTeam.players : null
    );
    if (priorTeam === null) {
      push({
        entityKey: team.teamId,
        code: 'no-prior-team',
        severity: 'info',
        category: 'roster',
        entityType: 'team',
        entityId: team.teamId,
        seasonId: team.seasonId,
        teamId: team.teamId,
        coachId: null,
        gameId: null,
        title: 'No prior-season team',
        message: `${name} has no prior-season same-slot team, so roster movement is unavailable.`,
        detail: null,
        recommendedAction: null,
        navigationTarget: teamTarget,
      });
    } else if (comparison.available) {
      if (comparison.summary.unknownCurrent > 0) {
        push({
          entityKey: team.teamId,
          code: 'roster-movement-unknown',
          severity: 'warning',
          category: 'roster',
          entityType: 'team',
          entityId: team.teamId,
          seasonId: team.seasonId,
          teamId: team.teamId,
          coachId: null,
          gameId: null,
          title: 'Ambiguous roster movement',
          message: `${name} has ${comparison.summary.unknownCurrent} current player(s) with ambiguous prior-season movement.`,
          detail: null,
          recommendedAction: 'Review ambiguous players for this team.',
          navigationTarget: teamTarget,
        });
      }
      const statuses = deriveCurrentRosterPlayerStatuses(
        team.players,
        priorTeam ? priorTeam.players : null
      );
      const reviewCount = statuses.available
        ? statuses.statuses.filter((s) => currentPlayerNeedsIdentityReview(s.derived)).length
        : 0;
      if (reviewCount > 0) {
        push({
          entityKey: team.teamId,
          code: 'roster-identity-review',
          severity: 'warning',
          category: 'roster',
          entityType: 'team',
          entityId: team.teamId,
          seasonId: team.seasonId,
          teamId: team.teamId,
          coachId: null,
          gameId: null,
          title: 'Low-confidence identity matches',
          message: `${name} has ${reviewCount} current player(s) with a low-confidence identity match.`,
          detail: null,
          recommendedAction: 'Review the low-confidence identity matches.',
          navigationTarget: teamTarget,
        });
      }
    }

    // Roster: y-up / z-down candidate signals.
    const cohort = cohortCounts.get(team.teamId);
    if (cohort && (cohort.yUp > 0 || cohort.zDown > 0)) {
      push({
        entityKey: team.teamId,
        code: 'cohort-reclassification-candidate',
        severity: 'info',
        category: 'roster',
        entityType: 'team',
        entityId: team.teamId,
        seasonId: team.seasonId,
        teamId: team.teamId,
        coachId: null,
        gameId: null,
        title: 'Cohort reclassification candidate',
        message: `${name} has ${cohort.yUp} y-up and ${cohort.zDown} z-down candidate signal(s) vs the prior season.`,
        detail: 'Candidate signals only — cohort reclassification is reviewed, never auto-applied.',
        recommendedAction: null,
        navigationTarget: teamTarget,
      });
    }

    // Schedule: no schedule / no final games.
    const schedule = summarizeTeamSchedule({
      teamId: team.teamId,
      games,
      teams,
      districts,
      ageDivisions,
    });
    if (schedule.totalGames === 0) {
      push({
        entityKey: team.teamId,
        code: 'team-no-schedule',
        severity: 'info',
        category: 'schedule',
        entityType: 'team',
        entityId: team.teamId,
        seasonId: team.seasonId,
        teamId: team.teamId,
        coachId: null,
        gameId: null,
        title: 'No schedule loaded',
        message: `${name} has no schedule or results loaded.`,
        detail: null,
        recommendedAction: 'Import a schedule for this team.',
        navigationTarget: teamTarget,
      });
    } else if (schedule.completedGames === 0) {
      push({
        entityKey: team.teamId,
        code: 'team-no-final-games',
        severity: 'info',
        category: 'schedule',
        entityType: 'team',
        entityId: team.teamId,
        seasonId: team.seasonId,
        teamId: team.teamId,
        coachId: null,
        gameId: null,
        title: 'No final results yet',
        message: `${name} has games scheduled but no final results yet.`,
        detail: null,
        recommendedAction: 'Enter results once games are final.',
        navigationTarget: teamTarget,
      });
    }

    // Coach: no coach data for the team.
    const staff = summarizeTeamCoachStaff({
      teamId: team.teamId,
      seasonId: team.seasonId,
      coaches,
      coachAssignments,
      priorSeasonTeamId: priorTeam?.teamId ?? null,
    });
    if (staff.totalAssignedCoaches === 0) {
      push({
        entityKey: team.teamId,
        code: 'team-no-coach-data',
        severity: 'info',
        category: 'coach',
        entityType: 'team',
        entityId: team.teamId,
        seasonId: team.seasonId,
        teamId: team.teamId,
        coachId: null,
        gameId: null,
        title: 'No coach data',
        message: `${name} has no coach or staff assignments loaded.`,
        detail: null,
        recommendedAction: 'Import coach data for this team.',
        navigationTarget: teamTarget,
      });
    }
  }

  // ----- Per-game schedule signals -----
  const unresolvedSchedule = validateScheduleReferences(games, teams);
  const unresolvedByGameId = new Map(unresolvedSchedule.map((u) => [u.gameId, u]));
  for (const game of games) {
    const unresolved = unresolvedByGameId.get(game.gameId);
    if (unresolved) {
      // Point to a resolvable participant if one exists.
      const resolvableTeamId = [game.homeTeamId, game.awayTeamId].find((id) => teamsById.has(id));
      push({
        entityKey: game.gameId,
        code: 'unresolved-game-reference',
        severity: 'warning',
        category: 'schedule',
        entityType: 'game',
        entityId: game.gameId,
        seasonId: game.seasonId,
        teamId: resolvableTeamId ?? null,
        coachId: null,
        gameId: game.gameId,
        title: 'Unresolved game reference',
        message: `Game ${game.gameId} references ${unresolved.missingTeamIds.length} team id(s) not in the workspace.`,
        detail: `Missing: ${unresolved.missingTeamIds.join(', ')}`,
        recommendedAction: 'Opponents must be existing teams; re-import the schedule or the missing team.',
        navigationTarget: resolvableTeamId ? { kind: 'team', teamId: resolvableTeamId } : null,
      });
    }

    // Final game with missing/invalid scores.
    if (game.status === 'final' && !(hasUsableScore(game.homeScore) && hasUsableScore(game.awayScore))) {
      const resolvableTeamId = [game.homeTeamId, game.awayTeamId].find((id) => teamsById.has(id));
      push({
        entityKey: game.gameId,
        code: 'final-game-missing-score',
        severity: 'warning',
        category: 'schedule',
        entityType: 'game',
        entityId: game.gameId,
        seasonId: game.seasonId,
        teamId: resolvableTeamId ?? null,
        coachId: null,
        gameId: game.gameId,
        title: 'Final game missing scores',
        message: `Game ${game.gameId} is marked final but is missing a usable home/away score.`,
        detail: null,
        recommendedAction: 'Enter both scores or change the game status.',
        navigationTarget: resolvableTeamId ? { kind: 'team', teamId: resolvableTeamId } : null,
      });
    }
  }

  // ----- Standings groups with no final games -----
  const groupKeys = new Set(teams.map((t) => `${t.seasonId}|${t.ageDivisionId}`));
  for (const key of groupKeys) {
    const [seasonId, ageDivisionId] = key.split('|');
    const standings = buildStandings({
      teams,
      games,
      districts,
      ageDivisions,
      seasonId,
      ageDivisionId,
    });
    if (standings.rows.length > 0 && !standings.hasFinalGames) {
      const divisionName =
        ageDivisions.find((a) => a.ageDivisionId === ageDivisionId)?.name ?? ageDivisionId;
      push({
        entityKey: key,
        code: 'standings-unavailable',
        severity: 'info',
        category: 'standings',
        entityType: 'ageDivision',
        entityId: key,
        seasonId,
        teamId: null,
        coachId: null,
        gameId: null,
        title: 'Standings provisional',
        message: `${seasonId} ${divisionName} has no final games yet, so standings are provisional.`,
        detail: null,
        recommendedAction: 'Enter results to populate standings.',
        navigationTarget: { kind: 'view', view: 'standings' },
      });
    }
  }

  // ----- Coach assignment reference issues -----
  const unresolvedAssignments = validateCoachAssignments(coachAssignments, coaches, teams);
  const assignmentById = new Map(coachAssignments.map((a) => [a.assignmentId, a]));
  for (const u of unresolvedAssignments) {
    const assignment = assignmentById.get(u.assignmentId);
    const parts: string[] = [];
    if (u.missingCoachId) parts.push('coach');
    if (u.missingTeamId) parts.push('team');
    const teamResolvable = assignment && teamsById.has(assignment.teamId);
    const coachResolvable = assignment && coachesById.has(assignment.coachId);
    const target: ReviewNavigationTarget | null = teamResolvable
      ? { kind: 'team', teamId: assignment!.teamId }
      : coachResolvable
        ? { kind: 'coach', coachId: assignment!.coachId }
        : null;
    push({
      entityKey: u.assignmentId,
      code: 'unresolved-coach-assignment',
      severity: 'warning',
      category: 'coach',
      entityType: 'coachAssignment',
      entityId: u.assignmentId,
      seasonId: assignment?.seasonId ?? null,
      teamId: assignment?.teamId ?? null,
      coachId: assignment?.coachId ?? null,
      gameId: null,
      title: 'Unresolved coach assignment',
      message: `A coach assignment references an unknown ${parts.join(' and ')}.`,
      detail: `Assignment ${u.assignmentId}`,
      recommendedAction: 'Re-import coach data so the assignment resolves.',
      navigationTarget: target,
    });
  }

  // ----- Coaches with assignments but no final-game performance -----
  for (const coach of coaches) {
    const perf = summarizeCoachPerformance({
      coachId: coach.coachId,
      coaches,
      coachAssignments,
      teams,
      games,
      districts,
      ageDivisions,
    });
    if (perf.totalAssignments > 0 && perf.overallRecord.gamesPlayed === 0) {
      push({
        entityKey: coach.coachId,
        code: 'coach-no-final-games',
        severity: 'info',
        category: 'coach',
        entityType: 'coach',
        entityId: coach.coachId,
        seasonId: null,
        teamId: null,
        coachId: coach.coachId,
        gameId: null,
        title: 'Coach has no final-game record',
        message: `${coach.displayName} has assignments but no final games to derive a performance record.`,
        detail: null,
        recommendedAction: null,
        navigationTarget: { kind: 'coach', coachId: coach.coachId },
      });
    }
  }

  // ----- Workspace-level signals -----
  for (const season of seasons) {
    const seasonTeams = teams.filter((t) => t.seasonId === season);
    const anyFinal = seasonTeams.some(
      (t) =>
        summarizeTeamSchedule({ teamId: t.teamId, games, teams, districts, ageDivisions })
          .completedGames > 0
    );
    if (seasonTeams.length < 2 || !anyFinal) {
      push({
        entityKey: season,
        code: 'sparse-season-data',
        severity: 'info',
        category: 'workspace',
        entityType: 'season',
        entityId: season,
        seasonId: season,
        teamId: null,
        coachId: null,
        gameId: null,
        title: 'Sparse season data',
        message: `Season ${season} has sparse data (fewer than 2 teams or no final games).`,
        detail: null,
        recommendedAction: null,
        navigationTarget: { kind: 'view', view: 'analytics' },
      });
    }
  }

  if (importState.inMemoryRosterImportActive === true) {
    push({
      entityKey: 'workspace',
      code: 'in-memory-import-active',
      severity: 'info',
      category: 'import',
      entityType: 'workspace',
      entityId: null,
      seasonId: null,
      teamId: null,
      coachId: null,
      gameId: null,
      title: 'In-memory import active',
      message: 'An in-memory roster import is active and has not been exported to a snapshot.',
      detail: null,
      recommendedAction: 'Export a workspace snapshot to keep these changes.',
      navigationTarget: null,
    });
  }

  if (importState.importedWorkspace === true) {
    push({
      entityKey: 'workspace',
      code: 'imported-workspace-only',
      severity: 'info',
      category: 'workspace',
      entityType: 'workspace',
      entityId: null,
      seasonId: null,
      teamId: null,
      coachId: null,
      gameId: null,
      title: 'Imported workspace',
      message: 'This workspace was restored from an imported snapshot.',
      detail: 'Snapshots are the only durability path — export again to keep further changes.',
      recommendedAction: 'Export a workspace snapshot to keep further changes.',
      navigationTarget: null,
    });
  }

  // ----- Deterministic ordering -----
  const teamDisplay = (teamId: string | null): string =>
    teamId && teamsById.has(teamId) ? displayName(teamsById.get(teamId)!) : '';
  items.sort((a, b) => {
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (a.category !== b.category)
      return CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    // Season descending (nulls last).
    const sa = a.seasonId ?? '';
    const sb = b.seasonId ?? '';
    if (sa !== sb) {
      if (sa === '') return 1;
      if (sb === '') return -1;
      return sa < sb ? 1 : -1;
    }
    const ta = teamDisplay(a.teamId);
    const tb = teamDisplay(b.teamId);
    if (ta !== tb) {
      if (ta === '') return 1;
      if (tb === '') return -1;
      return ta < tb ? -1 : 1;
    }
    if (a.code !== b.code) return a.code < b.code ? -1 : 1;
    return a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0;
  });

  const byCategory = EMPTY_CATEGORY_COUNTS();
  const bySeverity: Record<ReviewSeverity, number> = { blocker: 0, warning: 0, info: 0 };
  for (const item of items) {
    byCategory[item.category] += 1;
    bySeverity[item.severity] += 1;
  }
  const counts: ReviewSeverityCounts = {
    total: items.length,
    blocker: bySeverity.blocker,
    warning: bySeverity.warning,
    info: bySeverity.info,
  };
  const status: WorkspaceDataQualitySummary['status'] =
    counts.blocker > 0 ? 'blocking' : counts.warning > 0 ? 'review-recommended' : 'clean';

  return { counts, byCategory, bySeverity, items, status };
}
