import { describe, it, expect } from 'vitest';
import type { Game, StaffCoach, Team, TeamCoachAssignment } from '../domain/types';
import { buildCoachImportPreview } from '../engine/coachImportPreview';
import { executeCoachImport, undoCoachImport } from '../engine/coachImportExecution';
import { assignmentId, buildStaffCoach } from '../engine/coachModel';

function team(teamId: string): Team {
  return {
    teamId, seasonId: '2026', districtId: 'alta', ageDivisionId: 'GR', teamCode: 'B1',
    draftOrder: 1, divisionTeamCount: 2, headCoach: { name: 'Jane Smith' }, assistantCoaches: [],
    players: [{ name: 'Jordan Smith' }],
  };
}
const TEAMS = [team('2026-alta-GR-B1'), team('2026-brighton-GR-B1')];

function payload(rows: unknown[]) {
  return { schemaVersion: '0.1', importType: 'coach', seasonId: '2026', assignments: rows };
}
function row(overrides: Record<string, unknown> = {}) {
  return { coachName: 'Pat Rivera', teamId: '2026-brighton-GR-B1', role: 'assistantCoach', sourceLabel: 'Asst', ...overrides };
}
function preview(rows: unknown[], coaches: StaffCoach[] = [], assignments: TeamCoachAssignment[] = []) {
  return buildCoachImportPreview({ payload: payload(rows), teams: TEAMS, existingCoaches: coaches, existingAssignments: assignments });
}

const JANE = buildStaffCoach('Jane Smith');
const JANE_ALTA: TeamCoachAssignment = {
  assignmentId: assignmentId('2026', '2026-alta-GR-B1', JANE.coachId),
  seasonId: '2026', teamId: '2026-alta-GR-B1', coachId: JANE.coachId, role: 'headCoach', sourceLabel: 'Head Coach',
};
const IDS = { transactionId: 'txn-1', executedAt: '2026-06-20T01:00:00.000Z' };
const UNDONE_AT = '2026-06-20T02:00:00.000Z';

describe('coach import execution', () => {
  it('rejects a non-executable preview', () => {
    const p = preview([row({ teamId: 'ghost' })]);
    const result = executeCoachImport({ preview: p, coaches: [], coachAssignments: [], ...IDS });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') expect(result.reason).toBe('preview-not-executable');
  });

  it('adds a new coach and assignment', () => {
    const p = preview([row()]);
    const result = executeCoachImport({ preview: p, coaches: [], coachAssignments: [], ...IDS });
    expect(result.status).toBe('executed');
    if (result.status !== 'executed') return;
    expect(result.addedCoachIds).toHaveLength(1);
    expect(result.addedAssignmentIds).toHaveLength(1);
    expect(result.coaches.map((c) => c.displayName)).toEqual(['Pat Rivera']);
    expect(result.coachAssignments[0].sourceLabel).toBe('Asst');
    expect(result.audit.durable).toBe(false);
    expect(result.audit.persisted).toBe(false);
  });

  it('reuses an existing coach identity (no new coach)', () => {
    const p = preview([row({ coachName: 'Jane Smith', teamId: '2026-brighton-GR-B1', role: 'headCoach' })], [JANE], [JANE_ALTA]);
    const result = executeCoachImport({ preview: p, coaches: [JANE], coachAssignments: [JANE_ALTA], ...IDS });
    if (result.status !== 'executed') throw new Error('expected executed');
    expect(result.addedCoachIds).toHaveLength(0);
    expect(result.coaches).toHaveLength(1);
    expect(result.coachAssignments).toHaveLength(2);
    expect(result.coachAssignments.some((a) => a.teamId === '2026-brighton-GR-B1' && a.coachId === JANE.coachId)).toBe(true);
  });

  it('updates an assignment only when classified as a safe update', () => {
    const p = preview([row({ coachName: 'Jane Smith', teamId: '2026-alta-GR-B1', role: 'assistantCoach', sourceLabel: 'Asst' })], [JANE], [JANE_ALTA]);
    const result = executeCoachImport({ preview: p, coaches: [JANE], coachAssignments: [JANE_ALTA], ...IDS });
    if (result.status !== 'executed') throw new Error('expected executed');
    expect(result.updatedAssignmentIds).toEqual([JANE_ALTA.assignmentId]);
    const updated = result.coachAssignments.find((a) => a.assignmentId === JANE_ALTA.assignmentId)!;
    expect(updated.role).toBe('assistantCoach');
    expect(result.coachAssignments).toHaveLength(1); // no new assignment
  });

  it('does not mutate input coaches/assignments/preview', () => {
    const coaches = [JANE];
    const assignments = [JANE_ALTA];
    const p = preview([row()], coaches, assignments);
    const cBefore = JSON.stringify(coaches);
    const aBefore = JSON.stringify(assignments);
    const pBefore = JSON.stringify(p);
    executeCoachImport({ preview: p, coaches, coachAssignments: assignments, ...IDS });
    expect(JSON.stringify(coaches)).toBe(cBefore);
    expect(JSON.stringify(assignments)).toBe(aBefore);
    expect(JSON.stringify(p)).toBe(pBefore);
  });

  it('uses caller-supplied transactionId/executedAt deterministically', () => {
    const p = preview([row()]);
    const a = executeCoachImport({ preview: p, coaches: [], coachAssignments: [], ...IDS });
    const b = executeCoachImport({ preview: p, coaches: [], coachAssignments: [], ...IDS });
    expect(a).toEqual(b);
  });

  it('does not mutate rosters or games (boundary)', () => {
    const teams = TEAMS.map((t) => ({ ...t, players: [...t.players] }));
    const games: Game[] = [
      { gameId: 'g1', seasonId: '2026', weekLabel: 'W1', scheduledDate: '2026-08-22', homeTeamId: '2026-alta-GR-B1', awayTeamId: '2026-brighton-GR-B1', status: 'final', homeScore: 21, awayScore: 14 },
    ];
    const teamsBefore = JSON.stringify(teams);
    const gamesBefore = JSON.stringify(games);
    const p = preview([row()]);
    executeCoachImport({ preview: p, coaches: [], coachAssignments: [], ...IDS });
    // The execution result contains only coaches/assignments; rosters & games are separate.
    expect(JSON.stringify(teams)).toBe(teamsBefore);
    expect(JSON.stringify(games)).toBe(gamesBefore);
  });
});

