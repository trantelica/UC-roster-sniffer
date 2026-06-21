import type { StaffCoach, Team, TeamCoachAssignment } from '../domain/types';
import { adaptCoachImport, type CoachImportSource } from './coachImportAdapter';
import { assignmentId, coachIdForIdentityKey } from './coachModel';

/**
 * Phase 7 slice 27: PURE, deterministic COACH IMPORT PREVIEW — ENGINE ONLY.
 *
 * Classifies each adapted coach-import row against the current coaches/assignments as
 * add / update / skip / error / review. Coach identity is name-based: a row reuses an
 * existing coach when exactly one existing coach shares its identity key; ZERO existing
 * matches add a new coach; MORE THAN ONE existing match is AMBIGUOUS and surfaced as a
 * blocking `review` (never silently merged). Assignments match by (season, team, coach);
 * a duplicate within the import blocks. It never silently overwrites.
 *
 * Guardrails: never mutates inputs; deterministic; no I/O.
 */

export const COACH_IMPORT_PREVIEW_LOGIC_VERSION = 'phase7-slice27-coach-import-preview-v1';

export type CoachImportRowOutcome = 'add' | 'update' | 'skip' | 'error' | 'review';
export type CoachAction = 'add' | 'reuse' | null;
export type AssignmentAction = 'add' | 'update' | 'skip' | null;

export type CoachImportPreviewReason = { code: string; message: string };

export type CoachImportPreviewRow = {
  rowIndex: number;
  sourceRowId: string;
  outcome: CoachImportRowOutcome;
  source: CoachImportSource;
  coachName: string | null;
  teamId: string | null;
  seasonId: string | null;
  role: string | null;
  coachAction: CoachAction;
  assignmentAction: AssignmentAction;
  /** The coachId this row would add or reuse, when resolvable. */
  resolvedCoachId: string | null;
  /** Existing assignment id this row would update, when applicable. */
  targetAssignmentId: string | null;
  reasons: CoachImportPreviewReason[];
};

export type CoachImportBlockingError = {
  rowIndex: number;
  sourceRowId: string;
  code: string;
  message: string;
};

export type CoachImportPreview = {
  available: boolean;
  shapeError: { code: string; message: string } | null;
  importType: string | null;
  seasonId: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  coachesToAdd: number;
  assignmentsToAdd: number;
  assignmentsToUpdate: number;
  skippedRows: number;
  unresolvedTeamReferences: number;
  ambiguousIdentityRows: number;
  blockingErrors: CoachImportBlockingError[];
  isExecutable: boolean;
  rows: CoachImportPreviewRow[];
};

function unavailable(code: string, message: string): CoachImportPreview {
  return {
    available: false,
    shapeError: { code, message },
    importType: null,
    seasonId: null,
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    coachesToAdd: 0,
    assignmentsToAdd: 0,
    assignmentsToUpdate: 0,
    skippedRows: 0,
    unresolvedTeamReferences: 0,
    ambiguousIdentityRows: 0,
    blockingErrors: [],
    isExecutable: false,
    rows: [],
  };
}

export type BuildCoachImportPreviewInput = {
  payload: unknown;
  teams: Team[];
  existingCoaches: StaffCoach[];
  existingAssignments: TeamCoachAssignment[];
};

/**
 * Builds the coach import preview. Pure; never mutates inputs. Returns an unavailable preview
 * for a structurally invalid file shape.
 */
