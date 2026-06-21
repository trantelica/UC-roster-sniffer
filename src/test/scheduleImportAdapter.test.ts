import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import { adaptScheduleImport } from '../engine/scheduleImportAdapter';
import scheduleSample from '../../data-samples/schedule-import.sample.json';

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

function payload(rows: unknown[], extra: Record<string, unknown> = {}) {
  return { schemaVersion: '0.1', importType: 'schedule', seasonId: '2026', games: rows, ...extra };
}

const HOME_ROW = {
  gameId: 'g1',
  teamId: '2026-alta-GR-B1',
  opponentTeamId: '2026-brighton-GR-B1',
  weekLabel: 'Week 1',
  gameDate: '2026-08-22',
  homeAway: 'home',
  teamScore: 21,
  opponentScore: 14,
  result: 'win',
};

describe('schedule import adapter', () => {
  it('parses the preserved schedule-import.sample.json contract', () => {
    const result = adaptScheduleImport(scheduleSample, { teams: TEAMS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importType).toBe('schedule');
    expect(result.seasonId).toBe('2026');
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.errors.length === 0)).toBe(true);
  });

  it('maps valid rows into Game model records (home orientation + scores)', () => {
    const result = adaptScheduleImport(payload([HOME_ROW]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    const game = result.rows[0].game!;
    expect(game.homeTeamId).toBe('2026-alta-GR-B1');
    expect(game.awayTeamId).toBe('2026-brighton-GR-B1');
    expect(game.status).toBe('final');
    expect(game.homeScore).toBe(21);
    expect(game.awayScore).toBe(14);
    expect(game.scheduledDate).toBe('2026-08-22');
    expect(game.seasonId).toBe('2026');
  });

  it('maps away orientation by swapping home/away and scores', () => {
    const awayRow = { ...HOME_ROW, gameId: 'g-away', homeAway: 'away', teamScore: 10, opponentScore: 7 };
    const result = adaptScheduleImport(payload([awayRow]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    const game = result.rows[0].game!;
    expect(game.homeTeamId).toBe('2026-brighton-GR-B1'); // opponent is home
    expect(game.awayTeamId).toBe('2026-alta-GR-B1');
    expect(game.homeScore).toBe(7); // opponentScore -> home
    expect(game.awayScore).toBe(10); // teamScore -> away
  });

  it('treats neutral as the listed team being home (deterministic)', () => {
    const neutralRow = { ...HOME_ROW, gameId: 'g-neutral', homeAway: 'neutral', teamScore: 20, opponentScore: 14 };
    const result = adaptScheduleImport(payload([neutralRow]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    const game = result.rows[0].game!;
    expect(game.homeTeamId).toBe('2026-alta-GR-B1');
    expect(game.homeScore).toBe(20);
    expect(game.awayScore).toBe(14);
  });

  it('rejects an invalid import shape (wrong importType)', () => {
    const result = adaptScheduleImport({ importType: 'roster', games: [] }, { teams: TEAMS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.shapeError.code).toBe('wrong-import-type');
  });

  it('rejects a row with an unresolved team reference', () => {
    const badRow = { ...HOME_ROW, opponentTeamId: 'ghost-team' };
    const result = adaptScheduleImport(payload([badRow]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows[0].game).toBeNull();
    expect(result.rows[0].errors.map((e) => e.code)).toContain('unresolved-away-team');
  });

  it('rejects a final game with missing scores (result present, scores null)', () => {
    const badRow = { ...HOME_ROW, gameId: 'g-bad', teamScore: null, opponentScore: null, result: 'win' };
    const result = adaptScheduleImport(payload([badRow]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows[0].errors.map((e) => e.code)).toContain('invalid-final-scores');
  });

  it('does not require scores for scheduled / postponed / cancelled rows', () => {
    const rows = [
      { ...HOME_ROW, gameId: 'g-sched', teamScore: null, opponentScore: null, result: null, status: 'scheduled' },
      { ...HOME_ROW, gameId: 'g-postponed', teamScore: null, opponentScore: null, result: null, status: 'postponed' },
      { ...HOME_ROW, gameId: 'g-cancelled', teamScore: null, opponentScore: null, result: null, status: 'cancelled' },
    ];
    const result = adaptScheduleImport(payload(rows), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(result.rows.map((r) => r.game!.status)).toEqual(['scheduled', 'postponed', 'cancelled']);
  });

  it('rejects an invalid status value', () => {
    const badRow = { ...HOME_ROW, gameId: 'g-badstatus', status: 'in-progress' };
    const result = adaptScheduleImport(payload([badRow]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows[0].errors.map((e) => e.code)).toContain('invalid-status');
  });

  it('does not mutate the input payload or teams', () => {
    const input = payload([HOME_ROW]);
    const inputBefore = JSON.stringify(input);
    const teamsBefore = JSON.stringify(TEAMS);
    adaptScheduleImport(input, { teams: TEAMS });
    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(JSON.stringify(TEAMS)).toBe(teamsBefore);
  });
});
