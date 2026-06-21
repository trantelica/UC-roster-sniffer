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
  type ContextRecord,
} from './teamScheduleSummary';
import { buildStandings, type StandingsRow } from './standingsSummary';
import { summarizeTeamPriorSeasonComparison } from './priorSeasonRosterComparisonSummary';
import { findPriorSeasonTeam } from './teamRosterStatusSummary';
import { summarizeTeamCoachStaff, validateCoachAssignments } from './coachHistorySummary';
import {
  detectCohortReclassificationSignals,
  type RosterMovementRecord,
} from './cohortReclassificationSignal';
import { findDuplicatePlayerIdentityGroups } from './playerDuplicateDetection';

/**
 * Phase 9 slice 30: PURE, deterministic MULTI-YEAR ANALYTICS — ENGINE ONLY.
 *
 * Derives season-over-season trends (team / district / age-division / coach) plus an aggregate
 * attention summary by composing the existing deterministic helpers. It is READ-ONLY and
 * recomputes everything at runtime from existing workspace data; it does NOT duplicate or fork
 * authoritative roster/team/game/coach data, and it never mutates inputs.
 *
 * Standings ranks are always computed within the true (season, age-division) group via
 * buildStandings — filters only decide which rows are DISPLAYED, never how ranks are computed.
 * Values that cannot be derived (no prior-season same-slot team, no final games) are returned as
 * null/unavailable, never fabricated zeros.
 */

export const MULTI_YEAR_ANALYTICS_LOGIC_VERSION = 'phase9-slice30-multi-year-analytics-v1';

// ---------------------------------------------------------------------------
// Shared record helpers
// ---------------------------------------------------------------------------

export type TrendRecord = ContextRecord & { winPercentage: number };

function emptyContext(): ContextRecord {
  return { wins: 0, losses: 0, ties: 0, gamesPlayed: 0, pointsFor: 0, pointsAgainst: 0, pointDifferential: 0 };
}

function addContext(into: ContextRecord, from: ContextRecord): void {
  into.wins += from.wins;
  into.losses += from.losses;
  into.ties += from.ties;
  into.gamesPlayed += from.gamesPlayed;
  into.pointsFor += from.pointsFor;
  into.pointsAgainst += from.pointsAgainst;
  into.pointDifferential = into.pointsFor - into.pointsAgainst;
}

function winPct(wins: number, ties: number, gamesPlayed: number): number {
  if (gamesPlayed === 0) return 0;
  return (wins + 0.5 * ties) / gamesPlayed;
}

function toTrendRecord(record: ContextRecord): TrendRecord {
  return { ...record, winPercentage: winPct(record.wins, record.ties, record.gamesPlayed) };
}

