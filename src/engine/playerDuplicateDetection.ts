import { getPlayerIdentityKey } from './playerIdentity';

export type PlayerIdentityInput = {
  id?: string;
  name: string;
  teamId?: string;
  jerseyNumber?: string | number;
};

export type PlayerIdentityDuplicateGroup = {
  identityKey: string;
  players: PlayerIdentityInput[];
};

/**
 * Groups player records that share the same deterministic identity key.
 * Returns only groups with 2 or more players (exact duplicates).
 * Groups appear in the order their key first appeared in the input.
 * Players within each group appear in original input order.
 * Throws if any player name is empty or whitespace-only.
 */
export function findDuplicatePlayerIdentityGroups(
  players: PlayerIdentityInput[]
): PlayerIdentityDuplicateGroup[] {
  const keyOrder: string[] = [];
  const groups = new Map<string, PlayerIdentityInput[]>();

  for (const player of players) {
    const key = getPlayerIdentityKey(player.name);
    if (!groups.has(key)) {
      keyOrder.push(key);
      groups.set(key, []);
    }
    groups.get(key)!.push(player);
  }

  const result: PlayerIdentityDuplicateGroup[] = [];
  for (const key of keyOrder) {
    const group = groups.get(key)!;
    if (group.length >= 2) {
      result.push({ identityKey: key, players: group });
    }
  }
  return result;
}

/**
 * Returns true if any two players in the list share the same deterministic identity key.
 * Throws if any player name is empty or whitespace-only.
 */
export function hasDuplicatePlayerIdentities(players: PlayerIdentityInput[]): boolean {
  return findDuplicatePlayerIdentityGroups(players).length > 0;
}
