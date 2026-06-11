import { getPlayerIdentityKey } from './playerIdentity';
import { getAgeDivisionRank } from './ageDivision';
import type {
  RosterMovementRecord,
  TeamSlotContext,
} from './playerMovementDetection';
import type { PlayerIdentityInput } from './playerIdentityOverlap';

export type { RosterMovementRecord, TeamSlotContext };

/**
 * Phase 4 slice 1: cohort reclassification SIGNAL detection — ENGINE ONLY.
 *
 * This helper inspects exact-identity players whose prior-season and
 * current-season records sit in DIFFERENT age divisions and flags whether the
 * year-over-year age-division movement looks like a normal one-division
 * progression, an unchanged division, or a possible y-up / z-down cohort
 * reclassification candidate. It is engine-only: no UI, no player-card badges,
 * and no import behavior change.
 *
 * Scope guardrails (see `docs/derived-logic.md` "## Y-Up / Z-Down"):
 *   - This is a SIGNAL layer only. It detects y-up / z-down CANDIDATES; it does
 *     NOT persist a cohort offset, carry reclassification forward across future
 *     seasons, or reset a preserved path. That preservation work is the rest of
 *     Phase 4 and is layered on top of this signal, not folded into it.
 *   - Matching is exact identity only, reusing `getPlayerIdentityKey`. There is
 *     no fuzzy matching and no initial inference.
 *   - Classification uses age-division ORDINAL movement only. It deliberately
 *     does NOT consult grade, birthdate, player age, or roster notes.
 *   - Ambiguous (duplicate-name) identities stay `unknown` / low-confidence and
 *     are never classified as a candidate.
 *
 * Roster authority rule (carried forward): loaded roster records are
 * authoritative. This helper never alters, removes, suppresses, merges,
 * nullifies, rewrites, reorders, or ignores source records. Source `player` and
 * `team` objects are preserved by reference; all signal metadata is fresh and
 * attached alongside, never on the source objects.
 */

export type CohortReclassificationSide = 'current' | 'prior';

export type CohortReclassificationStatus =
  | 'expected-age-progression'
  | 'y-up-candidate'
  | 'z-down-candidate'
  | 'same-age-division'
  | 'unknown';

export type CohortReclassificationConfidence = 'high' | 'low';

export type CohortReclassificationReason =
  | 'normal-one-division-progression'
  | 'skipped-age-division'
  | 'moved-down-age-division'
  | 'unchanged-age-division'
  | 'ambiguous-identity'
  | 'missing-current-record'
  | 'missing-prior-record'
  | 'invalid-age-division';

export type CohortReclassificationSignal = {
  status: CohortReclassificationStatus;
  confidence: CohortReclassificationConfidence;
  reason: CohortReclassificationReason;
};

/**
 * One perspective-aware signal entry per relevant source roster record, so the
 * total entry count always equals `currentRecords.length + priorRecords.length`.
 *
 * - `identityKey` / `side` identify the record and which roster it came from.
 * - `player` and `record` are the source references, preserved by reference and
 *   never mutated.
 * - `currentTeam` / `priorTeam` resolve the current-season and prior-season team
 *   slot context where available, and are `null` where they do not apply (e.g.
 *   `priorTeam` is null for a current-only `missing-prior-record`).
 * - `currentAgeDivisionId` / `priorAgeDivisionId` mirror the resolved teams'
 *   raw age-division ids (the unparsed source values) where available, else
 *   `null`. They are reported as-is even when unsupported, so a reviewer can see
 *   the raw division that triggered an `invalid-age-division` signal.
 * - `signal` is the derived cohort reclassification verdict.
 */
export type CohortReclassificationEntry = {
  identityKey: string;
  side: CohortReclassificationSide;
  player: PlayerIdentityInput;
  record: RosterMovementRecord;
  currentTeam: TeamSlotContext | null;
  priorTeam: TeamSlotContext | null;
  currentAgeDivisionId: string | null;
  priorAgeDivisionId: string | null;
  signal: CohortReclassificationSignal;
};

