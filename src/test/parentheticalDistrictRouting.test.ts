import { describe, it, expect } from 'vitest';
import type { District, Team } from '../domain/types';
import { buildDistrictNameRegistryLookup } from '../engine/districtRegistry';
import { listUteConferenceScrapedJsonTeamTargets } from '../engine/uteConferenceScrapedJsonAdapter';
import { mapUteScrapedTeamTargetToCanonicalContext } from '../engine/uteConferenceScrapedCanonicalMapping';
import { buildWholeFilePlayerImportPlan } from '../engine/uteConferenceScrapedJsonWholeFileImport';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function district(overrides: Partial<District>): District {
  return {
    districtId: 'x',
    name: 'X',
    mascot: '',
    logoAssetPath: '',
    helmetAssetPath: '',
    primaryColor: '',
    secondaryColor: '',
    status: 'active',
    ...overrides,
  };
}

function team(overrides: Partial<Team> & { teamId: string; teamCode: string }): Team {
  return {
    seasonId: '2026',
    districtId: 'layton',
    ageDivisionId: 'GI',
    draftOrder: 1,
    divisionTeamCount: 1,
    headCoach: null,
    assistantCoaches: [],
    players: [],
    ...overrides,
  };
}

function scrapedTeam(name: string, players: string[]) {
  return {
    team_name: name,
    source_url: `https://ute.example/${name}`,
    players_count: players.length,
    players: players.map((p) => ({ name: p })),
  };
}

/** A GI players file whose single scraped/admin district carries the given teams. */
function giPlayersFile(adminDistrict: string, teams: ReturnType<typeof scrapedTeam>[]) {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'GI League 12',
      age_division_alias: 'GI',
      year: 2026,
      record_type: 'players',
      source_url: 'https://ute.example/players',
    },
    districts: [
      { district: adminDistrict, league: 'GI League 12', teams_count: teams.length, teams },
    ],
  };
}

// Registry with BOTH the scraped/admin district (Alta) and the represented district (Layton).
const altaAndLayton = buildDistrictNameRegistryLookup([
  district({ districtId: 'alta', name: 'Alta' }),
  district({ districtId: 'layton', name: 'Layton' }),
]);
// Registry WITHOUT Layton (so the parenthetical candidate cannot resolve).
const altaOnly = buildDistrictNameRegistryLookup([district({ districtId: 'alta', name: 'Alta' })]);

function firstTargetId(payload: unknown): string {
  return listUteConferenceScrapedJsonTeamTargets(payload)[0].sourceTargetId;
}

// ---------------------------------------------------------------------------
// Canonical mapping
// ---------------------------------------------------------------------------

describe('parenthetical district routing — canonical mapping', () => {
  it('routes "GridIron A1 (Layton)" to the represented Layton district with code A1', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A1 (Layton)', ['Player One'])]);
    const mapping = mapUteScrapedTeamTargetToCanonicalContext(payload, firstTargetId(payload), {
      districtRegistry: altaAndLayton,
    });

    expect(mapping.ok).toBe(true);
    expect(mapping.canonicalContext.districtId).toBe('layton');
    expect(mapping.canonicalContext.teamClassification).toBe('A1');
    // The canonical-context teamId is the lowercased slug form; the materialized team id
    // (case-preserved, "2026-layton-GI-A1") is built and asserted by the whole-file plan test.
    expect(mapping.canonicalContext.teamId).toBe('2026-layton-gi-a1');
    expect(mapping.district.confidence).toBe('high');
  });

  it('captures the routing trail (original label + scraped/admin district) as source evidence', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A1 (Layton)', ['Player One'])]);
    const mapping = mapUteScrapedTeamTargetToCanonicalContext(payload, firstTargetId(payload), {
      districtRegistry: altaAndLayton,
    });

    expect(mapping.parentheticalRouting).toEqual({
      originalTeamLabel: 'GridIron A1 (Layton)',
      baseTeamLabel: 'GridIron A1',
      representedDistrictCandidate: 'Layton',
      representedDistrictId: 'layton',
      sourceDistrictName: 'Alta',
      resolved: true,
    });
  });

  it('blocks (unresolved) when the parenthetical district is not in the registry', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A1 (Layton)', ['Player One'])]);
    const mapping = mapUteScrapedTeamTargetToCanonicalContext(payload, firstTargetId(payload), {
      districtRegistry: altaOnly,
    });

    expect(mapping.ok).toBe(false);
    expect(mapping.canonicalContext.districtId).toBeNull();
    expect(mapping.parentheticalRouting?.resolved).toBe(false);
    expect(
      mapping.issues.some((i) => i.code === 'unresolved-parenthetical-district' && i.severity === 'error')
    ).toBe(true);
  });

  it('leaves non-parenthetical labels on the existing scraped-district behavior', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A3', ['Player One'])]);
    const mapping = mapUteScrapedTeamTargetToCanonicalContext(payload, firstTargetId(payload), {
      districtRegistry: altaAndLayton,
    });

    expect(mapping.parentheticalRouting).toBeNull();
    expect(mapping.canonicalContext.districtId).toBe('alta');
    expect(mapping.canonicalContext.teamClassification).toBe('A3');
  });

  it('does not mutate the payload', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A1 (Layton)', ['Player One'])]);
    const json = JSON.stringify(payload);
    mapUteScrapedTeamTargetToCanonicalContext(payload, firstTargetId(payload), {
      districtRegistry: altaAndLayton,
    });
    expect(JSON.stringify(payload)).toBe(json);
  });
});

