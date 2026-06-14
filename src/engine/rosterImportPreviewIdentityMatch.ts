import { getPlayerIdentityKey } from './playerIdentity';
import type { RosterImportPreviewRow } from './rosterImportPreview';

/**
 * Phase 5 slice 2: import preview identity match CANDIDATES — ENGINE ONLY.
 *
 * Given Phase 5 slice 1 import preview rows (`RosterImportPreviewRow`) and a set
 * of existing roster/player identity records supplied in the input, this module
 * answers one question per ready preview row: "which existing roster records might
 * this imported row correspond to?" It generates candidate matches and review
 * metadata for a LATER collision-review / apply workflow.
 *
 * This is CANDIDATE GENERATION ONLY. It is NOT collision resolution, NOT import
 * apply/commit, NOT file/CSV parsing, NOT persistence, and NOT UI. It does not
 * derive new / returning / transferred / promoted / relegated status, and it does
 * not compare against prior seasons — it only matches preview rows against the
 * existing records given to it.
 *
 * Roster authority rule (carried forward, see `docs/derived-logic.md`
 * "## Roster authority"): loaded roster records are authoritative. Matching only
 * produces candidate metadata and review flags. It NEVER alters, removes,
 * suppresses, merges, nullifies, rewrites, reorders, or ignores rostered names.
 * Every preview row and every existing record is preserved; source objects are
 * referenced, never mutated.
 *
 * Chosen contract decisions (documented and tested):
 *   - Only `ready` preview rows are matched. `invalid` rows become
 *     `skipped-invalid-preview-row` entries; `needs-review` rows become
 *     `skipped-review-preview-row` entries. Both are preserved, never dropped.
 *   - Matching is exact normalized identity key only (reusing the Phase 2
 *     `getPlayerIdentityKey` helper). A jersey number can ADD a reason and RAISE
 *     confidence within an exact-name candidate, but never creates a match alone.
 *   - One existing key match -> `single-candidate`; more than one -> a review
 *     `multiple-candidates`; none -> `no-match`. Duplicate existing names and
 *     duplicate preview names produce review metadata, never discarded candidates.
 *   - An existing record with a missing/blank name cannot produce an identity key;
 *     it is reported as a result-level `invalid-existing-record` issue (never
 *     throws) and excluded from matching only.
 *
 * Purity: inputs (preview rows, existing records, and their nested objects) are
 * never mutated. Output is fully deterministic and identical across repeated
 * calls. Entries follow preview row order; candidates follow existing-record input
 * order.
 */

export type RosterImportPreviewIdentityMatchStatus =
  | 'no-match'
  | 'single-candidate'
  | 'multiple-candidates'
  | 'skipped-invalid-preview-row'
  | 'skipped-review-preview-row';

export type RosterImportPreviewIdentityMatchType =
  | 'exact-identity-key'
  | 'same-name-duplicate-existing'
  | 'same-name-duplicate-preview'
  | 'jersey-assisted-exact-name';

export type RosterImportPreviewIdentityMatchConfidence =
  | 'high'
  | 'medium'
  | 'low'
  | 'none';

export type RosterImportPreviewIdentityMatchReasonCode =
  | 'exact-normalized-name-match'
  | 'matching-jersey-number'
  | 'existing-duplicate-name'
  | 'preview-duplicate-name'
  | 'preview-row-invalid'
  | 'preview-row-needs-review'
  | 'no-existing-identity-match'
  | 'invalid-existing-record';

export type RosterImportPreviewIdentityMatchSeverity =
  | 'info'
  | 'warning'
  | 'error';

export type RosterImportPreviewIdentityMatchIssue = {
  code: RosterImportPreviewIdentityMatchReasonCode;
  severity: RosterImportPreviewIdentityMatchSeverity;
  message: string;
};

