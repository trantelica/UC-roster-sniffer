import {
  getAgeDivisionRank,
  getAgeDivisionIdByRank,
} from './ageDivision';
import { getPlayerIdentityKey } from './playerIdentity';
import type { CohortReclassificationRecord } from './cohortReclassificationRecord';
import type {
  RosterMovementRecord,
  TeamSlotContext,
} from './playerMovementDetection';
import type { PlayerIdentityInput } from './playerIdentityOverlap';

/**
 * Phase 4 slice 3: cohort reclassification CARRY-FORWARD — ENGINE ONLY.
 *
 * Slice 1 (`detectCohortReclassificationSignals`) detects y-up / z-down candidate
 * signals. Slice 2 (`deriveFirstYearCohortReclassificationRecords`) records the
 * first-year cohort reclassification event. This slice preserves a recorded
 * y-up / z-down status while the player continues traveling along the reclassified
 * cohort path in a LATER season, and flags the path as broken when the player
 * leaves it. It is engine-only: no UI, no player-card badges, no import behavior,
 * and no persistence.
 *
 * Core concept (see `docs/derived-logic.md` "## Y-Up / Z-Down"):
 *   - A first-year record establishes a cohort OFFSET relative to normal age
 *     progression. Normal progression is +1 age division per season. The
 *     reclassified path advances +1 age division per season from the first
 *     detected age division, so the offset is preserved automatically.
 *   - `cohortOffset = firstDetectedRank - (priorRank + 1)`: it is the distance
 *     from the normal expected division in the first detection year. It is
 *     POSITIVE for y-up and NEGATIVE for z-down, and is never zero for an actual
 *     candidate (a y-up needs ordinal delta >= 2, a z-down needs delta <= -1).
 *   - Expected age division at a later season is `firstDetectedRank + seasonSteps`
 *     (capped at the SC..BA bounds), where `seasonSteps` is how many seasons the
 *     evaluated season is after the first detected season, per `seasonOrder`.
 *
 * Conservative handling: missing current records, unusable season ordering,
 * invalid age divisions, and ambiguous (duplicate-name) identities never carry a
 * status forward. They are reported as `insufficient-history` or `unknown` so a
 * reviewer can see why, never as a silent drop. A broken path is a REVIEW SIGNAL,
 * not data deletion.
 *
 * Roster authority rule (carried forward): loaded roster records are
 * authoritative. This helper never alters, removes, suppresses, merges,
 * nullifies, rewrites, reorders, or ignores source records or first-year records.
 * Source `player`, `team`, `record`, and first-year `record` objects are preserved
 * by reference; carry-forward metadata is fresh and attached alongside, never on
 * the source objects. There is no fuzzy matching, no birthdate / grade / notes
 * inference, and no manual review/override.
 */

export type CohortReclassificationCarryForwardType = 'y-up' | 'z-down';

export type CohortReclassificationCarryForwardStatus =
  | 'first-year'
  | 'carried-forward'
  | 'path-broken'
  | 'insufficient-history'
  | 'unknown';

export type CohortReclassificationCarryForwardConfidence = 'high' | 'low';

export type CohortReclassificationCarryForwardReason =
  | 'first-year-record'
  | 'expected-offset-path'
  | 'returned-to-normal-path'
  | 'unexpected-age-division'
  | 'capped-at-top-division'
  | 'capped-at-bottom-division'
  | 'missing-current-record'
  | 'invalid-age-division'
  | 'ambiguous-identity'
  | 'missing-season-order'
  | 'first-season-not-in-order'
  | 'evaluated-season-not-in-order'
  | 'evaluated-season-before-first-detection';

