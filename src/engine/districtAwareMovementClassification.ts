import { compareTeamClassifications } from './teamClassification';
import {
  detectExactPriorSeasonPlayerMovement,
  type ExactPriorSeasonPlayerMovementResult,
  type PlayerMovementEntry,
  type PlayerMovementSide,
  type RosterMovementRecord,
  type TeamSlotContext,
} from './playerMovementDetection';
import type { PlayerIdentityInput } from './playerIdentityOverlap';

/**
 * Phase 3 slice 6: district-aware player movement classification — ENGINE ONLY.
 *
 * This is a derived INTERPRETATION layer sitting on top of the exact team-slot
 * movement SIGNAL from Phase 3 slice 4 (`detectExactPriorSeasonPlayerMovement`).
 * The slice-4 detector answers only "does this exact identity sit on the same
 * team slot, a different team slot, only the current season, or only the prior
 * season?" — its `transferredIn` / `transferredOut` buckets are an input signal,
 * not a final product verdict. This layer reads that signal and, using district
 * context and the existing competitive hierarchy, produces product-level movement
 * statuses.
 *
 * Distinctions this layer enforces (see `docs/derived-logic.md`):
 *   - Exact team-slot movement is the INPUT. This module does NOT replace or
 *     mutate the slice-4 detector; it consumes its output read-only.
 *   - A **district change** is a `transfer`. Same-district, same-age-division
 *     movement between different slots is candidate promotion / relegation /
 *     lateral, decided by the competitive hierarchy
 *     `A(x) > B1 > C1 = B2 > B3+ = C2 = D2`, where `A(x)` is any valid A-code
 *     (A1..A4) treated as the single top tier.
 *   - Different age division is handled CONSERVATIVELY. y-up / z-down cohort
 *     reclassification is intentionally NOT implemented here; it is Phase 4 work.
 *     Same-district + different-age-division movement is reported as the neutral
 *     `age-division-change`, and different-district movement stays `transfer`
 *     regardless of age division.
 *   - Ambiguous (duplicate-name) identities stay `unknown` and are never
 *     classified as transfer / promoted / relegated / lateral.
 *
 * Roster authority rule (carried forward): loaded roster records are
 * authoritative. This helper never alters, removes, suppresses, merges,
 * nullifies, rewrites, reorders, or ignores source records. Source `player` and
 * `team` objects are preserved by reference; all classification is fresh derived
 * metadata attached alongside.
 */

export type DistrictAwareMovementStatus =
  | 'same-team-returning'
  | 'promoted'
  | 'relegated'
  | 'lateral'
  | 'transfer'
  | 'age-division-change'
  | 'new-to-conference'
  | 'not-returning'
  | 'unknown';

export type DistrictAwareMovementConfidence = 'high' | 'low';

export type DistrictAwareMovementReason =
  | 'same-team-slot'
  | 'same-district-higher-team'
  | 'same-district-lower-team'
  | 'same-district-equivalent-team'
  // Conservative fallback: same district + same age division + different slot,
  // but at least one team code is genuinely unsupported/invalid and cannot be
  // parsed by the team-classification helper (e.g. a malformed code, or an
  // out-of-range code like `C3`). Valid A-codes (A1..A4) ARE rankable as the top
  // tier and never reach this fallback. No promotion/relegation direction is
  // claimed for an unrankable code.
  | 'same-district-unrankable-team'
  | 'different-district'
  | 'same-district-different-age-division'
  | 'new-current-identity'
  | 'missing-current-identity'
  | 'ambiguous-identity';

export type DistrictAwareMovementClassification = {
  status: DistrictAwareMovementStatus;
  confidence: DistrictAwareMovementConfidence;
  reason: DistrictAwareMovementReason;
};

/**
 * One perspective-aware classification entry per underlying slice-4 movement
 * entry, so the entry count always equals the slice-4 entry count (one per
 * relevant source roster record).
 *
 * - `identityKey` / `side` are carried through from the underlying movement entry.
 * - `player` and `record` are the source references, preserved by reference and
 *   never mutated.
 * - `currentTeam` / `priorTeam` give the resolved current-season and prior-season
 *   team slot context where applicable, and `null` where it does not apply (e.g.
 *   `priorTeam` is null for `new-to-conference`).
 * - `classification` is the derived product-level verdict.
 * - `source` is the underlying slice-4 entry, preserved by reference for trace.
 */
