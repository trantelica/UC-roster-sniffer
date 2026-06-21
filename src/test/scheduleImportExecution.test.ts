import { describe, it, expect } from 'vitest';
import type { Game, Team } from '../domain/types';
import { buildScheduleImportPreview } from '../engine/scheduleImportPreview';
import {
  executeScheduleImport,
  undoScheduleImport,
} from '../engine/scheduleImportExecution';

function team(teamId: string, districtId: string): Team {
  return {
    teamId,
    seasonId: '2026',
    districtId,
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 2,
    headCoach: null,
    assistantCoaches: [],
    players: [],
  };
}

const TEAMS = [team('2026-alta-GR-B1', 'alta'), team('2026-brighton-GR-B1', 'brighton')];

function row(overrides: Record<string, unknown> = {}) {
  return {
    gameId: 'g1',
    teamId: '2026-alta-GR-B1',
    opponentTeamId: '2026-brighton-GR-B1',
    weekLabel: 'Week 1',
    gameDate: '2026-08-22',
    homeAway: 'home',
    teamScore: null,
    opponentScore: null,
    result: null,
    status: 'scheduled',
    ...overrides,
  };
}

function payload(rows: unknown[]) {
  return { schemaVersion: '0.1', importType: 'schedule', seasonId: '2026', games: rows };
}

function existingGame(overrides: Partial<Game> & Pick<Game, 'gameId'>): Game {
  return {
    seasonId: '2026',
    ageDivisionId: 'GR',
    weekLabel: 'Week 1',
    scheduledDate: '2026-08-22',
    homeTeamId: '2026-alta-GR-B1',
    awayTeamId: '2026-brighton-GR-B1',
    status: 'scheduled',
    ...overrides,
  };
}

function preview(rows: unknown[], existingGames: Game[]) {
  return buildScheduleImportPreview({ payload: payload(rows), teams: TEAMS, existingGames });
}

const IDS = { transactionId: 'txn-1', executedAt: '2026-06-20T01:00:00.000Z' };
const UNDONE_AT = '2026-06-20T02:00:00.000Z';

describe('schedule import execution', () => {
  it('rejects a non-executable preview', () => {
    const p = preview([row({ gameId: 'bad', opponentTeamId: 'ghost' })], []);
    const result = executeScheduleImport({ preview: p, games: [], ...IDS });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toBe('preview-not-executable');
  });

  it('executes add candidates (appends new games)', () => {
    const p = preview([row({ gameId: 'new-1', gameDate: '2026-09-01' })], []);
    const result = executeScheduleImport({ preview: p, games: [], ...IDS });
    expect(result.status).toBe('executed');
    if (result.status !== 'executed') return;
    expect(result.addedGameIds).toEqual(['new-1']);
    expect(result.games.map((g) => g.gameId)).toEqual(['new-1']);
    expect(result.audit.durable).toBe(false);
    expect(result.audit.persisted).toBe(false);
    expect(result.executedAt).toBe(IDS.executedAt);
  });

  it('executes safe update candidates (replaces existing, keeps order)', () => {
    const existing = [
      existingGame({ gameId: 'g0', scheduledDate: '2026-08-15', homeTeamId: '2026-brighton-GR-B1', awayTeamId: '2026-alta-GR-B1' }),
      existingGame({ gameId: 'g1', status: 'scheduled' }),
    ];
    const p = preview(
      [row({ gameId: 'g1', status: 'final', teamScore: 21, opponentScore: 14, result: 'win' })],
      existing
    );
    const result = executeScheduleImport({ preview: p, games: existing, ...IDS });
    if (result.status !== 'executed') throw new Error('expected executed');
    expect(result.updatedGameIds).toEqual(['g1']);
    expect(result.games.map((g) => g.gameId)).toEqual(['g0', 'g1']); // order preserved
    const updated = result.games.find((g) => g.gameId === 'g1')!;
    expect(updated.status).toBe('final');
    expect(updated.homeScore).toBe(21);
    expect(updated.awayScore).toBe(14);
  });

  it('does not count skipped rows and does not mutate inputs', () => {
    const existing = [existingGame({ gameId: 'g1', status: 'scheduled' })];
    const p = preview(
      [
        row({ gameId: 'g1', status: 'scheduled' }), // no-change skip
        row({ gameId: 'new-1', gameDate: '2026-09-02' }),
      ],
      existing
    );
    const beforeExisting = JSON.stringify(existing);
    const beforePreview = JSON.stringify(p);
    const result = executeScheduleImport({ preview: p, games: existing, ...IDS });
    if (result.status !== 'executed') throw new Error('expected executed');
    expect(result.addedGameIds).toEqual(['new-1']);
    expect(result.skippedRowIds).toContain('g1');
    expect(JSON.stringify(existing)).toBe(beforeExisting);
    expect(JSON.stringify(p)).toBe(beforePreview);
  });

  it('uses caller-supplied transactionId/executedAt deterministically', () => {
    const p = preview([row({ gameId: 'new-1', gameDate: '2026-09-01' })], []);
    const a = executeScheduleImport({ preview: p, games: [], ...IDS });
    const b = executeScheduleImport({ preview: p, games: [], ...IDS });
    expect(a).toEqual(b);
  });
});