export type ExistingRosterIdentityRecord = {
  recordId: string;
  seasonId?: string;
  districtId?: string;
  ageDivisionId?: string;
  teamId?: string;
  playerName?: string;
  jerseyNumber?: string;
  grade?: string;
  raw?: unknown;
};

export type RosterImportPreviewIdentityMatchCandidate = {
  previewSourceRowId: string | null;
  previewRowIndex: number;
  existingRecordId: string;
  existingPlayerName: string | null;
  matchType: RosterImportPreviewIdentityMatchType;
  confidence: RosterImportPreviewIdentityMatchConfidence;
  reasons: RosterImportPreviewIdentityMatchReasonCode[];
};

export type RosterImportPreviewIdentityMatchEntry = {
  previewSourceRowId: string | null;
  previewRowIndex: number;
  previewPlayerName: string | null;
  previewNormalizedIdentityKey: string | null;
  status: RosterImportPreviewIdentityMatchStatus;
  candidates: RosterImportPreviewIdentityMatchCandidate[];
  issues: RosterImportPreviewIdentityMatchIssue[];
};

export type RosterImportPreviewIdentityMatchInput = {
  previewRows?: RosterImportPreviewRow[];
  existingRosterRecords?: ExistingRosterIdentityRecord[];
};

export type RosterImportPreviewIdentityMatchSummary = {
  totalEntries: number;
  noMatchEntries: number;
  singleCandidateEntries: number;
  multipleCandidateEntries: number;
  skippedInvalidEntries: number;
  skippedReviewEntries: number;
  readyForApplyEntries: number;
  needsReviewEntries: number;
  totalCandidates: number;
};

export type RosterImportPreviewIdentityMatchResult = {
  entries: RosterImportPreviewIdentityMatchEntry[];
  summary: RosterImportPreviewIdentityMatchSummary;
  /** Result-level issues (e.g. invalid existing records). Entry issues live on entries. */
  issues: RosterImportPreviewIdentityMatchIssue[];
};

/** A non-empty trimmed string, or null. Never throws. */
function asPresentString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

/** True only when both jersey values are present and equal (after trimming). */
function jerseyMatches(
  previewJersey: string | null,
  existingJersey: string | undefined
): boolean {
  const a = asPresentString(previewJersey);
  const b = asPresentString(existingJersey);
  return a !== null && b !== null && a.trim() === b.trim();
}

/** Raises confidence one notch (capped at high); used only for jersey assistance. */
function raiseConfidence(
  confidence: RosterImportPreviewIdentityMatchConfidence
): RosterImportPreviewIdentityMatchConfidence {
  if (confidence === 'low') return 'medium';
  if (confidence === 'medium') return 'high';
  return confidence;
}

function issue(
  code: RosterImportPreviewIdentityMatchReasonCode,
  severity: RosterImportPreviewIdentityMatchSeverity,
  message: string
): RosterImportPreviewIdentityMatchIssue {
  return { code, severity, message };
}

/**
 * An entry is ready for a future apply workflow only when it is an unambiguous,
 * single, high-confidence candidate with no review (warning/error) issues.
 */
function isEntryReadyForApply(
  entry: RosterImportPreviewIdentityMatchEntry
): boolean {
  return (
    entry.status === 'single-candidate' &&
    entry.candidates.length === 1 &&
    entry.candidates[0].confidence === 'high' &&
    entry.issues.every((i) => i.severity === 'info')
  );
}

/**
 * An entry needs review when it has more than one candidate or carries any
 * warning/error issue (e.g. duplicate preview/existing names).
 */
function isEntryNeedingReview(
  entry: RosterImportPreviewIdentityMatchEntry
): boolean {
  return (
    entry.status === 'multiple-candidates' ||
    entry.issues.some((i) => i.severity !== 'info')
  );
}

/**
 * Generates identity match candidates for import preview rows against existing
 * roster identity records. Pure and deterministic.
 */
