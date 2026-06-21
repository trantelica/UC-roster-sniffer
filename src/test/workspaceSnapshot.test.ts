import { describe, it, expect } from 'vitest';
import type { AgeDivision, District, Game, Team } from '../domain/types';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  validateWorkspaceSnapshot,
  restoreWorkspaceFromSnapshot,
  WORKSPACE_SNAPSHOT_KIND,
  WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
  type WorkspaceState,
  type WorkspaceSnapshot,
} from '../engine/workspaceSnapshot';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function district(districtId: string, name: string): District {
  return {
    districtId,
    name,
    mascot: 'Mascot',
    logoAssetPath: 'logo.png',
    helmetAssetPath: 'helmet.png',
    primaryColor: '#000000',
    secondaryColor: '#ffffff',
  };
}

function ageDivision(ageDivisionId: string): AgeDivision {
  return {
    ageDivisionId,
    name: ageDivisionId,
    leagueLabel: `${ageDivisionId} League`,
    ordinal: 1,
    typicalAges: [9, 10],
  };
}

function team(
  teamId: string,
  seasonId: string,
  playerNames: string[],
  overrides: Partial<Team> = {}
): Team {
  return {
    teamId,
    seasonId,
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 1,
    headCoach: { name: 'Coach One' },
    assistantCoaches: [{ name: 'Assistant One' }],
    players: playerNames.map((name) => ({ name })),
    ...overrides,
  };
}

function workspaceState(): WorkspaceState {
  return {
    districts: [district('alta', 'Alta'), district('brighton', 'Brighton')],
    ageDivisions: [ageDivision('GR'), ageDivision('PW')],
    teams: [
      team('2025-alta-GR-B1', '2025', ['Jordan Smith', 'Taylor Johnson']),
      team('2026-alta-GR-B1', '2026', ['Jordan Smith', 'Brand New', 'Cary, Hudson']),
    ],
    games: [],
    selection: {
      seasonId: '2026',
      districtId: 'alta',
      ageDivisionId: 'GR',
      teamId: '2026-alta-GR-B1',
    },
  };
}

const GENERATED_AT = '2026-06-20T00:00:00.000Z';

function sampleGame(overrides: Partial<Game> & Pick<Game, 'gameId'>): Game {
  return {
    seasonId: '2026',
    ageDivisionId: 'GR',
    weekLabel: 'Week 1',
    scheduledDate: '2026-08-22',
    homeTeamId: '2026-alta-GR-B1',
    awayTeamId: '2025-alta-GR-B1',
    status: 'scheduled',
    ...overrides,
  };
}

function workspaceWithGames(): WorkspaceState {
  return {
    ...workspaceState(),
    games: [
      sampleGame({
        gameId: 'g-final',
        status: 'final',
        homeTeamId: '2026-alta-GR-B1',
        awayTeamId: '2025-alta-GR-B1',
        homeScore: 21,
        awayScore: 14,
      }),
      sampleGame({ gameId: 'g-scheduled', status: 'scheduled' }),
    ],
  };
}