describe('coach import undo', () => {
  function executeAddAndUpdate() {
    // Update Jane's alta role + add a new coach (Pat) to brighton.
    const coaches = [JANE];
    const assignments = [JANE_ALTA];
    const p = preview(
      [
        row({ coachName: 'Jane Smith', teamId: '2026-alta-GR-B1', role: 'assistantCoach', sourceLabel: 'Asst' }),
        row({ coachName: 'Pat Rivera', teamId: '2026-brighton-GR-B1', role: 'assistantCoach' }),
      ],
      coaches,
      assignments
    );
    const result = executeCoachImport({ preview: p, coaches, coachAssignments: assignments, ...IDS });
    if (result.status !== 'executed') throw new Error('expected executed');
    return { result };
  }

  it('removes added assignments, restores updated assignments, removes safely-added coaches', () => {
    const { result } = executeAddAndUpdate();
    const undo = undoCoachImport({
      executionResult: result, coaches: result.coaches, coachAssignments: result.coachAssignments, undoneAt: UNDONE_AT,
    });
    expect(undo.status).toBe('undone');
    if (undo.status !== 'undone') return;
    // Pat (added coach + assignment) removed; Jane's alta restored to headCoach.
    expect(undo.coaches.map((c) => c.displayName)).toEqual(['Jane Smith']);
    expect(undo.removedCoachIds).toHaveLength(1);
    const jane = undo.coachAssignments.find((a) => a.assignmentId === JANE_ALTA.assignmentId)!;
    expect(jane.role).toBe('headCoach');
    expect(undo.coachAssignments).toHaveLength(1);
  });

  it('keeps an added coach that is still referenced by a preserved assignment', () => {
    // Add Pat to brighton AND alta in one import; undo only removes added assignments,
    // but if one added assignment survived... here both are added, so Pat is removed.
    // Instead test the "kept" path: pre-existing assignment references the added coach id.
    const pat = buildStaffCoach('Pat Rivera');
    const preexisting: TeamCoachAssignment = {
      assignmentId: assignmentId('2025', '2025-alta-GR-B1', pat.coachId),
      seasonId: '2025', teamId: '2025-alta-GR-B1', coachId: pat.coachId, role: 'assistantCoach',
    };
    // Pat is NOT yet a coach record, but a stray assignment references the same id.
    const p = preview([row({ coachName: 'Pat Rivera', teamId: '2026-brighton-GR-B1' })], [], [preexisting]);
    const result = executeCoachImport({ preview: p, coaches: [], coachAssignments: [preexisting], ...IDS });
    if (result.status !== 'executed') throw new Error('expected executed');
    const undo = undoCoachImport({ executionResult: result, coaches: result.coaches, coachAssignments: result.coachAssignments, undoneAt: UNDONE_AT });
    if (undo.status !== 'undone') throw new Error('expected undone');
    // The preexisting 2025 assignment still references Pat, so the added coach is KEPT.
    expect(undo.keptAddedCoachIds).toContain(pat.coachId);
    expect(undo.coaches.some((c) => c.coachId === pat.coachId)).toBe(true);
  });

  it('rejects undo of a non-executed result', () => {
    const p = preview([row({ teamId: 'ghost' })]);
    const rejected = executeCoachImport({ preview: p, coaches: [], coachAssignments: [], ...IDS });
    const undo = undoCoachImport({ executionResult: rejected, coaches: [], coachAssignments: [], undoneAt: UNDONE_AT });
    expect(undo.status).toBe('rejected');
    if (undo.status === 'rejected') expect(undo.reason).toBe('not-executed');
  });

  it('does not mutate the execution result', () => {
    const { result } = executeAddAndUpdate();
    const before = JSON.stringify(result);
    undoCoachImport({ executionResult: result, coaches: result.coaches, coachAssignments: result.coachAssignments, undoneAt: UNDONE_AT });
    expect(JSON.stringify(result)).toBe(before);
  });
});
