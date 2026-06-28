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
import { mapUteScrapedTeamClassification } from '../engine/uteConferenceScrapedCanonicalMapping';
import { buildDistrictNameRegistryLookup } from '../engine/districtRegistry';
import { normalizeUteConferenceImportSource } from '../engine/uteConferenceImportSourceNormalization';
import { buildWholeFilePlayerImportPlan } from '../engine/uteConferenceScrapedJsonWholeFileImport';

const EXPECTED_DISTRICTS = [
  'Alta', 'Bingham', 'Bountiful', 'Brighton', 'Cedar Valley', 'Clearfield', 'Copper Hills',
  'Corner Canyon', 'Cyprus', 'Deseret Peak', 'East', 'Farmington', 'Fremont', 'Grantsville',
  'Herriman', 'Highland', 'Hunter', 'Juan Diego', 'Kearns', 'Mountain Ridge', 'Murray',
  'Northridge', 'Olympus', 'Orem', 'Park City', 'Riverton', 'Skyline', 'South Summit',
  'Stansbury', 'Syracuse', 'Taylorsville', 'Tooele', 'Viewmont', 'Wasatch', 'Weber', 'West',
  'West Field', 'West Jordan', 'Woods Cross',
];
const GI_CODES = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'D2'];

function committablePlanForFlatRow(row: Record<string, string>) {
  const seed = loadUteConferenceSeedWorkspace();
  const norm = normalizeUteConferenceImportSource([row], { fileName: 'ute-players-2026.json' });
  if (!norm.ok) throw new Error('expected normalize ok');
  return buildWholeFilePlayerImportPlan({
    payload: norm.payload,
    existingTeams: seed.teams,
    districtRegistry: buildDistrictNameRegistryLookup(seed.districts),
  });
}

describe('loadUteConferenceSeedWorkspace — expanded coverage', () => {
  it('includes all listed real districts with deterministic IDs', () => {
    const ws = loadUteConferenceSeedWorkspace();
    expect(ws.districts).toHaveLength(EXPECTED_DISTRICTS.length);
    expect(ws.districts.map((d) => d.name)).toEqual(EXPECTED_DISTRICTS);
    const byName = new Map(ws.districts.map((d) => [d.name, d.districtId]));
    expect(byName.get('Alta')).toBe('alta');
    expect(byName.get('Cedar Valley')).toBe('cedar-valley');
    expect(byName.get('West Field')).toBe('west-field');
    expect(byName.get('Juan Diego')).toBe('juan-diego');
    // All 39 ids are unique.
    expect(new Set(ws.districts.map((d) => d.districtId)).size).toBe(EXPECTED_DISTRICTS.length);
  });

  it('keeps real branding for registry districts and marks new ones provisional', () => {
    const ws = loadUteConferenceSeedWorkspace();
    const alta = ws.districts.find((d) => d.districtId === 'alta')!;
    expect(alta.mascot).toBe('Hawks'); // real seeded-registry branding preserved
    const riverton = ws.districts.find((d) => d.districtId === 'riverton')!;
    expect(riverton.brandingProvisional).toBe(true);
    expect(riverton.status).toBe('active');
    expect(riverton.sourceLabels).toEqual(['Riverton']);
  });

  it('seeds GI/2026 empty team shells for every district (deterministic ids, no rosters)', () => {
    const ws = loadUteConferenceSeedWorkspace();
    expect(ws.teams).toHaveLength(EXPECTED_DISTRICTS.length * GI_CODES.length); // 39 * 11 = 429
    expect(ws.teams.every((t) => t.ageDivisionId === 'GI' && t.seasonId === '2026')).toBe(true);
    expect(ws.teams.every((t) => t.players.length === 0 && t.headCoach === null)).toBe(true);
    expect(ws.teams.some((t) => t.teamId === '2026-alta-GI-A3')).toBe(true);
    expect(ws.teams.some((t) => t.teamId === '2026-riverton-GI-B1')).toBe(true);
    expect(ws.games).toEqual([]);
    expect(ws.coaches).toEqual([]);
    expect(ws.coachAssignments).toEqual([]);
  });

  it('gives every team valid refs and consistent counts', () => {
    const ws = loadUteConferenceSeedWorkspace();
    const districtIds = new Set(ws.districts.map((d) => d.districtId));
    const ageIds = new Set(ws.ageDivisions.map((a) => a.ageDivisionId));
    for (const t of ws.teams) {
      expect(districtIds.has(t.districtId)).toBe(true);
      expect(ageIds.has(t.ageDivisionId)).toBe(true);
      expect(() => parseTeamClassification(t.teamCode)).not.toThrow();
      expect(t.divisionTeamCount).toBe(GI_CODES.length);
      expect(t.draftOrder).toBeGreaterThanOrEqual(1);
      expect(t.draftOrder).toBeLessThanOrEqual(t.divisionTeamCount);
    }
  });

  it('is deterministic and snapshot build/restore compatible', () => {
    const a = loadUteConferenceSeedWorkspace();
    const b = loadUteConferenceSeedWorkspace();
    expect(a.teams.map((t) => t.teamId)).toEqual(b.teams.map((t) => t.teamId));

    const state: WorkspaceState = {
      ...a,
      selection: { seasonId: null, districtId: null, ageDivisionId: null, teamId: null },
    };
    const snapshot = buildWorkspaceSnapshot({ workspace: state, generatedAt: '2026-06-28T00:00:00.000Z' });
    const validated = validateWorkspaceSnapshot(snapshot);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const restored = restoreWorkspaceFromSnapshot(validated.snapshot);
    expect(restored.workspace.teams).toHaveLength(a.teams.length);
    expect(restored.workspace.districts).toHaveLength(EXPECTED_DISTRICTS.length);
  });

  it('does not change loadEmptyWorkspace or loadSampleData', () => {
    expect(loadEmptyWorkspace().teams).toHaveLength(0);
    const sample = loadSampleData();
    expect(sample.teams.length).toBeGreaterThan(0);
    expect(sample.teams.some((t) => t.players.length > 0)).toBe(true);
  });
});

