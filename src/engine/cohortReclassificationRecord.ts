import { getAgeDivisionRank } from './ageDivision';
import type {
  CohortReclassificationEntry,
  CohortReclassificationSignalResult,
} from './cohortReclassificationSignal';
import type {
  RosterMovementRecord,
  TeamSlotContext,
} from './playerMovementDetection';
import type { PlayerIdentityInput } from './playerIdentityOverlap';

/**
 * Phase 4 slice 2: first-year cohort reclassification RECORD derivation —
 * ENGINE ONLY.
 *
 * Phase 4 slice 1 (`detectCohortReclassificationSignals`) flags possible y-up /
 * z-down cohort reclassification CANDIDATES from exact-identity year-over-year
 * age-division movement. This slice consumes that signal output and records the
 * **first-year cohort reclassification event** for the high-confidence
 * candidates only.
 *
 * A y-up / z-down is a cohort reclassification event, not merely a team
 * transfer. Once identified, future logic should be able to preserve that status
 * while the player travels with the reclassified cohort. This slice records only
 * the first-year event foundation.
 *
 * Scope guardrails (see `docs/derived-logic.md` "## Y-Up / Z-Down"):
 *   - This records the FIRST-YEAR event only. It does NOT persist a cohort
 *     offset to storage, carry the reclassification forward across future
 *     seasons, or reset a preserved path. That carry-forward work is later
 *     Phase 4 and is layered on top of this record, not folded into it.
 *   - It adds no detection of its own. It strictly consumes slice 1 signal
 *     entries. There is no fuzzy matching, no initial inference, and no consult
 *     of grade, birthdate, player age, or roster notes.
 *   - Only `y-up-candidate` / `z-down-candidate` entries at `high` confidence
 *     produce records. Every other status (`expected-age-progression`,
 *     `same-age-division`, `unknown`) and every low-confidence entry is skipped.
 *   - Ambiguous (duplicate-name) identities never reach a candidate verdict in
 *     slice 1, so they never produce a record here.
 *
 * Roster authority rule (carried forward): loaded roster records are
 * authoritative. This helper never alters, removes, suppresses, merges,
 * nullifies, rewrites, reorders, or ignores source records or signal entries.
 * Source `player` and `team` objects are preserved by reference; record metadata
 * is fresh and attached alongside, never on the source objects.
 */

export type CohortReclassificationType = 'y-up' | 'z-down';

export type CohortReclassificationSourceStatus =
  | 'y-up-candidate'
  | 'z-down-candidate';

export type CohortReclassificationRecordReason =
  | 'first-year-y-up-detected'
  | 'first-year-z-down-detected';

/**
 * A first-year cohort reclassification event derived from a single
 * high-confidence slice 1 candidate signal.
 *
 * - `identityKey` is the exact-identity key shared by the matched pair.
 * - `reclassificationType` / `sourceStatus` record the event kind and the slice
 *   1 candidate status it was derived from.
 * - `firstDetectedSeasonId` is the current-season team's `seasonId`;
 *   `priorSeasonId` is the prior-season team's `seasonId`.
 * - `priorAgeDivisionId` / `currentAgeDivisionId` are the raw source age-division
 *   ids from the matched pair, preserved as-is.
 * - `ageDivisionDelta` is the age-division ordinal movement (current minus
 *   prior): positive for `y-up`, negative for `z-down`.
 * - `player`, `currentTeam`, and `priorTeam` are the source references, preserved
 *   by reference and never mutated. `player` comes from the canonical
 *   (current-side preferred) signal entry.
 * - `confidence` is always `high` (only high-confidence candidates produce a
 *   record). `reason` mirrors the event kind.
 */
export type CohortReclassificationRecord = {
  identityKey: string;
  reclassificationType: CohortReclassificationType;
  sourceStatus: CohortReclassificationSourceStatus;
  firstDetectedSeasonId: string;
  priorSeasonId: string;
  priorAgeDivisionId: string;
  currentAgeDivisionId: string;
  ageDivisionDelta: number;
  player: PlayerIdentityInput;
  currentTeam: TeamSlotContext;
  priorTeam: TeamSlotContext;
  confidence: 'high';
  reason: CohortReclassificationRecordReason;
};

export type CohortReclassificationSkippedReason =
  | 'not-a-candidate'
  | 'low-confidence'
  | 'missing-current-team'
  | 'missing-prior-team'
  | 'missing-current-season'
  | 'missing-prior-season'
  | 'invalid-age-division'
  | 'duplicate-perspective';

/**
 * A slice 1 signal entry that did NOT produce a cohort reclassification record,
 * with the reason it was skipped. `duplicate-perspective` marks the second
 * perspective (prior-side) of an event already recorded from the current side.
 */
export type CohortReclassificationSkippedEntry = {
  identityKey: string;
  side: CohortReclassificationEntry['side'];
  record: RosterMovementRecord;
  reason: CohortReclassificationSkippedReason;
};

export type CohortReclassificationRecordResult = {
  records: CohortReclassificationRecord[];
  skipped: CohortReclassificationSkippedEntry[];
};

