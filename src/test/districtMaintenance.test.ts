import { describe, it, expect } from 'vitest';
import type { District, Team } from '../domain/types';
import {
  createDistrictFromInput,
  updateDistrict,
  reactivateDistrict,
  inactivateDistrict,
  validateDistrictInput,
  normalizeSourceLabels,
  isDistrictReferencedByTeams,
  countTeamsForDistrict,
  buildDistrictNameRegistryLookup,
  findDistrictById,
  isDistrictActive,
} from '../engine/districtRegistry';

function freeze<T>(value: T): T {
  return Object.freeze(value) as T;
}

function district(overrides: Partial<District>): District {
  return {
    districtId: 'x',
    name: 'X',
    mascot: '',
    logoAssetPath: '',
    helmetAssetPath: '',
    primaryColor: '',
    secondaryColor: '',
    ...overrides,
  };
}

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
    players: [],
  };
}

describe('validateDistrictInput', () => {
  it('requires name and mascot', () => {
    expect(validateDistrictInput({ name: '', mascot: '' })).toEqual([
      'missing-name',
      'missing-mascot',
    ]);
    expect(validateDistrictInput({ name: 'Granger', mascot: 'Lancers' })).toEqual([]);
    expect(validateDistrictInput({ name: '  ', mascot: 'x' })).toEqual(['missing-name']);
  });
});

describe('createDistrictFromInput', () => {
  it('generates a deterministic districtId from the name', () => {
    const r1 = createDistrictFromInput([], { name: 'Granger', mascot: 'Lancers' });
    const r2 = createDistrictFromInput([], { name: 'Granger', mascot: 'Lancers' });
    expect(r1.district.districtId).toBe('granger');
    expect(r2.district.districtId).toBe('granger');
  });

  it('disambiguates a colliding districtId deterministically', () => {
    const existing = [district({ districtId: 'granger', name: 'Granger' })];
    const r = createDistrictFromInput(existing, { name: 'Granger!', mascot: 'x' });
    expect(r.district.districtId).toBe('granger-2');
    expect(r.districts).toHaveLength(2);
  });

  it('defaults status to active', () => {
    const r = createDistrictFromInput([], { name: 'Granger', mascot: 'x' });
    expect(r.district.status).toBe('active');
    expect(isDistrictActive(r.district)).toBe(true);
  });

  it('defaults sourceLabels to [name] when none provided, else uses given labels', () => {
    const a = createDistrictFromInput([], { name: 'Granger', mascot: 'x' });
    expect(a.district.sourceLabels).toEqual(['Granger']);
    const b = createDistrictFromInput([], {
      name: 'Granger',
      mascot: 'x',
      sourceLabels: ['Granger HS', 'Granger High', ' '],
    });
    expect(b.district.sourceLabels).toEqual(['Granger HS', 'Granger High']);
  });

  it('defaults brandingProvisional true unless both colors present; honors explicit value', () => {
    const incomplete = createDistrictFromInput([], { name: 'A', mascot: 'x' });
    expect(incomplete.district.brandingProvisional).toBe(true);
    const complete = createDistrictFromInput([], {
      name: 'B',
      mascot: 'x',
      primaryColor: '#000',
      secondaryColor: '#fff',
    });
    expect(complete.district.brandingProvisional).toBe(false);
    const forced = createDistrictFromInput([], {
      name: 'C',
      mascot: 'x',
      primaryColor: '#000',
      secondaryColor: '#fff',
      brandingProvisional: true,
    });
    expect(forced.district.brandingProvisional).toBe(true);
  });

  it('stores image references as plain trimmed strings (no bytes)', () => {
    const r = createDistrictFromInput([], {
      name: 'A',
      mascot: 'x',
      logoAssetPath: '  districts/a-logo.png ',
      helmetAssetPath: 'districts/a-helmet.png',
    });
    expect(r.district.logoAssetPath).toBe('districts/a-logo.png');
    expect(r.district.helmetAssetPath).toBe('districts/a-helmet.png');
  });

  it('does not mutate the input registry', () => {
    const existing = freeze([district({ districtId: 'a', name: 'A' })]);
    const r = createDistrictFromInput(existing, { name: 'B', mascot: 'x' });
    expect(existing).toHaveLength(1);
    expect(r.districts).toHaveLength(2);
  });
});

