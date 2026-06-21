import type { CoachRole, StaffCoach, TeamCoachAssignment } from '../domain/types';
import type { CoachImportPreview } from './coachImportPreview';
import { assignmentId, buildStaffCoach } from './coachModel';

/**
 * Phase 7 slice 27: PURE, deterministic IN-MEMORY coach import EXECUTION + UNDO.
 *
 * Applies an EXECUTABLE coach-import preview into new coaches/assignments arrays: `add` rows
 * add a new coach (only when not deterministically matched to an existing coach) and a new
 * assignment; `update` rows replace the targeted assignment's role/sourceLabel in place;
 * `skip` / `error` / `review` rows are not applied. Existing coaches and assignments are
 * preserved exactly unless explicitly updated. NEVER destructively merges identities.
 *
 * Guardrails: never mutates inputs (preview, coaches, assignments); the write is IN-MEMORY
 * ONLY (durable only via a workspace snapshot export); never touches rosters or games. Undo
 * removes added assignments, restores updated ones, and removes added coaches only when no
 * surviving assignment references them. Caller-supplied transactionId/executedAt/undoneAt.
 */

export const COACH_IMPORT_EXECUTION_LOGIC_VERSION = 'phase7-slice27-coach-import-execution-v1';

const EXECUTION_NOTE =
  'In-memory only. Imported coaches/assignments were applied to the current runtime workspace; nothing is durable until you export a workspace snapshot. No browser storage, database, or sync is used.';

export type CoachImportExecutionAudit = {
  logicVersion: string;
  transactionId: string;
  executedAt: string;
  executed: boolean;
  durable: false;
  persisted: false;
  note: string;
};

export type CoachImportExecutionResult =
  | {
      status: 'executed';
      transactionId: string;
      executedAt: string;
      durable: false;
      persisted: false;
      addedCoachIds: string[];
      addedAssignmentIds: string[];
      updatedAssignmentIds: string[];
      skippedRowIds: string[];
      previousAssignmentsById: Record<string, TeamCoachAssignment>;
      coaches: StaffCoach[];
      coachAssignments: TeamCoachAssignment[];
      audit: CoachImportExecutionAudit;
    }
  | {
      status: 'rejected';
      transactionId: string;
      executedAt: string;
      durable: false;
      persisted: false;
      reason: 'preview-not-executable' | 'update-target-missing';
      message: string;
    };

function cloneAssignment(a: TeamCoachAssignment): TeamCoachAssignment {
  return JSON.parse(JSON.stringify(a)) as TeamCoachAssignment;
}
function cloneCoach(c: StaffCoach): StaffCoach {
  return JSON.parse(JSON.stringify(c)) as StaffCoach;
}

export type ExecuteCoachImportInput = {
  preview: CoachImportPreview;
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  transactionId: string;
  executedAt: string;
};

/**
 * Executes an executable coach-import preview. Pure; never mutates inputs. Returns a rejected
 * result when the preview is not executable.
 */
