import { describe, it, expect } from 'vitest';
import { loadEmptyWorkspace } from '../data/loadSampleData';
import { buildDistrictNameRegistryLookup } from '../engine/districtRegistry';
import { getMaterializedTeams } from '../engine/filters';
import type { WorkspaceData } from '../engine/workspaceSnapshot';
import {
  buildWholeFileCoachImportPlan,
  commitWholeFileCoachImport,
  undoWholeFileCoachImport,
} from '../engine/uteConferenceScrapedJsonWholeFileCoachImport';
import coachesPw from './fixtures/ute-scraped-json/coaches-2022-pw-small.json';

// The shipped demo fixture's head coach carries a non-breaking space (U+00A0), so exact
// name preservation (no folding to a normal space) is exercised end to end.
const JOHN_SMITH_NBSP = 'John Smith';

/**
 * End-to-end smoke check on the SHIPPED demo coach fixture (`coaches-2022-pw-small.json`), driving
 * the exact engine path the import workbench wires: reset → load → preview (no mutation) → commit
 * → materialized under the correct district → coaching staff correct → undo → pre-import state.
 */
describe('coach import demo-fixture smoke (whole 8-step flow)', () => {
  it('reset → load → preview (no mutation) → commit → materialized → staff → undo', () => {
    // 1. Reset to a fresh workspace (seeded districts incl. Alta; zero teams).
    const ws: WorkspaceData = loadEmptyWorkspace();
    const registry = buildDistrictNameRegistryLookup(ws.districts);
    expect(ws.teams).toHaveLength(0);
    const preLoadJson = JSON.stringify(ws);

    // 2. Load the valid coach source and build the plan.
    const plan = buildWholeFileCoachImportPlan({
      payload: coachesPw,
      existingTeams: ws.teams,
      districtRegistry: registry,
    });
    expect(plan.isCoachFile).toBe(true);
    expect(plan.createCount).toBe(2); // PeeWee C1 + PeeWee A3
    expect(plan.canCommit).toBe(true);

    // 3. Preview did NOT create a team or mutate the workspace.
    expect(ws.teams).toHaveLength(0);
    expect(JSON.stringify(ws)).toBe(preLoadJson);

    // 4. Commit the source.
    const commit = commitWholeFileCoachImport(ws, plan);
    expect(commit.committed).toBe(true);
    if (!commit.committed) return;

    // 5. Coach-only teams appear under the correct district (Alta) and are materialized.
    const c1 = commit.workspace.teams.find((t) => t.teamId === '2022-alta-PW-C1');
    const a3 = commit.workspace.teams.find((t) => t.teamId === '2022-alta-PW-A3');
    expect(c1?.districtId).toBe('alta');
    expect(a3?.districtId).toBe('alta');
    expect(c1?.players).toEqual([]);
    const materializedIds = getMaterializedTeams(commit.workspace.teams).map((t) => t.teamId);
    expect(materializedIds).toContain('2022-alta-PW-C1');
    expect(materializedIds).toContain('2022-alta-PW-A3');

    // 6. Coaching staff display correctly, with names preserved EXACTLY (NBSP intact).
    expect(c1?.headCoach).toEqual({ name: JOHN_SMITH_NBSP });
    expect(c1?.assistantCoaches).toEqual([{ name: 'Dana Park' }]);
    expect(a3?.headCoach).toEqual({ name: 'Lee Roy' });
    expect(a3?.assistantCoaches).toEqual([]);

    // 7. Undo the completed import session.
    const undo = undoWholeFileCoachImport(commit.workspace, commit.previousTeams, commit.createdTeamIds);
    expect(undo.restored).toBe(true);
    if (!undo.restored) return;

    // 8. Back to the exact pre-import state (created teams removed; nothing else changed).
    expect(undo.workspace.teams).toHaveLength(0);
    expect(JSON.stringify(undo.workspace)).toBe(preLoadJson);
  });
});