/**
 * One carry-forward verdict per first-year cohort reclassification record.
 *
 * - `identityKey` / `reclassificationType` mirror the source first-year record.
 * - `player` is the first-year record's player reference (preserved by reference).
 * - `firstYearRecord` is the source slice-2 record, preserved by reference.
 * - `currentRecord` is the matched later-season roster record, or `null` when no
 *   single current record matched the identity.
 * - `firstDetectedSeasonId` / `evaluatedSeasonId` are the first detection season
 *   and the evaluated (later) season (`null` when there is no matched record).
 * - `priorAgeDivisionId` / `firstDetectedAgeDivisionId` come from the first-year
 *   record (the raw source division ids).
 * - `expectedAgeDivisionId` is the age division on the reclassified offset path at
 *   the evaluated season (`null` when it cannot be computed).
 * - `actualAgeDivisionId` is the matched current record's raw division id (`null`
 *   when there is no matched record).
 * - `cohortOffset` is the preserved offset relative to normal progression.
 * - `status` / `confidence` / `reason` are the derived verdict.
 */
export type CohortReclassificationCarryForwardEntry = {
  identityKey: string;
  reclassificationType: CohortReclassificationCarryForwardType;
  player: PlayerIdentityInput;
  firstYearRecord: CohortReclassificationRecord;
  currentRecord: RosterMovementRecord | null;
  firstDetectedSeasonId: string;
  evaluatedSeasonId: string | null;
  priorAgeDivisionId: string;
  firstDetectedAgeDivisionId: string;
  expectedAgeDivisionId: string | null;
  actualAgeDivisionId: string | null;
  cohortOffset: number;
  status: CohortReclassificationCarryForwardStatus;
  confidence: CohortReclassificationCarryForwardConfidence;
  reason: CohortReclassificationCarryForwardReason;
};

export type CohortReclassificationCarryForwardSummary = {
  total: number;
  firstYear: number;
  carriedForward: number;
  pathBroken: number;
  insufficientHistory: number;
  unknown: number;
  yUp: number;
  zDown: number;
  highConfidence: number;
  lowConfidence: number;
};

export type CohortReclassificationCarryForwardResult = {
  entries: CohortReclassificationCarryForwardEntry[];
  summary: CohortReclassificationCarryForwardSummary;
};

const MIN_RANK = 1; // SC
const MAX_RANK = 6; // BA

/**
 * Returns the fixed age-division ordinal (SC=1 .. BA=6) or `null` when the id is
 * missing, malformed, or unsupported. Never throws, so carry-forward stays
 * deterministic and treats invalid divisions as `invalid-age-division` rather
 * than failing.
 */
function safeAgeDivisionRank(ageDivisionId: string | null): number | null {
  if (ageDivisionId === null) return null;
  try {
    return getAgeDivisionRank(ageDivisionId);
  } catch {
    return null;
  }
}

function clampRank(rank: number): number {
  if (rank < MIN_RANK) return MIN_RANK;
  if (rank > MAX_RANK) return MAX_RANK;
  return rank;
}

/**
 * Groups later-season roster records by exact identity key, preserving original
 * record order within each key. Throws (via the identity pipeline) if any player
 * name is empty or whitespace-only.
 */
function groupRecordsByKey(
  records: RosterMovementRecord[]
): Map<string, RosterMovementRecord[]> {
  const byKey = new Map<string, RosterMovementRecord[]>();
  for (const record of records) {
    const key = getPlayerIdentityKey(record.player.name);
    if (!byKey.has(key)) {
      byKey.set(key, []);
    }
    byKey.get(key)!.push(record);
  }
  return byKey;
}

type Verdict = {
  status: CohortReclassificationCarryForwardStatus;
  confidence: CohortReclassificationCarryForwardConfidence;
  reason: CohortReclassificationCarryForwardReason;
};