export type DistrictAwareMovementEntry = {
  identityKey: string;
  side: PlayerMovementSide;
  player: PlayerIdentityInput;
  record: RosterMovementRecord;
  currentTeam: TeamSlotContext | null;
  priorTeam: TeamSlotContext | null;
  classification: DistrictAwareMovementClassification;
  source: PlayerMovementEntry;
};

export type DistrictAwarePlayerMovementResult = {
  entries: DistrictAwareMovementEntry[];
};

/**
 * Resolves the current-season and prior-season team slots for a slice-4 movement
 * entry from its `side` and `matchedTeam`. For a current-side entry the record's
 * own team is the current slot and `matchedTeam` (if any) is the prior slot; for
 * a prior-side entry the roles are reversed. `matchedTeam` is null where there is
 * no counterpart (new-to-conference, not-returning, unknown).
 */
function resolveTeams(entry: PlayerMovementEntry): {
  currentTeam: TeamSlotContext | null;
  priorTeam: TeamSlotContext | null;
} {
  if (entry.side === 'current') {
    return { currentTeam: entry.record.team, priorTeam: entry.matchedTeam };
  }
  return { currentTeam: entry.matchedTeam, priorTeam: entry.record.team };
}

const SAME_TEAM_RETURNING: DistrictAwareMovementClassification = {
  status: 'same-team-returning',
  confidence: 'high',
  reason: 'same-team-slot',
};

const TRANSFER: DistrictAwareMovementClassification = {
  status: 'transfer',
  confidence: 'high',
  reason: 'different-district',
};

const AGE_DIVISION_CHANGE: DistrictAwareMovementClassification = {
  status: 'age-division-change',
  confidence: 'high',
  reason: 'same-district-different-age-division',
};

const PROMOTED: DistrictAwareMovementClassification = {
  status: 'promoted',
  confidence: 'high',
  reason: 'same-district-higher-team',
};

const RELEGATED: DistrictAwareMovementClassification = {
  status: 'relegated',
  confidence: 'high',
  reason: 'same-district-lower-team',
};

const LATERAL: DistrictAwareMovementClassification = {
  status: 'lateral',
  confidence: 'high',
  reason: 'same-district-equivalent-team',
};

const LATERAL_UNRANKABLE: DistrictAwareMovementClassification = {
  status: 'lateral',
  confidence: 'low',
  reason: 'same-district-unrankable-team',
};

const NEW_TO_CONFERENCE: DistrictAwareMovementClassification = {
  status: 'new-to-conference',
  confidence: 'high',
  reason: 'new-current-identity',
};

const NOT_RETURNING: DistrictAwareMovementClassification = {
  status: 'not-returning',
  confidence: 'high',
  reason: 'missing-current-identity',
};

const UNKNOWN: DistrictAwareMovementClassification = {
  status: 'unknown',
  confidence: 'low',
  reason: 'ambiguous-identity',
};

/**
 * Classifies same-district, same-age-division movement between two different team
 * slots using the competitive hierarchy `A(x) > B1 > C1 = B2 > B3+ = C2 = D2`.
 * Valid A-codes (A1..A4) are rankable as the top tier. Returns a conservative
 * low-confidence `lateral` only when a team code is genuinely unsupported/invalid
 * and cannot be parsed (e.g. a malformed code), so the layer stays deterministic,
 * never throws, and never claims a false direction.
 */
function classifyCompetitiveTier(
  currentTeamCode: string,
  priorTeamCode: string
): DistrictAwareMovementClassification {
  let comparison: number;
  try {
    // Negative => current is the stronger tier; positive => prior is stronger.
    comparison = compareTeamClassifications(currentTeamCode, priorTeamCode);
  } catch {
    return LATERAL_UNRANKABLE;
  }
  if (comparison < 0) return PROMOTED;
  if (comparison > 0) return RELEGATED;
  return LATERAL;
}

