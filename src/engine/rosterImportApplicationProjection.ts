import type {
  RosterImportCommitPreviewPlanResult,
  RosterImportCommitPreviewPlanRow,
  RosterImportCommitPreviewPlanStatus,
  RosterImportCommitPreviewPlanOperation,
  RosterImportCommitPreviewPlanTargetContext,
} from './rosterImportCommitPreviewPlan';

/**
 * Phase 5 slice 8: pure in-memory import application / PROJECTION — ENGINE ONLY.
 *
 * Slice 6 (`createRosterImportCommitPreviewPlan`) produced a deterministic dry-run
 * commit plan: per row, what a future commit WOULD do (`ready-to-link` /
 * `ready-to-create` / `rejected` / `deferred` / `blocked-*`) and a top-level
 * `canCommit` readiness gate. This slice answers the next question, still entirely
 * in memory: "if this already-reviewed, committable plan were applied later, what
 * roster links / additions would result?"
 *
 * This is PROJECTION ONLY. It is NOT import apply/commit, NOT persistence, NOT
 * sample-data mutation, NOT browser storage, NOT file parsing, and NOT UI. A
 * `projected-link` describes a link a future apply WOULD make; it never modifies the
 * existing record. A `projected-create` describes a NEW roster record a future apply
 * WOULD add; the `projectedNewRecord` it carries is a provisional, in-memory
 * description and is NEVER persisted. No write/apply function is exported here.
 *
 * Roster authority rule (carried forward, see `docs/derived-logic.md`
 * "## Roster authority"): loaded roster records are authoritative. Projection never
 * alters, removes, suppresses, merges, nullifies, rewrites, reorders, or ignores
 * rostered names, existing records, or plan rows. Rejected and deferred rows are
 * preserved as rows; nothing is deleted. Source objects (the plan, its rows, the
 * original applied entries, and the existing roster records) are referenced, never
 * mutated.
 *
 * Gating: projection only proceeds when `plan.canCommit` is true. A non-committable
 * plan returns `ok: false` with a result-level `plan-not-committable` blocker and no
 * projected rows. Even when `plan.canCommit` claims true, a defensively-present
 * `blocked-*` plan row is projected as `blocked` and forces `ok: false` — the plan
 * row scan, not just the flag, decides readiness.
 *
 * Determinism: provisional create ids are derived from the target context plus the
 * preview row's stable key (`previewSourceRowId` + `previewRowIndex`), so output is
 * identical across repeated calls. Jersey number / grade are intentionally NOT
 * chased through raw plan/match objects (the slice 6 plan row does not expose them
 * cleanly); `projectedNewRecord` stays minimal and a later parser / import-map slice
 * may enrich it.
 */

/** Bump when the projection derivation or contract shape changes. */
export const ROSTER_IMPORT_APPLICATION_PROJECTION_LOGIC_VERSION =
  'phase5-slice8-import-application-projection-v1';

export type RosterImportApplicationProjectionStatus =
  | 'projected-link'
  | 'projected-create'
  | 'projected-reject'
  | 'projected-defer'
  | 'blocked'
  | 'skipped';

export type RosterImportApplicationProjectionOperation =
  | 'link-existing-record'
  | 'create-new-roster-entry'
  | 'reject-import-row'
  | 'defer-review'
  | 'none';

export type RosterImportApplicationProjectionBlockerCode =
  | 'plan-not-committable'
  | 'missing-existing-record'
  | 'duplicate-existing-record-id'
  | 'blocked-plan-row'
  | 'invalid-plan-row'
  | 'missing-target-context'
  | 'missing-preview-row-key'
  | 'missing-player-name-for-create';

export type RosterImportApplicationProjectionReasonCode =
  | 'linked-to-existing-record'
  | 'projected-new-roster-entry'
  | 'reviewer-rejected'
  | 'reviewer-deferred'
  | 'blocked-by-plan'
  | 'skipped-non-committed-row';

/**
 * An existing roster record supplied to projection for link resolution. Loaded and
 * authoritative; never mutated. Season / district / age division / team / player
 * name are required (a record without them cannot anchor a link target context).
 */
export type ExistingRosterProjectionRecord = {
  recordId: string;
  seasonId: string;
  districtId: string;
  ageDivisionId: string;
  teamId: string;
  playerName: string;
  jerseyNumber?: string;
  grade?: string;
  raw?: unknown;
};

/**
 * A provisional, in-memory description of a roster record a future apply WOULD add.
 * It is NOT persisted and carries no final/canonical id — `provisionalRecordId` is
 * deterministically derived from the target context + preview row key so callers can
 * reference it stably within a single projection.
 */
