import { getPlayerIdentityKey } from './playerIdentity';
import type { PlayerIdentityInput } from './playerDuplicateDetection';

export type { PlayerIdentityInput };

export type ExactIdentityMatch = {
  identityKey: string;
  current: PlayerIdentityInput;
  prior: PlayerIdentityInput;
};

export type IdentityOnlyGroup = {
  identityKey: string;
  players: PlayerIdentityInput[];
};

export type AmbiguousIdentityGroup = {
  identityKey: string;
  current: PlayerIdentityInput[];
  prior: PlayerIdentityInput[];
  reason: 'duplicate-current' | 'duplicate-prior' | 'duplicate-both';
};

export type PlayerIdentityOverlapResult = {
  exactMatches: ExactIdentityMatch[];
  currentOnly: IdentityOnlyGroup[];
  priorOnly: IdentityOnlyGroup[];
  ambiguous: AmbiguousIdentityGroup[];
};

function groupByKey(
  players: PlayerIdentityInput[]
): { keyOrder: string[]; groups: Map<string, PlayerIdentityInput[]> } {
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
  return { keyOrder, groups };
}

/**
 * Compares two player lists by exact identity key.
 * Returns exact matches, current-only, prior-only, and ambiguous groups.
 * Does not classify roster status, infer fuzzy matches, or resolve collisions.
 * Throws if any player name is empty or whitespace-only.
 */
export function comparePlayerIdentityOverlap(
  currentPlayers: PlayerIdentityInput[],
  priorPlayers: PlayerIdentityInput[]
): PlayerIdentityOverlapResult {
  const { keyOrder: currentKeyOrder, groups: currentGroups } = groupByKey(currentPlayers);
  const { keyOrder: priorKeyOrder, groups: priorGroups } = groupByKey(priorPlayers);

  const exactMatches: ExactIdentityMatch[] = [];
  const currentOnly: IdentityOnlyGroup[] = [];
  const priorOnly: IdentityOnlyGroup[] = [];
  const ambiguous: AmbiguousIdentityGroup[] = [];

  // Track keys placed into ambiguous to avoid duplicates across categories.
  const ambiguousKeys = new Set<string>();

  // Walk current keys first (determines order for exactMatches, currentOnly, and
  // any ambiguous keys first seen in current).
  for (const key of currentKeyOrder) {
    const cur = currentGroups.get(key)!;
    const pri = priorGroups.get(key) ?? [];

    const curDup = cur.length > 1;
    const priDup = pri.length > 1;

    if (curDup || priDup) {
      const reason: AmbiguousIdentityGroup['reason'] =
        curDup && priDup ? 'duplicate-both' : curDup ? 'duplicate-current' : 'duplicate-prior';
      ambiguous.push({ identityKey: key, current: cur, prior: pri, reason });
      ambiguousKeys.add(key);
    } else if (pri.length === 0) {
      currentOnly.push({ identityKey: key, players: cur });
    } else {
      exactMatches.push({ identityKey: key, current: cur[0], prior: pri[0] });
    }
  }

  // Walk prior keys to pick up prior-only and any prior-side ambiguous keys not
  // already seen while walking current.
  for (const key of priorKeyOrder) {
    if (ambiguousKeys.has(key)) continue;
    if (currentGroups.has(key)) continue; // already handled above

    const pri = priorGroups.get(key)!;
    if (pri.length > 1) {
      ambiguous.push({ identityKey: key, current: [], prior: pri, reason: 'duplicate-prior' });
      ambiguousKeys.add(key);
    } else {
      priorOnly.push({ identityKey: key, players: pri });
    }
  }

  return { exactMatches, currentOnly, priorOnly, ambiguous };
}