describe('schedule import undo', () => {
  function executeAddAndUpdate() {
    const existing = [
      existingGame({ gameId: 'keep', scheduledDate: '2026-07-01', homeTeamId: '2026-brighton-GR-B1', awayTeamId: '2026-alta-GR-B1' }),
      existingGame({ gameId: 'g1', status: 'scheduled' }),
    ];
    const p = preview(
      [
        row({ gameId: 'g1', status: 'final', teamScore: 35, opponentScore: 0, result: 'win' }),
        row({ gameId: 'new-1', gameDate: '2026-09-05' }),
      ],
      existing
    );
    const result = executeScheduleImport({ preview: p, games: existing, ...IDS });
    if (result.status !== 'executed') throw new Error('expected executed');
    return { existing, result };
  }

  it('removes added games, restores updated games, preserves unrelated games', () => {
    const { result } = executeAddAndUpdate();
    const undo = undoScheduleImport({ executionResult: result, games: result.games, undoneAt: UNDONE_AT });
    expect(undo.status).toBe('undone');
    if (undo.status !== 'undone') return;
    // new-1 removed; g1 restored to scheduled (no scores); keep preserved.
    expect(undo.games.map((g) => g.gameId)).toEqual(['keep', 'g1']);
    const g1 = undo.games.find((g) => g.gameId === 'g1')!;
    expect(g1.status).toBe('scheduled');
    expect(g1.homeScore).toBeUndefined();
    expect(undo.removedGameIds).toEqual(['new-1']);
    expect(undo.restoredGameIds).toEqual(['g1']);
  });

  it('does not mutate the execution result or games', () => {
    const { result } = executeAddAndUpdate();
    const beforeResult = JSON.stringify(result);
    const beforeGames = JSON.stringify(result.games);
    undoScheduleImport({ executionResult: result, games: result.games, undoneAt: UNDONE_AT });
    expect(JSON.stringify(result)).toBe(beforeResult);
    expect(JSON.stringify(result.games)).toBe(beforeGames);
  });

  it('rejects undo of a non-executed (rejected) result', () => {
    const p = preview([row({ gameId: 'bad', opponentTeamId: 'ghost' })], []);
    const rejected = executeScheduleImport({ preview: p, games: [], ...IDS });
    const undo = undoScheduleImport({ executionResult: rejected, games: [], undoneAt: UNDONE_AT });
    expect(undo.status).toBe('rejected');
    if (undo.status === 'rejected') expect(undo.reason).toBe('not-executed');
  });

  it('rejects malformed execution (missing prior state for an updated game)', () => {
    const { result } = executeAddAndUpdate();
    if (result.status !== 'executed') return;
    const malformed = { ...result, previousGamesByGameId: {} };
    const undo = undoScheduleImport({ executionResult: malformed, games: result.games, undoneAt: UNDONE_AT });
    expect(undo.status).toBe('rejected');
    if (undo.status === 'rejected') expect(undo.reason).toBe('malformed-execution');
  });
});
