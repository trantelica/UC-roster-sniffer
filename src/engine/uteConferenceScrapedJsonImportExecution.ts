import type { Team, Player } from '../domain/types';
import type { ScrapedImportTransactionPlanResult } from './uteConferenceScrapedJsonImportTransactionPlan';

/**
 * Phase 5 slice 22: PURE, deterministic IN-MEMORY import EXECUTION + UNDO — ENGINE ONLY.
 *
 * This is the first controlled WRITE boundary in the import workflow, but the write is
 * IN-MEMORY ONLY: it produces a new roster/team value (the additions applied) for the
 * current runtime/session view. It is NOT durable — nothing is saved, persisted, or
 * committed to any store (no `localStorage`, no `IndexedDB`, no backend, no database) and
 * it does not survive a reload. It is fully reversible via the undo helper.
 *
 * It CONSUMES the slice 21 transaction plan and invents no parallel import model.
 * Execution requires a `planned` transaction plan: `rejected`/not-ready plans are refused.
 * Only `addOperations` change the roster (they are appended as new records, in plan/source
 * order, after the existing records which are preserved exactly and never reordered).
 * `linkOperations` are no-ops, and `deferredRows` / `rejectedRows` are never applied.
 *
 * Guardrails: never mutates any input (the transaction plan, the existing team, its
 * players). Existing roster records and imported names are preserved exactly. No identity
 * merge, no prior-season mutation. Caller-supplied `executedAt` / `undoneAt` keep output
 * deterministic.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_EXECUTION_LOGIC_VERSION =
  'phase5-slice22-scraped-json-import-execution-v1';

const EXECUTION_NOTE =
  'In-memory only. This execution applied new roster records to the current runtime/session roster view ONLY. It is NOT durable: nothing was saved, persisted, or committed to any store (no localStorage, IndexedDB, backend, or database), and it will not survive a reload. It can be undone in memory.';

const UNDO_NOTE =
  'In-memory only. This undo removed the records added by an in-memory execution from the current runtime/session roster view ONLY. Nothing durable was changed; no store was written.';

// ---------------------------------------------------------------------------
// Execution result shapes
// ---------------------------------------------------------------------------

export type ScrapedImportExecutionAppliedAddition = {
  rowIndex: number;
  /** Raw imported player name, preserved exactly. */
  importedName: string | null;
  /** Raw name applied as a new roster record, preserved exactly. */
  projectedRecordName: string | null;
  /** Deterministic provisional ref carried from the transaction plan. */
  projectedRecordRef: string;
};

export type ScrapedImportExecutionNoOpLink = {
  rowIndex: number;
  importedName: string | null;
  linkTargetExistingName: string | null;
};

export type ScrapedImportExecutionSkippedRow = {
  rowIndex: number;
  importedName: string | null;
};

export type ScrapedImportExecutionRosterSummary = {
  teamId: string;
  playerCount: number;
};

export type ScrapedImportExecutionDeltaSummary = {
  addedCount: number;
  noOpLinkCount: number;
  skippedDeferredCount: number;
  skippedRejectedCount: number;
  /** Only additions change the roster record count. */
  netRosterRecordChange: number;
};

export type ScrapedImportExecutionUndoPlan = {
  removableAdditionRefs: string[];
  removableAdditionCount: number;
  restoresToPlayerCount: number;
  noOpLinksPreserved: number;
};

export type ScrapedImportExecutionAudit = {
  logicVersion: string;
  transactionId: string;
  executedAt: string;
  executed: boolean;
  /** Always false — this execution is in-memory only. */
  durable: false;
  /** Always false — nothing is persisted to any store. */
  persisted: false;
  note: string;
};

export type ScrapedImportExecutionRejectionReasonCode =
  | 'transaction-not-planned'
  | 'transaction-already-executed'
  | 'missing-existing-team'
  | 'team-mismatch';

export type ScrapedImportExecutionRejectionReason = {
  code: string;
  message: string;
};