const FIRST_YEAR: Verdict = {
  status: 'first-year',
  confidence: 'high',
  reason: 'first-year-record',
};
const EXPECTED_OFFSET_PATH: Verdict = {
  status: 'carried-forward',
  confidence: 'high',
  reason: 'expected-offset-path',
};
const CAPPED_AT_TOP: Verdict = {
  status: 'carried-forward',
  confidence: 'high',
  reason: 'capped-at-top-division',
};
const CAPPED_AT_BOTTOM: Verdict = {
  status: 'carried-forward',
  confidence: 'high',
  reason: 'capped-at-bottom-division',
};
const RETURNED_TO_NORMAL: Verdict = {
  status: 'path-broken',
  confidence: 'high',
  reason: 'returned-to-normal-path',
};
const UNEXPECTED_DIVISION: Verdict = {
  status: 'path-broken',
  confidence: 'high',
  reason: 'unexpected-age-division',
};
const MISSING_CURRENT_RECORD: Verdict = {
  status: 'insufficient-history',
  confidence: 'low',
  reason: 'missing-current-record',
};
const INVALID_AGE_DIVISION: Verdict = {
  status: 'unknown',
  confidence: 'low',
  reason: 'invalid-age-division',
};
const AMBIGUOUS_IDENTITY: Verdict = {
  status: 'unknown',
  confidence: 'low',
  reason: 'ambiguous-identity',
};
const MISSING_SEASON_ORDER: Verdict = {
  status: 'insufficient-history',
  confidence: 'low',
  reason: 'missing-season-order',
};
const FIRST_SEASON_NOT_IN_ORDER: Verdict = {
  status: 'insufficient-history',
  confidence: 'low',
  reason: 'first-season-not-in-order',
};
const EVALUATED_SEASON_NOT_IN_ORDER: Verdict = {
  status: 'insufficient-history',
  confidence: 'low',
  reason: 'evaluated-season-not-in-order',
};
const EVALUATED_SEASON_BEFORE_FIRST: Verdict = {
  status: 'insufficient-history',
  confidence: 'low',
  reason: 'evaluated-season-before-first-detection',
};

type EntryDraft = {
  evaluatedSeasonId: string | null;
  currentRecord: RosterMovementRecord | null;
  expectedAgeDivisionId: string | null;
  actualAgeDivisionId: string | null;
  verdict: Verdict;
};

/**
 * Computes the carry-forward verdict for a single first-year record against the
 * later-season roster records, without yet assembling the public entry shape.
 *
 * Precedence (each step is conservative, never mutates, never drops a record):
 *   1. Invalid first-year divisions -> unknown / invalid-age-division.
 *   2. Match the identity in the later-season records: more than one match is
 *      ambiguous; zero matches is missing-current-record.
 *   3. Invalid current division -> unknown / invalid-age-division.
 *   4. Season ordering: an empty order, an order missing either season, or an
 *      evaluated season before first detection all yield insufficient-history.
 *   5. Same season as first detection -> first-year.
 *   6. Later season -> compare the actual division to the reclassified offset path
 *      (carried-forward, with top/bottom caps) versus the normal path
 *      (returned-to-normal-path) versus anything else (unexpected-age-division).
 */