const CANDIDATE_STATUSES = new Set<string>([
  'y-up-candidate',
  'z-down-candidate',
]);

/** A usable id is a non-empty, non-whitespace string. */
function isUsableId(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Returns the fixed age-division ordinal (SC=1 .. BA=6) or `null` when the id is
 * missing, malformed, or unsupported. Never throws, so derivation stays
 * deterministic and skips invalid divisions rather than failing.
 */
function safeAgeDivisionRank(ageDivisionId: string | null): number | null {
  if (ageDivisionId === null) return null;
  try {
    return getAgeDivisionRank(ageDivisionId);
  } catch {
    return null;
  }
}

function recordFor(
  entry: CohortReclassificationEntry,
  type: CohortReclassificationType,
  currentTeam: TeamSlotContext,
  priorTeam: TeamSlotContext,
  currentAgeDivisionId: string,
  priorAgeDivisionId: string,
  ageDivisionDelta: number
): CohortReclassificationRecord {
  return {
    identityKey: entry.identityKey,
    reclassificationType: type,
    sourceStatus:
      type === 'y-up' ? 'y-up-candidate' : 'z-down-candidate',
    firstDetectedSeasonId: currentTeam.seasonId,
    priorSeasonId: priorTeam.seasonId,
    priorAgeDivisionId,
    currentAgeDivisionId,
    ageDivisionDelta,
    player: entry.player,
    currentTeam,
    priorTeam,
    confidence: 'high',
    reason:
      type === 'y-up'
        ? 'first-year-y-up-detected'
        : 'first-year-z-down-detected',
  };
}

/**
 * Derives first-year cohort reclassification records from Phase 4 slice 1 signal
 * output.
 *
 * It records an event only for `y-up-candidate` / `z-down-candidate` entries at
 * `high` confidence that carry usable current/prior team context, usable season
 * ids on both sides, and valid age divisions on both sides. Everything else is
 * skipped (with a reason), including `expected-age-progression`,
 * `same-age-division`, `unknown`, and any low-confidence entry.
 *
 * Slice 1 emits one entry per source record, so an exact-identity event has both
 * a current-side and a prior-side entry. This helper produces exactly ONE record
 * per identity event, preferring the current-side entry as the canonical source;
 * the redundant prior-side perspective is skipped as `duplicate-perspective`.
 *
 * Guarantees:
 *   - Pure and deterministic: records and skipped entries follow slice 1 entry
 *     order (current-side entries precede prior-side entries), so the current
 *     side is always the canonical record source when both exist.
 *   - Source `player`, `team`, `record`, and signal entries are preserved by
 *     reference and never mutated. Record metadata is fresh.
 *   - `ageDivisionDelta` is positive for `y-up` and negative for `z-down`.
 */
export function deriveFirstYearCohortReclassificationRecords(
  signalResult: CohortReclassificationSignalResult
): CohortReclassificationRecordResult {
  const records: CohortReclassificationRecord[] = [];
  const skipped: CohortReclassificationSkippedEntry[] = [];
  const recordedKeys = new Set<string>();

  const skip = (
    entry: CohortReclassificationEntry,
    reason: CohortReclassificationSkippedReason
  ): void => {
    skipped.push({
      identityKey: entry.identityKey,
      side: entry.side,
      record: entry.record,
      reason,
    });
  };

  for (const entry of signalResult.entries) {
    const { status, confidence } = entry.signal;

    if (!CANDIDATE_STATUSES.has(status)) {
      skip(entry, 'not-a-candidate');
      continue;
    }
    if (confidence !== 'high') {
      skip(entry, 'low-confidence');
      continue;
    }
    if (entry.currentTeam === null) {
      skip(entry, 'missing-current-team');
      continue;
    }
    if (entry.priorTeam === null) {
      skip(entry, 'missing-prior-team');
      continue;
    }
    if (!isUsableId(entry.currentTeam.seasonId)) {
      skip(entry, 'missing-current-season');
      continue;
    }
    if (!isUsableId(entry.priorTeam.seasonId)) {
      skip(entry, 'missing-prior-season');
      continue;
    }

    const currentRank = safeAgeDivisionRank(entry.currentAgeDivisionId);
    const priorRank = safeAgeDivisionRank(entry.priorAgeDivisionId);
    if (currentRank === null || priorRank === null) {
      skip(entry, 'invalid-age-division');
      continue;
    }

    // One record per identity event: the canonical (current-side preferred)
    // entry wins; the redundant opposite perspective is a duplicate.
    if (recordedKeys.has(entry.identityKey)) {
      skip(entry, 'duplicate-perspective');
      continue;
    }

    const type: CohortReclassificationType =
      status === 'y-up-candidate' ? 'y-up' : 'z-down';
    const delta = currentRank - priorRank;

    records.push(
      recordFor(
        entry,
        type,
        entry.currentTeam,
        entry.priorTeam,
        // Non-null: a candidate verdict only arises from a matched pair with
        // resolved divisions, and the ranks above confirmed they are valid.
        entry.currentAgeDivisionId as string,
        entry.priorAgeDivisionId as string,
        delta
      )
    );
    recordedKeys.add(entry.identityKey);
  }

  return { records, skipped };
}
