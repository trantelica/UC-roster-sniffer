import { getPlayerIdentityKey } from './playerIdentity';

/**
 * Phase 5 slice 1: roster import preview state/contract — ENGINE ONLY.
 *
 * This module defines a pure, deterministic **import preview** for roster
 * imports: how candidate imported rows are represented, validated, summarized,
 * and prepared for later collision review. It is a NON-DESTRUCTIVE STAGING layer.
 *
 * It is NOT real import parsing (no file / CSV reading), NOT identity collision
 * resolution, NOT import commit/apply logic, NOT persistence, and NOT UI. It does
 * not compare against existing roster data and does not classify new / returning /
 * transferred players. Those are later Phase 5 / Phase 6 work.
 *
 * Roster authority rule (carried forward, see `docs/derived-logic.md`
 * "## Roster authority"): loaded roster records are authoritative. Import preview
 * never alters, removes, suppresses, merges, nullifies, rewrites, reorders, or
 * ignores rostered names because of duplicates, ambiguity, or low-confidence
 * matching. EVERY input row is preserved as a preview row in its original order,
 * even when it is invalid, duplicate, or ambiguous. Ambiguity affects preview
 * metadata (issues / status) only.
 *
 * Chosen contract decisions (documented and tested):
 *   - Missing player name -> the row is `invalid` (error `missing-player-name`).
 *   - Missing source row id -> the row is `invalid` (error `missing-source-row-id`):
 *     a row with no stable identity cannot be safely tracked through later review.
 *   - Duplicate source row id -> every row sharing that id is `needs-review`
 *     (warning `duplicate-source-row-id`): the id exists but is not unique, so the
 *     rows are flagged for review, never discarded.
 *   - Duplicate normalized player identity within the import -> every row in the
 *     group is `needs-review` (warning `duplicate-name-in-import`), never discarded.
 *
 * Purity: the input object, its `rows` array, and every row object are never
 * mutated. Output is fully deterministic and identical across repeated calls.
 * `raw` and other passthrough field values are preserved by reference (never
 * cloned, never mutated).
 */

export type RosterImportPreviewRowStatus = 'ready' | 'needs-review' | 'invalid';

export type RosterImportPreviewIssueSeverity = 'info' | 'warning' | 'error';

export type RosterImportPreviewIssueCode =
  | 'missing-source-row-id'
  | 'duplicate-source-row-id'
  | 'missing-player-name'
  | 'duplicate-name-in-import'
  | 'invalid-target-context';

export type RosterImportPreviewIssue = {
  code: RosterImportPreviewIssueCode;
  severity: RosterImportPreviewIssueSeverity;
  message: string;
};

/** Optional passthrough fields preserved verbatim for later stages. */
export type RosterImportPreviewRowInput = {
  sourceRowId?: string;
  playerName?: string;
  jerseyNumber?: string;
  grade?: string;
  notes?: string;
  raw?: unknown;
};

export type RosterImportPreviewFields = {
  jerseyNumber: string | null;
  grade: string | null;
  notes: string | null;
  raw: unknown;
};

export type RosterImportPreviewRow = {
  sourceRowId: string | null;
  rowIndex: number;
  playerName: string | null;
  normalizedIdentityKey: string | null;
  fields: RosterImportPreviewFields;
  issues: RosterImportPreviewIssue[];
  status: RosterImportPreviewRowStatus;
};

export type RosterImportPreviewTargetContext = {
  seasonId: string | null;
  districtId: string | null;
  ageDivisionId: string | null;
  teamId: string | null;
};

export type RosterImportPreviewInput = {
  seasonId?: string;
  districtId?: string;
  ageDivisionId?: string;
  teamId?: string;
  rows?: RosterImportPreviewRowInput[];
};

export type RosterImportPreviewSummary = {
  totalRows: number;
  readyRows: number;
  needsReviewRows: number;
  invalidRows: number;
  duplicateNameGroups: number;
  duplicateSourceRowIdGroups: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
};

export type RosterImportPreviewResult = {
  ok: boolean;
  target: RosterImportPreviewTargetContext;
  targetValid: boolean;
  rows: RosterImportPreviewRow[];
  summary: RosterImportPreviewSummary;
  /** Preview-level issues (e.g. invalid target context). Row issues live on rows. */
  issues: RosterImportPreviewIssue[];
};