export function executeCoachImport(
  input: ExecuteCoachImportInput
): CoachImportExecutionResult {
  const { preview, coaches, coachAssignments, transactionId, executedAt } = input;
  if (!preview.isExecutable) {
    return {
      status: 'rejected',
      transactionId,
      executedAt,
      durable: false,
      persisted: false,
      reason: 'preview-not-executable',
      message: 'The coach import preview is not executable (blocking errors or no changes).',
    };
  }

  const nextCoaches = coaches.map(cloneCoach);
  const coachIds = new Set(nextCoaches.map((c) => c.coachId));
  const nextAssignments = coachAssignments.map(cloneAssignment);
  const assignmentIndexById = new Map(nextAssignments.map((a, i) => [a.assignmentId, i]));

  const addedCoachIds: string[] = [];
  const addedAssignmentIds: string[] = [];
  const updatedAssignmentIds: string[] = [];
  const skippedRowIds: string[] = [];
  const previousAssignmentsById: Record<string, TeamCoachAssignment> = {};

  for (const row of preview.rows) {
    if (row.outcome === 'add' && row.resolvedCoachId && row.teamId && row.seasonId && row.coachName) {
      if (row.coachAction === 'add' && !coachIds.has(row.resolvedCoachId)) {
        const coach = buildStaffCoach(row.coachName);
        nextCoaches.push(coach);
        coachIds.add(coach.coachId);
        addedCoachIds.push(coach.coachId);
      }
      const id = assignmentId(row.seasonId, row.teamId, row.resolvedCoachId);
      const assignment: TeamCoachAssignment = {
        assignmentId: id,
        seasonId: row.seasonId,
        teamId: row.teamId,
        coachId: row.resolvedCoachId,
        role: (row.role as CoachRole) ?? 'unknown',
      };
      if (row.source.sourceLabel !== null) assignment.sourceLabel = row.source.sourceLabel;
      assignment.sourceRowId = row.sourceRowId;
      nextAssignments.push(assignment);
      assignmentIndexById.set(id, nextAssignments.length - 1);
      addedAssignmentIds.push(id);
    } else if (row.outcome === 'update' && row.targetAssignmentId) {
      const index = assignmentIndexById.get(row.targetAssignmentId);
      if (index === undefined) {
        return {
          status: 'rejected',
          transactionId,
          executedAt,
          durable: false,
          persisted: false,
          reason: 'update-target-missing',
          message: `Update target "${row.targetAssignmentId}" no longer exists.`,
        };
      }
      if (!(row.targetAssignmentId in previousAssignmentsById)) {
        previousAssignmentsById[row.targetAssignmentId] = cloneAssignment(nextAssignments[index]);
      }
      const prior = nextAssignments[index];
      const updated: TeamCoachAssignment = {
        ...prior,
        role: (row.role as CoachRole) ?? prior.role,
      };
      if (row.source.sourceLabel !== null) updated.sourceLabel = row.source.sourceLabel;
      nextAssignments[index] = updated;
      updatedAssignmentIds.push(row.targetAssignmentId);
    } else if (row.outcome === 'skip') {
      skippedRowIds.push(row.sourceRowId);
    }
  }

  return {
    status: 'executed',
    transactionId,
    executedAt,
    durable: false,
    persisted: false,
    addedCoachIds,
    addedAssignmentIds,
    updatedAssignmentIds,
    skippedRowIds,
    previousAssignmentsById,
    coaches: nextCoaches,
    coachAssignments: nextAssignments,
    audit: {
      logicVersion: COACH_IMPORT_EXECUTION_LOGIC_VERSION,
      transactionId,
      executedAt,
      executed: true,
      durable: false,
      persisted: false,
      note: EXECUTION_NOTE,
    },
  };
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

export type CoachImportUndoResult =
  | {
      status: 'undone';
      transactionId: string;
      undoneAt: string;
      durable: false;
      persisted: false;
      removedAssignmentIds: string[];
      restoredAssignmentIds: string[];
      removedCoachIds: string[];
      keptAddedCoachIds: string[];
      coaches: StaffCoach[];
      coachAssignments: TeamCoachAssignment[];
    }
  | {
      status: 'rejected';
      transactionId: string;
      undoneAt: string;
      reason: 'not-executed' | 'malformed-execution';
      message: string;
    };

export type UndoCoachImportInput = {
  executionResult: CoachImportExecutionResult;
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  undoneAt: string;
};

/**
 * Undoes a coach import: removes added assignments, restores updated assignments, and removes
 * added coaches ONLY when no surviving assignment references them. Pure; never mutates inputs.
 */
export function undoCoachImport(input: UndoCoachImportInput): CoachImportUndoResult {
  const { executionResult, coaches, coachAssignments, undoneAt } = input;
  const transactionId = executionResult.transactionId;

  if (executionResult.status !== 'executed') {
    return {
      status: 'rejected',
      transactionId,
      undoneAt,
      reason: 'not-executed',
      message: 'The execution result is not an executed coach import; nothing to undo.',
    };
  }
  for (const updatedId of executionResult.updatedAssignmentIds) {
    if (!(updatedId in executionResult.previousAssignmentsById)) {
      return {
        status: 'rejected',
        transactionId,
        undoneAt,
        reason: 'malformed-execution',
        message: `No captured prior state for updated assignment "${updatedId}".`,
      };
    }
  }

  const addedAssignmentSet = new Set(executionResult.addedAssignmentIds);
  const restoredAssignmentIds: string[] = [];
  const nextAssignments: TeamCoachAssignment[] = [];
  for (const a of coachAssignments) {
    if (addedAssignmentSet.has(a.assignmentId)) continue; // remove added assignments
    const prior = executionResult.previousAssignmentsById[a.assignmentId];
    if (prior !== undefined) {
      nextAssignments.push(cloneAssignment(prior));
      restoredAssignmentIds.push(a.assignmentId);
    } else {
      nextAssignments.push(cloneAssignment(a)); // unrelated assignment preserved
    }
  }

  // Remove added coaches only when no surviving assignment references them.
  const referencedCoachIds = new Set(nextAssignments.map((a) => a.coachId));
  const addedCoachSet = new Set(executionResult.addedCoachIds);
  const removedCoachIds: string[] = [];
  const keptAddedCoachIds: string[] = [];
  const nextCoaches: StaffCoach[] = [];
  for (const c of coaches) {
    if (addedCoachSet.has(c.coachId) && !referencedCoachIds.has(c.coachId)) {
      removedCoachIds.push(c.coachId);
      continue;
    }
    if (addedCoachSet.has(c.coachId)) keptAddedCoachIds.push(c.coachId);
    nextCoaches.push(cloneCoach(c));
  }

  return {
    status: 'undone',
    transactionId,
    undoneAt,
    durable: false,
    persisted: false,
    removedAssignmentIds: [...executionResult.addedAssignmentIds],
    restoredAssignmentIds,
    removedCoachIds,
    keptAddedCoachIds,
    coaches: nextCoaches,
    coachAssignments: nextAssignments,
  };
}