export type CohortReclassificationSignalResult = {
  entries: CohortReclassificationEntry[];
};

const EXPECTED_AGE_PROGRESSION: CohortReclassificationSignal = {
  status: 'expected-age-progression',
  confidence: 'high',
  reason: 'normal-one-division-progression',
};

const SAME_AGE_DIVISION: CohortReclassificationSignal = {
  status: 'same-age-division',
  confidence: 'high',
  reason: 'unchanged-age-division',
};

const Y_UP_CANDIDATE: CohortReclassificationSignal = {
  status: 'y-up-candidate',
  confidence: 'high',
  reason: 'skipped-age-division',
};

const Z_DOWN_CANDIDATE: CohortReclassificationSignal = {
  status: 'z-down-candidate',
  confidence: 'high',
  reason: 'moved-down-age-division',
};

const INVALID_AGE_DIVISION: CohortReclassificationSignal = {
  status: 'unknown',
  confidence: 'low',
  reason: 'invalid-age-division',
};

const AMBIGUOUS_IDENTITY: CohortReclassificationSignal = {
  status: 'unknown',
  confidence: 'low',
  reason: 'ambiguous-identity',
};

const MISSING_PRIOR_RECORD: CohortReclassificationSignal = {
  status: 'unknown',
  confidence: 'low',
  reason: 'missing-prior-record',
};

const MISSING_CURRENT_RECORD: CohortReclassificationSignal = {
  status: 'unknown',
  confidence: 'low',
  reason: 'missing-current-record',
};

/**
 * Returns the fixed age-division ordinal (SC=1 .. BA=6) or `null` when the id is
 * missing, malformed, or unsupported. Never throws, so the signal layer stays
 * deterministic and classifies invalid data as `invalid-age-division` rather
 * than failing.
 */
function safeAgeDivisionRank(ageDivisionId: string): number | null {
  try {
    return getAgeDivisionRank(ageDivisionId);
  } catch {
    return null;
  }
}

/**
 * Classifies a matched current/prior pair by age-division ordinal movement only.
 *   - one division up   -> expected-age-progression
 *   - unchanged         -> same-age-division
 *   - more than one up  -> y-up-candidate
 *   - one or more down  -> z-down-candidate
 *   - either side invalid/unsupported -> invalid-age-division (unknown/low)
 */
function classifyAgeDivisionMovement(
  currentAgeDivisionId: string,
  priorAgeDivisionId: string
): CohortReclassificationSignal {
  const current = safeAgeDivisionRank(currentAgeDivisionId);
  const prior = safeAgeDivisionRank(priorAgeDivisionId);
  if (current === null || prior === null) {
    return INVALID_AGE_DIVISION;
  }
  const delta = current - prior;
  if (delta === 0) return SAME_AGE_DIVISION;
  if (delta === 1) return EXPECTED_AGE_PROGRESSION;
  if (delta >= 2) return Y_UP_CANDIDATE;
  return Z_DOWN_CANDIDATE; // delta <= -1: moved down one or more divisions
}

type KeyGroups = {
  byKey: Map<string, RosterMovementRecord[]>;
};

/**
 * Groups roster records by exact identity key, preserving original record order
 * within each key. Throws (via the identity pipeline) if any player name is empty
 * or whitespace-only.
 */
function groupRecordsByKey(records: RosterMovementRecord[]): KeyGroups {
  const byKey = new Map<string, RosterMovementRecord[]>();
  for (const record of records) {
    const key = getPlayerIdentityKey(record.player.name);
    if (!byKey.has(key)) {
      byKey.set(key, []);
    }
    byKey.get(key)!.push(record);
  }
  return { byKey };
}

function entry(
  identityKey: string,
  side: CohortReclassificationSide,
  record: RosterMovementRecord,
  currentTeam: TeamSlotContext | null,
  priorTeam: TeamSlotContext | null,
  signal: CohortReclassificationSignal
): CohortReclassificationEntry {
  return {
    identityKey,
    side,
    player: record.player,
    record,
    currentTeam,
    priorTeam,
    currentAgeDivisionId: currentTeam ? currentTeam.ageDivisionId : null,
    priorAgeDivisionId: priorTeam ? priorTeam.ageDivisionId : null,
    signal,
  };
}