export type ProjectedNewRosterRecord = {
  provisionalRecordId: string;
  seasonId: string;
  districtId: string;
  ageDivisionId: string;
  teamId: string;
  playerName: string;
  sourceRowId: string;
  sourceRowIndex: number;
  jerseyNumber?: string;
  grade?: string;
  source: {
    logicVersion: string;
    planStatus: RosterImportCommitPreviewPlanStatus;
    provisional: true;
  };
};

export type RosterImportApplicationProjectionRow = {
  previewSourceRowId: string | null;
  previewRowIndex: number;
  previewPlayerName: string | null;
  planStatus: RosterImportCommitPreviewPlanStatus;
  plannedOperation: RosterImportCommitPreviewPlanOperation;
  projectionStatus: RosterImportApplicationProjectionStatus;
  projectedOperation: RosterImportApplicationProjectionOperation;
  targetExistingRecordId?: string | null;
  projectedNewRecord?: ProjectedNewRosterRecord;
  reasons: RosterImportApplicationProjectionReasonCode[];
  blockers: RosterImportApplicationProjectionBlockerCode[];
  originalPlanRow: RosterImportCommitPreviewPlanRow;
};

export type RosterImportApplicationProjectionOptions = {
  /** When true (default), `rejected` plan rows project as `projected-reject`; when false, as `skipped`. */
  allowRejectedRows?: boolean;
  /** When true (default), `deferred` plan rows project as `projected-defer`; when false, as `skipped`. */
  allowDeferredRows?: boolean;
};

export type RosterImportApplicationProjectionInput = {
  plan: RosterImportCommitPreviewPlanResult;
  existingRosterRecords?: ExistingRosterProjectionRecord[];
  options?: RosterImportApplicationProjectionOptions;
};

export type RosterImportApplicationProjectionSummary = {
  totalRows: number;
  projectedLinkRows: number;
  projectedCreateRows: number;
  projectedRejectRows: number;
  projectedDeferRows: number;
  blockedRows: number;
  skippedRows: number;
  blockerCount: number;
  ok: boolean;
};