function namedPlayers(players: Player[]): Player[] {
  return players.filter((p) => p.name.trim() !== '');
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export type SeasonCoverageSummary = {
  seasons: string[];
  firstSeason: string | null;
  latestSeason: string | null;
  seasonCount: number;
  districtCount: number;
  teamCount: number;
  playerCount: number;
  gameCount: number;
  finalGameCount: number;
  coachCount: number;
};

export type AnalyticsFilterOptions = {
  seasons: string[];
  districts: { id: string; name: string }[];
  ageDivisions: { id: string; name: string }[];
  teams: { id: string; name: string; seasonId: string }[];
  coaches: { id: string; name: string }[];
};

export type TeamTrendRow = {
  teamId: string;
  seasonId: string;
  districtId: string;
  districtName: string;
  ageDivisionId: string;
  ageDivisionName: string;
  teamCode: string;
  displayName: string;
  playerCount: number;
  priorComparisonAvailable: boolean;
  returningCount: number | null;
  newCount: number | null;
  notReturningCount: number | null;
  unknownMovementCount: number | null;
  rosterRetentionRate: number | null;
  /** Season-wide cohort reclassification candidate counts; null when there is no prior season. */
  yUpCount: number | null;
  zDownCount: number | null;
  record: TrendRecord;
  pointDifferential: number;
  standingsRank: number | null;
  standingsTotalTeams: number;
  headCoachNames: string[];
  coachContinuityAvailable: boolean;
  coachContinuityReturning: number | null;
};

export type TrendSeasonCell = {
  seasonId: string;
  teamCount: number;
  playerCount: number;
  finalGameCount: number;
};

export type DistrictTrendRow = {
  districtId: string;
  districtName: string;
  seasonsRepresented: string[];
  perSeason: TrendSeasonCell[];
  teamCount: number;
  playerCount: number;
  aggregateRecord: TrendRecord;
  aggregatePointDifferential: number;
};

export type AgeDivisionTrendRow = {
  ageDivisionId: string;
  ageDivisionName: string;
  seasonsRepresented: string[];
  perSeason: TrendSeasonCell[];
  teamCount: number;
  playerCount: number;
  averagePlayersPerTeam: number | null;
  aggregateRecord: TrendRecord;
};

export type CoachTrendSeasonCell = {
  seasonId: string;
  teamIds: string[];
  overallRecord: TrendRecord;
  playoffRecord: ContextRecord;
  championshipRecord: ContextRecord;
};

export type CoachTrendRow = {
  coachId: string;
  displayName: string;
  available: boolean;
  seasonsActive: string[];
  totalAssignments: number;
  perSeason: CoachTrendSeasonCell[];
  careerRecord: TrendRecord;
  careerPlayoffRecord: ContextRecord;
  careerChampionshipRecord: ContextRecord;
  latestAssignment: { seasonId: string; teamId: string; teamDisplayName: string; role: string } | null;
};

export type AnalyticsAttentionSeverity = 'info' | 'warning' | 'blocker';

export type AnalyticsAttentionCode =
  | 'missing-prior-team-comparison'
  | 'roster-identity-ambiguity'
  | 'unresolved-schedule-reference'
  | 'unresolved-coach-reference'
  | 'teams-without-schedule'
  | 'teams-without-coach-data'
  | 'sparse-season-data';

export type AnalyticsAttentionItem = {
  code: AnalyticsAttentionCode;
  severity: AnalyticsAttentionSeverity;
  count: number;
  message: string;
};

export type MultiYearAnalyticsSummary = {
  coverage: SeasonCoverageSummary;
  filterOptions: AnalyticsFilterOptions;
  teamTrends: TeamTrendRow[];
  districtTrends: DistrictTrendRow[];
  ageDivisionTrends: AgeDivisionTrendRow[];
  coachTrends: CoachTrendRow[];
  attention: AnalyticsAttentionItem[];
};

export type MultiYearAnalyticsFilters = {
  /** Subset of seasons to include; null/undefined = all seasons. */
  seasons?: string[] | null;
  districtId?: string | null;
  ageDivisionId?: string | null;
  teamId?: string | null;
  coachId?: string | null;
};

export type BuildMultiYearAnalyticsInput = {
  teams: Team[];
  games: Game[];
  districts: District[];
  ageDivisions: AgeDivision[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  filters?: MultiYearAnalyticsFilters;
};

// ---------------------------------------------------------------------------
// Cohort reclassification (y-up / z-down) candidate counts per team
// ---------------------------------------------------------------------------

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

/**
 * Builds per-team y-up / z-down candidate counts for every season that has a prior season.
 * y-up/z-down is a season-wide, cross-division event, so it is computed once per
 * (season vs prior season) over all players, then attributed to the player's CURRENT team slot.
 * Teams in the earliest season have no prior season and are absent from the map (→ null counts).
 */
function buildCohortCandidateCounts(
  teams: Team[],
  seasons: string[]
): Map<string, { yUp: number; zDown: number }> {
  const result = new Map<string, { yUp: number; zDown: number }>();
  const teamsBySeason = new Map<string, Team[]>();
  for (const season of seasons) {
    teamsBySeason.set(season, teams.filter((t) => t.seasonId === season));
  }

  for (let i = 1; i < seasons.length; i += 1) {
    const season = seasons[i];
    const priorSeason = seasons[i - 1];
    const currentTeams = teamsBySeason.get(season) ?? [];
    const priorTeams = teamsBySeason.get(priorSeason) ?? [];

    // Map current-season slot -> teamId so candidate entries can be attributed back to a team.
    const slotToTeamId = new Map<string, string>();
    for (const team of currentTeams) {
      slotToTeamId.set(slotKey(team.districtId, team.ageDivisionId, team.teamCode), team.teamId);
      // Ensure every current team has a zeroed entry so "0 candidates" is distinct from "null".
      result.set(team.teamId, { yUp: 0, zDown: 0 });
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
      const bucket = result.get(teamId)!;
      if (e.signal.status === 'y-up-candidate') bucket.yUp += 1;
      else if (e.signal.status === 'z-down-candidate') bucket.zDown += 1;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildMultiYearAnalyticsSummary(
  input: BuildMultiYearAnalyticsInput
): MultiYearAnalyticsSummary {
  const { teams, games, districts, ageDivisions, coaches, coachAssignments } = input;
  const filters = input.filters ?? {};

  const allSeasons = getDistinctSeasons(teams);
  const districtsById = new Map(districts.map((d) => [d.districtId, d]));
  const ageDivisionsById = new Map(ageDivisions.map((a) => [a.ageDivisionId, a]));
  const districtName = (id: string): string => districtsById.get(id)?.name ?? id;
  const ageDivisionName = (id: string): string => ageDivisionsById.get(id)?.name ?? id;

  // --- Filter options (always from the FULL workspace, so the user can widen the scope) ---
  const filterOptions: AnalyticsFilterOptions = {
    seasons: allSeasons,
    districts: distinctById(
      teams.map((t) => ({ id: t.districtId, name: districtName(t.districtId) }))
    ),
    ageDivisions: distinctById(
      teams.map((t) => ({ id: t.ageDivisionId, name: ageDivisionName(t.ageDivisionId) }))
    ),
    teams: teams
      .map((t) => ({
        id: t.teamId,
        name: formatTeamDisplayName(t, districts, ageDivisions),
        seasonId: t.seasonId,
      }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    coaches: coaches
      .map((c) => ({ id: c.coachId, name: c.displayName }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1)),
  };

  // --- Scope: season + district + age-division filters (not team/coach) drive the dashboard ---
  const seasonFilter = filters.seasons && filters.seasons.length > 0 ? new Set(filters.seasons) : null;
  const scopeTeams = teams.filter((t) => {
    if (seasonFilter && !seasonFilter.has(t.seasonId)) return false;
    if (filters.districtId && t.districtId !== filters.districtId) return false;
    if (filters.ageDivisionId && t.ageDivisionId !== filters.ageDivisionId) return false;
    return true;
  });
  const scopeTeamIds = new Set(scopeTeams.map((t) => t.teamId));

  // --- Caches for per-team schedule records and per-group standings ---
  const scheduleCache = new Map<string, ReturnType<typeof summarizeTeamSchedule>>();
  const scheduleFor = (team: Team): ReturnType<typeof summarizeTeamSchedule> => {
    const cached = scheduleCache.get(team.teamId);
    if (cached) return cached;
    const summary = summarizeTeamSchedule({ teamId: team.teamId, games, teams, districts, ageDivisions });
    scheduleCache.set(team.teamId, summary);
    return summary;
  };
  const standingsCache = new Map<string, Map<string, StandingsRow>>();
  const standingsGroupMeta = new Map<string, { totalTeams: number; hasFinalGames: boolean }>();
  const standingsRowFor = (team: Team): { row: StandingsRow | null; totalTeams: number; hasFinalGames: boolean } => {
    const key = `${team.seasonId}|${team.ageDivisionId}`;
    let group = standingsCache.get(key);
    if (!group) {
      const result = buildStandings({
        teams, games, districts, ageDivisions,
        seasonId: team.seasonId, ageDivisionId: team.ageDivisionId,
      });
      group = new Map(result.rows.map((r) => [r.teamId, r]));
      standingsCache.set(key, group);
      standingsGroupMeta.set(key, { totalTeams: result.rows.length, hasFinalGames: result.hasFinalGames });
    }
    const meta = standingsGroupMeta.get(key)!;
    return { row: group.get(team.teamId) ?? null, totalTeams: meta.totalTeams, hasFinalGames: meta.hasFinalGames };
  };

  const cohortCounts = buildCohortCandidateCounts(teams, allSeasons);

  // --- Coverage (reflects the season/district/age-division scope) ---
  const coverageSeasons = getDistinctSeasons(scopeTeams);
  const scopeGames = games.filter(
    (g) => scopeTeamIds.has(g.homeTeamId) || scopeTeamIds.has(g.awayTeamId)
  );
  const coverage: SeasonCoverageSummary = {
    seasons: coverageSeasons,
    firstSeason: coverageSeasons[0] ?? null,
    latestSeason: coverageSeasons.length > 0 ? coverageSeasons[coverageSeasons.length - 1] : null,
    seasonCount: coverageSeasons.length,
    districtCount: new Set(scopeTeams.map((t) => t.districtId)).size,
    teamCount: scopeTeams.length,
    playerCount: scopeTeams.reduce((sum, t) => sum + t.players.length, 0),
    gameCount: scopeGames.length,
    finalGameCount: scopeGames.filter((g) => g.status === 'final').length,
    coachCount: new Set(
      coachAssignments.filter((a) => scopeTeamIds.has(a.teamId)).map((a) => a.coachId)
    ).size,
  };

  // --- Team trends ---
  const teamTrendTeams = scopeTeams.filter((t) => !filters.teamId || t.teamId === filters.teamId);
  const teamTrends: TeamTrendRow[] = teamTrendTeams
    .map((team): TeamTrendRow => {
      const priorTeam = findPriorSeasonTeam(teams, team);
      const comparison = summarizeTeamPriorSeasonComparison(
        team.players,
        priorTeam ? priorTeam.players : null
      );
      const schedule = scheduleFor(team);
      const standing = standingsRowFor(team);
      const staff = summarizeTeamCoachStaff({
        teamId: team.teamId,
        seasonId: team.seasonId,
        coaches,
        coachAssignments,
        priorSeasonTeamId: priorTeam?.teamId ?? null,
      });
      const cohort = cohortCounts.get(team.teamId) ?? null;

      let returningCount: number | null = null;
      let newCount: number | null = null;
      let notReturningCount: number | null = null;
      let unknownMovementCount: number | null = null;
      let rosterRetentionRate: number | null = null;
      if (comparison.available) {
        returningCount = comparison.summary.returning;
        newCount = comparison.summary.newToRoster;
        notReturningCount = comparison.summary.notReturning;
        unknownMovementCount = comparison.summary.unknownCurrent;
        rosterRetentionRate =
          comparison.summary.totalPrior > 0
            ? comparison.summary.returning / comparison.summary.totalPrior
            : null;
      }

      return {
        teamId: team.teamId,
        seasonId: team.seasonId,
        districtId: team.districtId,
        districtName: districtName(team.districtId),
        ageDivisionId: team.ageDivisionId,
        ageDivisionName: ageDivisionName(team.ageDivisionId),
        teamCode: team.teamCode,
        displayName: formatTeamDisplayName(team, districts, ageDivisions),
        playerCount: team.players.length,
        priorComparisonAvailable: comparison.available,
        returningCount,
        newCount,
        notReturningCount,
        unknownMovementCount,
        rosterRetentionRate,
        yUpCount: cohort ? cohort.yUp : null,
        zDownCount: cohort ? cohort.zDown : null,
        record: toTrendRecord(schedule.overallRecord),
        pointDifferential: schedule.overallRecord.pointDifferential,
        standingsRank: standing.hasFinalGames && standing.row ? standing.row.rank : null,
        standingsTotalTeams: standing.totalTeams,
        headCoachNames: staff.headCoaches.map((m) => m.displayName),
        coachContinuityAvailable: staff.continuity.available,
        coachContinuityReturning: staff.continuity.available
          ? staff.continuity.returningCoaches
          : null,
      };
    })
    .sort(compareTeamTrend);

  // --- District trends ---
  const districtTrends = buildGroupTrends(
    scopeTeams,
    (t) => t.districtId,
    (id) => districtName(id),
    scheduleFor
  ).map(
    (g): DistrictTrendRow => ({
      districtId: g.id,
      districtName: g.name,
      seasonsRepresented: g.seasonsRepresented,
      perSeason: g.perSeason,
      teamCount: g.teamCount,
      playerCount: g.playerCount,
      aggregateRecord: toTrendRecord(g.aggregate),
      aggregatePointDifferential: g.aggregate.pointDifferential,
    })
  );

  // --- Age-division trends ---
  const ageDivisionTrends = buildGroupTrends(
    scopeTeams,
    (t) => t.ageDivisionId,
    (id) => ageDivisionName(id),
    scheduleFor
  ).map(
    (g): AgeDivisionTrendRow => ({
      ageDivisionId: g.id,
      ageDivisionName: g.name,
      seasonsRepresented: g.seasonsRepresented,
      perSeason: g.perSeason,
      teamCount: g.teamCount,
      playerCount: g.playerCount,
      averagePlayersPerTeam: g.teamCount > 0 ? g.playerCount / g.teamCount : null,
      aggregateRecord: toTrendRecord(g.aggregate),
    })
  );

  // --- Coach trends ---
  const coachTrends = buildCoachTrends({
    coaches,
    coachAssignments,
    teams,
    districts,
    ageDivisions,
    scopeTeamIds,
    coachIdFilter: filters.coachId ?? null,
    scheduleFor,
  });

  // --- Attention summary ---
  const attention = buildAttention({
    scopeTeams,
    scheduleFor,
    coachAssignments,
    coaches,
    teams,
    coverageSeasons,
  });

  return {
    coverage,
    filterOptions,
    teamTrends,
    districtTrends,
    ageDivisionTrends,
    coachTrends,
    attention,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function distinctById(items: { id: string; name: string }[]): { id: string; name: string }[] {
  const byId = new Map<string, { id: string; name: string }>();
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return [...byId.values()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}

function compareTeamTrend(a: TeamTrendRow, b: TeamTrendRow): number {
  if (a.seasonId !== b.seasonId) return a.seasonId < b.seasonId ? -1 : 1;
  if (a.districtName !== b.districtName) return a.districtName < b.districtName ? -1 : 1;
  if (a.ageDivisionId !== b.ageDivisionId) return a.ageDivisionId < b.ageDivisionId ? -1 : 1;
  if (a.teamCode !== b.teamCode) return a.teamCode < b.teamCode ? -1 : 1;
  return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
}

type GroupTrend = {
  id: string;
  name: string;
  seasonsRepresented: string[];
  perSeason: TrendSeasonCell[];
  teamCount: number;
  playerCount: number;
  aggregate: ContextRecord;
};

function buildGroupTrends(
  scopeTeams: Team[],
  keyOf: (t: Team) => string,
  nameOf: (id: string) => string,
  scheduleFor: (t: Team) => ReturnType<typeof summarizeTeamSchedule>
): GroupTrend[] {
  const groups = new Map<string, Team[]>();
  for (const team of scopeTeams) {
    const key = keyOf(team);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(team);
  }

  const rows: GroupTrend[] = [];
  for (const [id, groupTeams] of groups) {
    const seasonsRepresented = getDistinctSeasons(groupTeams);
    const perSeason: TrendSeasonCell[] = seasonsRepresented.map((seasonId) => {
      const seasonTeams = groupTeams.filter((t) => t.seasonId === seasonId);
      let finalGameCount = 0;
      for (const t of seasonTeams) finalGameCount += scheduleFor(t).completedGames;
      return {
        seasonId,
        teamCount: seasonTeams.length,
        playerCount: seasonTeams.reduce((sum, t) => sum + t.players.length, 0),
        finalGameCount,
      };
    });
    const aggregate = emptyContext();
    for (const t of groupTeams) addContext(aggregate, scheduleFor(t).overallRecord);
    rows.push({
      id,
      name: nameOf(id),
      seasonsRepresented,
      perSeason,
      teamCount: groupTeams.length,
      playerCount: groupTeams.reduce((sum, t) => sum + t.players.length, 0),
      aggregate,
    });
  }

  return rows.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
}

const ROLE_ORDER: Record<string, number> = { headCoach: 0, assistantCoach: 1, unknown: 2 };

function buildCoachTrends(args: {
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
  scopeTeamIds: Set<string>;
  coachIdFilter: string | null;
  scheduleFor: (t: Team) => ReturnType<typeof summarizeTeamSchedule>;
}): CoachTrendRow[] {
  const { coaches, coachAssignments, teams, districts, ageDivisions, scopeTeamIds, coachIdFilter, scheduleFor } = args;
  const teamsById = new Map(teams.map((t) => [t.teamId, t]));
  const coachesById = new Map(coaches.map((c) => [c.coachId, c]));

  // A coach is in scope if any of their assignments target a scope team.
  const inScope = (coachId: string): boolean =>
    coachAssignments.some((a) => a.coachId === coachId && scopeTeamIds.has(a.teamId));

  const coachIds = coaches
    .map((c) => c.coachId)
    .filter((id) => (coachIdFilter ? id === coachIdFilter : inScope(id)));

  const rows: CoachTrendRow[] = coachIds.map((coachId): CoachTrendRow => {
    const coach = coachesById.get(coachId) ?? null;
    const myAssignments = coachAssignments.filter((a) => a.coachId === coachId);
    const seasonsActive = [...new Set(myAssignments.map((a) => a.seasonId))].sort();

    const perSeason: CoachTrendSeasonCell[] = seasonsActive.map((seasonId): CoachTrendSeasonCell => {
      const teamIds = [
        ...new Set(
          myAssignments
            .filter((a) => a.seasonId === seasonId && teamsById.has(a.teamId))
            .map((a) => a.teamId)
        ),
      ].sort();
      const overall = emptyContext();
      const playoff = emptyContext();
      const championship = emptyContext();
      for (const teamId of teamIds) {
        const schedule = scheduleFor(teamsById.get(teamId)!);
        addContext(overall, schedule.overallRecord);
        addContext(playoff, schedule.playoffRecord);
        addContext(championship, schedule.championshipRecord);
      }
      return {
        seasonId,
        teamIds,
        overallRecord: toTrendRecord(overall),
        playoffRecord: playoff,
        championshipRecord: championship,
      };
    });

    const career = emptyContext();
    const careerPlayoff = emptyContext();
    const careerChampionship = emptyContext();
    for (const cell of perSeason) {
      addContext(career, cell.overallRecord);
      addContext(careerPlayoff, cell.playoffRecord);
      addContext(careerChampionship, cell.championshipRecord);
    }

    const latest = [...myAssignments].sort((a, b) => {
      if (a.seasonId !== b.seasonId) return a.seasonId < b.seasonId ? -1 : 1;
      if (a.teamId !== b.teamId) return a.teamId < b.teamId ? -1 : 1;
      if (a.role !== b.role) return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      return a.assignmentId < b.assignmentId ? -1 : 1;
    });
    const latestAssignment =
      latest.length > 0
        ? (() => {
            const a = latest[latest.length - 1];
            const t = teamsById.get(a.teamId) ?? null;
            return {
              seasonId: a.seasonId,
              teamId: a.teamId,
              teamDisplayName: t ? formatTeamDisplayName(t, districts, ageDivisions) : a.teamId,
              role: a.role,
            };
          })()
        : null;

    return {
      coachId,
      displayName: coach ? coach.displayName : coachId,
      available: coach !== null,
      seasonsActive,
      totalAssignments: myAssignments.length,
      perSeason,
      careerRecord: toTrendRecord(career),
      careerPlayoffRecord: careerPlayoff,
      careerChampionshipRecord: careerChampionship,
      latestAssignment,
    };
  });

  return rows.sort((a, b) =>
    a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : a.coachId < b.coachId ? -1 : 1
  );
}

const ATTENTION_SEVERITY_RANK: Record<AnalyticsAttentionSeverity, number> = {
  blocker: 0,
  warning: 1,
  info: 2,
};

const ATTENTION_CODE_ORDER: AnalyticsAttentionCode[] = [
  'roster-identity-ambiguity',
  'unresolved-schedule-reference',
  'unresolved-coach-reference',
  'missing-prior-team-comparison',
  'teams-without-schedule',
  'teams-without-coach-data',
  'sparse-season-data',
];

function buildAttention(args: {
  scopeTeams: Team[];
  scheduleFor: (t: Team) => ReturnType<typeof summarizeTeamSchedule>;
  coachAssignments: TeamCoachAssignment[];
  coaches: StaffCoach[];
  teams: Team[];
  coverageSeasons: string[];
}): AnalyticsAttentionItem[] {
  const { scopeTeams, scheduleFor, coachAssignments, coaches, teams, coverageSeasons } = args;
  const scopeTeamIds = new Set(scopeTeams.map((t) => t.teamId));
  const items: AnalyticsAttentionItem[] = [];

  const missingPrior = scopeTeams.filter((t) => findPriorSeasonTeam(teams, t) === null).length;
  if (missingPrior > 0) {
    items.push({
      code: 'missing-prior-team-comparison',
      severity: 'info',
      count: missingPrior,
      message: `${missingPrior} team(s) have no prior-season same-slot team, so roster movement is unavailable.`,
    });
  }

  const ambiguousTeams = scopeTeams.filter((t) => {
    const duplicates = findDuplicatePlayerIdentityGroups(
      namedPlayers(t.players).map((p) => ({ name: p.name }))
    ).length;
    const priorTeam = findPriorSeasonTeam(teams, t);
    const comparison = summarizeTeamPriorSeasonComparison(
      t.players,
      priorTeam ? priorTeam.players : null
    );
    const unknown = comparison.available ? comparison.summary.unknownCurrent : 0;
    return duplicates > 0 || unknown > 0;
  }).length;
  if (ambiguousTeams > 0) {
    items.push({
      code: 'roster-identity-ambiguity',
      severity: 'warning',
      count: ambiguousTeams,
      message: `${ambiguousTeams} team(s) have roster identity ambiguity (duplicate names or ambiguous movement).`,
    });
  }

  let unresolvedScheduleRefs = 0;
  for (const t of scopeTeams) {
    unresolvedScheduleRefs += scheduleFor(t).games.filter(
      (g) => g.status === 'final' && g.unresolvedReference
    ).length;
  }
  if (unresolvedScheduleRefs > 0) {
    items.push({
      code: 'unresolved-schedule-reference',
      severity: 'warning',
      count: unresolvedScheduleRefs,
      message: `${unresolvedScheduleRefs} final game(s) reference an unresolved opponent team.`,
    });
  }

  const unresolvedCoachRefs = validateCoachAssignments(
    coachAssignments.filter((a) => scopeTeamIds.has(a.teamId)),
    coaches,
    teams
  ).filter((u) => u.missingCoachId).length;
  if (unresolvedCoachRefs > 0) {
    items.push({
      code: 'unresolved-coach-reference',
      severity: 'warning',
      count: unresolvedCoachRefs,
      message: `${unresolvedCoachRefs} coach assignment(s) reference a coach not in the workspace.`,
    });
  }

  const noSchedule = scopeTeams.filter((t) => scheduleFor(t).totalGames === 0).length;
  if (noSchedule > 0) {
    items.push({
      code: 'teams-without-schedule',
      severity: 'info',
      count: noSchedule,
      message: `${noSchedule} team(s) have no schedule or results loaded.`,
    });
  }

  const assignedTeamIds = new Set(coachAssignments.map((a) => a.teamId));
  const noCoach = scopeTeams.filter((t) => !assignedTeamIds.has(t.teamId)).length;
  if (noCoach > 0) {
    items.push({
      code: 'teams-without-coach-data',
      severity: 'info',
      count: noCoach,
      message: `${noCoach} team(s) have no coach or staff assignments.`,
    });
  }

  // A season is "sparse" when it has fewer than 2 teams or no final games in scope.
  const sparseSeasons = coverageSeasons.filter((season) => {
    const seasonTeams = scopeTeams.filter((t) => t.seasonId === season);
    if (seasonTeams.length < 2) return true;
    const anyFinal = seasonTeams.some((t) => scheduleFor(t).completedGames > 0);
    return !anyFinal;
  }).length;
  if (sparseSeasons > 0) {
    items.push({
      code: 'sparse-season-data',
      severity: 'info',
      count: sparseSeasons,
      message: `${sparseSeasons} season(s) in scope have sparse data (few teams or no final games).`,
    });
  }

  return items.sort((a, b) => {
    if (a.severity !== b.severity)
      return ATTENTION_SEVERITY_RANK[a.severity] - ATTENTION_SEVERITY_RANK[b.severity];
    return ATTENTION_CODE_ORDER.indexOf(a.code) - ATTENTION_CODE_ORDER.indexOf(b.code);
  });
}