export type ScrapedImportExecutionResult =
  | {
      status: 'executed';
      transactionId: string;
      executedAt: string;
      durable: false;
      persisted: false;
      appliedAdditions: ScrapedImportExecutionAppliedAddition[];
      noOpLinks: ScrapedImportExecutionNoOpLink[];
      skippedDeferredRows: ScrapedImportExecutionSkippedRow[];
      skippedRejectedRows: ScrapedImportExecutionSkippedRow[];
      beforeRosterSummary: ScrapedImportExecutionRosterSummary;
      afterRosterSummary: ScrapedImportExecutionRosterSummary;
      rosterDeltaSummary: ScrapedImportExecutionDeltaSummary;
      /** New in-memory team value with additions applied (existing records preserved). */
      executedTeam: Team;
      undoPlan: ScrapedImportExecutionUndoPlan;
      audit: ScrapedImportExecutionAudit;
    }
  | {
      status: 'rejected';
      transactionId: string;
      executedAt: string;
      durable: false;
      persisted: false;
      reason: ScrapedImportExecutionRejectionReasonCode;
      message: string;
      rejectionReasons: ScrapedImportExecutionRejectionReason[];
      audit: ScrapedImportExecutionAudit;
    };

export type ExecuteScrapedJsonImportTransactionInput = {
  transactionPlan: ScrapedImportTransactionPlanResult;
  /** The current in-memory team the plan targets, or null when not located. */
  existingTeam: Team | null;
  /** Caller-supplied stable timestamp (keeps output deterministic). */
  executedAt: string;
};

function executionAudit(
  transactionId: string,
  executedAt: string,
  executed: boolean
): ScrapedImportExecutionAudit {
  return {
    logicVersion: UTE_CONFERENCE_SCRAPED_JSON_IMPORT_EXECUTION_LOGIC_VERSION,
    transactionId,
    executedAt,
    executed,
    durable: false,
    persisted: false,
    note: executed ? EXECUTION_NOTE : UNDO_NOTE,
  };
}

function executionRejected(
  transactionId: string,
  executedAt: string,
  reason: ScrapedImportExecutionRejectionReasonCode,
  message: string,
  rejectionReasons: ScrapedImportExecutionRejectionReason[] = []
): ScrapedImportExecutionResult {
  return {
    status: 'rejected',
    transactionId,
    executedAt,
    durable: false,
    persisted: false,
    reason,
    message,
    rejectionReasons:
      rejectionReasons.length > 0 ? rejectionReasons : [{ code: reason, message }],
    audit: executionAudit(transactionId, executedAt, false),
  };
}

/** The raw name that an addition applies as a new record (preserved exactly). */
function additionRecordName(
  projectedRecordName: string | null,
  importedName: string | null
): string {
  return projectedRecordName ?? importedName ?? '';
}

/**
 * Executes a `planned` transaction plan into a new in-memory team value. Pure; never
 * mutates the plan, the existing team, or its players. Returns a `rejected` result for any
 * plan that is not `planned`, a missing team, or a team/plan mismatch — producing no
 * additions.
 */
