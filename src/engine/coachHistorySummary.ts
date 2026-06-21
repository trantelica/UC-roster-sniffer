import type {
  AgeDivision,
  CoachRole,
  District,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import { formatTeamDisplayName } from './teamScheduleSummary';

/**
 * Phase 7 slice 27: PURE, deterministic coach HISTORY / STAFF summaries — ENGINE ONLY.
 *
 * Derives team staff (by role), coach assignment history across seasons/teams, and a coach
 * directory, plus reference validation. Coach identity is name/coachId based; unresolved
 * coach/team references are reported, never invented. Guardrails: never mutates inputs,
 * preserves names exactly, deterministic ordering.
 */

export const COACH_HISTORY_SUMMARY_LOGIC_VERSION = 'phase7-slice27-coach-history-summary-v1';

const ROLE_ORDER: Record<CoachRole, number> = { headCoach: 0, assistantCoach: 1, unknown: 2 };

export type TeamCoachStaffMember = {
  assignmentId: string;
  coachId: string;
  displayName: string;
  role: CoachRole;
  sourceLabel: string | null;
  /** True when the assignment's coachId is not in the coach list. */
  unresolvedCoach: boolean;
};

export type TeamCoachContinuity = {
  available: boolean;
  returningCoaches: number;
  newToTeamCoaches: number;
  departedCoaches: number;
};

export type TeamCoachStaffSummary = {
  teamId: string;
  seasonId: string;
  headCoaches: TeamCoachStaffMember[];
  assistantCoaches: TeamCoachStaffMember[];
  unknownRoleCoaches: TeamCoachStaffMember[];
  totalAssignedCoaches: number;
  unresolvedCoachReferences: number;
  continuity: TeamCoachContinuity;
};

function compareStaff(a: TeamCoachStaffMember, b: TeamCoachStaffMember): number {
  if (a.role !== b.role) return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
  if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
  return a.coachId < b.coachId ? -1 : a.coachId > b.coachId ? 1 : 0;
}

export type SummarizeTeamCoachStaffInput = {
  teamId: string;
  seasonId: string;
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  /** Optional prior same-slot teamId for returning/new/departed continuity. */
  priorSeasonTeamId?: string | null;
};

/**
 * Summarizes a team's coaching staff by role, with optional prior-season continuity. Pure;
 * never mutates inputs.
 */
export function summarizeTeamCoachStaff(
  input: SummarizeTeamCoachStaffInput
): TeamCoachStaffSummary {
  const { teamId, seasonId, coaches, coachAssignments, priorSeasonTeamId } = input;
  const coachesById = new Map(coaches.map((c) => [c.coachId, c]));

  const members: TeamCoachStaffMember[] = coachAssignments
    .filter((a) => a.teamId === teamId)
    .map((a) => {
      const coach = coachesById.get(a.coachId) ?? null;
      return {
        assignmentId: a.assignmentId,
        coachId: a.coachId,
        displayName: coach ? coach.displayName : a.coachId,
        role: a.role,
        sourceLabel: a.sourceLabel ?? null,
        unresolvedCoach: coach === null,
      };
    })
    .sort(compareStaff);

  const headCoaches = members.filter((m) => m.role === 'headCoach');
  const assistantCoaches = members.filter((m) => m.role === 'assistantCoach');
  const unknownRoleCoaches = members.filter((m) => m.role === 'unknown');

  let continuity: TeamCoachContinuity = {
    available: false,
    returningCoaches: 0,
    newToTeamCoaches: 0,
    departedCoaches: 0,
  };
  if (priorSeasonTeamId) {
    const currentIds = new Set(members.map((m) => m.coachId));
    const priorIds = new Set(
      coachAssignments.filter((a) => a.teamId === priorSeasonTeamId).map((a) => a.coachId)
    );
    let returning = 0;
    let newToTeam = 0;
    for (const id of currentIds) {
      if (priorIds.has(id)) returning += 1;
      else newToTeam += 1;
    }
    let departed = 0;
    for (const id of priorIds) if (!currentIds.has(id)) departed += 1;
    continuity = {
      available: true,
      returningCoaches: returning,
      newToTeamCoaches: newToTeam,
      departedCoaches: departed,
    };
  }

  return {
    teamId,
    seasonId,
    headCoaches,
    assistantCoaches,
    unknownRoleCoaches,
    totalAssignedCoaches: members.length,
    unresolvedCoachReferences: members.filter((m) => m.unresolvedCoach).length,
    continuity,
  };
}

// ---------------------------------------------------------------------------
// Coach history
// ---------------------------------------------------------------------------

export type CoachAssignmentHistoryEntry = {
  assignmentId: string;
  seasonId: string;
  teamId: string;
  teamDisplayName: string;
  role: CoachRole;
  sourceLabel: string | null;
  unresolvedTeam: boolean;
};

export type CoachHistorySummary = {
  coachId: string;
  displayName: string;
  available: boolean;
  assignments: CoachAssignmentHistoryEntry[];
  seasonsActive: string[];
  teamsCoached: string[];
  rolesHeld: CoachRole[];
  latestAssignment: CoachAssignmentHistoryEntry | null;
  movementSummary: { distinctSeasons: number; distinctTeams: number; changedTeams: boolean };
};

export type SummarizeCoachHistoryInput = {
  coachId: string;
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
};

function compareAssignments(
  a: CoachAssignmentHistoryEntry,
  b: CoachAssignmentHistoryEntry
): number {
  if (a.seasonId !== b.seasonId) return a.seasonId < b.seasonId ? -1 : 1;
  if (a.teamId !== b.teamId) return a.teamId < b.teamId ? -1 : 1;
  if (a.role !== b.role) return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
  return a.assignmentId < b.assignmentId ? -1 : a.assignmentId > b.assignmentId ? 1 : 0;
}

function distinctSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Summarizes one coach's assignment history across seasons/teams. Pure; never mutates inputs.
 * Teams are resolved through existing teams; an unresolved team is flagged, not invented.
 */
export function summarizeCoachHistory(
  input: SummarizeCoachHistoryInput
): CoachHistorySummary {
  const { coachId, coaches, coachAssignments, teams, districts, ageDivisions } = input;
  const coach = coaches.find((c) => c.coachId === coachId) ?? null;
  const teamsById = new Map(teams.map((t) => [t.teamId, t]));

  const assignments: CoachAssignmentHistoryEntry[] = coachAssignments
    .filter((a) => a.coachId === coachId)
    .map((a) => {
      const team = teamsById.get(a.teamId) ?? null;
      return {
        assignmentId: a.assignmentId,
        seasonId: a.seasonId,
        teamId: a.teamId,
        teamDisplayName: team ? formatTeamDisplayName(team, districts, ageDivisions) : a.teamId,
        role: a.role,
        sourceLabel: a.sourceLabel ?? null,
        unresolvedTeam: team === null,
      };
    })
    .sort(compareAssignments);

  const seasonsActive = distinctSorted(assignments.map((a) => a.seasonId));
  const teamsCoached = distinctSorted(assignments.map((a) => a.teamId));
  const rolesHeld = (distinctSorted(assignments.map((a) => a.role)) as CoachRole[]);
  const latestAssignment =
    assignments.length > 0 ? assignments[assignments.length - 1] : null;

  return {
    coachId,
    displayName: coach ? coach.displayName : coachId,
    available: coach !== null,
    assignments,
    seasonsActive,
    teamsCoached,
    rolesHeld,
    latestAssignment,
    movementSummary: {
      distinctSeasons: seasonsActive.length,
      distinctTeams: teamsCoached.length,
      changedTeams: teamsCoached.length > 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Coach directory
// ---------------------------------------------------------------------------

export type CoachDirectoryRow = {
  coachId: string;
  displayName: string;
  seasonsActiveCount: number;
  teamsCoachedCount: number;
  rolesHeld: CoachRole[];
  latestSeasonId: string | null;
  latestTeamDisplayName: string | null;
  latestRole: CoachRole | null;
};

export type BuildCoachDirectoryInput = {
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
};

/**
 * Builds the coach directory (one row per coach), each with latest assignment + counts.
 * Pure; deterministic ordering by display name then coachId; never mutates inputs.
 */
export function buildCoachDirectory(input: BuildCoachDirectoryInput): CoachDirectoryRow[] {
  const { coaches } = input;
  return coaches
    .map((coach): CoachDirectoryRow => {
      const history = summarizeCoachHistory({ ...input, coachId: coach.coachId });
      return {
        coachId: coach.coachId,
        displayName: coach.displayName,
        seasonsActiveCount: history.seasonsActive.length,
        teamsCoachedCount: history.teamsCoached.length,
        rolesHeld: history.rolesHeld,
        latestSeasonId: history.latestAssignment?.seasonId ?? null,
        latestTeamDisplayName: history.latestAssignment?.teamDisplayName ?? null,
        latestRole: history.latestAssignment?.role ?? null,
      };
    })
    .sort((a, b) =>
      a.displayName !== b.displayName
        ? a.displayName < b.displayName
          ? -1
          : 1
        : a.coachId < b.coachId
          ? -1
          : a.coachId > b.coachId
            ? 1
            : 0
    );
}

// ---------------------------------------------------------------------------
// Reference validation
// ---------------------------------------------------------------------------

export type UnresolvedCoachReference = {
  assignmentId: string;
  missingCoachId: boolean;
  missingTeamId: boolean;
};

/**
 * Reports assignments whose coachId or teamId references are not present. Pure; never mutates
 * inputs. Used by snapshot validation (coaches/teams must exist).
 */
export function validateCoachAssignments(
  coachAssignments: TeamCoachAssignment[],
  coaches: StaffCoach[],
  teams: Team[]
): UnresolvedCoachReference[] {
  const coachIds = new Set(coaches.map((c) => c.coachId));
  const teamIds = new Set(teams.map((t) => t.teamId));
  const unresolved: UnresolvedCoachReference[] = [];
  for (const a of coachAssignments) {
    const missingCoachId = !coachIds.has(a.coachId);
    const missingTeamId = !teamIds.has(a.teamId);
    if (missingCoachId || missingTeamId) {
      unresolved.push({ assignmentId: a.assignmentId, missingCoachId, missingTeamId });
    }
  }
  return unresolved;
}
