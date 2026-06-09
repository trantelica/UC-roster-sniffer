import {
  comparePlayerIdentityOverlap,
  type PlayerIdentityInput,
} from './playerIdentityOverlap';
import type { DerivedRosterStatus } from './rosterStatus';

export type { PlayerIdentityInput };

/**
 * Phase 3 slice 1: prior-season roster comparison RESULT CONTRACT.
 *
 * This establishes a stable, deterministic output shape for organizing a
 * current-vs-prior roster comparison so later Phase 3 slices have a fixed model
 * to build on. It deliberately does NOT implement the movement taxonomy:
 * transfer, promotion, relegation, y-up, and z-down are out of scope here, as
 * are fuzzy matching, confidence scoring beyond the existing high/low metadata,
 * and import-collision resolution.
 *
 * The four buckets reflect only what exact identity overlap can determine:
 *   - returning:     a current player with exactly one prior identity match
 *   - newToRoster:   a current player with no prior identity match
 *   - notReturning:  a prior player with no current identity match
 *   - unknown:       current and/or prior records whose identity key is
 *                    ambiguous (duplicate name) and cannot be safely resolved
 */

/**
 * A current/prior pair joined by an exact one-to-one identity match.
 * Both source records are preserved by reference, never mutated.
 */
export type ReturningComparisonEntry = {
  identityKey: string;
  current: PlayerIdentityInput;
  prior: PlayerIdentityInput;
  derived: DerivedRosterStatus;
};

/**
 * A current-roster record with no prior identity match. `side` is always
 * 'current' to make the source side explicit for later review and UI use.
 */
export type NewToRosterComparisonEntry = {
  identityKey: string;
  side: 'current';
  player: PlayerIdentityInput;
  derived: DerivedRosterStatus;
};

/**
 * A prior-roster record with no current identity match. `side` is always
 * 'prior'. This is a prior-season-only status and never a current player card.
 */
export type NotReturningComparisonEntry = {
  identityKey: string;
  side: 'prior';
  player: PlayerIdentityInput;
  derived: DerivedRosterStatus;
};

/**
 * A single record (current or prior) belonging to an ambiguous identity key.
 * Each ambiguous record gets its own entry so that every duplicate record stays
 * individually visible and preserved; none is dropped or merged. `side` records
 * which roster the record came from.
 */
export type UnknownComparisonEntry = {
  identityKey: string;
  side: 'current' | 'prior';
  player: PlayerIdentityInput;
  derived: DerivedRosterStatus;
};

export type PriorSeasonRosterComparisonResult = {
  returning: ReturningComparisonEntry[];
  newToRoster: NewToRosterComparisonEntry[];
  notReturning: NotReturningComparisonEntry[];
  unknown: UnknownComparisonEntry[];
};

const RETURNING_STATUS: DerivedRosterStatus = {
  status: 'returning',
  confidence: 'high',
  reason: 'exact-identity-match',
};

const NEW_STATUS: DerivedRosterStatus = {
  status: 'new',
  confidence: 'high',
  reason: 'current-only',
};

const NOT_RETURNING_STATUS: DerivedRosterStatus = {
  status: 'not-returning',
  confidence: 'high',
  reason: 'prior-only',
};

const UNKNOWN_STATUS: DerivedRosterStatus = {
  status: 'unknown',
  confidence: 'low',
  reason: 'ambiguous-identity',
};

/**
 * Compares a current roster to a prior-season roster and organizes the result
 * into the four-bucket comparison contract.
 *
 * Built on the existing exact-identity overlap pipeline
 * (comparePlayerIdentityOverlap), so matching is exact normalized-name only.
 *
 * Guarantees:
 *   - Every source record lands in exactly one bucket. An ambiguous record
 *     appears only in `unknown`, never in returning / newToRoster / notReturning.
 *   - Source player records are preserved by reference and never mutated; the
 *     derived status is fresh metadata attached alongside, not on the record.
 *   - Deterministic ordering: current-side buckets follow current roster
 *     first-appearance order; prior-side buckets follow prior roster order.
 *     `unknown` follows the overlap's ambiguous-group order (current-first, then
 *     prior keys not seen in current), and within a group lists current records
 *     before prior records, each in original input order.
 *
 * Throws if any player name is empty or whitespace-only (inherited from the
 * identity pipeline).
 */
export function comparePriorSeasonRoster(
  currentPlayers: PlayerIdentityInput[],
  priorPlayers: PlayerIdentityInput[]
): PriorSeasonRosterComparisonResult {
  const overlap = comparePlayerIdentityOverlap(currentPlayers, priorPlayers);

  const returning: ReturningComparisonEntry[] = overlap.exactMatches.map(
    (match) => ({
      identityKey: match.identityKey,
      current: match.current,
      prior: match.prior,
      derived: RETURNING_STATUS,
    })
  );

  const newToRoster: NewToRosterComparisonEntry[] = [];
  for (const group of overlap.currentOnly) {
    for (const player of group.players) {
      newToRoster.push({
        identityKey: group.identityKey,
        side: 'current',
        player,
        derived: NEW_STATUS,
      });
    }
  }

  const notReturning: NotReturningComparisonEntry[] = [];
  for (const group of overlap.priorOnly) {
    for (const player of group.players) {
      notReturning.push({
        identityKey: group.identityKey,
        side: 'prior',
        player,
        derived: NOT_RETURNING_STATUS,
      });
    }
  }

  const unknown: UnknownComparisonEntry[] = [];
  for (const group of overlap.ambiguous) {
    for (const player of group.current) {
      unknown.push({
        identityKey: group.identityKey,
        side: 'current',
        player,
        derived: UNKNOWN_STATUS,
      });
    }
    for (const player of group.prior) {
      unknown.push({
        identityKey: group.identityKey,
        side: 'prior',
        player,
        derived: UNKNOWN_STATUS,
      });
    }
  }

  return { returning, newToRoster, notReturning, unknown };
}