export type RosterImportApplicationProjectionResult = {
  ok: boolean;
  planCommittable: boolean;
  targetContext: RosterImportCommitPreviewPlanTargetContext;
  rows: RosterImportApplicationProjectionRow[];
  /** Result-level blockers (e.g. plan-not-committable). Row blockers live on rows. */
  blockers: RosterImportApplicationProjectionBlockerCode[];
  summary: RosterImportApplicationProjectionSummary;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function presentOrNull(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

const EMPTY_TARGET_CONTEXT: RosterImportCommitPreviewPlanTargetContext = {
  seasonId: null,
  districtId: null,
  ageDivisionId: null,
  teamId: null,
};

/** Deterministic provisional id for a projected new roster record. Not persisted. */
function deriveProvisionalRecordId(
  target: RosterImportCommitPreviewPlanTargetContext,
  sourceRowId: string,
  sourceRowIndex: number
): string {
  return [
    'projected',
    target.seasonId,
    target.districtId,
    target.ageDivisionId,
    target.teamId,
    sourceRowId,
    sourceRowIndex,
  ].join(':');
}

/**
 * Projects a committable dry-run commit plan into an in-memory roster projection:
 * per plan row, the link / create / reject / defer / blocked / skipped outcome a
 * future apply WOULD produce. Pure and deterministic; nothing is written, linked,
 * created, removed, or mutated.
 */
export function createRosterImportApplicationProjection(
  input: RosterImportApplicationProjectionInput
): RosterImportApplicationProjectionResult {
  const plan = input.plan;
  const planCommittable = plan?.canCommit === true;
  const targetContext = plan?.targetContext ?? EMPTY_TARGET_CONTEXT;

  const allowRejectedRows = input.options?.allowRejectedRows !== false;
  const allowDeferredRows = input.options?.allowDeferredRows !== false;

  // Gate: a non-committable plan yields a single result-level blocker and no rows.
  if (!planCommittable) {
    const blockers: RosterImportApplicationProjectionBlockerCode[] = [
      'plan-not-committable',
    ];
    const rows: RosterImportApplicationProjectionRow[] = [];
    return {
      ok: false,
      planCommittable,
      targetContext,
      rows,
      blockers,
      summary: summaryFor(rows, blockers, false),
    };
  }

  // Count existing record ids to detect duplicates (affects link resolution only).
  const existingRecords = Array.isArray(input.existingRosterRecords)
    ? input.existingRosterRecords
    : [];
  const existingIdCounts = new Map<string, number>();
  for (const record of existingRecords) {
    if (isNonEmptyString(record?.recordId)) {
      existingIdCounts.set(
        record.recordId,
        (existingIdCounts.get(record.recordId) ?? 0) + 1
      );
    }
  }

  const planRows = Array.isArray(plan.rows) ? plan.rows : [];
  const rows = planRows.map((planRow) =>
    projectRow(planRow, targetContext, existingIdCounts, {
      allowRejectedRows,
      allowDeferredRows,
    })
  );

  const rowBlockerCount = rows.reduce((n, r) => n + r.blockers.length, 0);
  const ok = planCommittable && rowBlockerCount === 0;

  return {
    ok,
    planCommittable,
    targetContext,
    rows,
    blockers: [],
    summary: summaryFor(rows, [], ok),
  };
}

/** Maps one committable plan row to a projection row. Pure; never mutates the row. */
function projectRow(
  planRow: RosterImportCommitPreviewPlanRow,
  targetContext: RosterImportCommitPreviewPlanTargetContext,
  existingIdCounts: Map<string, number>,
  options: { allowRejectedRows: boolean; allowDeferredRows: boolean }
): RosterImportApplicationProjectionRow {
  const base = {
    previewSourceRowId: planRow.previewSourceRowId,
    previewRowIndex: planRow.previewRowIndex,
    previewPlayerName: planRow.previewPlayerName,
    planStatus: planRow.planStatus,
    plannedOperation: planRow.plannedOperation,
    originalPlanRow: planRow,
  };

  const make = (
    projectionStatus: RosterImportApplicationProjectionStatus,
    projectedOperation: RosterImportApplicationProjectionOperation,
    reason: RosterImportApplicationProjectionReasonCode,
    blockers: RosterImportApplicationProjectionBlockerCode[] = [],
    extra: {
      targetExistingRecordId?: string | null;
      projectedNewRecord?: ProjectedNewRosterRecord;
    } = {}
  ): RosterImportApplicationProjectionRow => ({
    ...base,
    projectionStatus,
    projectedOperation,
    reasons: [reason],
    blockers,
    ...('targetExistingRecordId' in extra
      ? { targetExistingRecordId: extra.targetExistingRecordId }
      : {}),
    ...(extra.projectedNewRecord
      ? { projectedNewRecord: extra.projectedNewRecord }
      : {}),
  });

  const blocked = (
    blocker: RosterImportApplicationProjectionBlockerCode
  ): RosterImportApplicationProjectionRow =>
    make('blocked', 'none', 'blocked-by-plan', [blocker]);

  switch (planRow.planStatus) {
    case 'ready-to-link': {
      const target = presentOrNull(planRow.targetExistingRecordId);
      if (target === null) {
        // A ready-to-link row must carry a target id; an internally inconsistent
        // plan row is treated as invalid (never linked).
        return make('blocked', 'none', 'blocked-by-plan', ['invalid-plan-row'], {
          targetExistingRecordId: null,
        });
      }
      const count = existingIdCounts.get(target) ?? 0;
      if (count === 0) {
        return make('blocked', 'none', 'blocked-by-plan', [
          'missing-existing-record',
        ], { targetExistingRecordId: target });
      }
      if (count > 1) {
        return make('blocked', 'none', 'blocked-by-plan', [
          'duplicate-existing-record-id',
        ], { targetExistingRecordId: target });
      }
      return make(
        'projected-link',
        'link-existing-record',
        'linked-to-existing-record',
        [],
        { targetExistingRecordId: target }
      );
    }

    case 'ready-to-create': {
      const playerName = presentOrNull(planRow.previewPlayerName);
      const sourceRowId = presentOrNull(planRow.previewSourceRowId);
      const contextComplete =
        targetContext.seasonId !== null &&
        targetContext.districtId !== null &&
        targetContext.ageDivisionId !== null &&
        targetContext.teamId !== null;

      if (!contextComplete) {
        return blocked('missing-target-context');
      }
      if (sourceRowId === null) {
        return blocked('missing-preview-row-key');
      }
      if (playerName === null) {
        return blocked('missing-player-name-for-create');
      }

      const projectedNewRecord: ProjectedNewRosterRecord = {
        provisionalRecordId: deriveProvisionalRecordId(
          targetContext,
          sourceRowId,
          planRow.previewRowIndex
        ),
        seasonId: targetContext.seasonId as string,
        districtId: targetContext.districtId as string,
        ageDivisionId: targetContext.ageDivisionId as string,
        teamId: targetContext.teamId as string,
        playerName,
        sourceRowId,
        sourceRowIndex: planRow.previewRowIndex,
        source: {
          logicVersion: ROSTER_IMPORT_APPLICATION_PROJECTION_LOGIC_VERSION,
          planStatus: planRow.planStatus,
          provisional: true,
        },
      };
      return make(
        'projected-create',
        'create-new-roster-entry',
        'projected-new-roster-entry',
        [],
        { projectedNewRecord }
      );
    }

    case 'rejected':
      return options.allowRejectedRows
        ? make('projected-reject', 'reject-import-row', 'reviewer-rejected')
        : make('skipped', 'none', 'skipped-non-committed-row');

    case 'deferred':
      return options.allowDeferredRows
        ? make('projected-defer', 'defer-review', 'reviewer-deferred')
        : make('skipped', 'none', 'skipped-non-committed-row');

    case 'blocked-unresolved':
    case 'blocked-conflict':
    case 'blocked-invalid-preview-row':
    case 'blocked-review-preview-row':
      // Should never appear in a committable plan; defensively blocked here.
      return blocked('blocked-plan-row');

    default:
      // Defensive: an unknown plan status is conservatively blocked, never applied.
      return blocked('invalid-plan-row');
  }
}

function summaryFor(
  rows: RosterImportApplicationProjectionRow[],
  resultBlockers: RosterImportApplicationProjectionBlockerCode[],
  ok: boolean
): RosterImportApplicationProjectionSummary {
  const summary = summarizeRosterImportApplicationProjection(rows);
  summary.blockerCount += resultBlockers.length;
  summary.ok = ok;
  return summary;
}

/** Resolves either a projection result or a bare rows array into a rows array. */
function resolveRows(
  resultOrRows:
    | RosterImportApplicationProjectionResult
    | RosterImportApplicationProjectionRow[]
): RosterImportApplicationProjectionRow[] {
  return Array.isArray(resultOrRows) ? resultOrRows : resultOrRows.rows;
}

/**
 * Tallies projection rows into deterministic counts. The reported `ok` is ROW-LEVEL
 * readiness (at least one row, no `blocked` rows, no row blockers); the result's
 * top-level `ok` additionally requires the plan to be committable and no
 * result-level blockers. `blockerCount` here counts row blockers only.
 */
export function summarizeRosterImportApplicationProjection(
  projectionOrRows:
    | RosterImportApplicationProjectionResult
    | RosterImportApplicationProjectionRow[]
): RosterImportApplicationProjectionSummary {
  const rows = resolveRows(projectionOrRows);
  const summary: RosterImportApplicationProjectionSummary = {
    totalRows: rows.length,
    projectedLinkRows: 0,
    projectedCreateRows: 0,
    projectedRejectRows: 0,
    projectedDeferRows: 0,
    blockedRows: 0,
    skippedRows: 0,
    blockerCount: 0,
    ok: false,
  };

  for (const row of rows) {
    switch (row.projectionStatus) {
      case 'projected-link':
        summary.projectedLinkRows += 1;
        break;
      case 'projected-create':
        summary.projectedCreateRows += 1;
        break;
      case 'projected-reject':
        summary.projectedRejectRows += 1;
        break;
      case 'projected-defer':
        summary.projectedDeferRows += 1;
        break;
      case 'blocked':
        summary.blockedRows += 1;
        break;
      case 'skipped':
        summary.skippedRows += 1;
        break;
    }
    summary.blockerCount += row.blockers.length;
  }

  summary.ok =
    summary.totalRows > 0 &&
    summary.blockedRows === 0 &&
    summary.blockerCount === 0;
  return summary;
}

/** Projection rows that would link to an existing record (`projected-link`). */
export function getRosterImportApplicationProjectionLinkedRows(
  resultOrRows:
    | RosterImportApplicationProjectionResult
    | RosterImportApplicationProjectionRow[]
): RosterImportApplicationProjectionRow[] {
  return resolveRows(resultOrRows).filter(
    (row) => row.projectionStatus === 'projected-link'
  );
}

/** Projection rows that would add a new roster record (`projected-create`). */
export function getRosterImportApplicationProjectionNewRows(
  resultOrRows:
    | RosterImportApplicationProjectionResult
    | RosterImportApplicationProjectionRow[]
): RosterImportApplicationProjectionRow[] {
  return resolveRows(resultOrRows).filter(
    (row) => row.projectionStatus === 'projected-create'
  );
}

/**
 * Projection rows that produce no roster link/create — the preserved, non-committing
 * outcomes: `projected-reject`, `projected-defer`, and `skipped`. (Blocked rows are
 * a separate readiness failure and are not included here.)
 */
export function getRosterImportApplicationProjectionSkippedRows(
  resultOrRows:
    | RosterImportApplicationProjectionResult
    | RosterImportApplicationProjectionRow[]
): RosterImportApplicationProjectionRow[] {
  return resolveRows(resultOrRows).filter(
    (row) =>
      row.projectionStatus === 'projected-reject' ||
      row.projectionStatus === 'projected-defer' ||
      row.projectionStatus === 'skipped'
  );
}