export function createRosterImportPreviewIdentityMatches(
  input: RosterImportPreviewIdentityMatchInput
): RosterImportPreviewIdentityMatchResult {
  const previewRows = Array.isArray(input.previewRows)
    ? input.previewRows
    : [];
  const existingRecords = Array.isArray(input.existingRosterRecords)
    ? input.existingRosterRecords
    : [];

  // Index existing records by identity key, preserving input order. Records with
  // an unusable name are reported and excluded from matching only.
  const existingByKey = new Map<string, ExistingRosterIdentityRecord[]>();
  const resultIssues: RosterImportPreviewIdentityMatchIssue[] = [];
  for (const record of existingRecords) {
    const name = asPresentString(record.playerName);
    if (name === null) {
      resultIssues.push(
        issue(
          'invalid-existing-record',
          'warning',
          `Existing roster record "${record.recordId ?? '(no recordId)'}" has a missing or blank player name and cannot be matched.`
        )
      );
      continue;
    }
    const key = getPlayerIdentityKey(name);
    const bucket = existingByKey.get(key);
    if (bucket) {
      bucket.push(record);
    } else {
      existingByKey.set(key, [record]);
    }
  }

  // Count ready preview-row identity keys to detect preview-side duplicates.
  const previewReadyKeyCounts = new Map<string, number>();
  for (const row of previewRows) {
    if (row.status === 'ready' && row.normalizedIdentityKey !== null) {
      previewReadyKeyCounts.set(
        row.normalizedIdentityKey,
        (previewReadyKeyCounts.get(row.normalizedIdentityKey) ?? 0) + 1
      );
    }
  }

  const entries: RosterImportPreviewIdentityMatchEntry[] = previewRows.map(
    (row) => {
      const base = {
        previewSourceRowId: row.sourceRowId,
        previewRowIndex: row.rowIndex,
        previewPlayerName: row.playerName,
        previewNormalizedIdentityKey: row.normalizedIdentityKey,
      };

      if (row.status === 'invalid') {
        return {
          ...base,
          status: 'skipped-invalid-preview-row',
          candidates: [],
          issues: [
            issue(
              'preview-row-invalid',
              'info',
              'Preview row is invalid and was skipped for identity matching.'
            ),
          ],
        };
      }

      if (row.status === 'needs-review') {
        return {
          ...base,
          status: 'skipped-review-preview-row',
          candidates: [],
          issues: [
            issue(
              'preview-row-needs-review',
              'info',
              'Preview row needs review and was skipped for identity matching.'
            ),
          ],
        };
      }

      // Ready row.
      const key = row.normalizedIdentityKey;
      const matches = key !== null ? existingByKey.get(key) ?? [] : [];
      const existingDuplicate = matches.length > 1;
      const previewDuplicate =
        key !== null && (previewReadyKeyCounts.get(key) ?? 0) > 1;

      const candidates: RosterImportPreviewIdentityMatchCandidate[] =
        matches.map((record) => {
          const reasons: RosterImportPreviewIdentityMatchReasonCode[] = [
            'exact-normalized-name-match',
          ];
          const hasJerseyMatch = jerseyMatches(
            row.fields.jerseyNumber,
            record.jerseyNumber
          );
          if (hasJerseyMatch) reasons.push('matching-jersey-number');
          if (existingDuplicate) reasons.push('existing-duplicate-name');
          if (previewDuplicate) reasons.push('preview-duplicate-name');

          const matchType: RosterImportPreviewIdentityMatchType =
            existingDuplicate
              ? 'same-name-duplicate-existing'
              : previewDuplicate
                ? 'same-name-duplicate-preview'
                : hasJerseyMatch
                  ? 'jersey-assisted-exact-name'
                  : 'exact-identity-key';

          let confidence: RosterImportPreviewIdentityMatchConfidence =
            existingDuplicate || previewDuplicate ? 'low' : 'high';
          if (hasJerseyMatch) confidence = raiseConfidence(confidence);

          return {
            previewSourceRowId: row.sourceRowId,
            previewRowIndex: row.rowIndex,
            existingRecordId: record.recordId,
            existingPlayerName: asPresentString(record.playerName),
            matchType,
            confidence,
            reasons,
          };
        });

      const status: RosterImportPreviewIdentityMatchStatus =
        matches.length === 0
          ? 'no-match'
          : matches.length === 1
            ? 'single-candidate'
            : 'multiple-candidates';

      const issues: RosterImportPreviewIdentityMatchIssue[] = [];
      if (status === 'no-match') {
        issues.push(
          issue(
            'no-existing-identity-match',
            'info',
            'No existing roster record matches this preview row by identity key.'
          )
        );
      }
      if (existingDuplicate) {
        issues.push(
          issue(
            'existing-duplicate-name',
            'warning',
            'More than one existing roster record shares this identity key; review required.'
          )
        );
      }
      if (previewDuplicate) {
        issues.push(
          issue(
            'preview-duplicate-name',
            'warning',
            'This identity key appears on more than one ready preview row; review required.'
          )
        );
      }

      return { ...base, status, candidates, issues };
    }
  );

  return {
    entries,
    summary: summarizeRosterImportPreviewIdentityMatches(entries),
    issues: resultIssues,
  };
}