/**
 * Detects cohort reclassification SIGNALS for exact-identity players by comparing
 * their prior-season and current-season age divisions.
 *
 * Matching is exact identity only (`getPlayerIdentityKey`); classification uses
 * age-division ordinal movement only (no grade, birthdate, age, or notes).
 *
 * Classification per identity key:
 *   - Duplicate key on either side -> every record with that key is `unknown` /
 *     low-confidence (`ambiguous-identity`). An ambiguous key is never given a
 *     candidate verdict.
 *   - Exactly one current and one prior record -> the matched pair is classified
 *     by age-division movement (expected-age-progression / same-age-division /
 *     y-up-candidate / z-down-candidate, or `invalid-age-division` if either
 *     side's division is unsupported). Both the current-side and prior-side
 *     records receive the same signal, from their own perspective.
 *   - One current record, no prior match -> `unknown` / `missing-prior-record`.
 *   - One prior record, no current match -> `unknown` / `missing-current-record`.
 *
 * Guarantees:
 *   - Every source record produces exactly one perspective-aware output entry,
 *     so the total entry count equals `currentRecords.length +
 *     priorRecords.length`. No record is dropped, merged, reordered, or mutated.
 *   - Source `player` and `team` objects are preserved by reference; signal
 *     metadata is attached alongside, never on the source objects.
 *   - Deterministic ordering: current-side entries follow current input order,
 *     then prior-side entries follow prior input order.
 *
 * Throws if any player name is empty or whitespace-only (inherited from the
 * identity pipeline).
 */
export function detectCohortReclassificationSignals(
  currentRecords: RosterMovementRecord[],
  priorRecords: RosterMovementRecord[]
): CohortReclassificationSignalResult {
  const current = groupRecordsByKey(currentRecords);
  const prior = groupRecordsByKey(priorRecords);

  const isAmbiguous = (key: string): boolean =>
    (current.byKey.get(key)?.length ?? 0) > 1 ||
    (prior.byKey.get(key)?.length ?? 0) > 1;

  const entries: CohortReclassificationEntry[] = [];

  // Current-side walk (current input order). Each current record yields exactly
  // one entry.
  for (const record of currentRecords) {
    const key = getPlayerIdentityKey(record.player.name);
    if (isAmbiguous(key)) {
      entries.push(entry(key, 'current', record, record.team, null, AMBIGUOUS_IDENTITY));
      continue;
    }
    const priorMatch = prior.byKey.get(key); // length 0 or 1 when not ambiguous
    if (priorMatch && priorMatch.length === 1) {
      const priorTeam = priorMatch[0].team;
      const signal = classifyAgeDivisionMovement(
        record.team.ageDivisionId,
        priorTeam.ageDivisionId
      );
      entries.push(entry(key, 'current', record, record.team, priorTeam, signal));
    } else {
      entries.push(entry(key, 'current', record, record.team, null, MISSING_PRIOR_RECORD));
    }
  }

  // Prior-side walk (prior input order). Each prior record yields exactly one
  // entry.
  for (const record of priorRecords) {
    const key = getPlayerIdentityKey(record.player.name);
    if (isAmbiguous(key)) {
      entries.push(entry(key, 'prior', record, null, record.team, AMBIGUOUS_IDENTITY));
      continue;
    }
    const currentMatch = current.byKey.get(key); // length 0 or 1 when not ambiguous
    if (currentMatch && currentMatch.length === 1) {
      const currentTeam = currentMatch[0].team;
      const signal = classifyAgeDivisionMovement(
        currentTeam.ageDivisionId,
        record.team.ageDivisionId
      );
      entries.push(entry(key, 'prior', record, currentTeam, record.team, signal));
    } else {
      entries.push(entry(key, 'prior', record, null, record.team, MISSING_CURRENT_RECORD));
    }
  }

  return { entries };
}
