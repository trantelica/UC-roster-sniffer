import { describe, it, expect } from 'vitest';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  restoreWorkspaceFromSnapshot,
  type WorkspaceData,
  type WorkspaceSnapshot,
  type WorkspaceSnapshotSelection,
} from '../engine/workspaceSnapshot';
import { loadSampleData } from '../data/loadSampleData';
import { getDistinctSeasons } from '../engine/filters';

// Completion Milestone A2: prove the portable dataset round-trips. This exercises the SAME
// path the UI uses:
//   Export Dataset  = buildWorkspaceSnapshot(committed workspace) -> JSON.stringify
//   Import Dataset  = parseWorkspaceSnapshotJson -> restoreWorkspaceFromSnapshot
// The "another browser/session" hand-off is modelled by passing ONLY the JSON string across
// the boundary (nothing else travels with the file).

const SELECTION: WorkspaceSnapshotSelection = {
  seasonId: '2026',
  districtId: null,
  ageDivisionId: null,
  teamId: null,
};

// Mirror App.handleExportSnapshot: committed workspace only (never an in-memory overlay).
function exportDatasetJson(workspace: WorkspaceData, generatedAt: string): string {
  const snapshot = buildWorkspaceSnapshot({
    workspace: { ...workspace, selection: SELECTION },
    generatedAt,
  });
  return JSON.stringify(snapshot, null, 2);
}

// Mirror App.handleImportFileChange: parse + validate + restore (no merge).
function importDataset(json: string) {
  const parsed = parseWorkspaceSnapshotJson(json);
  if (!parsed.ok) throw new Error(`import rejected: ${parsed.errors.map((e) => e.code).join(', ')}`);
  return restoreWorkspaceFromSnapshot(parsed.snapshot);
}

// Volatile fields that legitimately differ between two exports; everything else must match.
function canonicalize(snapshot: WorkspaceSnapshot) {
  return {
    selection: snapshot.selection,
    workspace: snapshot.workspace,
    summaryWithoutTimestamp: { ...snapshot.summary, generatedAt: '<ignored>' },
  };
}

describe('A2 portable dataset round-trip', () => {
  it('uses a representative dataset (multiple seasons, teams, players, games, coaches)', () => {
    const ws = loadSampleData();
    expect(getDistinctSeasons(ws.teams).length).toBeGreaterThanOrEqual(2);
    expect(ws.teams.length).toBeGreaterThan(0);
    expect(ws.teams.some((t) => t.players.length > 0)).toBe(true);
    expect(ws.games.length).toBeGreaterThan(0);
    expect(ws.coaches.length).toBeGreaterThan(0);
    expect(ws.coachAssignments.length).toBeGreaterThan(0);
    expect(ws.districts.length).toBeGreaterThan(0);
    expect(ws.ageDivisions.length).toBeGreaterThan(0);
  });

  it('export JSON -> import -> re-export yields canonically equivalent workspace data', () => {
    const original = loadSampleData();

    // Export on "machine A".
    const json = exportDatasetJson(original, '2026-06-27T10:00:00.000Z');

    // Import on "machine B" — only the JSON string crosses the boundary.
    const restored = importDataset(json);

    // Re-export from the restored workspace, with a DIFFERENT timestamp to prove that the
    // timestamp is the ONLY thing allowed to differ.
    const reExportedJson = exportDatasetJson(restored.workspace, '2026-06-27T23:59:59.000Z');

    const a = canonicalize(parseOk(json));
    const b = canonicalize(parseOk(reExportedJson));

    // Full canonical equivalence of all workspace data (districts, age divisions, teams,
    // players, games, coaches, coach assignments) plus selection and summary counts.
    expect(b).toEqual(a);
  });

  it('preserves the full committed workspace exactly through one round trip', () => {
    const original = loadSampleData();
    const json = exportDatasetJson(original, '2026-06-27T10:00:00.000Z');
    const restored = importDataset(json);

    // The restored workspace equals the original committed workspace (deep equality of the
    // entire dataset — duplicate/ambiguous names and any provisional/unknown values included).
    expect(restored.workspace.districts).toEqual(original.districts);
    expect(restored.workspace.ageDivisions).toEqual(original.ageDivisions);
    expect(restored.workspace.teams).toEqual(original.teams);
    expect(restored.workspace.games).toEqual(original.games);
    expect(restored.workspace.coaches).toEqual(original.coaches);
    expect(restored.workspace.coachAssignments).toEqual(original.coachAssignments);
  });

  it('rejects invalid JSON and wrong-shape datasets without restoring (calm error)', () => {
    const invalidJson = parseWorkspaceSnapshotJson('{ not valid json');
    expect(invalidJson.ok).toBe(false);

    const wrongShape = parseWorkspaceSnapshotJson(JSON.stringify({ hello: 'world' }));
    expect(wrongShape.ok).toBe(false);
  });
});

function parseOk(json: string): WorkspaceSnapshot {
  const parsed = parseWorkspaceSnapshotJson(json);
  if (!parsed.ok) throw new Error('expected valid snapshot');
  return parsed.snapshot;
}
