import { describe, it, expect } from 'vitest';
import type { AgeDivision, District, Team } from '../domain/types';
import {
  getDistrictBranding,
  getTeamBranding,
} from '../engine/teamBrandingDisplay';

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: 'Hawks', logoAssetPath: 'assets/alta/logo.png', helmetAssetPath: 'assets/alta/helmet.png', primaryColor: '#000000', secondaryColor: '#FFFFFF' },
  // Brighton has blank branding fields to exercise fallbacks.
  { districtId: 'brighton', name: 'Brighton', mascot: '', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 2, typicalAges: [9] },
];

function team(teamId: string, districtId: string, teamCode = 'B1'): Team {
  return {
    teamId, seasonId: '2026', districtId, ageDivisionId: 'GR', teamCode,
    draftOrder: 1, divisionTeamCount: 2, headCoach: null, assistantCoaches: [], players: [],
  };
}

describe('getDistrictBranding', () => {
  it('returns district colors, mascot, and assets when available', () => {
    const b = getDistrictBranding('alta', DISTRICTS);
    expect(b.districtName).toBe('Alta');
    expect(b.mascot).toBe('Hawks');
    expect(b.primaryColor).toBe('#000000');
    expect(b.secondaryColor).toBe('#FFFFFF');
    expect(b.hasBrandColors).toBe(true);
    expect(b.logoAssetPath).toBe('assets/alta/logo.png');
    expect(b.helmetAssetPath).toBe('assets/alta/helmet.png');
    expect(b.initials).toBe('AL');
  });

  it('falls back deterministically when brand fields are blank', () => {
    const b = getDistrictBranding('brighton', DISTRICTS);
    expect(b.districtName).toBe('Brighton');
    expect(b.mascot).toBeNull();
    expect(b.primaryColor).toBeNull();
    expect(b.secondaryColor).toBeNull();
    expect(b.hasBrandColors).toBe(false);
    expect(b.logoAssetPath).toBeNull();
    expect(b.helmetAssetPath).toBeNull();
    expect(b.initials).toBe('BR');
  });

  it('falls back to the district id and a deterministic badge when the district is unknown', () => {
    const b = getDistrictBranding('ghost-district', DISTRICTS);
    expect(b.districtName).toBe('ghost-district');
    expect(b.hasBrandColors).toBe(false);
    expect(b.initials).toBe('GH');
    const withFallback = getDistrictBranding('xyz', DISTRICTS, { fallbackName: 'Unknown District' });
    expect(withFallback.districtName).toBe('Unknown District');
  });

  it('does not mutate inputs', () => {
    const before = JSON.stringify(DISTRICTS);
    getDistrictBranding('alta', DISTRICTS);
    expect(JSON.stringify(DISTRICTS)).toBe(before);
  });
});

describe('getTeamBranding', () => {
  it('combines district branding with age division and classification', () => {
    const b = getTeamBranding(team('2026-alta-GR-B1', 'alta'), DISTRICTS, AGE_DIVISIONS);
    expect(b.teamDisplayName).toBe('Alta Gremlin B1');
    expect(b.ageDivisionName).toBe('Gremlin');
    expect(b.teamCode).toBe('B1');
    expect(b.classificationLabel).toBe('Class B1');
    expect(b.districtName).toBe('Alta');
    expect(b.primaryColor).toBe('#000000');
    expect(b.initials).toBe('AL');
  });

  it('preserves names exactly and handles missing age division / blank code', () => {
    const t = team('2026-brighton-GR-', 'brighton', '');
    const b = getTeamBranding(t, DISTRICTS, []);
    expect(b.ageDivisionName).toBe('GR'); // falls back to id when age division missing
    expect(b.classificationLabel).toBe('Unclassified');
    expect(b.districtName).toBe('Brighton');
  });

  it('does not mutate inputs', () => {
    const t = team('2026-alta-GR-B1', 'alta');
    const before = JSON.stringify({ t, DISTRICTS, AGE_DIVISIONS });
    getTeamBranding(t, DISTRICTS, AGE_DIVISIONS);
    expect(JSON.stringify({ t, DISTRICTS, AGE_DIVISIONS })).toBe(before);
  });
});
