import type { Game, GameStatus } from '../domain/types';

/**
 * Phase 6 slice 25: PURE, deterministic IN-MEMORY game result/status update — ENGINE ONLY.
 *
 * Applies a small, validated patch (status / scores / notes) to one game and returns a new
 * games array. Final games require valid numeric scores; scheduled / postponed / cancelled
 * games may have blank scores. It NEVER creates games, never touches rosters, and never
 * mutates inputs. The write is in-memory only (durable solely via workspace snapshot export).
 */

export const GAME_RESULT_UPDATE_LOGIC_VERSION = 'phase6-slice25-game-result-update-v1';

const VALID_STATUSES: GameStatus[] = ['scheduled', 'final', 'cancelled', 'postponed'];

export type GameResultPatch = {
  status?: GameStatus;
  /** number sets the score; null clears it. */
  homeScore?: number | null;
  awayScore?: number | null;
  notes?: string | null;
};

export type GameResultUpdateErrorCode =
  | 'game-not-found'
  | 'invalid-status'
  | 'invalid-score'
  | 'invalid-final-scores';

export type GameResultUpdateError = {
  code: GameResultUpdateErrorCode;
  message: string;
};

export type GameResultUpdateResult =
  | { ok: true; games: Game[]; updatedGame: Game }
  | { ok: false; errors: GameResultUpdateError[] };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export type UpdateGameResultInput = {
  games: Game[];
  gameId: string;
  patch: GameResultPatch;
};

/**
 * Updates a single game's result/status in memory. Pure; never mutates inputs. Returns a
 * rejected result (current games unchanged) for any validation failure.
 */
export function updateGameResult(input: UpdateGameResultInput): GameResultUpdateResult {
  const { games, gameId, patch } = input;
  const index = games.findIndex((g) => g.gameId === gameId);
  if (index === -1) {
    return { ok: false, errors: [{ code: 'game-not-found', message: `No game "${gameId}".` }] };
  }

  const errors: GameResultUpdateError[] = [];
  const current = games[index];
  const next: Game = { ...current };

  if (patch.status !== undefined) {
    if (!VALID_STATUSES.includes(patch.status)) {
      errors.push({ code: 'invalid-status', message: `Invalid status "${patch.status}".` });
    } else {
      next.status = patch.status;
    }
  }

  if (patch.homeScore !== undefined) {
    if (patch.homeScore === null) {
      delete next.homeScore;
    } else if (!isFiniteNumber(patch.homeScore)) {
      errors.push({ code: 'invalid-score', message: 'homeScore must be a number or null.' });
    } else {
      next.homeScore = patch.homeScore;
    }
  }
  if (patch.awayScore !== undefined) {
    if (patch.awayScore === null) {
      delete next.awayScore;
    } else if (!isFiniteNumber(patch.awayScore)) {
      errors.push({ code: 'invalid-score', message: 'awayScore must be a number or null.' });
    } else {
      next.awayScore = patch.awayScore;
    }
  }
  if (patch.notes !== undefined) {
    if (patch.notes === null) {
      delete next.notes;
    } else {
      next.notes = patch.notes;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  if (next.status === 'final') {
    if (!isFiniteNumber(next.homeScore) || !isFiniteNumber(next.awayScore)) {
      return {
        ok: false,
        errors: [
          { code: 'invalid-final-scores', message: 'A final game requires both home and away scores.' },
        ],
      };
    }
  }

  const nextGames = games.map((g, i) => (i === index ? next : g));
  return { ok: true, games: nextGames, updatedGame: next };
}