describe('updateDistrict', () => {
  const base = () => [
    district({
      districtId: 'alta',
      name: 'Alta',
      mascot: 'Hawks',
      status: 'active',
      sourceLabels: ['Alta'],
    }),
  ];

  it('edits mutable fields without changing districtId or status', () => {
    const r = updateDistrict(base(), 'alta', {
      name: 'Alta United',
      mascot: 'Falcons',
      primaryColor: '#111',
    });
    expect(r.changed).toBe(true);
    if (!r.changed) return;
    expect(r.district.districtId).toBe('alta'); // id never changes
    expect(r.district.status).toBe('active');
    expect(r.district.name).toBe('Alta United');
    expect(r.district.mascot).toBe('Falcons');
    expect(r.district.primaryColor).toBe('#111');
  });

  it('trims and removes blank source labels (exact, deduped)', () => {
    const r = updateDistrict(base(), 'alta', {
      sourceLabels: [' Alta ', '', 'Alta District', 'Alta District'],
    });
    if (!r.changed) throw new Error('expected changed');
    expect(r.district.sourceLabels).toEqual(['Alta', 'Alta District']);
  });

  it('returns not-found for an unknown id and changes nothing', () => {
    const districts = base();
    const r = updateDistrict(districts, 'nope', { name: 'X' });
    expect(r.changed).toBe(false);
    if (r.changed) return;
    expect(r.reason).toBe('not-found');
  });

  it('does not mutate the input', () => {
    const districts = freeze(base().map(freeze));
    updateDistrict(districts, 'alta', { name: 'Changed' });
    expect(districts[0].name).toBe('Alta');
  });
});

describe('inactivate / reactivate (never deletes, id stable)', () => {
  it('reactivate preserves the same districtId and every other field', () => {
    const districts = [
      district({ districtId: 'alta', name: 'Alta', mascot: 'Hawks', status: 'inactive' }),
    ];
    const r = reactivateDistrict(districts, 'alta');
    expect(r.changed).toBe(true);
    if (!r.changed) return;
    expect(r.district.districtId).toBe('alta');
    expect(r.district.status).toBe('active');
    expect(r.district.mascot).toBe('Hawks');
    expect(r.districts).toHaveLength(1); // not removed
  });

  it('reactivate reports already-active / not-found', () => {
    const districts = [district({ districtId: 'alta', name: 'Alta', status: 'active' })];
    expect(reactivateDistrict(districts, 'alta').changed).toBe(false);
    expect(reactivateDistrict(districts, 'missing').changed).toBe(false);
  });

  it('inactivate then reactivate is a stable round-trip on the same id', () => {
    let districts = [district({ districtId: 'alta', name: 'Alta', status: 'active' })];
    const off = inactivateDistrict(districts, 'alta');
    if (!off.changed) throw new Error('expected changed');
    districts = off.districts;
    expect(findDistrictById(districts, 'alta')?.status).toBe('inactive');
    const on = reactivateDistrict(districts, 'alta');
    if (!on.changed) throw new Error('expected changed');
    expect(findDistrictById(on.districts, 'alta')?.status).toBe('active');
  });
});

describe('referenced-by-teams helpers', () => {
  const teams = [team('alta'), team('alta'), team('brighton')];
  it('identifies districts used by existing teams', () => {
    expect(isDistrictReferencedByTeams(teams, 'alta')).toBe(true);
    expect(isDistrictReferencedByTeams(teams, 'granger')).toBe(false);
    expect(countTeamsForDistrict(teams, 'alta')).toBe(2);
    expect(countTeamsForDistrict(teams, 'granger')).toBe(0);
  });
});

describe('maintenance changes feed the active import-mapping lookup', () => {
  it('includes a newly created active district and excludes inactive ones', () => {
    const created = createDistrictFromInput([], { name: 'Granger', mascot: 'x' });
    const lookup = buildDistrictNameRegistryLookup(created.districts);
    expect(lookup.Granger).toBe('granger');

    const off = inactivateDistrict(created.districts, 'granger');
    if (!off.changed) throw new Error('expected changed');
    expect(buildDistrictNameRegistryLookup(off.districts).Granger).toBeUndefined();

    const on = reactivateDistrict(off.districts, 'granger');
    if (!on.changed) throw new Error('expected changed');
    expect(buildDistrictNameRegistryLookup(on.districts).Granger).toBe('granger');
  });

  it('uses edited source labels for exact matching only (no fuzzy)', () => {
    const created = createDistrictFromInput([], { name: 'Granger', mascot: 'x' });
    const updated = updateDistrict(created.districts, 'granger', {
      sourceLabels: ['Granger', 'Granger HS'],
    });
    if (!updated.changed) throw new Error('expected changed');
    const lookup = buildDistrictNameRegistryLookup(updated.districts);
    expect(lookup['Granger HS']).toBe('granger');
    // A near miss does NOT resolve (exact only).
    expect(lookup['granger hs']).toBeUndefined();
    expect(lookup.Grangr).toBeUndefined();
  });
});

describe('normalizeSourceLabels', () => {
  it('trims, drops blanks, and dedupes exactly', () => {
    expect(normalizeSourceLabels([' A ', '', 'A', 'B', 5 as unknown as string])).toEqual([
      'A',
      'B',
    ]);
    expect(normalizeSourceLabels(undefined)).toEqual([]);
  });
});

describe('no destructive delete is exported', () => {
  it('has no delete/remove/destroy helper', async () => {
    const mod = await import('../engine/districtRegistry');
    const deleteLike = Object.keys(mod).filter((k) => /delete|remove|destroy/i.test(k));
    expect(deleteLike).toEqual([]);
  });
});
