import type { Team } from '../domain/types';
import {
  comparePlayerIdentityOverlap,
  type PlayerIdentityInput,
} from './playerIdentityOverlap';
import { deriveRosterStatusFromOverlap, type RosterStatusEntry } from './rosterStatus';
import type { RosterStatusSummary } from './rosterStatusSummary';

/**
 * Result of attempting to summarize a selected team's roster status against the
 * prior season. When no prior-season roster is available to compare against,
 * the summary is reported as unavailable rather than fabricated.
 */
export type TeamRosterStatusSummary =
  | { available: false; reason: 'no-prior-season' }
  | { available: true; summary: RosterStatusSummary };

/**
 * Perspective-aware roster status summary for the SELECTED current team view.
 *
 * The lower-level summarizeRosterStatuses counts one tally per source record, so
 * an exact prior-season match contributes both its current-season record and its
 * prior-season record (a single returning player would count as 2). That is
 * correct for whole-comparison record accounting but wrong for a selected-team
 * summary, which should count from the current team's perspective:
 *
 *   returning    = current-roster players with an exact prior-season identity match
 *   new          = current-roster players with no prior-season identity match
 *   unknown      = current-roster players whose current identity is ambiguous
 *   notReturning = prior-season players absent from the current roster
 *
 * Confidence is counted against those same displayed records (their own derived
 * confidence), not over all source entries:
 *   highConfidence + lowConfidence === total === returning + new + unknown + notReturning
 *
 * Because comparePlayerIdentityOverlap partitions every current player into
 * exactly one of exact-match / current-only / ambiguous-current, the invariant
 * returning + new + unknown === currentPlayers.length always holds, and
 * notReturning === prior-only players. No current player is double-counted.
 *
 * This reads derived metadata only. It never alters, removes, suppresses,
 * merges, nullifies, rewrites, or ignores any source player record.
 */
export function summarizeSelectedTeamRosterStatus(
  entries: RosterStatusEntry[]
): RosterStatusSummary {
  const summary: RosterStatusSummary = {
    total: 0,
    returning: 0,
    new: 0,
    notReturning: 0,
    unknown: 0,
    highConfidence: 0,
    lowConfidence: 0,
  };

  for (const entry of entries) {
    const { status, confidence } = entry.derived;
    let counted = false;

    if (entry.side === 'current') {
      // Current-roster perspective: returning, new, and ambiguous players.
      if (status === 'returning') {
        summary.returning += 1;
        counted = true;
      } else if (status === 'new') {
        summary.new += 1;
        counted = true;
      } else if (status === 'unknown') {
        summary.unknown += 1;
        counted = true;
      }
    } else if (status === 'not-returning') {
      // Prior-season players absent from the current roster.
      summary.notReturning += 1;
      counted = true;
    }

    if (counted) {
      if (confidence === 'high') summary.highConfidence += 1;
      else summary.lowConfidence += 1;
    }
  }

  summary.total =
    summary.returning + summary.new + summary.unknown + summary.notReturning;
  return summary;
}

/**
 * Adapter that connects a selected team's current player list and its
 * prior-season player list to the roster-status pipeline:
 *   comparePlayerIdentityOverlap -> deriveRosterStatusFromOverlap
 *   -> summarizeSelectedTeamRosterStatus
 *
 * This helper only reads the supplied arrays. It never alters, removes,
 * suppresses, merges, nullifies, rewrites, or ignores any player record; derived
 * status is metadata only.
 *
 * When priorPlayers is null or undefined (no prior-season roster exists to
 * compare against), the result is { available: false } so the UI can show a
 * clear unavailable state instead of misleading zero counts.
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
  return { available: true, summary: summarizeSelectedTeamRosterStatus(entries) };
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
