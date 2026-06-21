import type {
  AgeDivision,
  District,
  Game,
  Player,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import {
  summarizeTeamSchedule,
  formatTeamDisplayName,
  type ContextRecord,
  type TeamScheduleGameView,
} from './teamScheduleSummary';
import { buildStandings } from './standingsSummary';
import {
  summarizeTeamCoachStaff,
  type TeamCoachStaffMember,
  type TeamCoachContinuity,
} from './coachHistorySummary';
import { findPriorSeasonTeam } from './teamRosterStatusSummary';
import {
  summarizeTeamCoachPerformance,
  type CoachPerformanceRecord,
  type TeamCoachPerformanceMember,
} from './coachPerformanceSummary';
import { summarizeTeamPriorSeasonComparison } from './priorSeasonRosterComparisonSummary';
import {
  deriveCurrentRosterPlayerStatuses,
  currentPlayerNeedsIdentityReview,
} from './currentRosterPlayerStatus';
import { findDuplicatePlayerIdentityGroups } from './playerDuplicateDetection';

/**
 * Phase 8 slice 29: PURE, deterministic MY TEAM command-center summary — ENGINE ONLY.
 *
 * Consolidates one selected team's intelligence (identity, roster movement, schedule/results,
 * standings position, coach/staff intelligence, and attention items) by composing the existing
 * deterministic helpers. It is READ-ONLY and derives everything at runtime from existing
 * workspace data; it does NOT duplicate or fork authoritative roster/team/game/coach data, and
 * it never mutates inputs.
 *
 * The prior-season same-slot lookup reuses `findPriorSeasonTeam` from teamRosterStatusSummary so
 * the roster comparison and coach continuity share one definition of "prior team".
 */

export const MY_TEAM_SUMMARY_LOGIC_VERSION = 'phase8-slice29-my-team-summary-v1';

function winPct(wins: number, ties: number, gamesPlayed: number): number {
  if (gamesPlayed === 0) return 0;
  return (wins + 0.5 * ties) / gamesPlayed;
}

function toPerformanceRecord(record: ContextRecord): CoachPerformanceRecord {
  return { ...record, winPercentage: winPct(record.wins, record.ties, record.gamesPlayed) };
}

// ---------------------------------------------------------------------------
// Attention items
// ---------------------------------------------------------------------------

export type AttentionSeverity = 'info' | 'warning' | 'blocker';

export type AttentionItemCode =
  | 'no-prior-team'
  | 'roster-identity-duplicates'
  | 'roster-movement-unknown'
  | 'roster-identity-review'
  | 'unresolved-schedule-reference'
  | 'no-schedule-loaded'
  | 'no-final-games'
  | 'standings-unavailable'
  | 'no-coach-data'
  | 'unresolved-coach-reference'
  | 'imported-workspace-only';

export type MyTeamAttentionItem = {
  code: AttentionItemCode;
  severity: AttentionSeverity;
  message: string;
};

const SEVERITY_RANK: Record<AttentionSeverity, number> = { blocker: 0, warning: 1, info: 2 };

// Stable secondary ordering within a severity, so attention items are fully deterministic.
const CODE_ORDER: AttentionItemCode[] = [
  'roster-identity-duplicates',
  'roster-movement-unknown',
  'roster-identity-review',
  'unresolved-schedule-reference',
  'unresolved-coach-reference',
  'no-prior-team',
  'no-schedule-loaded',
  'no-final-games',
  'standings-unavailable',
  'no-coach-data',
  'imported-workspace-only',
];

function sortAttentionItems(items: MyTeamAttentionItem[]): MyTeamAttentionItem[] {
  return items.slice().sort((a, b) => {
    if (a.severity !== b.severity) return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    return CODE_ORDER.indexOf(a.code) - CODE_ORDER.indexOf(b.code);
  });
}

// ---------------------------------------------------------------------------
// Summary shapes
// ---------------------------------------------------------------------------

export type MyTeamIdentity = {
  teamId: string;
  seasonId: string;
  districtId: string;
  districtName: string;
  ageDivisionId: string;
  ageDivisionName: string;
  teamCode: string;
  displayName: string;
  mascot: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
};

export type MyTeamRosterPriorComparison =
  | { available: false; reason: 'no-prior-season' }
  | {
      available: true;
      returning: number;
      newToRoster: number;
      notReturning: number;
      unknownCurrent: number;
      unknownPrior: number;
      highConfidence: number;
      lowConfidence: number;
      /** Current players whose derived identity match is low-confidence (needs review). */
      identityReviewCount: number;
    };

export type MyTeamRosterSummary = {
  totalPlayers: number;
  /** Distinct duplicate-identity groups within the current roster (each group ≥ 2 players). */
  duplicateGroupCount: number;
  priorSeasonComparison: MyTeamRosterPriorComparison;
};

export type MyTeamScheduleSummary = {
  totalGames: number;
  completedGames: number;
  upcomingGames: number;
  cancelledGames: number;
  overallRecord: ContextRecord;
  regularSeasonRecord: ContextRecord;
  playoffRecord: ContextRecord;
  championshipRecord: ContextRecord;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  winPercentage: number;
  nextGame: TeamScheduleGameView | null;
  lastGame: TeamScheduleGameView | null;
  unresolvedScheduleReferenceCount: number;
};

export type MyTeamStandingsSummary = {
  available: boolean;
  rank: number | null;
  totalTeams: number;
  winPercentage: number;
  pointDifferential: number;
  hasFinalGames: boolean;
};

export type MyTeamCoachSummary = {
  totalAssignedCoaches: number;
  headCoaches: TeamCoachStaffMember[];
  assistantCoaches: TeamCoachStaffMember[];
  unknownRoleCoaches: TeamCoachStaffMember[];
  continuity: TeamCoachContinuity;
  /** Record earned WITH THIS TEAM (this team's final games — equals the team record). */
  withTeamRecord: CoachPerformanceRecord;
  /** Per assigned coach: with-this-team and career records. */
  members: TeamCoachPerformanceMember[];
  unresolvedCoachReferences: number;
  unresolvedGameReferenceCount: number;
};

export type MyTeamSummary = {
  identity: MyTeamIdentity;
  roster: MyTeamRosterSummary;
  schedule: MyTeamScheduleSummary;
  standings: MyTeamStandingsSummary;
  coaches: MyTeamCoachSummary;
  attentionItems: MyTeamAttentionItem[];
};

export type BuildMyTeamSummaryInput = {
  teamId: string;
  teams: Team[];
  games: Game[];
  districts: District[];
  ageDivisions: AgeDivision[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  /** True when the current workspace was restored from an imported snapshot (durability cue). */
  importedWorkspace?: boolean;
};

function nonEmptyNamedPlayers(players: Player[]): Player[] {
  return players.filter((p) => p.name.trim() !== '');
}

/**
 * Builds the consolidated My Team summary for a selected team. Pure; never mutates inputs.
 * Returns null when the teamId does not resolve to a team in the workspace (the caller renders
 * an empty/selector state).
 */
export function buildMyTeamSummary(input: BuildMyTeamSummaryInput): MyTeamSummary | null {
  const {
    teamId,
    teams,
    games,
    districts,
    ageDivisions,
    coaches,
    coachAssignments,
    importedWorkspace,
  } = input;

  const team = teams.find((t) => t.teamId === teamId) ?? null;
  if (team === null) return null;

  const district = districts.find((d) => d.districtId === team.districtId) ?? null;
  const ageDivision = ageDivisions.find((a) => a.ageDivisionId === team.ageDivisionId) ?? null;

  const identity: MyTeamIdentity = {
    teamId: team.teamId,
    seasonId: team.seasonId,
    districtId: team.districtId,
    districtName: district?.name ?? team.districtId,
    ageDivisionId: team.ageDivisionId,
    ageDivisionName: ageDivision?.name ?? team.ageDivisionId,
    teamCode: team.teamCode,
    displayName: formatTeamDisplayName(team, districts, ageDivisions),
    mascot: district?.mascot ?? null,
    primaryColor: district?.primaryColor ?? null,
    secondaryColor: district?.secondaryColor ?? null,
  };

  // --- Roster ---
  const priorTeam = findPriorSeasonTeam(teams, team);
  const priorPlayers = priorTeam ? priorTeam.players : null;
  const comparison = summarizeTeamPriorSeasonComparison(team.players, priorPlayers);

  const namedPlayers = nonEmptyNamedPlayers(team.players);
  const duplicateGroupCount = findDuplicatePlayerIdentityGroups(namedPlayers).length;

  let priorSeasonComparison: MyTeamRosterPriorComparison;
  let identityReviewCount = 0;
  if (comparison.available) {
    const statuses = deriveCurrentRosterPlayerStatuses(team.players, priorPlayers);
    if (statuses.available) {
      identityReviewCount = statuses.statuses.filter((s) =>
        currentPlayerNeedsIdentityReview(s.derived)
      ).length;
    }
    priorSeasonComparison = {
      available: true,
      returning: comparison.summary.returning,
      newToRoster: comparison.summary.newToRoster,
      notReturning: comparison.summary.notReturning,
      unknownCurrent: comparison.summary.unknownCurrent,
      unknownPrior: comparison.summary.unknownPrior,
      highConfidence: comparison.summary.highConfidence,
      lowConfidence: comparison.summary.lowConfidence,
      identityReviewCount,
    };
  } else {
    priorSeasonComparison = { available: false, reason: 'no-prior-season' };
  }

  const roster: MyTeamRosterSummary = {
    totalPlayers: team.players.length,
    duplicateGroupCount,
    priorSeasonComparison,
  };

  // --- Schedule / results ---
  const scheduleSummary = summarizeTeamSchedule({
    teamId: team.teamId,
    games,
    teams,
    districts,
    ageDivisions,
  });
  const unresolvedScheduleReferenceCount = scheduleSummary.games.filter(
    (g) => g.status === 'final' && g.unresolvedReference
  ).length;

  const schedule: MyTeamScheduleSummary = {
    totalGames: scheduleSummary.totalGames,
    completedGames: scheduleSummary.completedGames,
    upcomingGames: scheduleSummary.upcomingGames,
    cancelledGames: scheduleSummary.cancelledGames,
    overallRecord: scheduleSummary.overallRecord,
    regularSeasonRecord: scheduleSummary.regularSeasonRecord,
    playoffRecord: scheduleSummary.playoffRecord,
    championshipRecord: scheduleSummary.championshipRecord,
    pointsFor: scheduleSummary.pointsFor,
    pointsAgainst: scheduleSummary.pointsAgainst,
    pointDifferential: scheduleSummary.pointDifferential,
    winPercentage: winPct(
      scheduleSummary.overallRecord.wins,
      scheduleSummary.overallRecord.ties,
      scheduleSummary.overallRecord.gamesPlayed
    ),
    nextGame: scheduleSummary.nextGame,
    lastGame: scheduleSummary.lastGame,
    unresolvedScheduleReferenceCount,
  };

  // --- Standings ---
  const standingsResult = buildStandings({
    teams,
    games,
    districts,
    ageDivisions,
    seasonId: team.seasonId,
    ageDivisionId: team.ageDivisionId,
  });
  const standingsRow = standingsResult.rows.find((r) => r.teamId === team.teamId) ?? null;
  const standings: MyTeamStandingsSummary = {
    available: standingsRow !== null,
    rank: standingsRow ? standingsRow.rank : null,
    totalTeams: standingsResult.rows.length,
    winPercentage: standingsRow ? standingsRow.winPercentage : 0,
    pointDifferential: standingsRow ? standingsRow.pointDifferential : 0,
    hasFinalGames: standingsResult.hasFinalGames,
  };

  // --- Coaches ---
  const staff = summarizeTeamCoachStaff({
    teamId: team.teamId,
    seasonId: team.seasonId,
    coaches,
    coachAssignments,
    priorSeasonTeamId: priorTeam?.teamId ?? null,
  });
  const teamCoachPerformance = summarizeTeamCoachPerformance({
    teamId: team.teamId,
    seasonId: team.seasonId,
    coaches,
    coachAssignments,
    teams,
    games,
    districts,
    ageDivisions,
  });
  const coachesSummary: MyTeamCoachSummary = {
    totalAssignedCoaches: staff.totalAssignedCoaches,
    headCoaches: staff.headCoaches,
    assistantCoaches: staff.assistantCoaches,
    unknownRoleCoaches: staff.unknownRoleCoaches,
    continuity: staff.continuity,
    // The with-this-team record is this team's final-game record (same data the schedule shows).
    withTeamRecord: toPerformanceRecord(scheduleSummary.overallRecord),
    members: teamCoachPerformance.members,
    unresolvedCoachReferences: staff.unresolvedCoachReferences,
    unresolvedGameReferenceCount: teamCoachPerformance.unresolvedGameReferenceCount,
  };

  // --- Attention items ---
  const items: MyTeamAttentionItem[] = [];

  if (priorTeam === null) {
    items.push({
      code: 'no-prior-team',
      severity: 'info',
      message:
        'No prior-season same-slot team was found, so returning/new roster comparison is not available.',
    });
  }
  if (duplicateGroupCount > 0) {
    items.push({
      code: 'roster-identity-duplicates',
      severity: 'warning',
      message: `${duplicateGroupCount} duplicate-name group(s) on the roster may need identity review.`,
    });
  }
  if (priorSeasonComparison.available && priorSeasonComparison.unknownCurrent > 0) {
    items.push({
      code: 'roster-movement-unknown',
      severity: 'warning',
      message: `${priorSeasonComparison.unknownCurrent} current player(s) have ambiguous prior-season movement.`,
    });
  }
  if (priorSeasonComparison.available && priorSeasonComparison.identityReviewCount > 0) {
    items.push({
      code: 'roster-identity-review',
      severity: 'warning',
      message: `${priorSeasonComparison.identityReviewCount} current player(s) have a low-confidence identity match.`,
    });
  }
  if (unresolvedScheduleReferenceCount > 0) {
    items.push({
      code: 'unresolved-schedule-reference',
      severity: 'warning',
      message: `${unresolvedScheduleReferenceCount} final game(s) reference an unresolved opponent team.`,
    });
  }
  if (coachesSummary.unresolvedCoachReferences > 0) {
    items.push({
      code: 'unresolved-coach-reference',
      severity: 'warning',
      message: `${coachesSummary.unresolvedCoachReferences} coach assignment(s) reference a coach not in the workspace.`,
    });
  }
  if (schedule.totalGames === 0) {
    items.push({
      code: 'no-schedule-loaded',
      severity: 'info',
      message: 'No schedule or results are loaded for this team yet.',
    });
  } else if (schedule.completedGames === 0) {
    items.push({
      code: 'no-final-games',
      severity: 'info',
      message: 'No final games yet — records will populate once results are entered.',
    });
  }
  if (!standings.hasFinalGames) {
    items.push({
      code: 'standings-unavailable',
      severity: 'info',
      message:
        'Standings have no final games in this season/age division yet, so position is provisional.',
    });
  }
  if (coachesSummary.totalAssignedCoaches === 0) {
    items.push({
      code: 'no-coach-data',
      severity: 'info',
      message: 'No coach or staff assignments are loaded for this team.',
    });
  }
  if (importedWorkspace === true) {
    items.push({
      code: 'imported-workspace-only',
      severity: 'info',
      message:
        'This workspace was restored from an imported snapshot. Export a snapshot to keep further changes.',
    });
  }

  return {
    identity,
    roster,
    schedule,
    standings,
    coaches: coachesSummary,
    attentionItems: sortAttentionItems(items),
  };
}
