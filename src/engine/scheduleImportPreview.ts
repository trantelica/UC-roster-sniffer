import type { Game, Team } from '../domain/types';
import {
  adaptScheduleImport,
  type ScheduleImportAdaptedRow,
  type ScheduleImportSource,
} from './scheduleImportAdapter';

/**
 * Phase 6 slice 25: PURE, deterministic SCHEDULE IMPORT PREVIEW — ENGINE ONLY.
 *
 * Composes the schedule import adapter and classifies every row against the current games as
 * an add / update / skip / error, detecting duplicate and ambiguous matches. It answers:
 * "what would importing this schedule file do, and is it safe to execute?"
 *
 * Match policy (never silently overwrites): a row updates an existing game when their
 * `gameId` matches; otherwise when the deterministic natural key
 * (seasonId + scheduledDate + homeTeamId + awayTeamId) matches EXACTLY one existing game.
 * An ambiguous natural-key match (or a duplicate within the import) is a blocking error.
 *
 * Guardrails: never mutates inputs; deterministic; no I/O.
 */

export const SCHEDULE_IMPORT_PREVIEW_LOGIC_VERSION = 'phase6-slice25-schedule-import-preview-v1';

export type ScheduleImportRowOutcome = 'add' | 'update' | 'skip' | 'error';

export type ScheduleImportPreviewReason = { code: string; message: string };

export type ScheduleImportPreviewRow = {
  rowIndex: number;
  sourceRowId: string;
  outcome: ScheduleImportRowOutcome;
  source: ScheduleImportSource;
  /** Mapped game (null for shape-invalid rows). */
  game: Game | null;
  /** Existing game id this row would update, or null. */
  targetGameId: string | null;
  reasons: ScheduleImportPreviewReason[];
};

export type ScheduleImportBlockingError = {
  rowIndex: number;
  sourceRowId: string;
  code: string;
  message: string;
};

export type ScheduleImportPreview = {
  available: boolean;
  shapeError: { code: string; message: string } | null;
  importType: string | null;
  seasonId: string | null;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  addCandidates: number;
  updateCandidates: number;
  skippedRows: number;
  blockingErrors: ScheduleImportBlockingError[];
  isExecutable: boolean;
  rows: ScheduleImportPreviewRow[];
};

export function gameNaturalKey(game: {
  seasonId: string;
  scheduledDate: string | null;
  homeTeamId: string;
  awayTeamId: string;
}): string {
  return `${game.seasonId}|${game.scheduledDate ?? ''}|${game.homeTeamId}|${game.awayTeamId}`;
}

/** Field-based game equality (key-order independent). */
function gamesEqual(a: Game, b: Game): boolean {
  return (
    a.gameId === b.gameId &&
    a.seasonId === b.seasonId &&
    (a.ageDivisionId ?? null) === (b.ageDivisionId ?? null) &&
    a.weekLabel === b.weekLabel &&
    (a.scheduledDate ?? null) === (b.scheduledDate ?? null) &&
    a.homeTeamId === b.homeTeamId &&
    a.awayTeamId === b.awayTeamId &&
    (a.location ?? null) === (b.location ?? null) &&
    a.status === b.status &&
    (a.homeScore ?? null) === (b.homeScore ?? null) &&
    (a.awayScore ?? null) === (b.awayScore ?? null) &&
    (a.notes ?? null) === (b.notes ?? null) &&
    (a.isNeutralSite ?? false) === (b.isNeutralSite ?? false) &&
    (a.isPlayoff ?? false) === (b.isPlayoff ?? false) &&
    (a.isChampionship ?? false) === (b.isChampionship ?? false)
  );
}

function unavailable(
  code: string,
  message: string
): ScheduleImportPreview {
  return {
    available: false,
    shapeError: { code, message },
    importType: null,
    seasonId: null,
    totalRows: 0,
    validRows: 0,
    invalidRows: 0,
    addCandidates: 0,
    updateCandidates: 0,
    skippedRows: 0,
    blockingErrors: [],
    isExecutable: false,
    rows: [],
  };
}

export type BuildScheduleImportPreviewInput = {
  payload: unknown;
  teams: Team[];
  existingGames: Game[];
};

/**
 * Builds the schedule import preview. Pure; never mutates inputs. Returns an unavailable
 * preview for a structurally invalid file shape.
 */
