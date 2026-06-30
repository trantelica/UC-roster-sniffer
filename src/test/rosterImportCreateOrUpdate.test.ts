import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import { loadEmptyWorkspace } from '../data/loadSampleData';
import { buildDistrictNameRegistryLookup } from '../engine/districtRegistry';
import { normalizeUteConferenceImportSource } from '../engine/uteConferenceImportSourceNormalization';
import {
  buildWholeFilePlayerImportPlan,
  executeWholeFilePlayerImportBatch,
} from '../engine/uteConferenceScrapedJsonWholeFileImport';
import {
  commitRosterImportToWorkspace,
  undoRosterImportInWorkspace,
} from '../engine/workspaceImportCommit';
import type { WorkspaceData } from '../engine/workspaceSnapshot';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  restoreWorkspaceFromSnapshot,
} from '../engine/workspaceSnapshot';

// loadEmptyWorkspace seeds the Alta + Brighton districts (registry) but NO teams.
const emptyWorkspace = (): WorkspaceData => loadEmptyWorkspace();
const registryFor = (ws: WorkspaceData) => buildDistrictNameRegistryLookup(ws.districts);

function flatRow(district: string, team: string, player: string, ageGroup = 'GI League 12') {
  return { district, age_group: ageGroup, team, player_name: player };
}

function planFromFlat(rows: Record<string, string>[], ws: WorkspaceData, fileName = 'ute-players-2026.json') {
  const norm = normalizeUteConferenceImportSource(rows, { fileName });
  if (!norm.ok) throw new Error(`normalize failed: ${norm.reason}`);
  return buildWholeFilePlayerImportPlan({
    payload: norm.payload,
    existingTeams: ws.teams,
    districtRegistry: registryFor(ws),
  });
}

/** Commits a plan (create + update) into a workspace, mirroring the App handler. */
function commitPlan(ws: WorkspaceData, plan: ReturnType<typeof buildWholeFilePlayerImportPlan>) {
  const exec = executeWholeFilePlayerImportBatch({
    committableTargets: plan.committableTargets,
    generatedAt: '2026-06-28T00:00:00.000Z',
  });
  const updatedTeams = exec.status === 'executed' ? exec.committedTeams : [];
  const result = commitRosterImportToWorkspace(ws, updatedTeams, plan.teamsToCreate);
  if (!result.committed) throw new Error(`commit failed: ${result.reason}`);
  return result;
}

describe('roster import creates missing teams from an empty workspace', () => {
  it('creates teams and players from a real flat player file', () => {
    const ws = emptyWorkspace();
    const plan = planFromFlat([flatRow('Alta', 'GridIron A3', 'Cary, Hudson')], ws);
    expect(plan.createCount).toBe(1);
    const commit = commitPlan(ws, plan);
    const team = commit.workspace.teams.find((t) => t.teamId === '2026-alta-GI-A3');
    expect(team).toBeDefined();
    expect(team?.players.map((p) => p.name)).toEqual(['Cary, Hudson']);
    expect(commit.createdTeamIds).toEqual(['2026-alta-GI-A3']);
  });

  it('creates a team for a non-demo district (Riverton) without loading the optional seed', () => {
    // Fresh empty workspace only — no Ute Conference seed loaded.
    const ws = emptyWorkspace();
    const plan = planFromFlat([flatRow('Riverton', 'GridIron B1', 'Smith, Alex')], ws);
    expect(plan.createCount).toBe(1);
    expect(plan.targets[0].status).toBe('create');
    const commit = commitPlan(ws, plan);
    const team = commit.workspace.teams.find((t) => t.teamId === '2026-riverton-GI-B1');
    expect(team?.players.map((p) => p.name)).toEqual(['Smith, Alex']);
  });

  it('makes Alta GridIron A1 and Brighton GridIron A1 distinct teams', () => {
    const ws = emptyWorkspace();
    const plan = planFromFlat(
      [flatRow('Alta', 'GridIron A1', 'A One'), flatRow('Brighton', 'GridIron A1', 'B One')],
      ws
    );
    expect(plan.createCount).toBe(2);
    const ids = plan.teamsToCreate.map((t) => t.teamId).sort();
    expect(ids).toEqual(['2026-alta-GI-A1', '2026-brighton-GI-A1']);
  });

  it('produces distinct teams for different seasons (filename year)', () => {
    const ws = emptyWorkspace();
    const p2026 = planFromFlat([flatRow('Alta', 'GridIron A1', 'X')], ws, 'ute-players-2026.json');
    const p2025 = planFromFlat([flatRow('Alta', 'GridIron A1', 'X')], ws, 'ute-players-2025.json');
    expect(p2026.teamsToCreate[0].teamId).toBe('2026-alta-GI-A1');
    expect(p2025.teamsToCreate[0].teamId).toBe('2025-alta-GI-A1');
  });

  it('preserves player names exactly, including comma names and spacing', () => {
    const ws = emptyWorkspace();
    const plan = planFromFlat(
      [
        flatRow('Alta', 'GridIron A1', 'Cary, Hudson'),
        flatRow('Alta', 'GridIron A1', '  Moyer , Knox '),
      ],
      ws
    );
    const created = plan.teamsToCreate.find((t) => t.teamId === '2026-alta-GI-A1');
    expect(created?.players.map((p) => p.name)).toEqual(['Cary, Hudson', '  Moyer , Knox ']);
  });

  it('does not require identity review for a brand-new empty team', () => {
    const ws = emptyWorkspace();
    // A name that would be a duplicate in an existing roster is fine for a brand-new team.
    const plan = planFromFlat(
      [flatRow('Alta', 'GridIron A1', 'Dup Name'), flatRow('Alta', 'GridIron A1', 'Dup Name')],
      ws
    );
    expect(plan.createCount).toBe(1);
    expect(plan.committableCount).toBe(0); // updates (which need review) — none
    const created = plan.teamsToCreate[0];
    expect(created.players.map((p) => p.name)).toEqual(['Dup Name', 'Dup Name']);
  });
});

