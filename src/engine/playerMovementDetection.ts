import { getPlayerIdentityKey } from './playerIdentity';
import type { PlayerIdentityInput } from './playerIdentityOverlap';

export type { PlayerIdentityInput };

/**
 * Phase 3 slice 4: exact-identity transfer (team-slot) detection — ENGINE ONLY.
 *
 * This helper detects player movement BETWEEN team slots from one season to the
 * next, using exact identity keys only (the same `getPlayerIdentityKey` pipeline
 * the prior-season overlap engine uses). It deliberately does NOT implement the
 * richer movement taxonomy from `docs/derived-logic.md`: district-change transfer
 * semantics, promotion / relegation / lateral movement, y-up / z-down, fuzzy
 * matching, confidence scoring beyond high/low, and import-collision resolution
 * all remain future work and are NOT replaced by this slice.
 *
 * "Transfer" here means: an exact identity match exists in the prior season, but
 * the prior match sits on a DIFFERENT team slot than the player's current team
 * slot. "Same-team returning" means the exact prior match sits on the SAME team
 * slot. See {@link isSameTeamSlot} for the team-slot definition.
 *
 * Roster authority rule (carried forward): loaded roster records are
 * authoritative. This helper never alters, removes, suppresses, merges,
 * nullifies, rewrites, reorders, or ignores source records. Ambiguity affects
 * derived metadata only — duplicate/ambiguous identity keys on either side are
 * classified as `unknown` (low confidence) and remain individually present.
 */

/**
 * The minimal team context needed to decide whether two roster records belong to
 * the same team slot across seasons. Intentionally narrow: it is a structural
 * subset of the domain `Team` shape, so an existing `Team` is assignable to it.
 *
 * `seasonId` is retained for provenance and display, but is deliberately EXCLUDED
 * from same-slot comparison — the whole point of cross-season detection is that
 * the seasons differ. A team slot is identified across seasons by
 * `districtId` + `ageDivisionId` + `teamCode` (matching the same-slot definition
 * documented in `docs/data-model.md`).
 */
export type TeamSlotContext = {
  seasonId: string;
  districtId: string;
  ageDivisionId: string;
  teamCode: string;
};

/**
 * A single roster record: a source player paired with its team context. Both the
 * `player` and `team` references are preserved by reference and never mutated.
 */
export type RosterMovementRecord = {
  player: PlayerIdentityInput;
  team: TeamSlotContext;
};

export type PlayerMovementSide = 'current' | 'prior';

export type PlayerMovementStatus =
  | 'same-team-returning'
  | 'transferred-in'
  | 'transferred-out'
  | 'new-to-conference'
  | 'not-returning'
  | 'unknown';

export type PlayerMovementConfidence = 'high' | 'low';

export type PlayerMovementReason =
  | 'same-team-exact-match'
  | 'different-team-exact-match'
  | 'current-only'
  | 'prior-only'
  | 'ambiguous-identity';

export type DerivedPlayerMovement = {
  status: PlayerMovementStatus;
  confidence: PlayerMovementConfidence;
  reason: PlayerMovementReason;
};

/**
 * One perspective-aware output entry per relevant source roster record.
 *
 * - `record` is the source roster record, preserved by reference.
 * - `side` records which roster the source record came from.
 * - `matchedTeam` is the counterpart team slot for matched buckets
 *   (same-team-returning, transferred-in, transferred-out) and `null` otherwise.
 *   For `transferred-in` it is the prior team the player came FROM; for
 *   `transferred-out` it is the current team the player went TO.
 * - `derived` is fresh metadata attached alongside the record, never on it.
 */
export type PlayerMovementEntry = {
  identityKey: string;
  side: PlayerMovementSide;
  record: RosterMovementRecord;
  matchedTeam: TeamSlotContext | null;
  derived: DerivedPlayerMovement;
};

export type ExactPriorSeasonPlayerMovementResult = {
  sameTeamReturning: PlayerMovementEntry[];
  transferredIn: PlayerMovementEntry[];
  transferredOut: PlayerMovementEntry[];
  newToConference: PlayerMovementEntry[];
  notReturning: PlayerMovementEntry[];
  unknown: PlayerMovementEntry[];
};

const SAME_TEAM_RETURNING: DerivedPlayerMovement = {
  status: 'same-team-returning',
  confidence: 'high',
  reason: 'same-team-exact-match',
};

const TRANSFERRED_IN: DerivedPlayerMovement = {
  status: 'transferred-in',
  confidence: 'high',
  reason: 'different-team-exact-match',
};

const TRANSFERRED_OUT: DerivedPlayerMovement = {
  status: 'transferred-out',
  confidence: 'high',
  reason: 'different-team-exact-match',
};

const NEW_TO_CONFERENCE: DerivedPlayerMovement = {
  status: 'new-to-conference',
  confidence: 'high',
  reason: 'current-only',
};

const NOT_RETURNING: DerivedPlayerMovement = {
  status: 'not-returning',
  confidence: 'high',
  reason: 'prior-only',
};

const UNKNOWN: DerivedPlayerMovement = {
  status: 'unknown',
  confidence: 'low',
  reason: 'ambiguous-identity',
};

/**
 * Two records belong to the same team slot when their district, age division, and
 * team code all match. `seasonId` is intentionally excluded: same-slot detection
 * is a cross-season comparison, so the seasons are expected to differ.
 */
