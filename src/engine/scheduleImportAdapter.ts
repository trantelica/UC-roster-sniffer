import type { Game, GameStatus, Team } from '../domain/types';

/**
 * Phase 6 slice 25: PURE, deterministic SCHEDULE IMPORT ADAPTER — ENGINE ONLY.
 *
 * Maps the preserved team-centric `data-samples/schedule-import.sample.json` row contract
 * (`importType: "schedule"`, rows with `teamId` / `opponentTeamId` / `homeAway` and
 * team-relative scores) into the game-centric slice-24 `Game` model. Opponents are resolved
 * through EXISTING `Team.teamId` references — no opponent object is ever created, and an
 * unresolvable reference rejects the row rather than inventing a team.
 *
 * Guardrails: never mutates inputs, never touches rosters, and returns stable per-row
 * validation errors with reason codes. It performs NO file/network/storage I/O.
 */

export const SCHEDULE_IMPORT_ADAPTER_LOGIC_VERSION = 'phase6-slice25-schedule-import-adapter-v1';

const VALID_STATUSES: GameStatus[] = ['scheduled', 'final', 'cancelled', 'postponed'];
const VALID_HOME_AWAY = ['home', 'away', 'neutral'] as const;

export type ScheduleImportRowErrorCode =
  | 'invalid-row-shape'
  | 'missing-season'
  | 'invalid-home-away'
  | 'unresolved-home-team'
  | 'unresolved-away-team'
  | 'invalid-status'
  | 'invalid-scores'
  | 'invalid-final-scores';

export type ScheduleImportRowError = {
  code: ScheduleImportRowErrorCode;
  message: string;
};

/** JSON-safe snapshot of the raw source row, kept for preview display / debugging. */
export type ScheduleImportSource = {
  gameId: string | null;
  teamId: string | null;
  opponentTeamId: string | null;
  weekLabel: string | null;
  gameDate: string | null;
  homeAway: string | null;
  teamScore: number | null;
  opponentScore: number | null;
  result: string | null;
  status: string | null;
};

export type ScheduleImportAdaptedRow = {
  rowIndex: number;
  sourceRowId: string;
  source: ScheduleImportSource;
  /** Mapped game when the row is valid; null when it has errors. */
  game: Game | null;
  errors: ScheduleImportRowError[];
};

export type ScheduleImportShapeErrorCode =
  | 'not-an-object'
  | 'wrong-import-type'
  | 'missing-games-array';

