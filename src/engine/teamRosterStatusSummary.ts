import type { Team } from '../domain/types';
import {
  comparePlayerIdentityOverlap,
  type PlayerIdentityInput,
} from './playerIdentityOverlap';
import { deriveRosterStatusFromOverlap } from './rosterStatus';
import { summarizeRosterStatuses, type RosterStatusSummary } from './rosterStatusSummary';

/**
 * Result of attempting to summarize a selected team's roster status against the
 * prior season. When no prior-season roster is available to compare against,
 * the summary is reported as unavailable rather than fabricated.
 */
export type TeamRosterStatusSummary =
  | { available: false; reason: 'no-prior-season' }
  | { available: true; summary: RosterStatusSummary };

/**
 * Adapter that connects a selected team's current player list and its
 * prior-season player list to the existing roster-status pipeline:
 *   comparePlayerIdentityOverlap -> deriveRosterStatusFromOverlap -> summarizeRosterStatuses
 *
 * This helper only reads the supplied arrays. It never alters, removes,
 * suppresses, merges, nullifies, rewrites, or ignores any player record; derived
 * status is metadata only.
 *
 * When priorPlayers is null or undefined (no prior-season roster exists to
 * compare against), the result is { available: false } so the UI can show a
 * clear unavailable state instead of misleading zero counts.
 *
 * Note on counts: summarizeRosterStatuses counts one entry per source record.
 * An exact prior-season match contributes both its current-season record and its
 * prior-season record, so a single returning player adds 2 to the returning
 * count. Counts therefore reflect records compared, not unique people. A future
 * slice can add a single-perspective (current-team-only) count if desired.
 */
export function summarizeTeamRosterStatus(
  currentPlayers: PlayerIdentityInput[],
  priorPlayers: PlayerIdentityInput[] | null | undefined
): TeamRosterStatusSummary {
  if (priorPlayers == null) {
    return { available: false, reason: 'no-prior-season' };
  }

  const overlap = comparePlayerIdentityOverlap(currentPlayers, priorPlayers);
  const entries = deriveRosterStatusFromOverlap(overlap);
  return { available: true, summary: summarizeRosterStatuses(entries) };
}

/**
 * Returns the distinct prior season id for a given season: the greatest season
 * id that sorts strictly before seasonId. Returns null when no earlier season
 * exists in the supplied teams. Season ids are compared as strings, matching
 * getDistinctSeasons ordering.
 */
function getPriorSeasonId(teams: Team[], seasonId: string): string | null {
  const earlier = Array.from(new Set(teams.map((t) => t.seasonId)))
    .filter((s) => s < seasonId)
    .sort();
  return earlier.length > 0 ? earlier[earlier.length - 1] : null;
}

/**
 * Locates the prior-season team that shares the selected team's district, age
 * division, and team code. Returns null when there is no prior season or no
 * matching team in that season.
 *
 * This is a deterministic same-slot lookup only. It does not classify transfers,
 * promotions, relegations, y-up, or z-down, and it does not fuzzy-match.
 */
export function findPriorSeasonTeam(teams: Team[], currentTeam: Team): Team | null {
  const priorSeasonId = getPriorSeasonId(teams, currentTeam.seasonId);
  if (priorSeasonId === null) return null;

  return (
    teams.find(
      (t) =>
        t.seasonId === priorSeasonId &&
        t.districtId === currentTeam.districtId &&
        t.ageDivisionId === currentTeam.ageDivisionId &&
        t.teamCode === currentTeam.teamCode
    ) ?? null
  );
}
