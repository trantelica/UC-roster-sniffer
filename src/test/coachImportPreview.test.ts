import { describe, it, expect } from 'vitest';
import type { StaffCoach, Team, TeamCoachAssignment } from '../domain/types';
import { buildCoachImportPreview } from '../engine/coachImportPreview';
import { assignmentId, buildStaffCoach } from '../engine/coachModel';

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
function row(overrides: Record<string, unknown> = {}) {
  return { coachName: 'Pat Rivera', teamId: '2026-brighton-GR-B1', role: 'assistantCoach', sourceLabel: 'Asst Coach', ...overrides };
}
function preview(rows: unknown[], coaches: StaffCoach[] = [], assignments: TeamCoachAssignment[] = []) {
  return buildCoachImportPreview({ payload: payload(rows), teams: TEAMS, existingCoaches: coaches, existingAssignments: assignments });
}

const JANE = buildStaffCoach('Jane Smith');
const JANE_ALTA = {
  assignmentId: assignmentId('2026', '2026-alta-GR-B1', JANE.coachId),
  seasonId: '2026', teamId: '2026-alta-GR-B1', coachId: JANE.coachId, role: 'headCoach' as const, sourceLabel: 'Head Coach',
};

describe('coach import preview', () => {
  it('is unavailable for an invalid file shape', () => {
    const p = buildCoachImportPreview({ payload: { importType: 'nope' }, teams: TEAMS, existingCoaches: [], existingAssignments: [] });
    expect(p.available).toBe(false);
    expect(p.isExecutable).toBe(false);
  });

  it('detects add-coach + add-assignment candidates for a new coach', () => {
    const p = preview([row()]);
    expect(p.coachesToAdd).toBe(1);
    expect(p.assignmentsToAdd).toBe(1);
    expect(p.rows[0].outcome).toBe('add');
    expect(p.rows[0].coachAction).toBe('add');
    expect(p.isExecutable).toBe(true);
  });

  it('reuses an existing coach identity (add assignment only, no new coach)', () => {
    // Jane already exists; assign her to brighton -> reuse coach, add assignment.
    const p = preview([row({ coachName: 'Jane Smith', teamId: '2026-brighton-GR-B1', role: 'headCoach' })], [JANE], [JANE_ALTA]);
    expect(p.coachesToAdd).toBe(0);
    expect(p.assignmentsToAdd).toBe(1);
    expect(p.rows[0].coachAction).toBe('reuse');
    expect(p.rows[0].resolvedCoachId).toBe(JANE.coachId);
  });

  it('skips a no-change assignment', () => {
    const p = preview([row({ coachName: 'Jane Smith', teamId: '2026-alta-GR-B1', role: 'headCoach', sourceLabel: 'Head Coach' })], [JANE], [JANE_ALTA]);
    expect(p.rows[0].outcome).toBe('skip');
    expect(p.skippedRows).toBe(1);
    expect(p.isExecutable).toBe(false);
  });

  it('detects a safe assignment update (role change)', () => {
    const p = preview([row({ coachName: 'Jane Smith', teamId: '2026-alta-GR-B1', role: 'assistantCoach', sourceLabel: 'Asst' })], [JANE], [JANE_ALTA]);
    expect(p.rows[0].outcome).toBe('update');
    expect(p.assignmentsToUpdate).toBe(1);
    expect(p.rows[0].targetAssignmentId).toBe(JANE_ALTA.assignmentId);
  });

  it('surfaces ambiguous coach identity as review (not merged)', () => {
    // Two existing coaches share the "jane smith" identity key (distinct coachIds).
    const dupA: StaffCoach = { coachId: 'coach:jane-a', displayName: 'Jane Smith', identityKey: 'jane smith' };
    const dupB: StaffCoach = { coachId: 'coach:jane-b', displayName: 'Jane Smith', identityKey: 'jane smith' };
    const p = preview([row({ coachName: 'Jane Smith', teamId: '2026-brighton-GR-B1', role: 'headCoach' })], [dupA, dupB]);
    expect(p.rows[0].outcome).toBe('review');
    expect(p.ambiguousIdentityRows).toBe(1);
    expect(p.blockingErrors.map((e) => e.code)).toContain('ambiguous-coach-identity');
    expect(p.isExecutable).toBe(false);
  });

  it('blocks duplicate assignment within the import', () => {
    const p = preview([
      row({ coachName: 'Dana Park', teamId: '2026-alta-GR-B1' }),
      row({ coachName: 'Dana Park', teamId: '2026-alta-GR-B1' }),
    ]);
    expect(p.blockingErrors.map((e) => e.code)).toContain('duplicate-in-import');
    expect(p.isExecutable).toBe(false);
  });

  it('counts unresolved team references and stays non-executable', () => {
    const p = preview([row({ teamId: 'ghost' })]);
    expect(p.unresolvedTeamReferences).toBe(1);
    expect(p.isExecutable).toBe(false);
  });

  it('does not mutate inputs', () => {
    const input = payload([row()]);
    const before = JSON.stringify(input);
    preview([row()], [JANE], [JANE_ALTA]);
    expect(JSON.stringify(input)).toBe(before);
  });
});