/** A non-empty trimmed string, or null. Never throws. */
function asPresentString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

/** Optional passthrough string value preserved as-is, or null when absent. */
function asOptionalString(value: string | undefined): string | null {
  return value === undefined ? null : value;
}

function issue(
  code: RosterImportPreviewIssueCode,
  severity: RosterImportPreviewIssueSeverity,
  message: string
): RosterImportPreviewIssue {
  return { code, severity, message };
}

function statusFromIssues(
  issues: RosterImportPreviewIssue[]
): RosterImportPreviewRowStatus {
  if (issues.some((i) => i.severity === 'error')) return 'invalid';
  if (issues.some((i) => i.severity === 'warning')) return 'needs-review';
  return 'ready';
}

/**
 * Builds a non-destructive import preview from candidate roster rows.
 *
 * Every input row becomes exactly one preview row, in input order, with a
 * deterministic `rowIndex`. The target context is validated for presence of
 * seasonId / districtId / ageDivisionId / teamId; an invalid target context is
 * reported as a preview-level error WITHOUT mutating or dropping any row.
 */
export function createRosterImportPreview(
  input: RosterImportPreviewInput
): RosterImportPreviewResult {
  const target: RosterImportPreviewTargetContext = {
    seasonId: asPresentString(input.seasonId),
    districtId: asPresentString(input.districtId),
    ageDivisionId: asPresentString(input.ageDivisionId),
    teamId: asPresentString(input.teamId),
  };
  const targetValid =
    target.seasonId !== null &&
    target.districtId !== null &&
    target.ageDivisionId !== null &&
    target.teamId !== null;

  const previewIssues: RosterImportPreviewIssue[] = [];
  if (!targetValid) {
    previewIssues.push(
      issue(
        'invalid-target-context',
        'error',
        'Import target context is missing one or more of seasonId, districtId, ageDivisionId, teamId.'
      )
    );
  }

  const inputRows = Array.isArray(input.rows) ? input.rows : [];

  // First pass: resolve each row's identity-relevant values and presence issues.
  type Draft = {
    sourceRowId: string | null;
    rowIndex: number;
    playerName: string | null;
    normalizedIdentityKey: string | null;
    fields: RosterImportPreviewFields;
    issues: RosterImportPreviewIssue[];
  };

  const sourceRowIdCounts = new Map<string, number>();
  const identityKeyCounts = new Map<string, number>();

  const drafts: Draft[] = inputRows.map((rowInput, rowIndex) => {
    const issues: RosterImportPreviewIssue[] = [];

    const sourceRowId = asPresentString(rowInput.sourceRowId);
    if (sourceRowId === null) {
      issues.push(
        issue(
          'missing-source-row-id',
          'error',
          'Row is missing a stable source row id.'
        )
      );
    } else {
      sourceRowIdCounts.set(
        sourceRowId,
        (sourceRowIdCounts.get(sourceRowId) ?? 0) + 1
      );
    }

    const playerName = asPresentString(rowInput.playerName);
    let normalizedIdentityKey: string | null = null;
    if (playerName === null) {
      issues.push(
        issue('missing-player-name', 'error', 'Row is missing a player name.')
      );
    } else {
      normalizedIdentityKey = getPlayerIdentityKey(playerName);
      identityKeyCounts.set(
        normalizedIdentityKey,
        (identityKeyCounts.get(normalizedIdentityKey) ?? 0) + 1
      );
    }

    const fields: RosterImportPreviewFields = {
      jerseyNumber: asOptionalString(rowInput.jerseyNumber),
      grade: asOptionalString(rowInput.grade),
      notes: asOptionalString(rowInput.notes),
      raw: rowInput.raw === undefined ? null : rowInput.raw,
    };

    return {
      sourceRowId,
      rowIndex,
      playerName,
      normalizedIdentityKey,
      fields,
      issues,
    };
  });

  // Second pass: append duplicate issues (now that frequencies are known) and
  // finalize status. Order of appended issues is fixed for determinism.
  const rows: RosterImportPreviewRow[] = drafts.map((draft) => {
    const issues = [...draft.issues];

    if (
      draft.sourceRowId !== null &&
      (sourceRowIdCounts.get(draft.sourceRowId) ?? 0) > 1
    ) {
      issues.push(
        issue(
          'duplicate-source-row-id',
          'warning',
          `Source row id "${draft.sourceRowId}" appears on multiple import rows.`
        )
      );
    }

    if (
      draft.normalizedIdentityKey !== null &&
      (identityKeyCounts.get(draft.normalizedIdentityKey) ?? 0) > 1
    ) {
      issues.push(
        issue(
          'duplicate-name-in-import',
          'warning',
          `Normalized player identity "${draft.normalizedIdentityKey}" appears on multiple import rows.`
        )
      );
    }

    return {
      sourceRowId: draft.sourceRowId,
      rowIndex: draft.rowIndex,
      playerName: draft.playerName,
      normalizedIdentityKey: draft.normalizedIdentityKey,
      fields: draft.fields,
      issues,
      status: statusFromIssues(issues),
    };
  });

  const summary = summarizeRosterImportPreviewRows(rows);

  const ok =
    targetValid && summary.errorCount === 0 && summary.invalidRows === 0;

  return {
    ok,
    target,
    targetValid,
    rows,
    summary,
    issues: previewIssues,
  };
}

