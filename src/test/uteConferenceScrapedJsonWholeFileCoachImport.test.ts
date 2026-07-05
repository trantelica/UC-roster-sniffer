import { describe, it, expect } from 'vitest';
import type { District, Team } from '../domain/types';
import { loadEmptyWorkspace } from '../data/loadSampleData';
import { buildDistrictNameRegistryLookup } from '../engine/districtRegistry';
import { getMaterializedTeams } from '../engine/filters';
import type { WorkspaceData } from '../engine/workspaceSnapshot';
import {
  buildWholeFileCoachImportPlan,
  commitWholeFileCoachImport,
  undoWholeFileCoachImport,
} from '../engine/uteConferenceScrapedJsonWholeFileCoachImport';

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

type RawCoach = { name: string; title: string | null };

function coachTeam(name: string, coaches: RawCoach[]) {
  return {
    team_name: name,
    source_url: `https://ute.example/${name}`,
    coaches_count: coaches.length,
    coaches: coaches.map((c) =>
      c.title === null ? { name: c.name } : { name: c.name, title: c.title }
    ),
  };
}

/** A PW coaches file whose single scraped/admin district carries the given teams. */
function coachFile(adminDistrict: string, teams: ReturnType<typeof coachTeam>[]) {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'PW League 10',
      age_division_alias: 'PW',
      year: 2026,
      record_type: 'coaches',
      source_url: 'https://ute.example/coaches',
    },
    districts: [
      { district: adminDistrict, league: 'PW League 10', teams_count: teams.length, teams },
    ],
  };
}

/** A coaches file with two same-named admin districts (to force a canonical collision). */
function twoDistrictCoachFile(a: ReturnType<typeof coachTeam>[], b: ReturnType<typeof coachTeam>[]) {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'PW League 10',
      age_division_alias: 'PW',
      year: 2026,
      record_type: 'coaches',
      source_url: 'https://ute.example/coaches',
    },
    districts: [
      { district: 'Alta', league: 'PW League 10', teams_count: a.length, teams: a },
      { district: 'Alta', league: 'PW League 10', teams_count: b.length, teams: b },
    ],
  };
}

const HEAD = 'Head Coach';
const ASST = 'Asst Coach';

const altaRegistry = buildDistrictNameRegistryLookup([district({ districtId: 'alta', name: 'Alta' })]);
const altaAndLayton = buildDistrictNameRegistryLookup([
  district({ districtId: 'alta', name: 'Alta' }),
  district({ districtId: 'layton', name: 'Layton' }),
]);

function existingTeam(overrides: Partial<Team> & { teamId: string; teamCode: string }): Team {
  return {
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'PW',
    draftOrder: 1,
    divisionTeamCount: 1,
    headCoach: null,
    assistantCoaches: [],
    players: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Planning — create
// ---------------------------------------------------------------------------

describe('coach whole-file planning — create', () => {
  it('plans create for a coach-only team and builds a zero-player team with exact staff', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [
        { name: 'John Smith', title: HEAD },
        { name: 'Dana Park', title: ASST },
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaRegistry,
    });

    expect(plan.isCoachFile).toBe(true);
    expect(plan.createCount).toBe(1);
    expect(plan.updateCount).toBe(0);
    expect(plan.canCommit).toBe(true);
    expect(plan.targets[0].status).toBe('create');
    expect(plan.targets[0].coachCount).toBe(2);
    expect(plan.targets[0].headCoachName).toBe('John Smith');
    expect(plan.targets[0].assistantCoachNames).toEqual(['Dana Park']);

    const created = plan.teamsToCreate[0];
    expect(created.teamId).toBe('2026-alta-PW-C1');
    expect(created.players).toEqual([]);
    expect(created.headCoach).toEqual({ name: 'John Smith' });
    expect(created.assistantCoaches).toEqual([{ name: 'Dana Park' }]);
  });

  it('creates ONLY the source-backed team — no theoretical sibling teams', () => {
    const payload = coachFile('Alta', [coachTeam('PeeWee A3', [{ name: 'Lee Roy', title: HEAD }])]);
    const plan = buildWholeFileCoachImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaRegistry,
    });
    expect(plan.teamsToCreate.map((t) => t.teamId)).toEqual(['2026-alta-PW-A3']);
  });

  it('preserves coach names EXACTLY (spacing, punctuation, apostrophes; no dedupe)', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee B2', [
        { name: "O'Brien,  Pat ", title: HEAD },
        { name: 'de la Cruz, José', title: ASST },
        { name: 'de la Cruz, José', title: ASST }, // duplicate assistant — must NOT be deduped
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaRegistry,
    });
    const created = plan.teamsToCreate[0];
    expect(created.headCoach).toEqual({ name: "O'Brien,  Pat " });
    expect(created.assistantCoaches).toEqual([
      { name: 'de la Cruz, José' },
      { name: 'de la Cruz, José' },
    ]);
  });

  it('keeps assistant coaches in source order', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [
        { name: 'First Asst', title: ASST },
        { name: 'Second Asst', title: ASST },
        { name: 'The Head', title: HEAD },
        { name: 'Third Asst', title: ASST },
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaRegistry,
    });
    expect(plan.teamsToCreate[0].assistantCoaches.map((c) => c.name)).toEqual([
      'First Asst',
      'Second Asst',
      'Third Asst',
    ]);
    expect(plan.teamsToCreate[0].headCoach).toEqual({ name: 'The Head' });
  });
});