describe('workspace snapshot builder', () => {
  it('builds a valid snapshot from current workspace state', () => {
    const snapshot = buildWorkspaceSnapshot({
      workspace: workspaceState(),
      generatedAt: GENERATED_AT,
    });
    expect(snapshot.snapshotKind).toBe(WORKSPACE_SNAPSHOT_KIND);
    expect(snapshot.schemaVersion).toBe(WORKSPACE_SNAPSHOT_SCHEMA_VERSION);
    expect(snapshot.source).toBe('user-exported-json');
    expect(snapshot.generatedAt).toBe(GENERATED_AT);
    expect(snapshot.selection.teamId).toBe('2026-alta-GR-B1');
  });

  it('includes executed in-memory additions when present in current state', () => {
    // Simulate a slice-22 executed roster: the additions are already baked into teams.
    const ws = workspaceState();
    ws.teams = [
      team('2026-alta-GR-B1', '2026', [
        'Jordan Smith',
        'Brand New',
        'Cary, Hudson',
        'Executed Addition',
      ]),
    ];
    const snapshot = buildWorkspaceSnapshot({ workspace: ws, generatedAt: GENERATED_AT });
    expect(snapshot.workspace.teams[0].players.map((p) => p.name)).toContain(
      'Executed Addition'
    );
    expect(snapshot.summary.playerCount).toBe(4);
  });

  it('preserves roster/player names exactly', () => {
    const ws = workspaceState();
    const snapshot = buildWorkspaceSnapshot({ workspace: ws, generatedAt: GENERATED_AT });
    expect(snapshot.workspace.teams[1].players.map((p) => p.name)).toEqual([
      'Jordan Smith',
      'Brand New',
      'Cary, Hudson',
    ]);
  });

  it('does not mutate the input workspace state', () => {
    const ws = workspaceState();
    const before = JSON.stringify(ws);
    const snapshot = buildWorkspaceSnapshot({ workspace: ws, generatedAt: GENERATED_AT });
    // Mutating the snapshot must not affect the input (no shared references).
    snapshot.workspace.teams[0].players.push({ name: 'Mutant' });
    expect(JSON.stringify(ws)).toBe(before);
  });

  it('uses caller-supplied generatedAt deterministically', () => {
    const ws = workspaceState();
    const a = buildWorkspaceSnapshot({ workspace: ws, generatedAt: GENERATED_AT });
    const b = buildWorkspaceSnapshot({ workspace: ws, generatedAt: GENERATED_AT });
    expect(a).toEqual(b);
    expect(a.generatedAt).toBe(GENERATED_AT);
    expect(a.summary.generatedAt).toBe(GENERATED_AT);
  });

  it('computes correct summary counts', () => {
    const snapshot = buildWorkspaceSnapshot({
      workspace: workspaceState(),
      generatedAt: GENERATED_AT,
    });
    expect(snapshot.summary).toEqual({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      generatedAt: GENERATED_AT,
      seasonCount: 2,
      districtCount: 2,
      ageDivisionCount: 2,
      teamCount: 2,
      playerCount: 5,
      gameCount: 0,
    });
  });

  it('round-trips through JSON to a valid snapshot', () => {
    const snapshot = buildWorkspaceSnapshot({
      workspace: workspaceState(),
      generatedAt: GENERATED_AT,
    });
    const result = parseWorkspaceSnapshotJson(JSON.stringify(snapshot));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.workspace.teams.map((t) => t.teamId)).toEqual([
        '2025-alta-GR-B1',
        '2026-alta-GR-B1',
      ]);
    }
  });
});