// ---------------------------------------------------------------------------
// Whole-file import plan
// ---------------------------------------------------------------------------

describe('parenthetical district routing — whole-file plan', () => {
  it('CREATES the team under Layton (not the scraped Alta district)', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A1 (Layton)', ['Player One'])]);
    const plan = buildWholeFilePlayerImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaAndLayton,
    });

    expect(plan.createCount).toBe(1);
    const created = plan.teamsToCreate[0];
    expect(created.teamId).toBe('2026-layton-GI-A1');
    expect(created.districtId).toBe('layton');
    expect(created.teamCode).toBe('A1');
    expect(created.players.map((p) => p.name)).toEqual(['Player One']);

    // Never a literal parenthetical team and never one under the scraped/admin district.
    expect(plan.teamsToCreate.some((t) => t.districtId === 'alta')).toBe(false);
    expect(plan.teamsToCreate.some((t) => t.teamCode.includes('('))).toBe(false);
    expect(plan.teamsToCreate.some((t) => t.teamId === '2026-alta-GI-A1')).toBe(false);
  });

  it('preserves the source/admin district and original source label in the plan metadata', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A1 (Layton)', ['Player One'])]);
    const plan = buildWholeFilePlayerImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaAndLayton,
    });
    const t = plan.targets[0];

    expect(t.status).toBe('create');
    expect(t.routedFromParenthetical).toBe(true);
    expect(t.teamName).toBe('GridIron A1 (Layton)'); // original source label preserved exactly
    expect(t.sourceDistrictName).toBe('Alta'); // scraped/admin district retained as evidence
    expect(t.representedDistrictName).toBe('Layton');
    expect(t.districtId).toBe('layton'); // represented district drives the team
    expect(t.reasons.join(' ')).toMatch(/Routed to Layton/);
    expect(t.reasons.join(' ')).toMatch(/source district: Alta/);
  });

  it('UPDATES an existing Layton team when the routed target already exists', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A1 (Layton)', ['New Player'])]);
    const existing = [
      team({ teamId: '2026-layton-GI-A1', teamCode: 'A1', players: [{ name: 'Holdover' }] }),
    ];
    const plan = buildWholeFilePlayerImportPlan({
      payload,
      existingTeams: existing,
      districtRegistry: altaAndLayton,
    });

    expect(plan.createCount).toBe(0);
    expect(plan.committableCount).toBe(1);
    expect(plan.targets[0].status).toBe('update');
    expect(plan.committableTargets[0].existingTeam.teamId).toBe('2026-layton-GI-A1');
  });

  it('BLOCKS an unresolved parenthetical district with a clear reason and creates nothing', () => {
    const payload = giPlayersFile('Alta', [scrapedTeam('GridIron A1 (Layton)', ['Player One'])]);
    const plan = buildWholeFilePlayerImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaOnly, // no Layton
    });

    expect(plan.createCount).toBe(0);
    expect(plan.committableCount).toBe(0);
    const t = plan.targets[0];
    expect(t.status).toBe('unresolved-parenthetical-district');
    expect(t.committable).toBe(false);
    expect(t.reasons.join(' ')).toMatch(/Layton/);
    expect(t.reasons.join(' ')).toMatch(/not in the registry/i);
    expect(plan.teamsToCreate).toHaveLength(0);
  });

  it('preserves the PR #72 non-parenthetical create path (Corner Canyon A3 / C1 / C2)', () => {
    const registry = buildDistrictNameRegistryLookup([
      district({ districtId: 'corner-canyon', name: 'Corner Canyon' }),
    ]);
    const payload = giPlayersFile('Corner Canyon', [
      scrapedTeam('GridIron A3', ['A3 One']),
      scrapedTeam('GridIron C1', ['C1 One']),
      scrapedTeam('GridIron C2', ['C2 One']),
    ]);
    const plan = buildWholeFilePlayerImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: registry,
    });

    expect(plan.createCount).toBe(3);
    expect(plan.teamsToCreate.map((t) => t.teamId).sort()).toEqual([
      '2026-corner-canyon-GI-A3',
      '2026-corner-canyon-GI-C1',
      '2026-corner-canyon-GI-C2',
    ]);
    // None routed from a parenthetical.
    expect(plan.targets.every((t) => !t.routedFromParenthetical)).toBe(true);
  });
});