function evaluateRecord(
  firstYearRecord: CohortReclassificationRecord,
  byKey: Map<string, RosterMovementRecord[]>,
  seasonOrder: readonly string[],
  firstDetectedRank: number | null,
  priorRank: number | null
): EntryDraft {
  // 1. First-year record's own divisions must be valid (defensive: slice 2 only
  // emits valid divisions).
  if (firstDetectedRank === null || priorRank === null) {
    return {
      evaluatedSeasonId: null,
      currentRecord: null,
      expectedAgeDivisionId: null,
      actualAgeDivisionId: null,
      verdict: INVALID_AGE_DIVISION,
    };
  }

  // 2. Match the player's later-season record by exact identity.
  const matches = byKey.get(firstYearRecord.identityKey) ?? [];
  if (matches.length > 1) {
    return {
      evaluatedSeasonId: null,
      currentRecord: null,
      expectedAgeDivisionId: null,
      actualAgeDivisionId: null,
      verdict: AMBIGUOUS_IDENTITY,
    };
  }
  if (matches.length === 0) {
    return {
      evaluatedSeasonId: null,
      currentRecord: null,
      expectedAgeDivisionId: null,
      actualAgeDivisionId: null,
      verdict: MISSING_CURRENT_RECORD,
    };
  }

  const currentRecord = matches[0];
  const evaluatedSeasonId = currentRecord.team.seasonId;
  const actualAgeDivisionId = currentRecord.team.ageDivisionId;
  const actualRank = safeAgeDivisionRank(actualAgeDivisionId);

  // 3. The matched current division must be valid.
  if (actualRank === null) {
    return {
      evaluatedSeasonId,
      currentRecord,
      expectedAgeDivisionId: null,
      actualAgeDivisionId,
      verdict: INVALID_AGE_DIVISION,
    };
  }

  // 4. Season ordering must support a year-step calculation.
  if (!Array.isArray(seasonOrder) || seasonOrder.length === 0) {
    return {
      evaluatedSeasonId,
      currentRecord,
      expectedAgeDivisionId: null,
      actualAgeDivisionId,
      verdict: MISSING_SEASON_ORDER,
    };
  }
  const firstIndex = seasonOrder.indexOf(firstYearRecord.firstDetectedSeasonId);
  if (firstIndex === -1) {
    return {
      evaluatedSeasonId,
      currentRecord,
      expectedAgeDivisionId: null,
      actualAgeDivisionId,
      verdict: FIRST_SEASON_NOT_IN_ORDER,
    };
  }
  const evalIndex = seasonOrder.indexOf(evaluatedSeasonId);
  if (evalIndex === -1) {
    return {
      evaluatedSeasonId,
      currentRecord,
      expectedAgeDivisionId: null,
      actualAgeDivisionId,
      verdict: EVALUATED_SEASON_NOT_IN_ORDER,
    };
  }

  const seasonSteps = evalIndex - firstIndex;
  if (seasonSteps < 0) {
    return {
      evaluatedSeasonId,
      currentRecord,
      expectedAgeDivisionId: null,
      actualAgeDivisionId,
      verdict: EVALUATED_SEASON_BEFORE_FIRST,
    };
  }

  // 5. Evaluating the first detected season itself: this is the first-year event.
  if (seasonSteps === 0) {
    return {
      evaluatedSeasonId,
      currentRecord,
      expectedAgeDivisionId: firstYearRecord.currentAgeDivisionId,
      actualAgeDivisionId,
      verdict: FIRST_YEAR,
    };
  }

  // 6. Later season: the reclassified path advances +1 division per season from
  // the first detected division (offset preserved). Compare against it.
  const rawExpectedRank = firstDetectedRank + seasonSteps;
  const expectedRank = clampRank(rawExpectedRank);
  const expectedAgeDivisionId = getAgeDivisionIdByRank(expectedRank);

  if (actualRank === expectedRank) {
    let verdict: Verdict = EXPECTED_OFFSET_PATH;
    if (rawExpectedRank > MAX_RANK) {
      verdict = CAPPED_AT_TOP;
    } else if (rawExpectedRank < MIN_RANK) {
      verdict = CAPPED_AT_BOTTOM;
    }
    return {
      evaluatedSeasonId,
      currentRecord,
      expectedAgeDivisionId,
      actualAgeDivisionId,
      verdict,
    };
  }

  // Off the reclassified path. Distinguish a clean return to the normal age path
  // from any other unexpected division. Normal progression ignores the offset:
  // normal expected = priorRank + 1 + seasonSteps.
  const normalRank = clampRank(priorRank + 1 + seasonSteps);
  const verdict: Verdict =
    actualRank === normalRank ? RETURNED_TO_NORMAL : UNEXPECTED_DIVISION;
  return {
    evaluatedSeasonId,
    currentRecord,
    expectedAgeDivisionId,
    actualAgeDivisionId,
    verdict,
  };
}