/**
 * Tallies preview rows into deterministic counts. Status, severity, and duplicate
 * group counts are derived purely from the rows; duplicate groups are recomputed
 * from `sourceRowId` / `normalizedIdentityKey` frequencies (the same definition
 * `createRosterImportPreview` uses to attach duplicate issues). Severity counts
 * reflect row-level issues only; preview-level issues live on the result.
 */
export function summarizeRosterImportPreviewRows(
  rows: RosterImportPreviewRow[]
): RosterImportPreviewSummary {
  const summary: RosterImportPreviewSummary = {
    totalRows: rows.length,
    readyRows: 0,
    needsReviewRows: 0,
    invalidRows: 0,
    duplicateNameGroups: 0,
    duplicateSourceRowIdGroups: 0,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  };

  const sourceRowIdCounts = new Map<string, number>();
  const identityKeyCounts = new Map<string, number>();

  for (const row of rows) {
    switch (row.status) {
      case 'ready':
        summary.readyRows += 1;
        break;
      case 'needs-review':
        summary.needsReviewRows += 1;
        break;
      case 'invalid':
        summary.invalidRows += 1;
        break;
    }

    for (const rowIssue of row.issues) {
      switch (rowIssue.severity) {
        case 'error':
          summary.errorCount += 1;
          break;
        case 'warning':
          summary.warningCount += 1;
          break;
        case 'info':
          summary.infoCount += 1;
          break;
      }
    }

    if (row.sourceRowId !== null) {
      sourceRowIdCounts.set(
        row.sourceRowId,
        (sourceRowIdCounts.get(row.sourceRowId) ?? 0) + 1
      );
    }
    if (row.normalizedIdentityKey !== null) {
      identityKeyCounts.set(
        row.normalizedIdentityKey,
        (identityKeyCounts.get(row.normalizedIdentityKey) ?? 0) + 1
      );
    }
  }

  for (const count of sourceRowIdCounts.values()) {
    if (count > 1) summary.duplicateSourceRowIdGroups += 1;
  }
  for (const count of identityKeyCounts.values()) {
    if (count > 1) summary.duplicateNameGroups += 1;
  }

  return summary;
}

/** Resolves either a preview result or a bare rows array into a rows array. */
function resolveRows(
  resultOrRows: RosterImportPreviewResult | RosterImportPreviewRow[]
): RosterImportPreviewRow[] {
  return Array.isArray(resultOrRows) ? resultOrRows : resultOrRows.rows;
}

/** Rows flagged `needs-review` (e.g. duplicate name / duplicate source row id). */
export function getRosterImportPreviewRowsNeedingReview(
  resultOrRows: RosterImportPreviewResult | RosterImportPreviewRow[]
): RosterImportPreviewRow[] {
  return resolveRows(resultOrRows).filter(
    (row) => row.status === 'needs-review'
  );
}

/**
 * Rows that are NOT invalid (status `ready` or `needs-review`) — rows with a
 * usable identity that can advance to later collision-review stages. Invalid rows
 * are excluded but never removed from the underlying preview.
 */
export function getValidRosterImportPreviewRows(
  resultOrRows: RosterImportPreviewResult | RosterImportPreviewRow[]
): RosterImportPreviewRow[] {
  return resolveRows(resultOrRows).filter((row) => row.status !== 'invalid');
}