// ---------------------------------------------------------------------------
// Planning — update
// ---------------------------------------------------------------------------

describe('coach whole-file planning — update', () => {
  it('plans update and replaces ONLY coaching fields, preserving players + identity', () => {
    const existing = existingTeam({
      teamId: '2026-alta-PW-C1',
      teamCode: 'C1',
      draftOrder: 2,
      divisionTeamCount: 5,
      players: [{ name: 'Player One' }, { name: 'Player Two' }],
      headCoach: { name: 'Old Head' },
      assistantCoaches: [{ name: 'Old Asst' }],
    });
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [
        { name: 'New Head', title: HEAD },
        { name: 'New Asst', title: ASST },
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({
      payload,
      existingTeams: [existing],
      districtRegistry: altaRegistry,
    });

    expect(plan.updateCount).toBe(1);
    expect(plan.createCount).toBe(0);
    expect(plan.targets[0].status).toBe('update');

    const updated = plan.teamsToUpdate[0];
    expect(updated.headCoach).toEqual({ name: 'New Head' });
    expect(updated.assistantCoaches).toEqual([{ name: 'New Asst' }]);
    // Everything else preserved exactly.
    expect(updated.players).toEqual([{ name: 'Player One' }, { name: 'Player Two' }]);
    expect(updated.teamId).toBe('2026-alta-PW-C1');
    expect(updated.draftOrder).toBe(2);
    expect(updated.divisionTeamCount).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Role safety
// ---------------------------------------------------------------------------

describe('coach whole-file role safety', () => {
  it('blocks multiple DIFFERENT head coaches (no coach lost)', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [
        { name: 'Head One', title: HEAD },
        { name: 'Head Two', title: HEAD },
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: [], districtRegistry: altaRegistry });
    expect(plan.targets[0].status).toBe('blocked');
    expect(plan.canCommit).toBe(false);
    expect(plan.targets[0].reasons.join(' ')).toMatch(/Multiple different head coaches/i);
    expect(plan.teamsToCreate).toHaveLength(0);
  });

  it('blocks an unrecognized/unsupported role rather than dropping the coach', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [
        { name: 'The Head', title: HEAD },
        { name: 'Coordinator Cody', title: 'Offensive Coordinator' },
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: [], districtRegistry: altaRegistry });
    expect(plan.targets[0].status).toBe('blocked');
    expect(plan.canCommit).toBe(false);
    expect(plan.targets[0].reasons.join(' ')).toMatch(/Coordinator Cody/);
    // The unrecognized coach is retained as evidence in the plan's staff metadata.
    expect(plan.targets[0].staff.map((s) => s.name)).toContain('Coordinator Cody');
  });

  it('blocks a coach row with no name (never silently discarded)', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [
        { name: 'The Head', title: HEAD },
        { name: '   ', title: ASST },
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: [], districtRegistry: altaRegistry });
    expect(plan.targets[0].status).toBe('blocked');
    expect(plan.targets[0].reasons.join(' ')).toMatch(/no name/i);
  });

  it('commits one head plus assistants', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [
        { name: 'The Head', title: HEAD },
        { name: 'Asst A', title: ASST },
        { name: 'Asst B', title: ASST },
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: [], districtRegistry: altaRegistry });
    expect(plan.canCommit).toBe(true);
    expect(plan.targets[0].status).toBe('create');
  });

  it('retains raw source titles in plan metadata', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [{ name: 'John Smith', title: HEAD }]),
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: [], districtRegistry: altaRegistry });
    expect(plan.targets[0].staff).toEqual([{ name: 'John Smith', rawTitle: 'Head Coach', role: 'head' }]);
  });
});

// ---------------------------------------------------------------------------
// Parenthetical routing (PR #73 semantics)
// ---------------------------------------------------------------------------

