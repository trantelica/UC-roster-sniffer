import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import {
  commitImportedTeamsToWorkspace,
  undoImportedTeamsCommitInWorkspace,
} from '../engine/workspaceImportCommit';
import type { WorkspaceData } from '../engine/workspaceSnapshot';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  restoreWorkspaceFromSnapshot,
} from '../engine/workspaceSnapshot';

function team(teamId: string, players: string[]): Team {
  return {
    teamId,
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode: teamId.toUpperCase(),
    draftOrder: 1,
    divisionTeamCount: 3,
    headCoach: null,
    assistantCoaches: [],
    players: players.map((name) => ({ name })),
  };
}

function workspace(teams: Team[]): WorkspaceData {
  return {
    districts: [
      {
        districtId: 'alta',
        name: 'Alta',
        mascot: 'Hawks',
        logoAssetPath: '',
        helmetAssetPath: '',
        primaryColor: '#000',
        secondaryColor: '#fff',
        status: 'active',
      },
    ],
    ageDivisions: [],
    teams,
    games: [],
    coaches: [],
    coachAssignments: [],
  };
}

const base = () =>
  workspace([team('a', ['A1']), team('b', ['B1']), team('c', ['C1'])]);

describe('commitImportedTeamsToWorkspace (batch, all-or-nothing)', () => {
  it('commits multiple teams in one update and preserves unaffected slices', () => {
    const ws = base();
    const committedTeams = [team('a', ['A1', 'A2']), team('b', ['B1', 'B2', 'B3'])];
    const result = commitImportedTeamsToWorkspace(ws, committedTeams);
    expect(result.committed).toBe(true);
    if (!result.committed) return;

    const find = (id: string) => result.workspace.teams.find((t) => t.teamId === id);
    expect(find('a')?.players.map((p) => p.name)).toEqual(['A1', 'A2']);
    expect(find('b')?.players.map((p) => p.name)).toEqual(['B1', 'B2', 'B3']);
    // Unaffected team preserved exactly; previous values captured for undo.
    expect(find('c')?.players.map((p) => p.name)).toEqual(['C1']);
    expect(result.previousTeams.map((t) => t.teamId)).toEqual(['a', 'b']);
    expect(result.previousTeams[0].players.map((p) => p.name)).toEqual(['A1']);
  });

  it('preserves existing player records exactly and in order (only appends additions)', () => {
    const ws = base();
    const result = commitImportedTeamsToWorkspace(ws, [team('a', ['A1', 'New'])]);
    if (!result.committed) throw new Error('expected committed');
    const a = result.workspace.teams.find((t) => t.teamId === 'a');
    expect(a?.players.map((p) => p.name)).toEqual(['A1', 'New']);
  });

  it('is all-or-nothing: any missing target team leaves the workspace unchanged', () => {
    const ws = base();
    const result = commitImportedTeamsToWorkspace(ws, [
      team('a', ['A1', 'A2']),
      team('zzz', ['Z1']), // not in workspace
    ]);
    expect(result.committed).toBe(false);
    if (result.committed) return;
    expect(result.missingTeamIds).toEqual(['zzz']);
    // Nothing changed: team "a" still has its original single player.
    expect(result.workspace).toBe(ws);
    expect(ws.teams.find((t) => t.teamId === 'a')?.players).toHaveLength(1);
  });

  it('does not mutate inputs', () => {
    const ws = base();
    const wsJson = JSON.stringify(ws);
    const committed = [team('a', ['A1', 'A2'])];
    const committedJson = JSON.stringify(committed);
    commitImportedTeamsToWorkspace(ws, committed);
    expect(JSON.stringify(ws)).toBe(wsJson);
    expect(JSON.stringify(committed)).toBe(committedJson);
  });
});

describe('undoImportedTeamsCommitInWorkspace (batch)', () => {
  it('restores every affected team to its exact pre-batch state', () => {
    const ws = base();
    const commit = commitImportedTeamsToWorkspace(ws, [
      team('a', ['A1', 'A2']),
      team('b', ['B1', 'B2']),
    ]);
    if (!commit.committed) throw new Error('expected committed');
    const undo = undoImportedTeamsCommitInWorkspace(commit.workspace, commit.previousTeams);
    expect(undo.restored).toBe(true);
    if (!undo.restored) return;
    expect(undo.workspace.teams.find((t) => t.teamId === 'a')?.players.map((p) => p.name)).toEqual(['A1']);
    expect(undo.workspace.teams.find((t) => t.teamId === 'b')?.players.map((p) => p.name)).toEqual(['B1']);
  });

  it('preserves unrelated later changes to other teams', () => {
    const ws = base();
    const commit = commitImportedTeamsToWorkspace(ws, [team('a', ['A1', 'A2'])]);
    if (!commit.committed) throw new Error('expected committed');
    // After the batch commit, an unrelated team "c" is changed later.
    const laterTeams = commit.workspace.teams.map((t) =>
      t.teamId === 'c' ? team('c', ['C1', 'C-later']) : t
    );
    const laterWorkspace = { ...commit.workspace, teams: laterTeams };

    const undo = undoImportedTeamsCommitInWorkspace(laterWorkspace, commit.previousTeams);
    if (!undo.restored) throw new Error('expected restored');
    // "a" restored to pre-batch, "c"'s later change preserved.
    expect(undo.workspace.teams.find((t) => t.teamId === 'a')?.players.map((p) => p.name)).toEqual(['A1']);
    expect(undo.workspace.teams.find((t) => t.teamId === 'c')?.players.map((p) => p.name)).toEqual(['C1', 'C-later']);
  });

  it('refuses (all-or-nothing) when a target team is no longer present', () => {
    const ws = base();
    const undo = undoImportedTeamsCommitInWorkspace(ws, [team('missing', ['X'])]);
    expect(undo.restored).toBe(false);
    if (!undo.restored) expect(undo.missingTeamIds).toEqual(['missing']);
  });
});

describe('committed batch round-trips through snapshot', () => {
  it('build -> JSON -> parse -> restore preserves the committed additions', () => {
    const ws = base();
    const commit = commitImportedTeamsToWorkspace(ws, [
      team('a', ['A1', 'A2']),
      team('b', ['B1', 'B2']),
    ]);
    if (!commit.committed) throw new Error('expected committed');
    const snapshot = buildWorkspaceSnapshot({
      workspace: {
        ...commit.workspace,
        selection: { seasonId: null, districtId: null, ageDivisionId: null, teamId: null },
      },
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    const parsed = parseWorkspaceSnapshotJson(JSON.stringify(snapshot));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = restoreWorkspaceFromSnapshot(parsed.snapshot);
    expect(restored.workspace.teams.find((t) => t.teamId === 'a')?.players.map((p) => p.name)).toEqual(['A1', 'A2']);
    expect(restored.workspace.teams.find((t) => t.teamId === 'b')?.players.map((p) => p.name)).toEqual(['B1', 'B2']);
  });
});
