import {
  comparePriorSeasonRoster,
  type PriorSeasonRosterComparisonResult,
  type PlayerIdentityInput,
} from './priorSeasonRosterComparison';
import type { RosterConfidenceValue } from './rosterStatus';

/**
 * Phase 3 slice 2: prior-season roster comparison SUMMARY.
 *
 * Reduces the four-bucket comparison result (see comparePriorSeasonRoster) into
 * count totals for display. It reads derived metadata only; it does not classify
 * transfers, promotions, relegations, y-up/z-down, fuzzy matches, or collisions,
 * and it never adds movement taxonomy beyond what the contract already carries.
 *
 * Counting is perspective-aware so questions about each roster side are answered
 * without double-counting:
 *
 *   - `returning` counts current-roster players that have an exact prior match.
 *     A returning entry pairs one current record with one prior record, but it
 *     is counted ONCE here, not twice.
 *   - current-side counts (`newToRoster`, `unknownCurrent`) describe current
 *     roster records; prior-side counts (`notReturning`, `unknownPrior`)
 *     describe prior roster records.
 *   - `unknownCurrent` and `unknownPrior` distinguish current-side from
 *     prior-side ambiguity; `unknownTotal` is their sum.
 *
 * Record-accounting totals:
 *   totalCurrent = returning + newToRoster + unknownCurrent
 *   totalPrior   = returning + notReturning + unknownPrior
 *   (a returning player is represented on both the current and prior side, so it
 *    contributes to both totals — this is intentional record accounting.)
 *
 * Confidence is tallied over the deduplicated, perspective-aware summary set
 * (each returning entry once, plus every newToRoster / notReturning / unknown
 * record), using each entry's own derived confidence, so:
 *   highConfidence + lowConfidence
 *     === returning + newToRoster + notReturning + unknownTotal
 */
export type PriorSeasonRosterComparisonSummary = {
  totalCurrent: number;
  totalPrior: number;
  returning: number;
  newToRoster: number;
  notReturning: number;
  unknownCurrent: number;
  unknownPrior: number;
  unknownTotal: number;
  highConfidence: number;
  lowConfidence: number;
};

/**
 * Summarizes a prior-season roster comparison result into count totals.
 *
 * Pure and deterministic. It does not mutate the comparison result or any of its
 * entries, and it preserves loaded roster authority: source records are neither
 * altered, removed, suppressed, merged, nullified, rewritten, reordered, nor
 * ignored. This helper only counts derived metadata.
 */
export function summarizePriorSeasonRosterComparison(
  comparisonResult: PriorSeasonRosterComparisonResult
): PriorSeasonRosterComparisonSummary {
  const returning = comparisonResult.returning.length;
  const newToRoster = comparisonResult.newToRoster.length;
  const notReturning = comparisonResult.notReturning.length;

  let unknownCurrent = 0;
  let unknownPrior = 0;
  for (const entry of comparisonResult.unknown) {
    if (entry.side === 'current') unknownCurrent += 1;
    else unknownPrior += 1;
  }
  const unknownTotal = unknownCurrent + unknownPrior;

  let highConfidence = 0;
  let lowConfidence = 0;
  const tallyConfidence = (confidence: RosterConfidenceValue): void => {
    if (confidence === 'high') highConfidence += 1;
    else lowConfidence += 1;
  };

  // Each returning entry is counted once (not once per side), matching the
  // perspective-aware semantics.
  for (const entry of comparisonResult.returning) {
    tallyConfidence(entry.derived.confidence);
  }
  for (const entry of comparisonResult.newToRoster) {
    tallyConfidence(entry.derived.confidence);
  }
  for (const entry of comparisonResult.notReturning) {
    tallyConfidence(entry.derived.confidence);
  }
  for (const entry of comparisonResult.unknown) {
    tallyConfidence(entry.derived.confidence);
  }

  return {
    totalCurrent: returning + newToRoster + unknownCurrent,
    totalPrior: returning + notReturning + unknownPrior,
    returning,
    newToRoster,
    notReturning,
    unknownCurrent,
    unknownPrior,
    unknownTotal,
    highConfidence,
    lowConfidence,
  };
}

/**
 * Result of attempting to summarize a selected team's current roster against the
 * prior season's same-slot roster. When no prior-season roster is available, the
 * summary is reported as unavailable rather than fabricated, so the UI can show a
 * clear unavailable state instead of misleading zero counts.
 */
export type TeamPriorSeasonComparisonSummary =
  | { available: false; reason: 'no-prior-season' }
  | { available: true; summary: PriorSeasonRosterComparisonSummary };

/**
 * Team-level adapter that wires the selected team's current player list and its
 * prior-season player list through the Phase 3 comparison pipeline:
 *   comparePriorSeasonRoster -> summarizePriorSeasonRosterComparison
 *
 * Pure and read-only. It never alters, removes, suppresses, merges, nullifies,
 * rewrites, reorders, or ignores any player record; the returned summary is
 * derived count metadata only.
 *
 * When priorPlayers is null or undefined (no prior-season same-slot roster exists
 * to compare against), the result is { available: false } so the caller can show
 * an unavailable state.
 */
export function summarizeTeamPriorSeasonComparison(
  currentPlayers: PlayerIdentityInput[],
  priorPlayers: PlayerIdentityInput[] | null | undefined
): TeamPriorSeasonComparisonSummary {
  if (priorPlayers == null) {
    return { available: false, reason: 'no-prior-season' };
  }

  const comparison = comparePriorSeasonRoster(currentPlayers, priorPlayers);
  return {
    available: true,
    summary: summarizePriorSeasonRosterComparison(comparison),
  };
}