describe('coach whole-file parenthetical routing', () => {
  it('routes "PeeWee C1 (Layton)" to Layton, retaining the source/admin district', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1 (Layton)', [{ name: 'John Smith', title: HEAD }]),
    ]);
    const plan = buildWholeFileCoachImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaAndLayton,
    });

    expect(plan.createCount).toBe(1);
    const created = plan.teamsToCreate[0];
    expect(created.teamId).toBe('2026-layton-PW-C1');
    expect(created.districtId).toBe('layton');
    expect(created.headCoach).toEqual({ name: 'John Smith' });

    const t = plan.targets[0];
    expect(t.status).toBe('create');
    expect(t.routedFromParenthetical).toBe(true);
    expect(t.teamName).toBe('PeeWee C1 (Layton)');
    expect(t.sourceDistrictName).toBe('Alta');
    expect(t.representedDistrictName).toBe('Layton');
    expect(t.reasons.join(' ')).toMatch(/Routed to Layton/);

    // No literal parenthetical team and none under the scraped/admin district.
    expect(plan.teamsToCreate.some((x) => x.districtId === 'alta')).toBe(false);
    expect(plan.teamsToCreate.some((x) => x.teamCode.includes('('))).toBe(false);
  });

  it('blocks an unresolved parenthetical district with the add-district-first reason', () => {
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1 (Layton)', [{ name: 'John Smith', title: HEAD }]),
    ]);
    const plan = buildWholeFileCoachImportPlan({
      payload,
      existingTeams: [],
      districtRegistry: altaRegistry, // no Layton
    });
    expect(plan.targets[0].status).toBe('unresolved-parenthetical-district');
    expect(plan.canCommit).toBe(false);
    expect(plan.targets[0].reasons.join(' ')).toMatch(/Layton/);
    expect(plan.teamsToCreate).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Collision + non-coach + purity
// ---------------------------------------------------------------------------

describe('coach whole-file collisions and guards', () => {
  it('blocks a duplicate/colliding canonical target rather than merging', () => {
    const payload = twoDistrictCoachFile(
      [coachTeam('PeeWee C1', [{ name: 'Head A', title: HEAD }])],
      [coachTeam('PeeWee C1', [{ name: 'Head B', title: HEAD }])]
    );
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: [], districtRegistry: altaRegistry });
    expect(plan.createCount).toBe(1);
    const dup = plan.targets.find((t) => t.status === 'duplicate-target');
    expect(dup).toBeDefined();
    expect(plan.canCommit).toBe(false);
    expect(dup?.reasons.join(' ')).toMatch(/2026-alta-PW-C1/);
  });

  it('is not a coach file when given a players payload', () => {
    const playersPayload = {
      metadata: { organization: 'Ute Conference', age_division: 'PW League 10', year: 2026, record_type: 'players' },
      districts: [
        { district: 'Alta', league: 'PW League 10', teams_count: 1, teams: [{ team_name: 'PeeWee C1', players: [{ name: 'X' }] }] },
      ],
    };
    const plan = buildWholeFileCoachImportPlan({ payload: playersPayload, existingTeams: [], districtRegistry: altaRegistry });
    expect(plan.isCoachFile).toBe(false);
    expect(plan.canCommit).toBe(false);
    expect(plan.teamsToCreate).toHaveLength(0);
  });

  it('does not mutate its inputs', () => {
    const payload = coachFile('Alta', [coachTeam('PeeWee C1', [{ name: 'John Smith', title: HEAD }])]);
    const payloadJson = JSON.stringify(payload);
    const existing = [existingTeam({ teamId: '2026-alta-PW-C1', teamCode: 'C1', players: [{ name: 'P' }] })];
    const existingJson = JSON.stringify(existing);
    buildWholeFileCoachImportPlan({ payload, existingTeams: existing, districtRegistry: altaRegistry });
    expect(JSON.stringify(payload)).toBe(payloadJson);
    expect(JSON.stringify(existing)).toBe(existingJson);
  });
});

// ---------------------------------------------------------------------------
// Commit + undo transaction
// ---------------------------------------------------------------------------

const emptyWorkspace = (): WorkspaceData => loadEmptyWorkspace();
function withLayton(ws: WorkspaceData): WorkspaceData {
  return { ...ws, districts: [...ws.districts, district({ districtId: 'layton', name: 'Layton' })] };
}
const registryFor = (ws: WorkspaceData) => buildDistrictNameRegistryLookup(ws.districts);

