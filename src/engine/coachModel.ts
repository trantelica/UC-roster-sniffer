import type { CoachRole, StaffCoach, Team, TeamCoachAssignment } from '../domain/types';
import { getPlayerIdentityKey, normalizePlayerName } from './playerIdentity';

/**
 * Phase 7 slice 27: PURE, deterministic coach IDENTITY + model derivation — ENGINE ONLY.
 *
 * Coach identity is name-based and deterministic (reusing the existing exact-identity name
 * normalization — no fuzzy matching). A coachId derives from the identity key, so the same
 * name maps to the same coach across seasons/teams. Ambiguity (two distinct coachIds sharing
 * one identity key) is surfaced by callers, never silently merged here.
 *
 * Guardrails: never mutates inputs; never touches rosters/games (these helpers only read the
 * roster-embedded coach names to seed the normalized model); preserves raw names exactly.
 */

export const COACH_MODEL_LOGIC_VERSION = 'phase7-slice27-coach-model-v1';

/** Deterministic lowercase identity key for a coach name (reuses player-name normalization). */
export function coachIdentityKey(name: string): string {
  return getPlayerIdentityKey(name);
}

/** Stable coachId derived from an identity key. */
export function coachIdForIdentityKey(identityKey: string): string {
  return `coach:${identityKey}`;
}

/** Builds a StaffCoach from a raw name (identity-key based; raw name preserved as sourceName). */
export function buildStaffCoach(name: string): StaffCoach {
  const identityKey = coachIdentityKey(name);
  return {
    coachId: coachIdForIdentityKey(identityKey),
    displayName: normalizePlayerName(name),
    identityKey,
    sourceName: name,
  };
}

/** Stable assignment id: one assignment per (season, team, coach). */
export function assignmentId(seasonId: string, teamId: string, coachId: string): string {
  return `${seasonId}:${teamId}:${coachId}`;
}

/**
 * Derives the normalized coach model from the roster-embedded coach fields of teams. Pure;
 * never mutates inputs. Coaches are deduplicated by identity key across seasons/teams, so a
 * coach who appears on multiple teams/seasons becomes one record with multiple assignments.
 */
export function deriveCoachesAndAssignmentsFromTeams(teams: Team[]): {
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
} {
  const coachesByKey = new Map<string, StaffCoach>();
  const coachAssignments: TeamCoachAssignment[] = [];

  const addAssignment = (
    team: Team,
    rawName: string,
    role: CoachRole,
    sourceLabel: string
  ): void => {
    if (rawName.trim() === '') return;
    const coach = buildStaffCoach(rawName);
    if (!coachesByKey.has(coach.identityKey)) coachesByKey.set(coach.identityKey, coach);
    coachAssignments.push({
      assignmentId: assignmentId(team.seasonId, team.teamId, coach.coachId),
      seasonId: team.seasonId,
      teamId: team.teamId,
      coachId: coach.coachId,
      role,
      sourceLabel,
    });
  };

  for (const team of teams) {
    if (team.headCoach) addAssignment(team, team.headCoach.name, 'headCoach', 'Head Coach');
    for (const assistant of team.assistantCoaches) {
      addAssignment(team, assistant.name, 'assistantCoach', 'Assistant Coach');
    }
  }

  return { coaches: [...coachesByKey.values()], coachAssignments };
}
