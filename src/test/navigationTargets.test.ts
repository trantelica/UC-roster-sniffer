import { describe, it, expect } from 'vitest';
import type { AgeDivision, District, Team } from '../domain/types';
import {
  resolveTeamNavigationTarget,
  resolveCoachNavigationTarget,
} from '../engine/navigationTargets';
import { buildStaffCoach } from '../engine/coachModel';

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: 'Hawks', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 2, typicalAges: [9] },
];
const TEAM: Team = {
  teamId: '2026-alta-GR-B1', seasonId: '2026', districtId: 'alta', ageDivisionId: 'GR', teamCode: 'B1',
  draftOrder: 1, divisionTeamCount: 2, headCoach: null, assistantCoaches: [], players: [],
};
const JANE = buildStaffCoach('Jane Smith');

describe('resolveTeamNavigationTarget', () => {
  it('returns a found target for a known team', () => {
    const t = resolveTeamNavigationTarget('2026-alta-GR-B1', [TEAM], DISTRICTS, AGE_DIVISIONS);
    expect(t.found).toBe(true);
    expect(t.teamId).toBe('2026-alta-GR-B1');
    expect(t.displayName).toBe('Alta Gremlin B1');
  });

  it('handles a missing team safely', () => {
    const t = resolveTeamNavigationTarget('ghost-team', [TEAM], DISTRICTS, AGE_DIVISIONS);
    expect(t.found).toBe(false);
    expect(t.displayName).toBeNull();
  });

  it('handles null/empty ids safely', () => {
    expect(resolveTeamNavigationTarget(null, [TEAM], DISTRICTS, AGE_DIVISIONS).found).toBe(false);
    expect(resolveTeamNavigationTarget('', [TEAM], DISTRICTS, AGE_DIVISIONS).found).toBe(false);
  });
});

describe('resolveCoachNavigationTarget', () => {
  it('returns a found target for a known coach', () => {
    const t = resolveCoachNavigationTarget(JANE.coachId, [JANE]);
    expect(t.found).toBe(true);
    expect(t.displayName).toBe('Jane Smith');
  });

  it('handles a missing coach safely', () => {
    const t = resolveCoachNavigationTarget('coach:ghost', [JANE]);
    expect(t.found).toBe(false);
    expect(t.displayName).toBeNull();
  });

  it('handles null/empty ids safely', () => {
    expect(resolveCoachNavigationTarget(null, [JANE]).found).toBe(false);
    expect(resolveCoachNavigationTarget('', [JANE]).found).toBe(false);
  });
});