export function buildCoachImportPreview(
  input: BuildCoachImportPreviewInput
): CoachImportPreview {
  const adapted = adaptCoachImport(input.payload, { teams: input.teams });
  if (!adapted.ok) return unavailable(adapted.shapeError.code, adapted.shapeError.message);

  // Existing coach identity keys -> count of distinct coachIds (>1 = ambiguous).
  const coachIdsByKey = new Map<string, Set<string>>();
  for (const c of input.existingCoaches) {
    const set = coachIdsByKey.get(c.identityKey) ?? new Set<string>();
    set.add(c.coachId);
    coachIdsByKey.set(c.identityKey, set);
  }
  const existingAssignmentById = new Map(input.existingAssignments.map((a) => [a.assignmentId, a]));

  // Pre-count assignment natural keys WITHIN the import (resolvable rows only) to block dups.
  const importAssignmentKeyCounts = new Map<string, number>();
  for (const row of adapted.rows) {
    if (!row.candidate) continue;
    const existing = coachIdsByKey.get(row.candidate.identityKey);
    if (existing && existing.size > 1) continue; // ambiguous handled per-row
    const coachId =
      existing && existing.size === 1
        ? [...existing][0]
        : coachIdForIdentityKey(row.candidate.identityKey);
    const key = `${row.candidate.seasonId}|${row.candidate.teamId}|${coachId}`;
    importAssignmentKeyCounts.set(key, (importAssignmentKeyCounts.get(key) ?? 0) + 1);
  }

  const rows: CoachImportPreviewRow[] = adapted.rows.map((adaptedRow) => {
    const base = {
      rowIndex: adaptedRow.rowIndex,
      sourceRowId: adaptedRow.sourceRowId,
      source: adaptedRow.source,
      coachName: adaptedRow.candidate?.coachName ?? adaptedRow.source.coachName,
      teamId: adaptedRow.candidate?.teamId ?? adaptedRow.source.teamId,
      seasonId: adaptedRow.candidate?.seasonId ?? null,
      role: adaptedRow.candidate?.role ?? adaptedRow.source.role,
    };

    if (adaptedRow.errors.length > 0 || !adaptedRow.candidate) {
      return {
        ...base,
        outcome: 'error',
        coachAction: null,
        assignmentAction: null,
        resolvedCoachId: null,
        targetAssignmentId: null,
        reasons: adaptedRow.errors.map((e) => ({ code: e.code, message: e.message })),
      };
    }

    const candidate = adaptedRow.candidate;
    const existing = coachIdsByKey.get(candidate.identityKey);

    // Ambiguous coach identity: more than one existing coach shares this name key.
    if (existing && existing.size > 1) {
      return {
        ...base,
        outcome: 'review',
        coachAction: null,
        assignmentAction: null,
        resolvedCoachId: null,
        targetAssignmentId: null,
        reasons: [
          {
            code: 'ambiguous-coach-identity',
            message: `"${candidate.coachName}" matches ${existing.size} existing coaches; resolve before importing.`,
          },
        ],
      };
    }

    const coachAction: CoachAction = existing && existing.size === 1 ? 'reuse' : 'add';
    const resolvedCoachId =
      coachAction === 'reuse'
        ? [...existing!][0]
        : coachIdForIdentityKey(candidate.identityKey);

    const natKey = `${candidate.seasonId}|${candidate.teamId}|${resolvedCoachId}`;
    if ((importAssignmentKeyCounts.get(natKey) ?? 0) > 1) {
      return {
        ...base,
        outcome: 'error',
        coachAction,
        assignmentAction: null,
        resolvedCoachId,
        targetAssignmentId: null,
        reasons: [
          {
            code: 'duplicate-in-import',
            message: 'Multiple import rows assign the same coach to the same team/season.',
          },
        ],
      };
    }

    const targetId = assignmentId(candidate.seasonId, candidate.teamId, resolvedCoachId);
    const existingAssignment = existingAssignmentById.get(targetId) ?? null;
    if (existingAssignment) {
      const unchanged =
        existingAssignment.role === candidate.role &&
        (existingAssignment.sourceLabel ?? null) === (candidate.sourceLabel ?? null);
      if (unchanged) {
        return {
          ...base,
          outcome: 'skip',
          coachAction: 'reuse',
          assignmentAction: 'skip',
          resolvedCoachId,
          targetAssignmentId: targetId,
          reasons: [{ code: 'no-change', message: 'Assignment already exists; nothing to update.' }],
        };
      }
      return {
        ...base,
        outcome: 'update',
        coachAction,
        assignmentAction: 'update',
        resolvedCoachId,
        targetAssignmentId: targetId,
        reasons: [],
      };
    }

    return {
      ...base,
      outcome: 'add',
      coachAction,
      assignmentAction: 'add',
      resolvedCoachId,
      targetAssignmentId: null,
      reasons: [],
    };
  });

  const blockingErrors: CoachImportBlockingError[] = [];
  let invalidRows = 0;
  let ambiguousIdentityRows = 0;
  let unresolvedTeamReferences = 0;
  let assignmentsToAdd = 0;
  let assignmentsToUpdate = 0;
  let skippedRows = 0;
  const addedCoachIds = new Set<string>();

  for (const row of rows) {
    if (row.outcome === 'error' || row.outcome === 'review') {
      if (row.outcome === 'error') invalidRows += 1;
      if (row.outcome === 'review') ambiguousIdentityRows += 1;
      if (row.reasons.some((r) => r.code === 'unresolved-team')) unresolvedTeamReferences += 1;
      for (const reason of row.reasons) {
        blockingErrors.push({
          rowIndex: row.rowIndex,
          sourceRowId: row.sourceRowId,
          code: reason.code,
          message: reason.message,
        });
      }
    } else if (row.outcome === 'add') {
      assignmentsToAdd += 1;
      if (row.coachAction === 'add' && row.resolvedCoachId) addedCoachIds.add(row.resolvedCoachId);
    } else if (row.outcome === 'update') {
      assignmentsToUpdate += 1;
    } else if (row.outcome === 'skip') {
      skippedRows += 1;
    }
  }

  const validRows = rows.length - invalidRows - ambiguousIdentityRows;
  const isExecutable =
    blockingErrors.length === 0 && assignmentsToAdd + assignmentsToUpdate > 0;

  return {
    available: true,
    shapeError: null,
    importType: adapted.importType,
    seasonId: adapted.seasonId,
    totalRows: rows.length,
    validRows,
    invalidRows,
    coachesToAdd: addedCoachIds.size,
    assignmentsToAdd,
    assignmentsToUpdate,
    skippedRows,
    unresolvedTeamReferences,
    ambiguousIdentityRows,
    blockingErrors,
    isExecutable,
    rows,
  };
}
