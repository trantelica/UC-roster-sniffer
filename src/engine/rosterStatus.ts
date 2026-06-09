import type {
  PlayerIdentityOverlapResult,
  PlayerIdentityInput,
} from './playerIdentityOverlap';

export type RosterStatusValue = 'returning' | 'new' | 'not-returning' | 'unknown';
export type RosterConfidenceValue = 'high' | 'low';
export type RosterStatusReason =
  | 'exact-identity-match'
  | 'current-only'
  | 'prior-only'
  | 'ambiguous-identity';

export type DerivedRosterStatus = {
  status: RosterStatusValue;
  confidence: RosterConfidenceValue;
  reason: RosterStatusReason;
};

export type RosterStatusEntry = {
  player: PlayerIdentityInput;
  side: 'current' | 'prior';
  identityKey: string;
  derived: DerivedRosterStatus;
};

function entry(
  player: PlayerIdentityInput,
  side: 'current' | 'prior',
  identityKey: string,
  status: RosterStatusValue,
  confidence: RosterConfidenceValue,
  reason: RosterStatusReason
): RosterStatusEntry {
  return { player, side, identityKey, derived: { status, confidence, reason } };
}

/**
 * Derives roster status for every player record in an identity overlap result.
 * Returns one entry per source record; derived metadata is separate from player data.
 * Ambiguous records are preserved with unknown/low status — never dropped or merged.
 * Does not classify transfers, promotions, relegations, y-up, z-down, or confidence scores
 * beyond what is deterministically knowable from exact identity overlap alone.
 */
export function deriveRosterStatusFromOverlap(
  overlapResult: PlayerIdentityOverlapResult
): RosterStatusEntry[] {
  const entries: RosterStatusEntry[] = [];

  for (const match of overlapResult.exactMatches) {
    entries.push(entry(match.current, 'current', match.identityKey, 'returning', 'high', 'exact-identity-match'));
    entries.push(entry(match.prior, 'prior', match.identityKey, 'returning', 'high', 'exact-identity-match'));
  }

  for (const group of overlapResult.currentOnly) {
    for (const player of group.players) {
      entries.push(entry(player, 'current', group.identityKey, 'new', 'high', 'current-only'));
    }
  }

  for (const group of overlapResult.priorOnly) {
    for (const player of group.players) {
      entries.push(entry(player, 'prior', group.identityKey, 'not-returning', 'high', 'prior-only'));
    }
  }

  for (const group of overlapResult.ambiguous) {
    for (const player of group.current) {
      entries.push(entry(player, 'current', group.identityKey, 'unknown', 'low', 'ambiguous-identity'));
    }
    for (const player of group.prior) {
      entries.push(entry(player, 'prior', group.identityKey, 'unknown', 'low', 'ambiguous-identity'));
    }
  }

  return entries;
}
