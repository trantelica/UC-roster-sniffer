import { describe, it, expect } from 'vitest';
import type { District, Team } from '../domain/types';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  restoreWorkspaceFromSnapshot,
  validateWorkspaceSnapshot,
  type WorkspaceState,
} from '../engine/workspaceSnapshot';
import { isDistrictActive } from '../engine/districtRegistry';

function team(districtId: string): Team {
  return {
    teamId: `t-${districtId}`,
    seasonId: '2026',
    districtId,
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 1,
    headCoach: null,
    assistantCoaches: [],
    players: [{ name: 'Player One' }],
  };
}

function workspace(districts: District[]): WorkspaceState {
  return {
    districts,
    ageDivisions: [],
    teams: [team(districts[0].districtId)],
    games: [],
    coaches: [],
    coachAssignments: [],
    selection: { seasonId: null, districtId: null, ageDivisionId: null, teamId: null },
  };
}

function roundTrip(state: WorkspaceState) {
  const snapshot = buildWorkspaceSnapshot({ workspace: state, generatedAt: '2026-06-28T00:00:00.000Z' });
  const json = JSON.stringify(snapshot);
  const parsed = parseWorkspaceSnapshotJson(json);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('parse failed');
  return restoreWorkspaceFromSnapshot(parsed.snapshot);
}

function fullDistrict(overrides: Partial<District>): District {
  return {
    districtId: 'alta',
    name: 'Alta',
    mascot: 'Hawks',
    logoAssetPath: 'assets/districts/alta/logo.png',
    helmetAssetPath: 'assets/districts/alta/helmet.png',
    primaryColor: '#000000',
    secondaryColor: '#FFFFFF',
    ...overrides,
  };
}

describe('district registry snapshot round-trip', () => {
  it('restores an old-style district without status as active', () => {
    // Simulate an older snapshot whose district has no status/sourceLabels fields at all.
    const oldStyle = {
      schemaVersion: 1,
      snapshotKind: 'workspace',
      appName: 'uc-roster-sniffer',
      generatedAt: '2026-01-01T00:00:00.000Z',
      source: 'user-exported-json',
      note: '',
      selection: { seasonId: null, districtId: null, ageDivisionId: null, teamId: null },
      workspace: {
        districts: [
          {
            districtId: 'alta',
            name: 'Alta',
            mascot: 'Hawks',
            logoAssetPath: 'a.png',
            helmetAssetPath: 'h.png',
            primaryColor: '#000',
            secondaryColor: '#fff',
          },
        ],
        ageDivisions: [],
        teams: [team('alta')],
      },
    };
    const parsed = validateWorkspaceSnapshot(oldStyle);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = restoreWorkspaceFromSnapshot(parsed.snapshot);
    const d = restored.workspace.districts[0];
    expect(d.status).toBeUndefined();
    expect(isDistrictActive(d)).toBe(true);
  });

  it('round-trips new registry fields (status, sourceLabels, brandingProvisional)', () => {
    const state = workspace([
      fullDistrict({
        status: 'active',
        sourceLabels: ['Alta', 'Alta District'],
        brandingProvisional: false,
      }),
    ]);
    const restored = roundTrip(state);
    const d = restored.workspace.districts[0];
    expect(d.status).toBe('active');
    expect(d.sourceLabels).toEqual(['Alta', 'Alta District']);
    expect(d.brandingProvisional).toBe(false);
  });

  it('round-trips an inactive status exactly', () => {
    const state = workspace([fullDistrict({ status: 'inactive' })]);
    const restored = roundTrip(state);
    const d = restored.workspace.districts[0];
    expect(d.status).toBe('inactive');
    expect(isDistrictActive(d)).toBe(false);
  });

  it('keeps image references as plain string paths (no bytes)', () => {
    const state = workspace([
      fullDistrict({
        logoAssetPath: 'assets/districts/alta/logo.png',
        helmetAssetPath: 'assets/districts/alta/helmet.png',
        status: 'active',
      }),
    ]);
    const restored = roundTrip(state);
    const d = restored.workspace.districts[0];
    expect(typeof d.logoAssetPath).toBe('string');
    expect(typeof d.helmetAssetPath).toBe('string');
    expect(d.logoAssetPath).toBe('assets/districts/alta/logo.png');
    expect(d.helmetAssetPath).toBe('assets/districts/alta/helmet.png');
  });
});