export type ScheduleImportAdaptResult =
  | { ok: false; shapeError: { code: ScheduleImportShapeErrorCode; message: string } }
  | {
      ok: true;
      importType: string;
      seasonId: string | null;
      rows: ScheduleImportAdaptedRow[];
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asNullableNumber(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function buildSource(row: Record<string, unknown>): ScheduleImportSource {
  return {
    gameId: asNullableString(row.gameId),
    teamId: asNullableString(row.teamId),
    opponentTeamId: asNullableString(row.opponentTeamId),
    weekLabel: asNullableString(row.weekLabel),
    gameDate: asNullableString(row.gameDate),
    homeAway: asNullableString(row.homeAway),
    teamScore: asNullableNumber(row.teamScore),
    opponentScore: asNullableNumber(row.opponentScore),
    result: asNullableString(row.result),
    status: asNullableString(row.status),
  };
}

/** Maps one source row into a Game (or collects row errors). Pure; never mutates input. */
function adaptRow(
  raw: unknown,
  rowIndex: number,
  fileSeasonId: string | null,
  teamIds: Set<string>,
  teamAgeDivisionById: Map<string, string>
): ScheduleImportAdaptedRow {
  const errors: ScheduleImportRowError[] = [];
  if (!isObject(raw)) {
    return {
      rowIndex,
      sourceRowId: `row-${rowIndex}`,
      source: {
        gameId: null, teamId: null, opponentTeamId: null, weekLabel: null,
        gameDate: null, homeAway: null, teamScore: null, opponentScore: null,
        result: null, status: null,
      },
      game: null,
      errors: [{ code: 'invalid-row-shape', message: 'Row is not an object.' }],
    };
  }

  const source = buildSource(raw);
  const sourceRowId = source.gameId ?? `row-${rowIndex}`;

  const teamId = source.teamId;
  const opponentTeamId = source.opponentTeamId;
  if (!teamId || !opponentTeamId) {
    errors.push({
      code: 'invalid-row-shape',
      message: 'Row is missing teamId and/or opponentTeamId.',
    });
  }

  const seasonId =
    asNullableString(raw.seasonId) ?? fileSeasonId;
  if (!seasonId) {
    errors.push({ code: 'missing-season', message: 'Row has no resolvable seasonId.' });
  }

  const homeAway = source.homeAway;
  if (homeAway === null || !VALID_HOME_AWAY.includes(homeAway as (typeof VALID_HOME_AWAY)[number])) {
    errors.push({
      code: 'invalid-home-away',
      message: `Row homeAway must be one of ${VALID_HOME_AWAY.join(', ')}.`,
    });
  }

  // Resolve home/away from the team-centric orientation. "neutral" treats the listed team
  // as home by deterministic convention (the Game model has no neutral concept).
  let homeTeamId: string | null = null;
  let awayTeamId: string | null = null;
  if (teamId && opponentTeamId && homeAway) {
    if (homeAway === 'away') {
      homeTeamId = opponentTeamId;
      awayTeamId = teamId;
    } else {
      homeTeamId = teamId;
      awayTeamId = opponentTeamId;
    }
    if (!teamIds.has(homeTeamId)) {
      errors.push({
        code: 'unresolved-home-team',
        message: `Home team "${homeTeamId}" is not an existing team.`,
      });
    }
    if (!teamIds.has(awayTeamId)) {
      errors.push({
        code: 'unresolved-away-team',
        message: `Away team "${awayTeamId}" is not an existing team.`,
      });
    }
  }

  // Reject garbage scores (present but not a finite number / null).
  if (raw.teamScore !== undefined && raw.teamScore !== null && !isFiniteNumber(raw.teamScore)) {
    errors.push({ code: 'invalid-scores', message: 'teamScore must be a number or null.' });
  }
  if (
    raw.opponentScore !== undefined &&
    raw.opponentScore !== null &&
    !isFiniteNumber(raw.opponentScore)
  ) {
    errors.push({ code: 'invalid-scores', message: 'opponentScore must be a number or null.' });
  }

  // Resolve status: explicit `status` wins; otherwise derive from result/scores.
  const bothScores = source.teamScore !== null && source.opponentScore !== null;
  let status: GameStatus | null = null;
  if (source.status !== null) {
    if (!VALID_STATUSES.includes(source.status as GameStatus)) {
      errors.push({
        code: 'invalid-status',
        message: `status must be one of ${VALID_STATUSES.join(', ')}.`,
      });
    } else {
      status = source.status as GameStatus;
    }
  } else if (source.result !== null || bothScores) {
    status = 'final';
  } else {
    status = 'scheduled';
  }

  if (status === 'final' && !bothScores) {
    errors.push({
      code: 'invalid-final-scores',
      message: 'A final game requires both teamScore and opponentScore.',
    });
  }

  if (errors.length > 0 || !homeTeamId || !awayTeamId || !seasonId || !status) {
    return { rowIndex, sourceRowId, source, game: null, errors };
  }

  const teamIsHome = homeTeamId === teamId;
  const game: Game = {
    gameId: source.gameId ?? `${seasonId}-${homeTeamId}-vs-${awayTeamId}-${source.gameDate ?? rowIndex}`,
    seasonId,
    weekLabel: source.weekLabel ?? '',
    scheduledDate: source.gameDate,
    homeTeamId,
    awayTeamId,
    status,
  };
  // Derive a display age division from the home team where useful.
  const homeAgeDivision = teamAgeDivisionById.get(homeTeamId);
  if (homeAgeDivision) game.ageDivisionId = homeAgeDivision;
  if (bothScores) {
    game.homeScore = teamIsHome ? (source.teamScore as number) : (source.opponentScore as number);
    game.awayScore = teamIsHome ? (source.opponentScore as number) : (source.teamScore as number);
  }
  return { rowIndex, sourceRowId, source, game, errors: [] };
}

/**
 * Adapts a parsed schedule-import payload into mapped Game rows. Pure; never mutates input.
 * Validates the file shape, then each row independently, resolving teams against `teams`.
 */
export function adaptScheduleImport(
  payload: unknown,
  options: { teams: Team[] }
): ScheduleImportAdaptResult {
  if (!isObject(payload)) {
    return {
      ok: false,
      shapeError: { code: 'not-an-object', message: 'Schedule import is not a JSON object.' },
    };
  }
  if (payload.importType !== 'schedule') {
    return {
      ok: false,
      shapeError: {
        code: 'wrong-import-type',
        message: `Expected importType "schedule" but found "${String(payload.importType)}".`,
      },
    };
  }
  if (!Array.isArray(payload.games)) {
    return {
      ok: false,
      shapeError: { code: 'missing-games-array', message: 'Schedule import has no games array.' },
    };
  }

  const teamIds = new Set(options.teams.map((t) => t.teamId));
  const teamAgeDivisionById = new Map(options.teams.map((t) => [t.teamId, t.ageDivisionId]));
  const fileSeasonId = asNullableString(payload.seasonId);
  const rows = (payload.games as unknown[]).map((raw, index) =>
    adaptRow(raw, index, fileSeasonId, teamIds, teamAgeDivisionById)
  );

  return {
    ok: true,
    importType: 'schedule',
    seasonId: fileSeasonId,
    rows,
  };
}