/** Tallies match entries into deterministic counts. */
export function summarizeRosterImportPreviewIdentityMatches(
  entries: RosterImportPreviewIdentityMatchEntry[]
): RosterImportPreviewIdentityMatchSummary {
  const summary: RosterImportPreviewIdentityMatchSummary = {
    totalEntries: entries.length,
    noMatchEntries: 0,
    singleCandidateEntries: 0,
    multipleCandidateEntries: 0,
    skippedInvalidEntries: 0,
    skippedReviewEntries: 0,
    readyForApplyEntries: 0,
    needsReviewEntries: 0,
    totalCandidates: 0,
  };

  for (const entry of entries) {
    switch (entry.status) {
      case 'no-match':
        summary.noMatchEntries += 1;
        break;
      case 'single-candidate':
        summary.singleCandidateEntries += 1;
        break;
      case 'multiple-candidates':
        summary.multipleCandidateEntries += 1;
        break;
      case 'skipped-invalid-preview-row':
        summary.skippedInvalidEntries += 1;
        break;
      case 'skipped-review-preview-row':
        summary.skippedReviewEntries += 1;
        break;
    }
    summary.totalCandidates += entry.candidates.length;
    if (isEntryReadyForApply(entry)) summary.readyForApplyEntries += 1;
    if (isEntryNeedingReview(entry)) summary.needsReviewEntries += 1;
  }

  return summary;
}

/** Resolves either a match result or a bare entries array into an entries array. */
function resolveEntries(
  resultOrEntries:
    | RosterImportPreviewIdentityMatchResult
    | RosterImportPreviewIdentityMatchEntry[]
): RosterImportPreviewIdentityMatchEntry[] {
  return Array.isArray(resultOrEntries)
    ? resultOrEntries
    : resultOrEntries.entries;
}

/** Entries that require human review (multiple candidates or any warning/error). */
export function getRosterImportPreviewIdentityMatchesNeedingReview(
  resultOrEntries:
    | RosterImportPreviewIdentityMatchResult
    | RosterImportPreviewIdentityMatchEntry[]
): RosterImportPreviewIdentityMatchEntry[] {
  return resolveEntries(resultOrEntries).filter(isEntryNeedingReview);
}

/**
 * Entries safe for a future apply workflow: unambiguous single high-confidence
 * candidates with no review issues. No apply is performed here.
 */
export function getRosterImportPreviewIdentityMatchesReadyForApply(
  resultOrEntries:
    | RosterImportPreviewIdentityMatchResult
    | RosterImportPreviewIdentityMatchEntry[]
): RosterImportPreviewIdentityMatchEntry[] {
  return resolveEntries(resultOrEntries).filter(isEntryReadyForApply);
}