export function executeUteConferenceScrapedJsonImportTransaction(
  input: ExecuteScrapedJsonImportTransactionInput
): ScrapedImportExecutionResult {
  const { transactionPlan, existingTeam, executedAt } = input;
  const transactionId = transactionPlan.transactionId;

  if (transactionPlan.status !== 'planned') {
    const reasons: ScrapedImportExecutionRejectionReason[] =
      transactionPlan.status === 'rejected'
        ? transactionPlan.blockingReasons.map((r) => ({
            code: r.code,
            message: r.message,
          }))
        : [];
    return executionRejected(
      transactionId,
      executedAt,
      'transaction-not-planned',
      'The transaction plan is not planned (it was rejected as not ready), so in-memory execution is refused.',
      reasons
    );
  }
  // Defensive: a re-planned transaction is always `executed: false`; refuse otherwise.
  if (transactionPlan.executed !== false) {
    return executionRejected(
      transactionId,
      executedAt,
      'transaction-already-executed',
      'The transaction plan is already marked executed, so it cannot be executed again.'
    );
  }
  if (!existingTeam) {
    return executionRejected(
      transactionId,
      executedAt,
      'missing-existing-team',
      'The target roster team could not be located in memory, so execution is refused.'
    );
  }
  if (existingTeam.teamId !== transactionPlan.beforeRosterSummary.teamId) {
    return executionRejected(
      transactionId,
      executedAt,
      'team-mismatch',
      `The provided team (${existingTeam.teamId}) does not match the transaction plan target (${transactionPlan.beforeRosterSummary.teamId}).`
    );
  }

  const appliedAdditions: ScrapedImportExecutionAppliedAddition[] =
    transactionPlan.addOperations.map((op) => ({
      rowIndex: op.rowIndex,
      importedName: op.importedName,
      projectedRecordName: op.projectedRecordName,
      projectedRecordRef: op.projectedRecordRef,
    }));

  const addedPlayers: Player[] = appliedAdditions.map((a) => ({
    name: additionRecordName(a.projectedRecordName, a.importedName),
  }));

  // Existing records preserved exactly and in order; additions appended after them.
  const executedTeam: Team = {
    ...existingTeam,
    players: [...existingTeam.players, ...addedPlayers],
  };

  const noOpLinks: ScrapedImportExecutionNoOpLink[] =
    transactionPlan.linkOperations.map((op) => ({
      rowIndex: op.rowIndex,
      importedName: op.importedName,
      linkTargetExistingName: op.linkTargetExistingName,
    }));
  const skippedDeferredRows: ScrapedImportExecutionSkippedRow[] =
    transactionPlan.deferredRows.map((r) => ({
      rowIndex: r.rowIndex,
      importedName: r.importedName,
    }));
  const skippedRejectedRows: ScrapedImportExecutionSkippedRow[] =
    transactionPlan.rejectedRows.map((r) => ({
      rowIndex: r.rowIndex,
      importedName: r.importedName,
    }));

  const beforeCount = existingTeam.players.length;
  const afterCount = executedTeam.players.length;

  return {
    status: 'executed',
    transactionId,
    executedAt,
    durable: false,
    persisted: false,
    appliedAdditions,
    noOpLinks,
    skippedDeferredRows,
    skippedRejectedRows,
    beforeRosterSummary: { teamId: existingTeam.teamId, playerCount: beforeCount },
    afterRosterSummary: { teamId: existingTeam.teamId, playerCount: afterCount },
    rosterDeltaSummary: {
      addedCount: appliedAdditions.length,
      noOpLinkCount: noOpLinks.length,
      skippedDeferredCount: skippedDeferredRows.length,
      skippedRejectedCount: skippedRejectedRows.length,
      netRosterRecordChange: appliedAdditions.length,
    },
    executedTeam,
    undoPlan: {
      removableAdditionRefs: appliedAdditions.map((a) => a.projectedRecordRef),
      removableAdditionCount: appliedAdditions.length,
      restoresToPlayerCount: beforeCount,
      noOpLinksPreserved: noOpLinks.length,
    },
    audit: executionAudit(transactionId, executedAt, true),
  };
}

// ---------------------------------------------------------------------------
// Undo result shapes
// ---------------------------------------------------------------------------

export type ScrapedImportUndoRejectionReasonCode =
  | 'not-executed'
  | 'malformed-execution';

export type ScrapedImportUndoResult =
  | {
      status: 'undone';
      transactionId: string;
      undoneAt: string;
      durable: false;
      persisted: false;
      removedAdditionRefs: string[];
      removedAdditionCount: number;
      noOpLinksPreserved: number;
      beforeUndoRosterSummary: ScrapedImportExecutionRosterSummary;
      afterUndoRosterSummary: ScrapedImportExecutionRosterSummary;
      /** New in-memory team value restored to its pre-execution state. */
      restoredTeam: Team;
      audit: ScrapedImportExecutionAudit;
    }
  | {
      status: 'rejected';
      transactionId: string;
      undoneAt: string;
      durable: false;
      persisted: false;
      reason: ScrapedImportUndoRejectionReasonCode;
      message: string;
    };

export type UndoScrapedJsonImportExecutionInput = {
  executionResult: ScrapedImportExecutionResult;
  /** Caller-supplied stable timestamp (keeps output deterministic). */
  undoneAt: string;
};

function undoRejected(
  transactionId: string,
  undoneAt: string,
  reason: ScrapedImportUndoRejectionReasonCode,
  message: string
): ScrapedImportUndoResult {
  return {
    status: 'rejected',
    transactionId,
    undoneAt,
    durable: false,
    persisted: false,
    reason,
    message,
  };
}