function isSameTeamSlot(a: TeamSlotContext, b: TeamSlotContext): boolean {
  return (
    a.districtId === b.districtId &&
    a.ageDivisionId === b.ageDivisionId &&
    a.teamCode === b.teamCode
  );
}

type KeyGroups = {
  keyOrder: string[];
  byKey: Map<string, RosterMovementRecord[]>;
};

/**
 * Groups roster records by exact identity key, preserving first-appearance key
 * order and original record order within each key. Throws (via the identity
 * pipeline) if any player name is empty or whitespace-only.
 */
function groupRecordsByKey(records: RosterMovementRecord[]): KeyGroups {
  const keyOrder: string[] = [];
  const byKey = new Map<string, RosterMovementRecord[]>();
  for (const record of records) {
    const key = getPlayerIdentityKey(record.player.name);
    if (!byKey.has(key)) {
      keyOrder.push(key);
      byKey.set(key, []);
    }
    byKey.get(key)!.push(record);
  }
  return { keyOrder, byKey };
}

function entry(
  identityKey: string,
  side: PlayerMovementSide,
  record: RosterMovementRecord,
  matchedTeam: TeamSlotContext | null,
  derived: DerivedPlayerMovement
): PlayerMovementEntry {
  return { identityKey, side, record, matchedTeam, derived };
}

/**
 * Detects exact-identity player movement between current-season and prior-season
 * rosters across all team slots provided.
 *
 * Built on the exact-identity key pipeline (`getPlayerIdentityKey`), so matching
 * is exact normalized-name only — no fuzzy matching and no initial inference.
 *
 * Classification per identity key:
 *   - Duplicate key on either side (current and/or prior) -> every record with
 *     that key is `unknown` / low-confidence and appears ONLY in `unknown`.
 *   - Exactly one current and one prior record -> same team slot is
 *     `sameTeamReturning`; different team slot splits into `transferredIn`
 *     (current side) and `transferredOut` (prior side).
 *   - One current record, no prior match -> `newToConference`.
 *   - One prior record, no current match -> `notReturning`.
 *
 * Guarantees:
 *   - Every source record produces exactly one perspective-aware output entry, so
 *     the total entry count always equals currentRecords.length +
 *     priorRecords.length. No record is dropped, merged, reordered, or mutated.
 *   - Source `player` and `team` objects are preserved by reference; derived
 *     metadata is attached alongside, never on the source objects.
 *   - Deterministic ordering: current-side entries follow current input order;
 *     prior-side entries follow prior input order. Within `unknown`, current-side
 *     records (current order) precede prior-side records (prior order).
 *
 * Throws if any player name is empty or whitespace-only (inherited from the
 * identity pipeline).
 */
export function detectExactPriorSeasonPlayerMovement(
  currentRecords: RosterMovementRecord[],
  priorRecords: RosterMovementRecord[]
): ExactPriorSeasonPlayerMovementResult {
  const current = groupRecordsByKey(currentRecords);
  const prior = groupRecordsByKey(priorRecords);

  const isAmbiguous = (key: string): boolean =>
    (current.byKey.get(key)?.length ?? 0) > 1 ||
    (prior.byKey.get(key)?.length ?? 0) > 1;

  const result: ExactPriorSeasonPlayerMovementResult = {
    sameTeamReturning: [],
    transferredIn: [],
    transferredOut: [],
    newToConference: [],
    notReturning: [],
    unknown: [],
  };

  // Current-side walk (current input order). Each current record yields exactly
  // one entry.
  for (const record of currentRecords) {
    const key = getPlayerIdentityKey(record.player.name);
    if (isAmbiguous(key)) {
      result.unknown.push(entry(key, 'current', record, null, UNKNOWN));
      continue;
    }
    const priorMatch = prior.byKey.get(key); // length 0 or 1 when not ambiguous
    if (priorMatch && priorMatch.length === 1) {
      const priorTeam = priorMatch[0].team;
      if (isSameTeamSlot(record.team, priorTeam)) {
        result.sameTeamReturning.push(
          entry(key, 'current', record, priorTeam, SAME_TEAM_RETURNING)
        );
      } else {
        result.transferredIn.push(
          entry(key, 'current', record, priorTeam, TRANSFERRED_IN)
        );
      }
    } else {
      result.newToConference.push(
        entry(key, 'current', record, null, NEW_TO_CONFERENCE)
      );
    }
  }

  // Prior-side walk (prior input order). Each prior record yields exactly one
  // entry.
  for (const record of priorRecords) {
    const key = getPlayerIdentityKey(record.player.name);
    if (isAmbiguous(key)) {
      result.unknown.push(entry(key, 'prior', record, null, UNKNOWN));
      continue;
    }
    const currentMatch = current.byKey.get(key); // length 0 or 1 when not ambiguous
    if (currentMatch && currentMatch.length === 1) {
      const currentTeam = currentMatch[0].team;
      if (isSameTeamSlot(record.team, currentTeam)) {
        result.sameTeamReturning.push(
          entry(key, 'prior', record, currentTeam, SAME_TEAM_RETURNING)
        );
      } else {
        result.transferredOut.push(
          entry(key, 'prior', record, currentTeam, TRANSFERRED_OUT)
        );
      }
    } else {
      result.notReturning.push(
        entry(key, 'prior', record, null, NOT_RETURNING)
      );
    }
  }

  return result;
}
