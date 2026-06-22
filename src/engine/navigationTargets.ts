import type { AgeDivision, District, StaffCoach, Team } from '../domain/types';
import { formatTeamDisplayName } from './teamScheduleSummary';

/**
 * Phase 9 slice 31: PURE, deterministic cross-tab NAVIGATION TARGET resolvers — ENGINE ONLY.
 *
 * Cross-tab navigation only changes selection/view state, never source data. These resolvers let
 * the UI decide whether a navigation affordance is enabled: a target that no longer exists (e.g.
 * after a workspace snapshot import) resolves to `found: false` so the UI can disable or no-op the
 * control safely instead of navigating to a missing entity. Pure; never mutates inputs; preserves
 * names exactly.
 */

export type TeamNavigationTarget = {
  found: boolean;
  teamId: string;
  displayName: string | null;
};

/**
 * Resolves a team id to a navigation target. Returns `found: false` with a null display name when
 * the team is not in the workspace, so the caller can disable the affordance.
 */
export function resolveTeamNavigationTarget(
  teamId: string | null | undefined,
  teams: Team[],
  districts: District[],
  ageDivisions: AgeDivision[]
): TeamNavigationTarget {
  if (teamId === null || teamId === undefined || teamId === '') {
    return { found: false, teamId: teamId ?? '', displayName: null };
  }
  const team = teams.find((t) => t.teamId === teamId) ?? null;
  if (team === null) return { found: false, teamId, displayName: null };
  return { found: true, teamId, displayName: formatTeamDisplayName(team, districts, ageDivisions) };
}

export type CoachNavigationTarget = {
  found: boolean;
  coachId: string;
  displayName: string | null;
};

/**
 * Resolves a coach id to a navigation target. Returns `found: false` with a null display name when
 * the coach is not in the workspace.
 */
export function resolveCoachNavigationTarget(
  coachId: string | null | undefined,
  coaches: StaffCoach[]
): CoachNavigationTarget {
  if (coachId === null || coachId === undefined || coachId === '') {
    return { found: false, coachId: coachId ?? '', displayName: null };
  }
  const coach = coaches.find((c) => c.coachId === coachId) ?? null;
  if (coach === null) return { found: false, coachId, displayName: null };
  return { found: true, coachId, displayName: coach.displayName };
}
