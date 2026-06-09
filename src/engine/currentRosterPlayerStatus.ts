import type { Player } from '../domain/types';
import {
  comparePlayerIdentityOverlap,
  type PlayerIdentityInput,
} from './playerIdentityOverlap';
import {
  deriveRosterStatusFromOverlap,
  type DerivedRosterStatus,
} from './rosterStatus';

/**
 * Per-player derived status for a single CURRENT roster player, paired with the
 * original player record (by reference, never mutated). Intended for display on
 * the player card.
 *
 * A current-roster player can only derive to returning, new, or unknown:
 * not-returning is a prior-season-only status and is therefore never produced
 * here.
 */
export type CurrentRosterPlayerStatusEntry = {
  player: Player;
  derived: DerivedRosterStatus;
};

/**
 * Result of deriving per-player status for a selected current team. When there
 * is no prior-season roster to compare against, the result is reported as
 * unavailable rather than fabricated, matching summarizeTeamRosterStatus.
 */
export type CurrentRosterPlayerStatuses =
  | { available: false; reason: 'no-prior-season' }
  | { available: true; statuses: CurrentRosterPlayerStatusEntry[] };

/**
 * Derives one display-status entry per CURRENT roster player by running the
 * existing exact-identity roster-status pipeline:
 *   comparePlayerIdentityOverlap -> deriveRosterStatusFromOverlap
 *
 * Guarantees:
 *   - One entry per current player, in the original current roster order.
 *   - The original player record is preserved by reference and never mutated;
 *     derived status is separate metadata.
 *   - Prior-only (not-returning) players are NOT included; they are not current
 *     roster cards.
 *   - Ambiguous (duplicate-name) current players remain individually present and
 *     each derive to unknown / low / ambiguous-identity. No record is dropped or
 *     merged.
 *
 * When priorPlayers is null or undefined, the result is { available: false } so
 * the caller can render the roster with no per-player badge instead of showing a
 * misleading status.
 *
 * This reads the supplied arrays only. It does not classify transfers,
 * promotions, relegations, y-up, z-down, or collisions, and it does not
 * fuzzy-match.
 */
export function deriveCurrentRosterPlayerStatuses(
  currentPlayers: Player[],
  priorPlayers: Player[] | null | undefined
): CurrentRosterPlayerStatuses {
  if (priorPlayers == null) {
    return { available: false, reason: 'no-prior-season' };
  }

  const overlap = comparePlayerIdentityOverlap(
    currentPlayers as PlayerIdentityInput[],
    priorPlayers as PlayerIdentityInput[]
  );
  const entries = deriveRosterStatusFromOverlap(overlap);

  // The overlap helper preserves the original record references, so we can map
  // each current player back to its derived status by reference identity. Every
  // current player lands in exactly one current-side entry (exact-match,
  // current-only, or ambiguous-current), so the lookup is always populated.
  const byReference = new Map<Player, DerivedRosterStatus>();
  for (const entry of entries) {
    if (entry.side === 'current') {
      byReference.set(entry.player as Player, entry.derived);
    }
  }

  const statuses = currentPlayers.map((player) => ({
    player,
    derived: byReference.get(player)!,
  }));

  return { available: true, statuses };
}