/**
 * Undoes an in-memory execution, removing ONLY the records its additions created and
 * restoring the team to its pre-execution player count. Pure; never mutates the execution
 * result or its team. Rejects non-executed or malformed execution results. Linked existing
 * records, deferred rows, and rejected rows are untouched (they were never applied).
 */
export function undoUteConferenceScrapedJsonImportExecution(
  input: UndoScrapedJsonImportExecutionInput
): ScrapedImportUndoResult {
  const { executionResult, undoneAt } = input;
  const transactionId = executionResult.transactionId;

  if (executionResult.status !== 'executed') {
    return undoRejected(
      transactionId,
      undoneAt,
      'not-executed',
      'The execution result is not an executed import, so there is nothing to undo.'
    );
  }

  const team = executionResult.executedTeam;
  const beforeCount = executionResult.beforeRosterSummary.playerCount;
  const additions = executionResult.appliedAdditions;
  const expectedLength = beforeCount + additions.length;

  // Validate the executed team still ends with exactly the additions this result applied,
  // so undo removes only those records and preserves every surviving record exactly.
  if (team.players.length !== expectedLength) {
    return undoRejected(
      transactionId,
      undoneAt,
      'malformed-execution',
      'The executed team no longer matches the recorded execution (player count mismatch), so undo is refused.'
    );
  }
  for (let i = 0; i < additions.length; i += 1) {
    const expectedName = additionRecordName(
      additions[i].projectedRecordName,
      additions[i].importedName
    );
    if (team.players[beforeCount + i]?.name !== expectedName) {
      return undoRejected(
        transactionId,
        undoneAt,
        'malformed-execution',
        'The executed team no longer matches the recorded additions, so undo is refused.'
      );
    }
  }

  const restoredTeam: Team = {
    ...team,
    players: team.players.slice(0, beforeCount),
  };

  return {
    status: 'undone',
    transactionId,
    undoneAt,
    durable: false,
    persisted: false,
    removedAdditionRefs: additions.map((a) => a.projectedRecordRef),
    removedAdditionCount: additions.length,
    noOpLinksPreserved: executionResult.noOpLinks.length,
    beforeUndoRosterSummary: {
      teamId: team.teamId,
      playerCount: team.players.length,
    },
    afterUndoRosterSummary: {
      teamId: team.teamId,
      playerCount: restoredTeam.players.length,
    },
    restoredTeam,
    audit: executionAudit(transactionId, undoneAt, false),
  };
}

// ---------------------------------------------------------------------------
// Execution availability gate (pure; used by the UI to gate the action)
// ---------------------------------------------------------------------------

export type ScrapedImportExecutionAvailabilityReasonCode =
  | 'ready'
  | 'already-executed'
  | 'not-staged'
  | 'transaction-not-planned';

export type ScrapedImportExecutionAvailability = {
  canExecute: boolean;
  reasonCode: ScrapedImportExecutionAvailabilityReasonCode;
  message: string;
};

/**
 * Deterministic gate for whether the explicit in-memory execution action should be
 * available. Execution requires a staged preview, a `planned` transaction plan, and no
 * already-executed in-memory import for the active workflow.
 */
export function evaluateScrapedJsonImportExecutionAvailability(input: {
  transactionPlan: ScrapedImportTransactionPlanResult;
  staged: boolean;
  alreadyExecuted: boolean;
}): ScrapedImportExecutionAvailability {
  if (input.alreadyExecuted) {
    return {
      canExecute: false,
      reasonCode: 'already-executed',
      message:
        'An in-memory import is already executed. Undo it before executing again.',
    };
  }
  if (!input.staged) {
    return {
      canExecute: false,
      reasonCode: 'not-staged',
      message: 'Stage the preview before executing the in-memory import.',
    };
  }
  if (input.transactionPlan.status !== 'planned') {
    return {
      canExecute: false,
      reasonCode: 'transaction-not-planned',
      message:
        'The transaction plan is not ready/planned, so in-memory execution is unavailable.',
    };
  }
  return {
    canExecute: true,
    reasonCode: 'ready',
    message: 'Ready to execute the import in memory (in-memory only; no durable commit).',
  };
}