describe('coach whole-file commit + undo', () => {
  it('preview does not mutate the workspace; commit creates a materialized coach-only team', () => {
    const ws = emptyWorkspace();
    const wsJson = JSON.stringify(ws);
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [
        { name: 'John Smith', title: HEAD },
        { name: 'Dana Park', title: ASST },
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: ws.teams, districtRegistry: registryFor(ws) });

    // Preview only — no workspace change.
    expect(JSON.stringify(ws)).toBe(wsJson);
    expect(ws.teams).toHaveLength(0);

    const commit = commitWholeFileCoachImport(ws, plan);
    expect(commit.committed).toBe(true);
    if (!commit.committed) return;
    expect(commit.summary.teamsCreated).toBe(1);
    expect(commit.summary.coachingStaffImported).toBe(2);

    const team = commit.workspace.teams.find((t) => t.teamId === '2026-alta-PW-C1');
    expect(team).toBeDefined();
    expect(team?.players).toEqual([]);
    expect(team?.headCoach).toEqual({ name: 'John Smith' });
    // Coach-only team is materialized (appears in normal team selection).
    expect(getMaterializedTeams(commit.workspace.teams).some((t) => t.teamId === '2026-alta-PW-C1')).toBe(true);
  });

  it('refuses the whole-file commit when ANY target is blocked (all-or-nothing)', () => {
    const ws = emptyWorkspace();
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [{ name: 'John Smith', title: HEAD }]),
      coachTeam('PeeWee A3', [
        { name: 'Head One', title: HEAD },
        { name: 'Head Two', title: HEAD }, // blocks this target
      ]),
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: ws.teams, districtRegistry: registryFor(ws) });
    expect(plan.blockedCount).toBe(1);
    const commit = commitWholeFileCoachImport(ws, plan);
    expect(commit.committed).toBe(false);
    if (commit.committed) return;
    expect(commit.reason).toBe('blocked-targets');
    // Nothing changed.
    expect(commit.workspace.teams).toHaveLength(0);
  });

  it('undo removes created teams and restores prior coaching fields, leaving players intact', () => {
    const ws0 = emptyWorkspace();
    const ws: WorkspaceData = {
      ...ws0,
      teams: [
        {
          teamId: '2026-alta-PW-C1', seasonId: '2026', districtId: 'alta', ageDivisionId: 'PW',
          teamCode: 'C1', draftOrder: 1, divisionTeamCount: 1, headCoach: { name: 'Old Head' },
          assistantCoaches: [{ name: 'Old Asst' }], players: [{ name: 'Player One' }],
        },
      ],
    };
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1', [{ name: 'New Head', title: HEAD }]), // update existing
      coachTeam('PeeWee A3', [{ name: 'Lee Roy', title: HEAD }]), // create new
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: ws.teams, districtRegistry: registryFor(ws) });
    expect(plan.createCount).toBe(1);
    expect(plan.updateCount).toBe(1);

    const commit = commitWholeFileCoachImport(ws, plan);
    if (!commit.committed) throw new Error('expected commit');
    expect(commit.workspace.teams).toHaveLength(2);
    const updated = commit.workspace.teams.find((t) => t.teamId === '2026-alta-PW-C1');
    expect(updated?.headCoach).toEqual({ name: 'New Head' });
    expect(updated?.players).toEqual([{ name: 'Player One' }]); // players untouched

    const undo = undoWholeFileCoachImport(commit.workspace, commit.previousTeams, commit.createdTeamIds);
    expect(undo.restored).toBe(true);
    if (!undo.restored) return;
    expect(undo.workspace.teams).toHaveLength(1); // created A3 removed
    const restored = undo.workspace.teams.find((t) => t.teamId === '2026-alta-PW-C1');
    expect(restored?.headCoach).toEqual({ name: 'Old Head' }); // coaching restored
    expect(restored?.assistantCoaches).toEqual([{ name: 'Old Asst' }]);
    expect(restored?.players).toEqual([{ name: 'Player One' }]); // players preserved
  });

  it('commits a parenthetical-routed coach team under Layton', () => {
    const ws = withLayton(emptyWorkspace());
    const payload = coachFile('Alta', [
      coachTeam('PeeWee C1 (Layton)', [{ name: 'John Smith', title: HEAD }]),
    ]);
    const plan = buildWholeFileCoachImportPlan({ payload, existingTeams: ws.teams, districtRegistry: registryFor(ws) });
    const commit = commitWholeFileCoachImport(ws, plan);
    expect(commit.committed).toBe(true);
    if (!commit.committed) return;
    expect(commit.workspace.teams.find((t) => t.teamId === '2026-layton-PW-C1')).toBeDefined();
    expect(commit.workspace.teams.some((t) => t.districtId === 'alta')).toBe(false);
  });
});
