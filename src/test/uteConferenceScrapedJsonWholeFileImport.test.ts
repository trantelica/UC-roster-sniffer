import { describe, it, expect } from 'vitest';
import type { District, Team } from '../domain/types';
import {
  buildWholeFilePlayerImportPlan,
  executeWholeFilePlayerImportBatch,
} from '../engine/uteConferenceScrapedJsonWholeFileImport';
import { buildDistrictNameRegistryLookup } from '../engine/districtRegistry';

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
    ...overrides,
  };
}

function team(overrides: Partial<Team> & { teamId: string; teamCode: string }): Team {
  return {
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GR',
    draftOrder: 1,
    divisionTeamCount: 3,
    headCoach: null,
    assistantCoaches: [],
    players: [],
    ...overrides,
  };
}

/** One scraped team under a district. */
function scrapedTeam(name: string, players: string[]) {
  return {
    team_name: name,
    source_url: `https://ute.example/${name}`,
    players_count: players.length,
    players: players.map((p) => ({ name: p })),
  };
}

/** A players file with a single district carrying several teams. */
function playersFile(districtName: string, teams: ReturnType<typeof scrapedTeam>[]) {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'GR League 9',
      age_division_alias: 'GR',
      year: 2026,
      record_type: 'players',
      source_url: 'https://ute.example/players',
    },
    districts: [
      {
        district: districtName,
        league: 'GR League 9',
        teams_count: teams.length,
        teams,
      },
    ],
  };
}

const altaRegistry = buildDistrictNameRegistryLookup([
  district({ districtId: 'alta', name: 'Alta', status: 'active' }),
]);

// A file with three Alta GR teams:
//  B1 — two brand-new players (committable)
//  B2 — one brand-new player (committable)
//  B3 — one player that exactly matches an existing roster name (match-bearing → needs review)
function threeTeamFile() {
  return playersFile('Alta', [
    scrapedTeam('Gremlin B1', ['New Alpha', 'New Beta']),
    scrapedTeam('Gremlin B2', ['New Gamma']),
    scrapedTeam('Gremlin B3', ['Existing Three', 'New Delta']),
  ]);
}