describe('parenthetical team labels are not distinguished by the classification parser (documented limitation)', () => {
  it('the classification parser cannot derive a code from a parenthetical sub-label', () => {
    // The trailing token is "(Bonneville)", not a code, so no classification resolves. Such
    // teams are intentionally NOT seeded; they are future work (sub-label disambiguation).
    expect(mapUteScrapedTeamClassification({ teamName: 'GridIron A1 (Bonneville)' }).canonicalValue).toBeNull();
    expect(() => parseTeamClassification('(Bonneville)')).toThrow();
  });
});

describe('normalized flat roster import lands into seeded team shells', () => {
  it('Alta / GI League 12 / GridIron A3 is committable against the seed', () => {
    const plan = committablePlanForFlatRow({
      district: 'Alta', age_group: 'GI League 12', team: 'GridIron A3', player_name: 'Cary, Hudson',
    });
    expect(plan.committableCount).toBe(1);
    expect(plan.committableTargets[0].existingTeam.teamId).toBe('2026-alta-GI-A3');
  });

  it('Riverton / GI League 12 / GridIron B1 (non-demo district) is committable against the seed', () => {
    const plan = committablePlanForFlatRow({
      district: 'Riverton', age_group: 'GI League 12', team: 'GridIron B1', player_name: 'Smith, Alex',
    });
    expect(plan.committableCount).toBe(1);
    expect(plan.committableTargets[0].existingTeam.teamId).toBe('2026-riverton-GI-B1');
  });

  it('an unrecognized district stays non-committable and is not auto-created on import', () => {
    const seed = loadUteConferenceSeedWorkspace();
    const districtCountBefore = seed.districts.length;
    const plan = committablePlanForFlatRow({
      district: 'Nonexistent District', age_group: 'GI League 12', team: 'GridIron A1', player_name: 'X, Y',
    });
    expect(plan.committableCount).toBe(0);
    expect(plan.targets[0].committable).toBe(false);
    // Planning never mutates/creates districts.
    expect(loadUteConferenceSeedWorkspace().districts.length).toBe(districtCountBefore);
  });
});