describe('workspace snapshot validation', () => {
  function validSnapshotJson(): string {
    return JSON.stringify(
      buildWorkspaceSnapshot({ workspace: workspaceState(), generatedAt: GENERATED_AT })
    );
  }

  it('parses a valid snapshot JSON', () => {
    const result = parseWorkspaceSnapshotJson(validSnapshotJson());
    expect(result.ok).toBe(true);
  });

  it('rejects invalid JSON', () => {
    const result = parseWorkspaceSnapshotJson('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid-json');
  });

  it('rejects a non-object', () => {
    const result = validateWorkspaceSnapshot(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('not-an-object');
  });

  it('rejects a missing schemaVersion', () => {
    const result = validateWorkspaceSnapshot({ snapshotKind: 'workspace', workspace: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('missing-schema-version');
  });

  it('rejects an unsupported schemaVersion', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: 999,
      snapshotKind: 'workspace',
      workspace: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('unsupported-schema-version');
  });

  it('rejects the wrong snapshotKind (e.g. a preview artifact)', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      snapshotKind: 'uc-roster-sniffer:scraped-json-import-preview-artifact',
      workspace: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('wrong-snapshot-kind');
  });

  it('rejects structurally invalid workspace data (bad team)', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      snapshotKind: 'workspace',
      workspace: {
        districts: [],
        ageDivisions: [],
        teams: [{ teamId: '', players: [] }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid-teams');
  });

  it('rejects non-array workspace collections', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      snapshotKind: 'workspace',
      workspace: { districts: {}, ageDivisions: [], teams: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain('invalid-districts');
  });

  it('rejects an empty-workspace snapshot (no teams)', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      snapshotKind: 'workspace',
      workspace: { districts: [], ageDivisions: [], teams: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('empty-workspace');
  });

  it('does not mutate the input value during validation', () => {
    const raw = JSON.parse(validSnapshotJson());
    const before = JSON.stringify(raw);
    validateWorkspaceSnapshot(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('preserves data exactly when valid', () => {
    const result = parseWorkspaceSnapshotJson(validSnapshotJson());
    if (!result.ok) throw new Error('expected ok');
    expect(result.snapshot.workspace.teams[1].players.map((p) => p.name)).toEqual([
      'Jordan Smith',
      'Brand New',
      'Cary, Hudson',
    ]);
    expect(result.snapshot.workspace.districts.map((d) => d.districtId)).toEqual([
      'alta',
      'brighton',
    ]);
  });
});

describe('workspace snapshot restore', () => {
  function snapshot(): WorkspaceSnapshot {
    return buildWorkspaceSnapshot({
      workspace: workspaceState(),
      generatedAt: GENERATED_AT,
    });
  }

  it('restores the workspace as a replacement (full data present, not merged)', () => {
    const restored = restoreWorkspaceFromSnapshot(snapshot());
    expect(restored.workspace.teams.map((t) => t.teamId)).toEqual([
      '2025-alta-GR-B1',
      '2026-alta-GR-B1',
    ]);
    expect(restored.workspace.districts).toHaveLength(2);
    expect(restored.summary.playerCount).toBe(5);
  });

  it('does not mutate the snapshot when restoring', () => {
    const snap = snapshot();
    const before = JSON.stringify(snap);
    const restored = restoreWorkspaceFromSnapshot(snap);
    restored.workspace.teams[0].players.push({ name: 'Mutant' });
    expect(JSON.stringify(snap)).toBe(before);
  });

  it('restores the active team selection when it still exists', () => {
    const restored = restoreWorkspaceFromSnapshot(snapshot());
    expect(restored.selection).toEqual({
      seasonId: '2026',
      districtId: 'alta',
      ageDivisionId: 'GR',
      teamId: '2026-alta-GR-B1',
    });
  });

  it('falls back to the most recent season when the selected team is missing', () => {
    const snap = snapshot();
    const tampered: WorkspaceSnapshot = {
      ...snap,
      selection: { ...snap.selection, teamId: 'does-not-exist' },
    };
    const restored = restoreWorkspaceFromSnapshot(tampered);
    expect(restored.selection).toEqual({
      seasonId: '2026',
      districtId: null,
      ageDivisionId: null,
      teamId: null,
    });
  });

  it('round-trips build -> JSON -> parse -> restore preserving roster data', () => {
    const json = JSON.stringify(snapshot());
    const parsed = parseWorkspaceSnapshotJson(json);
    if (!parsed.ok) throw new Error('expected ok');
    const restored = restoreWorkspaceFromSnapshot(parsed.snapshot);
    expect(restored.workspace.teams[1].players.map((p) => p.name)).toEqual([
      'Jordan Smith',
      'Brand New',
      'Cary, Hudson',
    ]);
  });
});

describe('workspace snapshot schedules/results (slice 24)', () => {
  it('exported snapshot includes schedules/results with a game count', () => {
    const snapshot = buildWorkspaceSnapshot({
      workspace: workspaceWithGames(),
      generatedAt: GENERATED_AT,
    });
    expect(snapshot.workspace.games.map((g) => g.gameId)).toEqual([
      'g-final',
      'g-scheduled',
    ]);
    expect(snapshot.summary.gameCount).toBe(2);
  });

  it('a valid snapshot with games imports and restores them exactly', () => {
    const json = JSON.stringify(
      buildWorkspaceSnapshot({ workspace: workspaceWithGames(), generatedAt: GENERATED_AT })
    );
    const parsed = parseWorkspaceSnapshotJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = restoreWorkspaceFromSnapshot(parsed.snapshot);
    expect(restored.workspace.games).toHaveLength(2);
    const final = restored.workspace.games.find((g) => g.gameId === 'g-final')!;
    expect(final.homeScore).toBe(21);
    expect(final.awayScore).toBe(14);
    expect(final.status).toBe('final');
  });

  it('an older snapshot without a games field imports with an empty schedule', () => {
    // Simulate a slice-23 snapshot: build then strip the games field from the JSON.
    const raw = JSON.parse(
      JSON.stringify(
        buildWorkspaceSnapshot({ workspace: workspaceState(), generatedAt: GENERATED_AT })
      )
    );
    delete raw.workspace.games;
    delete raw.summary.gameCount;
    const result = validateWorkspaceSnapshot(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.workspace.games).toEqual([]);
    expect(result.snapshot.summary.gameCount).toBe(0);
    const restored = restoreWorkspaceFromSnapshot(result.snapshot);
    expect(restored.workspace.games).toEqual([]);
  });

  it('rejects structurally invalid game data', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      snapshotKind: 'workspace',
      workspace: {
        districts: [],
        ageDivisions: [],
        teams: [
          {
            teamId: '2026-alta-GR-B1',
            seasonId: '2026',
            districtId: 'alta',
            ageDivisionId: 'GR',
            teamCode: 'B1',
            draftOrder: 1,
            divisionTeamCount: 1,
            headCoach: null,
            assistantCoaches: [],
            players: [],
          },
        ],
        games: [{ gameId: 'bad', status: 'final' }],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid-games');
  });

  it('rejects a game referencing a team not in the snapshot', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      snapshotKind: 'workspace',
      workspace: {
        districts: [],
        ageDivisions: [],
        teams: [
          {
            teamId: '2026-alta-GR-B1',
            seasonId: '2026',
            districtId: 'alta',
            ageDivisionId: 'GR',
            teamCode: 'B1',
            draftOrder: 1,
            divisionTeamCount: 1,
            headCoach: null,
            assistantCoaches: [],
            players: [],
          },
        ],
        games: [
          {
            gameId: 'g1',
            seasonId: '2026',
            weekLabel: 'Week 1',
            scheduledDate: '2026-08-22',
            homeTeamId: '2026-alta-GR-B1',
            awayTeamId: 'ghost-team',
            status: 'scheduled',
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('unresolved-game-reference');
  });

  it('rejects a final game missing usable scores', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      snapshotKind: 'workspace',
      workspace: {
        districts: [],
        ageDivisions: [],
        teams: [
          {
            teamId: '2026-alta-GR-B1',
            seasonId: '2026',
            districtId: 'alta',
            ageDivisionId: 'GR',
            teamCode: 'B1',
            draftOrder: 1,
            divisionTeamCount: 1,
            headCoach: null,
            assistantCoaches: [],
            players: [],
          },
        ],
        games: [
          {
            gameId: 'g1',
            seasonId: '2026',
            weekLabel: 'Week 1',
            scheduledDate: '2026-08-22',
            homeTeamId: '2026-alta-GR-B1',
            awayTeamId: '2026-alta-GR-B1',
            status: 'final',
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid-games');
  });

  it('restore replaces games rather than merging', () => {
    // Snapshot A has 2 games; restoring it yields exactly those 2, not a union.
    const restored = restoreWorkspaceFromSnapshot(
      buildWorkspaceSnapshot({ workspace: workspaceWithGames(), generatedAt: GENERATED_AT })
    );
    expect(restored.workspace.games.map((g) => g.gameId)).toEqual([
      'g-final',
      'g-scheduled',
    ]);
  });

  it('does not mutate input games when building a snapshot', () => {
    const ws = workspaceWithGames();
    const before = JSON.stringify(ws.games);
    const snapshot = buildWorkspaceSnapshot({ workspace: ws, generatedAt: GENERATED_AT });
    snapshot.workspace.games[0].homeScore = 999;
    expect(JSON.stringify(ws.games)).toBe(before);
  });
});

describe('workspace snapshot game context (slice 26)', () => {
  function workspaceWithContextGame(): WorkspaceState {
    return {
      ...workspaceState(),
      games: [
        sampleGame({
          gameId: 'g-champ',
          status: 'final',
          homeScore: 20,
          awayScore: 14,
          isPlayoff: true,
          isChampionship: true,
          isNeutralSite: true,
        }),
      ],
    };
  }

  it('preserves neutral/playoff/championship fields through build -> parse -> restore', () => {
    const json = JSON.stringify(
      buildWorkspaceSnapshot({ workspace: workspaceWithContextGame(), generatedAt: GENERATED_AT })
    );
    const parsed = parseWorkspaceSnapshotJson(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const restored = restoreWorkspaceFromSnapshot(parsed.snapshot);
    const game = restored.workspace.games.find((g) => g.gameId === 'g-champ')!;
    expect(game.isPlayoff).toBe(true);
    expect(game.isChampionship).toBe(true);
    expect(game.isNeutralSite).toBe(true);
  });

  it('rejects an invalid context field type', () => {
    const result = validateWorkspaceSnapshot({
      schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
      snapshotKind: 'workspace',
      workspace: {
        districts: [],
        ageDivisions: [],
        teams: [
          {
            teamId: '2026-alta-GR-B1', seasonId: '2026', districtId: 'alta', ageDivisionId: 'GR',
            teamCode: 'B1', draftOrder: 1, divisionTeamCount: 1, headCoach: null,
            assistantCoaches: [], players: [],
          },
        ],
        games: [
          {
            gameId: 'g1', seasonId: '2026', weekLabel: 'Week 1', scheduledDate: '2026-08-22',
            homeTeamId: '2026-alta-GR-B1', awayTeamId: '2026-alta-GR-B1', status: 'scheduled',
            isPlayoff: 'yes',
          },
        ],
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid-games');
  });

  it('an older snapshot without context fields still restores (fields absent)', () => {
    const json = JSON.stringify(
      buildWorkspaceSnapshot({ workspace: workspaceWithGames(), generatedAt: GENERATED_AT })
    );
    const parsed = parseWorkspaceSnapshotJson(json);
    if (!parsed.ok) throw new Error('expected ok');
    const restored = restoreWorkspaceFromSnapshot(parsed.snapshot);
    const game = restored.workspace.games.find((g) => g.gameId === 'g-final')!;
    expect(game.isPlayoff).toBeUndefined();
    expect(game.isChampionship).toBeUndefined();
    expect(game.isNeutralSite).toBeUndefined();
  });
});