export function buildScheduleImportPreview(
  input: BuildScheduleImportPreviewInput
): ScheduleImportPreview {
  const adapted = adaptScheduleImport(input.payload, { teams: input.teams });
  if (!adapted.ok) {
    return unavailable(adapted.shapeError.code, adapted.shapeError.message);
  }

  // Pre-count gameId and natural-key occurrences WITHIN the import (mapped rows only).
  const importGameIdCounts = new Map<string, number>();
  const importNaturalKeyCounts = new Map<string, number>();
  for (const row of adapted.rows) {
    if (!row.game) continue;
    importGameIdCounts.set(row.game.gameId, (importGameIdCounts.get(row.game.gameId) ?? 0) + 1);
    const key = gameNaturalKey(row.game);
    importNaturalKeyCounts.set(key, (importNaturalKeyCounts.get(key) ?? 0) + 1);
  }

  const existingById = new Map(input.existingGames.map((g) => [g.gameId, g]));
  const existingByNaturalKey = new Map<string, Game[]>();
  for (const g of input.existingGames) {
    const key = gameNaturalKey(g);
    const list = existingByNaturalKey.get(key) ?? [];
    list.push(g);
    existingByNaturalKey.set(key, list);
  }

  const rows: ScheduleImportPreviewRow[] = adapted.rows.map((adaptedRow) =>
    classifyRow(adaptedRow, {
      existingById,
      existingByNaturalKey,
      importGameIdCounts,
      importNaturalKeyCounts,
    })
  );

  const blockingErrors: ScheduleImportBlockingError[] = [];
  let addCandidates = 0;
  let updateCandidates = 0;
  let skippedRows = 0;
  let invalidRows = 0;
  for (const row of rows) {
    if (row.outcome === 'error') {
      invalidRows += 1;
      for (const reason of row.reasons) {
        blockingErrors.push({
          rowIndex: row.rowIndex,
          sourceRowId: row.sourceRowId,
          code: reason.code,
          message: reason.message,
        });
      }
    } else if (row.outcome === 'add') {
      addCandidates += 1;
    } else if (row.outcome === 'update') {
      updateCandidates += 1;
    } else if (row.outcome === 'skip') {
      skippedRows += 1;
    }
  }

  const validRows = rows.length - invalidRows;
  const isExecutable =
    blockingErrors.length === 0 && addCandidates + updateCandidates > 0;

  return {
    available: true,
    shapeError: null,
    importType: adapted.importType,
    seasonId: adapted.seasonId,
    totalRows: rows.length,
    validRows,
    invalidRows,
    addCandidates,
    updateCandidates,
    skippedRows,
    blockingErrors,
    isExecutable,
    rows,
  };
}

function classifyRow(
  adaptedRow: ScheduleImportAdaptedRow,
  ctx: {
    existingById: Map<string, Game>;
    existingByNaturalKey: Map<string, Game[]>;
    importGameIdCounts: Map<string, number>;
    importNaturalKeyCounts: Map<string, number>;
  }
): ScheduleImportPreviewRow {
  const base = {
    rowIndex: adaptedRow.rowIndex,
    sourceRowId: adaptedRow.sourceRowId,
    source: adaptedRow.source,
  };

  if (adaptedRow.errors.length > 0 || !adaptedRow.game) {
    return {
      ...base,
      outcome: 'error',
      game: adaptedRow.game,
      targetGameId: null,
      reasons: adaptedRow.errors.map((e) => ({ code: e.code, message: e.message })),
    };
  }

  const game = adaptedRow.game;
  const key = gameNaturalKey(game);

  // Duplicate within the import file blocks execution.
  if ((ctx.importGameIdCounts.get(game.gameId) ?? 0) > 1) {
    return {
      ...base,
      outcome: 'error',
      game,
      targetGameId: null,
      reasons: [
        { code: 'duplicate-in-import', message: `gameId "${game.gameId}" appears more than once in the import.` },
      ],
    };
  }
  if (
    !ctx.existingById.has(game.gameId) &&
    (ctx.importNaturalKeyCounts.get(key) ?? 0) > 1
  ) {
    return {
      ...base,
      outcome: 'error',
      game,
      targetGameId: null,
      reasons: [
        { code: 'duplicate-natural-key', message: 'Multiple import rows share the same season/date/home/away.' },
      ],
    };
  }

  const byId = ctx.existingById.get(game.gameId) ?? null;
  if (byId) {
    if (gamesEqual(game, byId)) {
      return { ...base, outcome: 'skip', game, targetGameId: byId.gameId, reasons: [{ code: 'no-change', message: 'Matches the existing game exactly; nothing to update.' }] };
    }
    return { ...base, outcome: 'update', game, targetGameId: byId.gameId, reasons: [] };
  }

  const naturalMatches = ctx.existingByNaturalKey.get(key) ?? [];
  if (naturalMatches.length > 1) {
    return {
      ...base,
      outcome: 'error',
      game,
      targetGameId: null,
      reasons: [
        { code: 'ambiguous-existing-match', message: 'Natural key matches more than one existing game; resolve before importing.' },
      ],
    };
  }
  if (naturalMatches.length === 1) {
    const target = naturalMatches[0];
    const updated: Game = { ...game, gameId: target.gameId };
    if (gamesEqual(updated, target)) {
      return { ...base, outcome: 'skip', game, targetGameId: target.gameId, reasons: [{ code: 'no-change', message: 'Matches the existing game exactly; nothing to update.' }] };
    }
    return { ...base, outcome: 'update', game, targetGameId: target.gameId, reasons: [] };
  }

  return { ...base, outcome: 'add', game, targetGameId: null, reasons: [] };
}
