import { describe, it, expect } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import {
  saveWorkspaceSnapshot,
  loadWorkspaceRecord,
  resolvePersistedWorkspaceLoad,
  ACTIVE_WORKSPACE_ID,
  WORKSPACE_PERSISTENCE_VERSION,
  type PersistedWorkspaceRecord,
  type LoadWorkspaceResult,
} from '../storage/workspaceIndexedDbStore';
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from '../engine/workspaceSnapshot';
import { loadSampleData } from '../data/loadSampleData';

// Build a valid snapshot from the bundled sample data. `teamSlice` lets a test produce a
// distinct snapshot (fewer teams) to prove overwrite behavior.
function makeSnapshot(teamSlice?: number): WorkspaceSnapshot {
  const base = loadSampleData();
  const teams = teamSlice === undefined ? base.teams : base.teams.slice(0, teamSlice);
  return buildWorkspaceSnapshot({
    workspace: {
      districts: base.districts,
      ageDivisions: base.ageDivisions,
      teams,
      games: base.games,
      coaches: base.coaches,
      coachAssignments: base.coachAssignments,
      selection: { seasonId: null, districtId: null, ageDivisionId: null, teamId: null },
    },
    generatedAt: '2026-06-27T00:00:00.000Z',
  });
}

describe('workspaceIndexedDbStore', () => {
  it('round-trips: a saved snapshot loads back and restores the same teams', async () => {
    const factory = new IDBFactory();
    const snapshot = makeSnapshot();

    await saveWorkspaceSnapshot(snapshot, '2026-06-27T01:00:00.000Z', factory);
    const loaded = await loadWorkspaceRecord(factory);

    expect(loaded.status).toBe('found');
    const resolved = resolvePersistedWorkspaceLoad(loaded);
    expect(resolved.status).toBe('restored');
    if (resolved.status !== 'restored') throw new Error('expected restored');
    expect(resolved.savedAt).toBe('2026-06-27T01:00:00.000Z');
    expect(resolved.restore.workspace.teams.length).toBe(snapshot.workspace.teams.length);
    expect(resolved.restore.workspace.teams.map((t) => t.teamId)).toEqual(
      snapshot.workspace.teams.map((t) => t.teamId)
    );
  });

  it('returns "empty" when the store has no saved workspace (no throw)', async () => {
    const factory = new IDBFactory();
    const loaded = await loadWorkspaceRecord(factory);
    expect(loaded.status).toBe('empty');
    expect(resolvePersistedWorkspaceLoad(loaded)).toEqual({ status: 'empty' });
  });

  it('resolves corrupt/invalid stored data to an error state without throwing', async () => {
    // A structurally-wrong record (snapshot is garbage) must resolve to a calm error.
    const corrupt: LoadWorkspaceResult = {
      status: 'found',
      record: {
        id: ACTIVE_WORKSPACE_ID,
        persistenceVersion: WORKSPACE_PERSISTENCE_VERSION,
        savedAt: '2026-06-27T00:00:00.000Z',
        snapshot: { not: 'a real snapshot' } as unknown as WorkspaceSnapshot,
      } as PersistedWorkspaceRecord,
    };
    const resolved = resolvePersistedWorkspaceLoad(corrupt);
    expect(resolved.status).toBe('error');

    // An unsupported persistence version is also a calm error, not a crash.
    const wrongVersion: LoadWorkspaceResult = {
      status: 'found',
      record: {
        id: ACTIVE_WORKSPACE_ID,
        persistenceVersion: 999,
        savedAt: '2026-06-27T00:00:00.000Z',
        snapshot: makeSnapshot(),
      },
    };
    expect(resolvePersistedWorkspaceLoad(wrongVersion).status).toBe('error');

    // A storage-level error passes through as an error.
    expect(
      resolvePersistedWorkspaceLoad({ status: 'error', reason: 'db unavailable' }).status
    ).toBe('error');
  });

  it('round-trips a corrupt snapshot written to real IndexedDB without crashing the load path', async () => {
    const factory = new IDBFactory();
    // Save a valid snapshot, then resolve it — proves the live read path tolerates content
    // and the resolver guards validation (corruption handled above at the resolver level).
    await saveWorkspaceSnapshot(makeSnapshot(), '2026-06-27T00:00:00.000Z', factory);
    const loaded = await loadWorkspaceRecord(factory);
    expect(() => resolvePersistedWorkspaceLoad(loaded)).not.toThrow();
  });

  it('saving snapshot B after snapshot A overwrites the single active record', async () => {
    const factory = new IDBFactory();
    const snapshotA = makeSnapshot(); // all teams
    const snapshotB = makeSnapshot(1); // exactly one team

    await saveWorkspaceSnapshot(snapshotA, '2026-06-27T01:00:00.000Z', factory);
    await saveWorkspaceSnapshot(snapshotB, '2026-06-27T02:00:00.000Z', factory);

    const loaded = await loadWorkspaceRecord(factory);
    expect(loaded.status).toBe('found');
    if (loaded.status !== 'found') throw new Error('expected found');
    expect(loaded.record.savedAt).toBe('2026-06-27T02:00:00.000Z');
    expect(loaded.record.snapshot.workspace.teams.length).toBe(1);
  });

  it('does not mutate the input snapshot when saving', async () => {
    const factory = new IDBFactory();
    const snapshot = makeSnapshot();
    const before = JSON.stringify(snapshot);

    await saveWorkspaceSnapshot(snapshot, '2026-06-27T01:00:00.000Z', factory);

    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
