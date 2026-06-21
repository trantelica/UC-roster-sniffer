import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import { adaptCoachImport } from '../engine/coachImportAdapter';
import coachSample from '../../data-samples/coach-import.sample.json';

function team(teamId: string): Team {
  return {
    teamId, seasonId: '2026', districtId: 'alta', ageDivisionId: 'GR', teamCode: 'B1',
    draftOrder: 1, divisionTeamCount: 2, headCoach: null, assistantCoaches: [], players: [],
  };
}
const TEAMS = [team('2026-alta-GR-B1'), team('2026-brighton-GR-B1')];

function payload(rows: unknown[]) {
  return { schemaVersion: '0.1', importType: 'coach', seasonId: '2026', assignments: rows };
}
const ROW = { coachName: 'Pat Rivera', teamId: '2026-brighton-GR-B1', role: 'assistantCoach', sourceLabel: 'Asst Coach' };

describe('coach import adapter', () => {
  it('parses the coach-import sample contract', () => {
    const result = adaptCoachImport(coachSample, { teams: TEAMS });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.importType).toBe('coach');
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((r) => r.errors.length === 0)).toBe(true);
  });

  it('maps valid rows to coach/assignment candidates, preserving raw names/labels', () => {
    const result = adaptCoachImport(payload([ROW]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    const c = result.rows[0].candidate!;
    expect(c.coachName).toBe('Pat Rivera');
    expect(c.identityKey).toBe('pat rivera');
    expect(c.teamId).toBe('2026-brighton-GR-B1');
    expect(c.seasonId).toBe('2026');
    expect(c.role).toBe('assistantCoach');
    expect(c.sourceLabel).toBe('Asst Coach');
  });

  it('rejects an invalid import shape (wrong importType)', () => {
    const result = adaptCoachImport({ importType: 'roster', assignments: [] }, { teams: TEAMS });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.shapeError.code).toBe('wrong-import-type');
  });

  it('rejects a row with an unresolved team reference', () => {
    const result = adaptCoachImport(payload([{ ...ROW, teamId: 'ghost' }]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows[0].candidate).toBeNull();
    expect(result.rows[0].errors.map((e) => e.code)).toContain('unresolved-team');
  });

  it('rejects an invalid role', () => {
    const result = adaptCoachImport(payload([{ ...ROW, role: 'coordinator' }]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows[0].errors.map((e) => e.code)).toContain('invalid-role');
  });

  it('rejects a row missing coachName', () => {
    const result = adaptCoachImport(payload([{ teamId: '2026-alta-GR-B1', role: 'headCoach' }]), { teams: TEAMS });
    if (!result.ok) throw new Error('expected ok');
    expect(result.rows[0].errors.map((e) => e.code)).toContain('invalid-row-shape');
  });

  it('does not mutate inputs', () => {
    const input = payload([ROW]);
    const before = JSON.stringify(input);
    const teamsBefore = JSON.stringify(TEAMS);
    adaptCoachImport(input, { teams: TEAMS });
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(TEAMS)).toBe(teamsBefore);
  });
});
