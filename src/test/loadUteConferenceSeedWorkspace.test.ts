import { describe, it, expect } from 'vitest';
import { loadUteConferenceSeedWorkspace } from '../data/loadUteConferenceSeedWorkspace';
import { loadEmptyWorkspace, loadSampleData } from '../data/loadSampleData';
import {
  buildWorkspaceSnapshot,
  validateWorkspaceSnapshot,
  restoreWorkspaceFromSnapshot,
  type WorkspaceState,
} from '../engine/workspaceSnapshot';
import { parseTeamClassification } from '../engine/teamClassification';
import { buildDistrictNameRegistryLookup } from '../engine/districtRegistry';
import { normalizeUteConferenceImportSource } from '../engine/uteConferenceImportSourceNormalization';
import { buildWholeFilePlayerImportPlan } from '../engine/uteConferenceScrapedJsonWholeFileImport';

describe('loadUteConferenceSeedWorkspace', () => {
  it('returns seeded districts, fixed age divisions, and non-empty EMPTY-roster teams', () => {
    const ws = loadUteConferenceSeedWorkspace();
    expect(ws.districts.length).toBeGreaterThan(0);
    expect(ws.ageDivisions.length).toBe(6);
    expect(ws.teams.length).toBeGreaterThan(0);
    expect(ws.games).toEqual([]);
    expect(ws.coaches).toEqual([]);
    expect(ws.coachAssignments).toEqual([]);
    // Team shells carry no rosters / coaches.
    for (const t of ws.teams) {
      expect(t.players).toEqual([]);
      expect(t.headCoach).toBeNull();
      expect(t.assistantCoaches).toEqual([]);
    }
  });

  it('produces deterministic team IDs', () => {
    const a = loadUteConferenceSeedWorkspace();
    const b = loadUteConferenceSeedWorkspace();
    expect(a.teams.map((t) => t.teamId)).toEqual(b.teams.map((t) => t.teamId));
    expect(a.teams.some((t) => t.teamId === '2026-alta-GI-A3')).toBe(true);
  });

  it('gives every team valid district / age-division references and consistent counts', () => {
    const ws = loadUteConferenceSeedWorkspace();
    const districtIds = new Set(ws.districts.map((d) => d.districtId));
    const ageIds = new Set(ws.ageDivisions.map((a) => a.ageDivisionId));
    // Group sizes for the divisionTeamCount / draftOrder consistency check.
    const sizes = new Map<string, number>();
    for (const t of ws.teams) {
      const key = `${t.seasonId}|${t.districtId}|${t.ageDivisionId}`;
      sizes.set(key, (sizes.get(key) ?? 0) + 1);
    }
    for (const t of ws.teams) {
      expect(districtIds.has(t.districtId)).toBe(true);
      expect(ageIds.has(t.ageDivisionId)).toBe(true);
      expect(() => parseTeamClassification(t.teamCode)).not.toThrow();
      const key = `${t.seasonId}|${t.districtId}|${t.ageDivisionId}`;
      expect(t.divisionTeamCount).toBe(sizes.get(key));
      expect(t.draftOrder).toBeGreaterThanOrEqual(1);
      expect(t.draftOrder).toBeLessThanOrEqual(t.divisionTeamCount);
    }
  });

  it('is compatible with workspace snapshot build/restore', () => {
    const ws = loadUteConferenceSeedWorkspace();
    const state: WorkspaceState = {
      ...ws,
      selection: { seasonId: null, districtId: null, ageDivisionId: null, teamId: null },
    };
    const snapshot = buildWorkspaceSnapshot({ workspace: state, generatedAt: '2026-06-28T00:00:00.000Z' });
    const validated = validateWorkspaceSnapshot(snapshot); // seed has teams -> default validate ok
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const restored = restoreWorkspaceFromSnapshot(validated.snapshot);
    expect(restored.workspace.teams.length).toBe(ws.teams.length);
    expect(restored.workspace.teams.every((t) => t.players.length === 0)).toBe(true);
  });

  it('does not change loadEmptyWorkspace (no teams) or loadSampleData (demo teams + players)', () => {
    expect(loadEmptyWorkspace().teams).toHaveLength(0);
    const sample = loadSampleData();
    expect(sample.teams.length).toBeGreaterThan(0);
    expect(sample.teams.some((t) => t.players.length > 0)).toBe(true);
  });
});

describe('normalized flat roster import finds matching seeded team shells', () => {
  it('a flat player row matches an existing seeded team (becomes committable)', () => {
    const seed = loadUteConferenceSeedWorkspace();
    const flatRows = [
      { district: 'Alta', age_group: 'GI League 12', team: 'GridIron A3', player_name: 'Cary, Hudson' },
    ];
    const norm = normalizeUteConferenceImportSource(flatRows, { fileName: 'ute-players-2026.json' });
    expect(norm.ok).toBe(true);
    if (!norm.ok) return;

    const plan = buildWholeFilePlayerImportPlan({
      payload: norm.payload,
      existingTeams: seed.teams,
      districtRegistry: buildDistrictNameRegistryLookup(seed.districts),
    });
    expect(plan.committableCount).toBe(1);
    const target = plan.committableTargets[0];
    expect(target.existingTeam.teamId).toBe('2026-alta-GI-A3');
    expect(target.projectedAdditions).toBe(1);
  });

  it('a district/team not in the seed surfaces as no-existing-team (acceptable miss, no team creation)', () => {
    const seed = loadUteConferenceSeedWorkspace();
    const flatRows = [
      { district: 'Granger', age_group: 'GI League 12', team: 'GridIron A3', player_name: 'X, Y' },
    ];
    const norm = normalizeUteConferenceImportSource(flatRows, { fileName: 'ute-players-2026.json' });
    if (!norm.ok) throw new Error('expected ok');
    const plan = buildWholeFilePlayerImportPlan({
      payload: norm.payload,
      existingTeams: seed.teams,
      districtRegistry: buildDistrictNameRegistryLookup(seed.districts),
    });
    expect(plan.committableCount).toBe(0);
    // Granger is not a registered seed district -> provisional district (not auto-created).
    expect(plan.targets[0].committable).toBe(false);
  });
});