/**
 * Carries a recorded first-year y-up / z-down cohort reclassification status
 * forward into a later season.
 *
 * For each first-year record (slice 2 output), it finds the player's exact-identity
 * record in `currentRecords` (a later-season roster), uses `seasonOrder` (oldest to
 * newest) to compute how many seasons have elapsed, and decides whether the player
 * is still on the reclassified offset path. See {@link evaluateRecord} for the
 * full precedence.
 *
 * Guarantees:
 *   - Pure and deterministic: exactly one entry per first-year record, in
 *     `firstYearRecords` input order.
 *   - Source `firstYearRecord`, `player`, and matched `currentRecord` objects are
 *     preserved by reference and never mutated. Carry-forward metadata is fresh.
 *   - No record is dropped, merged, reordered, or suppressed. Ambiguity, missing
 *     data, and broken paths are reported as derived metadata only.
 *
 * Throws if any later-season player name is empty or whitespace-only (inherited
 * from the identity pipeline).
 */
export function carryForwardCohortReclassificationStatus(
  firstYearRecords: CohortReclassificationRecord[],
  currentRecords: RosterMovementRecord[],
  seasonOrder: readonly string[]
): CohortReclassificationCarryForwardResult {
  const byKey = groupRecordsByKey(currentRecords);
  const entries: CohortReclassificationCarryForwardEntry[] = [];

  for (const firstYearRecord of firstYearRecords) {
    const firstDetectedRank = safeAgeDivisionRank(
      firstYearRecord.currentAgeDivisionId
    );
    const priorRank = safeAgeDivisionRank(firstYearRecord.priorAgeDivisionId);

    const cohortOffset =
      firstDetectedRank !== null && priorRank !== null
        ? firstDetectedRank - (priorRank + 1)
        : 0;

    const draft = evaluateRecord(
      firstYearRecord,
      byKey,
      seasonOrder,
      firstDetectedRank,
      priorRank
    );

    entries.push({
      identityKey: firstYearRecord.identityKey,
      reclassificationType: firstYearRecord.reclassificationType,
      player: firstYearRecord.player,
      firstYearRecord,
      currentRecord: draft.currentRecord,
      firstDetectedSeasonId: firstYearRecord.firstDetectedSeasonId,
      evaluatedSeasonId: draft.evaluatedSeasonId,
      priorAgeDivisionId: firstYearRecord.priorAgeDivisionId,
      firstDetectedAgeDivisionId: firstYearRecord.currentAgeDivisionId,
      expectedAgeDivisionId: draft.expectedAgeDivisionId,
      actualAgeDivisionId: draft.actualAgeDivisionId,
      cohortOffset,
      status: draft.verdict.status,
      confidence: draft.verdict.confidence,
      reason: draft.verdict.reason,
    });
  }

  return {
    entries,
    summary: summarizeCohortReclassificationCarryForward(entries),
  };
}

/**
 * Counts carry-forward entries by status, reclassification type, and confidence.
 * Pure and deterministic; does not read or mutate the source entries beyond their
 * `status`, `reclassificationType`, and `confidence`.
 */
export function summarizeCohortReclassificationCarryForward(
  entries: CohortReclassificationCarryForwardEntry[]
): CohortReclassificationCarryForwardSummary {
  const summary: CohortReclassificationCarryForwardSummary = {
    total: entries.length,
    firstYear: 0,
    carriedForward: 0,
    pathBroken: 0,
    insufficientHistory: 0,
    unknown: 0,
    yUp: 0,
    zDown: 0,
    highConfidence: 0,
    lowConfidence: 0,
  };

  for (const entry of entries) {
    switch (entry.status) {
      case 'first-year':
        summary.firstYear += 1;
        break;
      case 'carried-forward':
        summary.carriedForward += 1;
        break;
      case 'path-broken':
        summary.pathBroken += 1;
        break;
      case 'insufficient-history':
        summary.insufficientHistory += 1;
        break;
      case 'unknown':
        summary.unknown += 1;
        break;
    }

    if (entry.reclassificationType === 'y-up') {
      summary.yUp += 1;
    } else {
      summary.zDown += 1;
    }

    if (entry.confidence === 'high') {
      summary.highConfidence += 1;
    } else {
      summary.lowConfidence += 1;
    }
  }

  return summary;
}

export type { TeamSlotContext };
