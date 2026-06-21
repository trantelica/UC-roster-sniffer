import type { Game } from '../domain/types';
import type { ScheduleImportPreview } from './scheduleImportPreview';

/**
 * Phase 6 slice 25: PURE, deterministic IN-MEMORY schedule import EXECUTION + UNDO.
 *
 * Applies an EXECUTABLE schedule import preview into the current in-memory games array:
 * `add` rows append new games, `update` rows replace the targeted existing game in place
 * (keeping its gameId), and `skip` / `error` rows are not applied. Existing games are
 * preserved exactly unless explicitly updated, and order is preserved (updates in place,
 * adds appended).
 *
 * Guardrails: never mutates inputs (games, preview); the write is IN-MEMORY ONLY — not
 * durable, not persisted (durability comes only from a user-exported workspace snapshot).
 * Undo removes added games and restores updated games to their captured prior state.
 * Caller-supplied transactionId / executedAt / undoneAt keep output deterministic.
 */

export const SCHEDULE_IMPORT_EXECUTION_LOGIC_VERSION =
  'phase6-slice25-schedule-import-execution-v1';

const EXECUTION_NOTE =
  'In-memory only. Imported schedule games were applied to the current runtime workspace; nothing is durable until you export a workspace snapshot. No browser storage, database, or sync is used.';

export type ScheduleImportExecutionAudit = {
  logicVersion: string;
  transactionId: string;
  executedAt: string;
  executed: boolean;
  durable: false;
  persisted: false;
  note: string;
};

export type ScheduleImportExecutionRejectionCode =
  | 'preview-not-executable'
  | 'update-target-missing';

export type ScheduleImportExecutionResult =
  | {
      status: 'executed';
      transactionId: string;
      executedAt: string;
      durable: false;
      persisted: false;
      addedGameIds: string[];
      updatedGameIds: string[];
      skippedRowIds: string[];
      /** Prior state of each updated game, captured for undo (keyed by gameId). */
      previousGamesByGameId: Record<string, Game>;
      /** New in-memory games array with the import applied. */
      games: Game[];
      audit: ScheduleImportExecutionAudit;
    }
  | {
      status: 'rejected';
      transactionId: string;
      executedAt: string;
      durable: false;
      persisted: false;
      reason: ScheduleImportExecutionRejectionCode;
      message: string;
    };

function cloneGame(game: Game): Game {
  return JSON.parse(JSON.stringify(game)) as Game;
}

export type ExecuteScheduleImportInput = {
  preview: ScheduleImportPreview;
  games: Game[];
  transactionId: string;
  executedAt: string;
};

/**
 * Executes an executable schedule import preview into a new games array. Pure; never mutates
 * inputs. Returns a rejected result when the preview is not executable.
 */
export function executeScheduleImport(
  input: ExecuteScheduleImportInput
): ScheduleImportExecutionResult {
  const { preview, games, transactionId, executedAt } = input;
  if (!preview.isExecutable) {
    return {
      status: 'rejected',
      transactionId,
      executedAt,
      durable: false,
      persisted: false,
      reason: 'preview-not-executable',
      message: 'The schedule import preview is not executable (blocking errors or no changes).',
    };
  }

  const nextGames = games.map(cloneGame);
  const indexById = new Map(nextGames.map((g, i) => [g.gameId, i]));
  const addedGameIds: string[] = [];
  const updatedGameIds: string[] = [];
  const skippedRowIds: string[] = [];
  const previousGamesByGameId: Record<string, Game> = {};

  for (const row of preview.rows) {
    if (row.outcome === 'add' && row.game) {
      nextGames.push(cloneGame(row.game));
      indexById.set(row.game.gameId, nextGames.length - 1);
      addedGameIds.push(row.game.gameId);
    } else if (row.outcome === 'update' && row.game && row.targetGameId) {
      const index = indexById.get(row.targetGameId);
      if (index === undefined) {
        return {
          status: 'rejected',
          transactionId,
          executedAt,
          durable: false,
          persisted: false,
          reason: 'update-target-missing',
          message: `Update target "${row.targetGameId}" no longer exists.`,
        };
      }
      if (!(row.targetGameId in previousGamesByGameId)) {
        previousGamesByGameId[row.targetGameId] = cloneGame(nextGames[index]);
      }
      nextGames[index] = { ...cloneGame(row.game), gameId: row.targetGameId };
      updatedGameIds.push(row.targetGameId);
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
    addedGameIds,
    updatedGameIds,
    skippedRowIds,
    previousGamesByGameId,
    games: nextGames,
    audit: {
      logicVersion: SCHEDULE_IMPORT_EXECUTION_LOGIC_VERSION,
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

export type ScheduleImportUndoRejectionCode = 'not-executed' | 'malformed-execution';

export type ScheduleImportUndoResult =
  | {
      status: 'undone';
      transactionId: string;
      undoneAt: string;
      durable: false;
      persisted: false;
      removedGameIds: string[];
      restoredGameIds: string[];
      games: Game[];
    }
  | {
      status: 'rejected';
      transactionId: string;
      undoneAt: string;
      reason: ScheduleImportUndoRejectionCode;
      message: string;
    };

export type UndoScheduleImportInput = {
  executionResult: ScheduleImportExecutionResult;
  games: Game[];
  undoneAt: string;
};

/**
 * Undoes a schedule import execution: removes the added games and restores updated games to
 * their captured prior state. Pure; never mutates inputs. Unrelated games are preserved
 * exactly and in order. Rejects non-executed or malformed execution results.
 */
export function undoScheduleImport(
  input: UndoScheduleImportInput
): ScheduleImportUndoResult {
  const { executionResult, games, undoneAt } = input;
  const transactionId = executionResult.transactionId;

  if (executionResult.status !== 'executed') {
    return {
      status: 'rejected',
      transactionId,
      undoneAt,
      reason: 'not-executed',
      message: 'The execution result is not an executed schedule import; nothing to undo.',
    };
  }

  // Malformed: an updated game has no captured prior state.
  for (const updatedId of executionResult.updatedGameIds) {
    if (!(updatedId in executionResult.previousGamesByGameId)) {
      return {
        status: 'rejected',
        transactionId,
        undoneAt,
        reason: 'malformed-execution',
        message: `No captured prior state for updated game "${updatedId}".`,
      };
    }
  }

  const addedSet = new Set(executionResult.addedGameIds);
  const restoredGameIds: string[] = [];
  const nextGames: Game[] = [];
  for (const game of games) {
    if (addedSet.has(game.gameId)) {
      continue; // remove games this execution added
    }
    const prior = executionResult.previousGamesByGameId[game.gameId];
    if (prior !== undefined) {
      nextGames.push(cloneGame(prior));
      restoredGameIds.push(game.gameId);
    } else {
      nextGames.push(cloneGame(game)); // unrelated game preserved exactly
    }
  }

  return {
    status: 'undone',
    transactionId,
    undoneAt,
    durable: false,
    persisted: false,
    removedGameIds: [...executionResult.addedGameIds],
    restoredGameIds,
    games: nextGames,
  };
}