/**
 * Interprets a different-team-slot movement signal (slice-4 transferredIn /
 * transferredOut) with district and age-division context. Both team slots are
 * present for this case.
 */
function classifyDifferentSlot(
  currentTeam: TeamSlotContext,
  priorTeam: TeamSlotContext
): DistrictAwareMovementClassification {
  if (currentTeam.districtId !== priorTeam.districtId) {
    // District change is a transfer in this layer, regardless of age division.
    // Promotion/relegation/lateral are intentionally NOT also claimed.
    return TRANSFER;
  }
  if (currentTeam.ageDivisionId !== priorTeam.ageDivisionId) {
    // Conservative: y-up / z-down cohort reclassification is Phase 4 work. A
    // same-district division change is reported neutrally here.
    return AGE_DIVISION_CHANGE;
  }
  return classifyCompetitiveTier(currentTeam.teamCode, priorTeam.teamCode);
}

/**
 * Maps one slice-4 movement entry to its product-level classification entry.
 */
function classifyEntry(entry: PlayerMovementEntry): DistrictAwareMovementEntry {
  const { currentTeam, priorTeam } = resolveTeams(entry);

  let classification: DistrictAwareMovementClassification;
  switch (entry.derived.status) {
    case 'same-team-returning':
      classification = SAME_TEAM_RETURNING;
      break;
    case 'transferred-in':
    case 'transferred-out':
      // Both team slots are guaranteed present for the different-slot signal.
      classification = classifyDifferentSlot(currentTeam!, priorTeam!);
      break;
    case 'new-to-conference':
      classification = NEW_TO_CONFERENCE;
      break;
    case 'not-returning':
      classification = NOT_RETURNING;
      break;
    case 'unknown':
    default:
      classification = UNKNOWN;
      break;
  }

  return {
    identityKey: entry.identityKey,
    side: entry.side,
    player: entry.record.player,
    record: entry.record,
    currentTeam,
    priorTeam,
    classification,
    source: entry,
  };
}

/**
 * Deterministic bucket order used to flatten the slice-4 result into one entry
 * stream. Within each bucket the slice-4 detector already preserves source input
 * order, so this ordering is fully deterministic.
 */
function flattenMovementEntries(
  movement: ExactPriorSeasonPlayerMovementResult
): PlayerMovementEntry[] {
  return [
    ...movement.sameTeamReturning,
    ...movement.transferredIn,
    ...movement.transferredOut,
    ...movement.newToConference,
    ...movement.notReturning,
    ...movement.unknown,
  ];
}

/**
 * Classifies district-aware player movement by building on top of the exact
 * team-slot movement detector (`detectExactPriorSeasonPlayerMovement`).
 *
 * The detector is called read-only; its output is interpreted, never mutated.
 * Each underlying movement entry yields exactly one classification entry, so the
 * total equals `currentRecords.length + priorRecords.length`. No source record is
 * dropped, merged, reordered, or mutated.
 *
 * Classification rules (see module docstring and `docs/derived-logic.md`):
 *   - same team slot                                   -> `same-team-returning`
 *   - different slot, same district, same age division -> `promoted` / `relegated`
 *                                                         / `lateral` by hierarchy
 *   - different slot, same district, diff age division -> `age-division-change`
 *   - different slot, different district               -> `transfer`
 *   - current-only exact identity                      -> `new-to-conference`
 *   - prior-only exact identity                        -> `not-returning`
 *   - ambiguous (duplicate) identity                   -> `unknown`
 *
 * Throws only via the inherited identity pipeline if a player name is empty or
 * whitespace-only.
 */
export function classifyDistrictAwarePlayerMovement(
  currentRecords: RosterMovementRecord[],
  priorRecords: RosterMovementRecord[]
): DistrictAwarePlayerMovementResult {
  const movement = detectExactPriorSeasonPlayerMovement(
    currentRecords,
    priorRecords
  );
  const entries = flattenMovementEntries(movement).map(classifyEntry);
  return { entries };
}
