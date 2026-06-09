import type { RosterStatusEntry } from './rosterStatus';

export type RosterStatusSummary = {
  total: number;
  returning: number;
  new: number;
  notReturning: number;
  unknown: number;
  highConfidence: number;
  lowConfidence: number;
};

/**
 * Summarizes derived roster status entries into count totals.
 *
 * This helper only reads the derived metadata produced by
 * deriveRosterStatusFromOverlap. It never alters, removes, suppresses, merges,
 * nullifies, or ignores source player records: every entry passed in is counted
 * exactly once and the input array (and its entries) are left untouched.
 *
 * total always equals entries.length. Status and confidence counts are tallied
 * independently, so an entry contributes to both one status count and one
 * confidence count.
 */
export function summarizeRosterStatuses(
  entries: RosterStatusEntry[]
): RosterStatusSummary {
  const summary: RosterStatusSummary = {
    total: entries.length,
    returning: 0,
    new: 0,
    notReturning: 0,
    unknown: 0,
    highConfidence: 0,
    lowConfidence: 0,
  };

  for (const entry of entries) {
    switch (entry.derived.status) {
      case 'returning':
        summary.returning += 1;
        break;
      case 'new':
        summary.new += 1;
        break;
      case 'not-returning':
        summary.notReturning += 1;
        break;
      case 'unknown':
        summary.unknown += 1;
        break;
    }

    switch (entry.derived.confidence) {
      case 'high':
        summary.highConfidence += 1;
        break;
      case 'low':
        summary.lowConfidence += 1;
        break;
    }
  }

  return summary;
}