function threeTeamWorkspace(): Team[] {
  return [
    team({ teamId: 'wt-b1', teamCode: 'B1', players: [{ name: 'Holdover One' }] }),
    team({ teamId: 'wt-b2', teamCode: 'B2', players: [{ name: 'Holdover Two' }] }),
    team({ teamId: 'wt-b3', teamCode: 'B3', players: [{ name: 'Existing Three' }] }),
  ];
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

describe('whole-file player import planning', () => {
  it('identifies multiple ready player team targets in one file', () => {
    const plan = buildWholeFilePlayerImportPlan({
      payload: threeTeamFile(),
      existingTeams: threeTeamWorkspace(),
      districtRegistry: altaRegistry,
    });
    expect(plan.isPlayerFile).toBe(true);
    expect(plan.playerTargetCount).toBe(3);
    expect(plan.committableCount).toBe(2);
    const committableTeamIds = plan.committableTargets.map((t) => t.existingTeam.teamId).sort();
    expect(committableTeamIds).toEqual(['wt-b1', 'wt-b2']);
    expect(plan.totalProjectedAdditions).toBe(3); // 2 + 1
  });

  it('skips match-bearing / unresolved teams (never committed) and reports them', () => {
    const plan = buildWholeFilePlayerImportPlan({
      payload: threeTeamFile(),
      existingTeams: threeTeamWorkspace(),
      districtRegistry: altaRegistry,
    });
    const b3 = plan.targets.find((t) => t.teamClassification === 'B3');
    expect(b3?.committable).toBe(false);
    expect(b3?.status).toBe('needs-review');
    expect(plan.skippedCount).toBe(1);
    expect(plan.needsReviewCount).toBe(1);
    // The match-bearing team is NOT in the committable execution list.
    expect(plan.committableTargets.some((t) => t.existingTeam.teamId === 'wt-b3')).toBe(false);
  });

  it('skips a team whose district is provisional/unknown until it is confirmed', () => {
    // Existing team is in district "granger", but the registry has no such district.
    const existing = [team({ teamId: 'wt-g', teamCode: 'B1', districtId: 'granger', players: [] })];
    const file = playersFile('Granger', [scrapedTeam('Gremlin B1', ['New One'])]);

    const before = buildWholeFilePlayerImportPlan({
      payload: file,
      existingTeams: existing,
      districtRegistry: altaRegistry, // no Granger
    });
    const t = before.targets[0];
    expect(t.status).toBe('provisional-district');
    expect(t.committable).toBe(false);
    expect(before.committableCount).toBe(0);
    expect(before.provisionalDistrictCount).toBe(1);

    // After confirming/registering Granger, the same team becomes committable on re-plan.
    const registry = buildDistrictNameRegistryLookup([
      district({ districtId: 'granger', name: 'Granger', status: 'active' }),
    ]);
    const after = buildWholeFilePlayerImportPlan({
      payload: file,
      existingTeams: existing,
      districtRegistry: registry,
    });
    expect(after.targets[0].status).toBe('committable');
    expect(after.committableCount).toBe(1);
  });

  it('treats an inactive registered district as provisional (excluded from mapping)', () => {
    const existing = [team({ teamId: 'wt-b1', teamCode: 'B1', players: [] })];
    const file = playersFile('Alta', [scrapedTeam('Gremlin B1', ['New One'])]);
    const inactiveRegistry = buildDistrictNameRegistryLookup([
      district({ districtId: 'alta', name: 'Alta', status: 'inactive' }),
    ]);
    const plan = buildWholeFilePlayerImportPlan({
      payload: file,
      existingTeams: existing,
      districtRegistry: inactiveRegistry,
    });
    expect(plan.targets[0].status).toBe('provisional-district');
    expect(plan.committableCount).toBe(0);
  });

  it('skips a scraped team with no matching workspace team', () => {
    const file = playersFile('Alta', [scrapedTeam('Gremlin B1', ['New One'])]);
    const plan = buildWholeFilePlayerImportPlan({
      payload: file,
      existingTeams: [], // no workspace team for the context
      districtRegistry: altaRegistry,
    });
    expect(plan.targets[0].status).toBe('no-existing-team');
    expect(plan.committableCount).toBe(0);
    expect(plan.noExistingTeamCount).toBe(1);
  });

  it('does not commit a coach (non-player) file', () => {
    const coachFile = {
      metadata: {
        organization: 'Ute Conference',
        event: '2026',
        age_division: 'GR League 9',
        year: 2026,
        record_type: 'coaches',
        source_url: 'https://ute.example/coaches',
      },
      districts: [
        {
          district: 'Alta',
          league: 'GR League 9',
          teams_count: 1,
          teams: [
            {
              team_name: 'Gremlin B1',
              source_url: 'https://ute.example/c',
              coaches_count: 1,
              coaches: [{ name: 'Coach One', title: 'Head Coach' }],
            },
          ],
        },
      ],
    };
    const plan = buildWholeFilePlayerImportPlan({
      payload: coachFile,
      existingTeams: threeTeamWorkspace(),
      districtRegistry: altaRegistry,
    });
    expect(plan.isPlayerFile).toBe(false);
    expect(plan.committableCount).toBe(0);
  });

  it('does not mutate its inputs', () => {
    const payload = threeTeamFile();
    const payloadJson = JSON.stringify(payload);
    const existing = threeTeamWorkspace();
    const existingJson = JSON.stringify(existing);
    buildWholeFilePlayerImportPlan({ payload, existingTeams: existing, districtRegistry: altaRegistry });
    expect(JSON.stringify(payload)).toBe(payloadJson);
    expect(JSON.stringify(existing)).toBe(existingJson);
  });
});

// ---------------------------------------------------------------------------
// Batch execution
// ---------------------------------------------------------------------------

describe('whole-file batch execution', () => {
  it('executes all committable teams, appending only planned additions in order', () => {
    const plan = buildWholeFilePlayerImportPlan({
      payload: threeTeamFile(),
      existingTeams: threeTeamWorkspace(),
      districtRegistry: altaRegistry,
    });
    const result = executeWholeFilePlayerImportBatch({
      committableTargets: plan.committableTargets,
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    expect(result.status).toBe('executed');
    if (result.status !== 'executed') return;
    expect(result.teamsCommitted).toBe(2);
    expect(result.totalAdded).toBe(3);

    const b1 = result.committedTeams.find((t) => t.teamId === 'wt-b1');
    // Existing record preserved exactly and first, additions appended in source order.
    expect(b1?.players.map((p) => p.name)).toEqual(['Holdover One', 'New Alpha', 'New Beta']);
    const b2 = result.committedTeams.find((t) => t.teamId === 'wt-b2');
    expect(b2?.players.map((p) => p.name)).toEqual(['Holdover Two', 'New Gamma']);
  });

  it('is all-or-nothing: a single execution failure yields no committed teams', () => {
    const plan = buildWholeFilePlayerImportPlan({
      payload: threeTeamFile(),
      existingTeams: threeTeamWorkspace(),
      districtRegistry: altaRegistry,
    });
    // Corrupt one committable target so its existing team mismatches the plan target.
    const corrupted = plan.committableTargets.map((t, i) =>
      i === 0 ? { ...t, existingTeam: { ...t.existingTeam, teamId: 'mismatched-id' } } : t
    );
    const result = executeWholeFilePlayerImportBatch({
      committableTargets: corrupted,
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.failedTargetId).toBe(plan.committableTargets[0].sourceTargetId);
    }
  });

  it('returns nothing-to-commit for an empty committable list', () => {
    const result = executeWholeFilePlayerImportBatch({
      committableTargets: [],
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    expect(result.status).toBe('nothing-to-commit');
  });

  it('does not duplicate an existing player (match-bearing teams are skipped, not linked)', () => {
    // The B3 team has a row matching "Existing Three"; it is skipped, so committing the
    // batch never touches wt-b3 and never duplicates that existing record.
    const plan = buildWholeFilePlayerImportPlan({
      payload: threeTeamFile(),
      existingTeams: threeTeamWorkspace(),
      districtRegistry: altaRegistry,
    });
    const result = executeWholeFilePlayerImportBatch({
      committableTargets: plan.committableTargets,
      generatedAt: '2026-06-28T00:00:00.000Z',
    });
    if (result.status !== 'executed') throw new Error('expected executed');
    expect(result.committedTeams.some((t) => t.teamId === 'wt-b3')).toBe(false);
  });
});