describe('existing team update still works', () => {
  it('updates an existing team and leaves it an update (not a create)', () => {
    const ws = emptyWorkspace();
    const existing: Team = {
      teamId: '2026-alta-GI-A1',
      seasonId: '2026',
      districtId: 'alta',
      ageDivisionId: 'GI',
      teamCode: 'A1',
      draftOrder: 1,
      divisionTeamCount: 1,
      headCoach: null,
      assistantCoaches: [],
      players: [{ name: 'Holdover' }],
    };
    ws.teams = [existing];
    const plan = planFromFlat([flatRow('Alta', 'GridIron A1', 'New Player')], ws);
    expect(plan.createCount).toBe(0);
    expect(plan.committableCount).toBe(1);
    expect(plan.targets[0].status).toBe('update');
    const commit = commitPlan(ws, plan);
    const team = commit.workspace.teams.find((t) => t.teamId === '2026-alta-GI-A1');
    expect(team?.players.map((p) => p.name)).toEqual(['Holdover', 'New Player']);
  });
});

describe('unknown district and unreadable team code are explicit, not silent', () => {
  it('blocks an unregistered district with an Add-district-first reason and creates nothing', () => {
    const ws = emptyWorkspace();
    const plan = planFromFlat([flatRow('Granger', 'GridIron A1', 'X')], ws);
    expect(plan.createCount).toBe(0);
    expect(plan.committableCount).toBe(0);
    const target = plan.targets[0];
    expect(target.status).toBe('provisional-district');
    expect(target.committable).toBe(false);
    expect(target.reasons.join(' ')).toMatch(/Add the district first/i);
  });

  it('blocks an UNRESOLVED parenthetical district rather than collapsing or inventing a team', () => {
    // The empty workspace seeds Alta + Brighton only, so "Bonneville" is unknown.
    const ws = emptyWorkspace();
    const plan = planFromFlat([flatRow('Alta', 'GridIron A1 (Bonneville)', 'X')], ws);
    expect(plan.createCount).toBe(0);
    expect(plan.targets[0].status).toBe('unresolved-parenthetical-district');
    expect(plan.targets[0].committable).toBe(false);
    expect(plan.targets[0].reasons.join(' ')).toMatch(/Bonneville/);
    // No team was created with the plain "A1" code under the scraped district, and no Bonneville
    // team was invented either.
    expect(plan.teamsToCreate.some((t) => t.teamId === '2026-alta-GI-A1')).toBe(false);
    expect(plan.teamsToCreate.some((t) => t.teamId === '2026-bonneville-GI-A1')).toBe(false);
  });
});

describe('roster import commit + undo + dataset round-trip', () => {
  it('combined create + update commit is all-or-nothing and undoable', () => {
    const ws = emptyWorkspace();
    ws.teams = [
      {
        teamId: '2026-alta-GI-A1', seasonId: '2026', districtId: 'alta', ageDivisionId: 'GI',
        teamCode: 'A1', draftOrder: 1, divisionTeamCount: 1, headCoach: null,
        assistantCoaches: [], players: [{ name: 'Holdover' }],
      },
    ];
    const plan = planFromFlat(
      [flatRow('Alta', 'GridIron A1', 'Added'), flatRow('Brighton', 'GridIron B1', 'New B')],
      ws
    );
    expect(plan.committableCount).toBe(1); // update Alta A1
    expect(plan.createCount).toBe(1); // create Brighton B1
    const commit = commitPlan(ws, plan);
    expect(commit.workspace.teams).toHaveLength(2);

    const undo = undoRosterImportInWorkspace(commit.workspace, commit.previousTeams, commit.createdTeamIds);
    expect(undo.restored).toBe(true);
    if (!undo.restored) return;
    expect(undo.workspace.teams).toHaveLength(1); // created team removed
    expect(undo.workspace.teams[0].players.map((p) => p.name)).toEqual(['Holdover']); // update reverted
  });

  it('created teams round-trip through dataset export/import', () => {
    const ws = emptyWorkspace();
    const plan = planFromFlat([flatRow('Alta', 'GridIron A2', 'Player One')], ws);
    const commit = commitPlan(ws, plan);
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
    const team = restored.workspace.teams.find((t) => t.teamId === '2026-alta-GI-A2');
    expect(team?.players.map((p) => p.name)).toEqual(['Player One']);
  });
});
