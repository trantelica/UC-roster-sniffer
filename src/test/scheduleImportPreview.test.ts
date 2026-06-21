import { describe, it, expect } from 'vitest';
import type { Game, Team } from '../domain/types';
import { buildScheduleImportPreview } from '../engine/scheduleImportPreview';

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

describe('schedule import preview', () => {
  it('is unavailable for an invalid file shape', () => {
    const preview = buildScheduleImportPreview({
      payload: { importType: 'nope' },
      teams: TEAMS,
      existingGames: [],
    });
    expect(preview.available).toBe(false);
    expect(preview.isExecutable).toBe(false);
    expect(preview.shapeError?.code).toBe('wrong-import-type');
  });

  it('detects add candidates for new games', () => {
    const preview = buildScheduleImportPreview({
      payload: payload([row({ gameId: 'new-1' })]),
      teams: TEAMS,
      existingGames: [],
    });
    expect(preview.addCandidates).toBe(1);
    expect(preview.updateCandidates).toBe(0);
    expect(preview.rows[0].outcome).toBe('add');
    expect(preview.isExecutable).toBe(true);
  });

  it('detects safe update candidates by gameId', () => {
    const existing = [existingGame({ gameId: 'g1', status: 'scheduled' })];
    const preview = buildScheduleImportPreview({
      payload: payload([row({ gameId: 'g1', status: 'final', teamScore: 21, opponentScore: 14, result: 'win' })]),
      teams: TEAMS,
      existingGames: existing,
    });
    expect(preview.updateCandidates).toBe(1);
    expect(preview.rows[0].outcome).toBe('update');
    expect(preview.rows[0].targetGameId).toBe('g1');
    expect(preview.isExecutable).toBe(true);
  });

  it('detects safe update candidates by natural key when unambiguous', () => {
    // Existing game has a DIFFERENT id but same season/date/home/away.
    const existing = [existingGame({ gameId: 'existing-id', status: 'scheduled' })];
    const preview = buildScheduleImportPreview({
      payload: payload([row({ gameId: 'import-id', status: 'final', teamScore: 28, opponentScore: 7, result: 'win' })]),
      teams: TEAMS,
      existingGames: existing,
    });
    expect(preview.rows[0].outcome).toBe('update');
    expect(preview.rows[0].targetGameId).toBe('existing-id');
  });

  it('blocks ambiguous natural-key matches against existing games', () => {
    const existing = [
      existingGame({ gameId: 'dup-a' }),
      existingGame({ gameId: 'dup-b' }),
    ];
    const preview = buildScheduleImportPreview({
      payload: payload([row({ gameId: 'import-x' })]),
      teams: TEAMS,
      existingGames: existing,
    });
    expect(preview.rows[0].outcome).toBe('error');
    expect(preview.blockingErrors.map((e) => e.code)).toContain('ambiguous-existing-match');
    expect(preview.isExecutable).toBe(false);
  });

  it('blocks duplicate gameId within the import', () => {
    const preview = buildScheduleImportPreview({
      payload: payload([row({ gameId: 'same' }), row({ gameId: 'same', gameDate: '2026-09-01' })]),
      teams: TEAMS,
      existingGames: [],
    });
    expect(preview.blockingErrors.map((e) => e.code)).toContain('duplicate-in-import');
    expect(preview.isExecutable).toBe(false);
  });

  it('classifies a no-change row as skip', () => {
    const existing = [existingGame({ gameId: 'g1', status: 'scheduled' })];
    const preview = buildScheduleImportPreview({
      payload: payload([row({ gameId: 'g1', status: 'scheduled' })]),
      teams: TEAMS,
      existingGames: existing,
    });
    expect(preview.rows[0].outcome).toBe('skip');
    expect(preview.skippedRows).toBe(1);
    expect(preview.isExecutable).toBe(false); // nothing to add/update
  });

  it('surfaces invalid rows as blocking errors', () => {
    const preview = buildScheduleImportPreview({
      payload: payload([row({ gameId: 'bad', opponentTeamId: 'ghost' })]),
      teams: TEAMS,
      existingGames: [],
    });
    expect(preview.invalidRows).toBe(1);
    expect(preview.isExecutable).toBe(false);
  });

  it('does not mutate inputs', () => {
    const existing = [existingGame({ gameId: 'g1' })];
    const input = payload([row({ gameId: 'new-1' })]);
    const beforeInput = JSON.stringify(input);
    const beforeExisting = JSON.stringify(existing);
    buildScheduleImportPreview({ payload: input, teams: TEAMS, existingGames: existing });
    expect(JSON.stringify(input)).toBe(beforeInput);
    expect(JSON.stringify(existing)).toBe(beforeExisting);
  });
});
