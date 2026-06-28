import { describe, it, expect } from 'vitest';
import { loadEmptyWorkspace, loadSampleData } from '../data/loadSampleData';
import {
  buildWorkspaceSnapshot,
  validateWorkspaceSnapshot,
  restoreWorkspaceFromSnapshot,
  type WorkspaceState,
} from '../engine/workspaceSnapshot';
import { resolvePersistedWorkspaceLoad } from '../storage/workspaceIndexedDbStore';
import { assessWorkspaceEmptiness } from '../engine/workspaceEmptyState';

describe('loadEmptyWorkspace (Part 3 default startup)', () => {
  it('has no teams/games/coaches but keeps baseline registries', () => {
    const ws = loadEmptyWorkspace();
    expect(ws.teams).toHaveLength(0);
    expect(ws.games).toHaveLength(0);
    expect(ws.coaches).toHaveLength(0);
    expect(ws.coachAssignments).toHaveLength(0);
    // Baseline registries needed for import to function are preserved.
    expect(ws.ageDivisions.length).toBeGreaterThan(0);
    expect(ws.districts.length).toBeGreaterThan(0);
  });

  it('reads as empty-for-roster (first-run state), unlike the sample workspace', () => {
    expect(assessWorkspaceEmptiness(loadEmptyWorkspace()).isEmptyForRoster).toBe(true);
    expect(assessWorkspaceEmptiness(loadSampleData()).isEmptyForRoster).toBe(false);
  });
});

function emptyWorkspaceState(): WorkspaceState {
  return {
    ...loadEmptyWorkspace(),
    selection: { seasonId: null, districtId: null, ageDivisionId: null, teamId: null },
  };
}

describe('empty-workspace snapshot validation', () => {
  it('rejects an empty workspace by default (e.g. user Dataset Import)', () => {
    const snapshot = buildWorkspaceSnapshot({
      workspace: emptyWorkspaceState(),
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    const result = validateWorkspaceSnapshot(snapshot);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('empty-workspace');
  });

  it('accepts an empty workspace when allowEmptyWorkspace is set (persistence restore)', () => {
    const snapshot = buildWorkspaceSnapshot({
      workspace: emptyWorkspaceState(),
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    const result = validateWorkspaceSnapshot(snapshot, { allowEmptyWorkspace: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const restored = restoreWorkspaceFromSnapshot(result.snapshot);
      expect(restored.workspace.teams).toHaveLength(0);
      expect(restored.workspace.districts.length).toBeGreaterThan(0);
    }
  });
});

describe('persistence restore allows a reset-to-empty workspace', () => {
  it('resolves a stored empty-workspace snapshot to restored (not error)', () => {
    const snapshot = buildWorkspaceSnapshot({
      workspace: emptyWorkspaceState(),
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    const resolved = resolvePersistedWorkspaceLoad({
      status: 'found',
      record: {
        id: 'active-workspace',
        persistenceVersion: 1,
        savedAt: '2026-06-28T00:00:00.000Z',
        snapshot,
      },
    });
    expect(resolved.status).toBe('restored');
    if (resolved.status === 'restored') {
      expect(resolved.restore.workspace.teams).toHaveLength(0);
    }
  });
});
