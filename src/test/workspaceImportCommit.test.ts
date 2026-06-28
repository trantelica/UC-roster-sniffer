import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
  getUteScrapedJsonImportSessionSelectableTargets,
} from '../engine/uteConferenceScrapedJsonImportSession';
import {
  buildScrapedJsonImportRosterAwareReview,
  findExistingRosterTeamForContext,
  type ScrapedImportReviewDecisionMap,
  type ScrapedImportRosterAwareReview,
} from '../engine/uteConferenceScrapedJsonImportRosterAwareReview';
import { buildScrapedJsonImportStagedProjection } from '../engine/uteConferenceScrapedJsonImportStagedProjection';
import { buildScrapedJsonImportFutureCommitReadiness } from '../engine/uteConferenceScrapedJsonImportFutureReadiness';
import { buildScrapedJsonImportTransactionPlan } from '../engine/uteConferenceScrapedJsonImportTransactionPlan';
import { executeUteConferenceScrapedJsonImportTransaction } from '../engine/uteConferenceScrapedJsonImportExecution';
import {
  commitImportedTeamToWorkspace,
  undoImportedTeamCommitInWorkspace,
} from '../engine/workspaceImportCommit';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  restoreWorkspaceFromSnapshot,
  type WorkspaceData,
} from '../engine/workspaceSnapshot';

// ---------------------------------------------------------------------------
// Harness (mirrors the component's pipeline + the execution test harness):
// a 2026 alta GR B1 player source against a controllable existing team.
// ---------------------------------------------------------------------------

function playerPayload(playerNames: string[]) {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'GR League 9',
      age_division_alias: 'GR',
      year: 2026,
      record_type: 'players',
      source_url: 'https://ute.example/2026/gr',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GR League 9',
        teams_count: 1,
        teams: [
          {
            team_name: 'Gremlin B1',
            source_url: 'https://ute.example/2026/gr/b1',
            players_count: playerNames.length,
            players: playerNames.map((name) => ({ name })),
          },
        ],
      },
    ],
  };
}

const TARGET_TEAM_ID = '2026-alta-GR-B1';

function targetTeam(playerNames: string[]): Team {
  return {
    teamId: TARGET_TEAM_ID,
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 1,
    headCoach: { name: 'Coach A' },
    assistantCoaches: [{ name: 'Assistant B' }],
    players: playerNames.map((name) => ({ name })),
  };
}

// An unrelated team that must never be touched by a commit/undo of the target team.
const OTHER_TEAM: Team = {
  teamId: '2025-other-PW-A1',
  seasonId: '2025',
  districtId: 'other',
  ageDivisionId: 'PW',
  teamCode: 'A1',
  draftOrder: 2,
  divisionTeamCount: 3,
  headCoach: null,
  assistantCoaches: [],
  players: [{ name: 'Untouched One' }, { name: 'Untouched Two' }],
};

function workspaceWith(target: Team): WorkspaceData {
  return {
    districts: [
      {
        districtId: 'alta',
        name: 'Alta',
        mascot: 'Hawks',
        logoAssetPath: 'alta-logo.png',
        helmetAssetPath: 'alta-helmet.png',
        primaryColor: '#000000',
        secondaryColor: '#ffffff',
      },
    ],
    ageDivisions: [
      { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR', ordinal: 2, typicalAges: [9] },
      { ageDivisionId: 'PW', name: 'PeeWee', leagueLabel: 'PW', ordinal: 3, typicalAges: [10] },
    ],
    teams: [OTHER_TEAM, target],
    games: [],
    coaches: [],
    coachAssignments: [],
  };
}

const SOURCE = {
  name: 'demo.json',
  kind: 'players',
  organization: 'Ute Conference',
  event: '2026 Fall Season',
  year: '2026',
};
const TARGET = {
  teamName: 'Gremlin B1',
  existingTeamId: TARGET_TEAM_ID,
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GR',
  teamClassification: 'B1',
};

// Build a real `planned` transaction plan + execute it, returning the executedTeam the UI
// would hand to the commit helper.
function executedTeamFor(
  payload: unknown,
  existing: Team,
  decisions: ScrapedImportReviewDecisionMap = {}
) {
  const loaded = createUteScrapedJsonImportSessionFromPayload(payload);
  const id = getUteScrapedJsonImportSessionSelectableTargets(loaded)[0].sourceTargetId;
  const session = selectUteScrapedJsonImportSessionTarget(loaded, id);
  const review = buildScrapedJsonImportRosterAwareReview(session, [existing], decisions);
  const ctx = session.selectedCanonicalContextMapping!.canonicalContext;
  const team = findExistingRosterTeamForContext([existing], {
    seasonId: ctx.seasonId,
    districtId: ctx.districtId,
    ageDivisionId: ctx.ageDivisionId,
    teamClassification: ctx.teamClassification,
  });
  const staged = buildScrapedJsonImportStagedProjection(review, team);
  const readiness = buildScrapedJsonImportFutureCommitReadiness(review, staged);
  const transactionPlan = buildScrapedJsonImportTransactionPlan({
    transactionId: 'txn-b1',
    generatedAt: '2026-06-28T00:00:00.000Z',
    source: SOURCE,
    target: TARGET,
    review,
    stagedProjection: staged,
    readiness,
  });
  const result = executeUteConferenceScrapedJsonImportTransaction({
    transactionPlan,
    existingTeam: team,
    executedAt: '2026-06-28T01:00:00.000Z',
  });
  return { result, review };
}

function rowIdByName(review: ScrapedImportRosterAwareReview, name: string) {
  if (!review.available) throw new Error('review unavailable');
  return review.rows.find((r) => r.playerName === name)!.sourceRowId!;
}

describe('workspaceImportCommit — commit a previewed scraped-JSON team (B1)', () => {
  it('commits a ready import: target team gains the additions; others untouched', () => {
    const existing = targetTeam(['Jordan Smith', 'Taylor Johnson']);
    const workspace = workspaceWith(existing);
    const { result } = executedTeamFor(playerPayload(['Brand New', 'Other New']), existing);
    expect(result.status).toBe('executed');
    if (result.status !== 'executed') return;

    const committed = commitImportedTeamToWorkspace(workspace, result.executedTeam);
    expect(committed.committed).toBe(true);
    if (!committed.committed) return;

    const updated = committed.workspace.teams.find((t) => t.teamId === TARGET_TEAM_ID)!;
    // Existing records preserved exactly and in order; additions appended after them.
    expect(updated.players.map((p) => p.name)).toEqual([
      'Jordan Smith',
      'Taylor Johnson',
      'Brand New',
      'Other New',
    ]);
    // Unrelated team preserved exactly.
    expect(committed.workspace.teams.find((t) => t.teamId === OTHER_TEAM.teamId)).toEqual(
      OTHER_TEAM
    );
    // Unaffected workspace slices preserved.
    expect(committed.workspace.districts).toEqual(workspace.districts);
    expect(committed.workspace.ageDivisions).toEqual(workspace.ageDivisions);
    expect(committed.workspace.games).toEqual(workspace.games);
    expect(committed.workspace.coaches).toEqual(workspace.coaches);
  });

  it('preserves existing roster records and team metadata exactly', () => {
    const existing = targetTeam(['Jordan Smith', 'Taylor Johnson']);
    const workspace = workspaceWith(existing);
    const { result } = executedTeamFor(playerPayload(['Brand New']), existing);
    if (result.status !== 'executed') throw new Error('expected executed');

    const committed = commitImportedTeamToWorkspace(workspace, result.executedTeam);
    if (!committed.committed) throw new Error('expected committed');
    const updated = committed.workspace.teams.find((t) => t.teamId === TARGET_TEAM_ID)!;
    // Metadata and head/assistant coaches preserved; only players changed (one appended).
    expect(updated.headCoach).toEqual({ name: 'Coach A' });
    expect(updated.assistantCoaches).toEqual([{ name: 'Assistant B' }]);
    expect(updated.players.slice(0, 2).map((p) => p.name)).toEqual([
      'Jordan Smith',
      'Taylor Johnson',
    ]);
  });

  it('link decisions add no records; deferred rows are not added', () => {
    const existing = targetTeam(['Jordan Smith', 'Taylor Johnson']);
    const workspace = workspaceWith(existing);

    // Confirm-match on an existing name => link no-op; another name deferred (needs-review).
    const probe = executedTeamFor(playerPayload(['Jordan Smith', 'Deferred Person']), existing);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(probe.review, 'Jordan Smith')]: 'confirm-match',
      [rowIdByName(probe.review, 'Deferred Person')]: 'needs-review',
    };
    const { result } = executedTeamFor(
      playerPayload(['Jordan Smith', 'Deferred Person']),
      existing,
      decisions
    );
    if (result.status !== 'executed') throw new Error('expected executed');

    const committed = commitImportedTeamToWorkspace(workspace, result.executedTeam);
    if (!committed.committed) throw new Error('expected committed');
    const updated = committed.workspace.teams.find((t) => t.teamId === TARGET_TEAM_ID)!;
    // No additions: a confirmed link is a no-op and a deferred row is never added.
    expect(updated.players.map((p) => p.name)).toEqual(['Jordan Smith', 'Taylor Johnson']);
  });

  it('refuses to commit when the target team is not in the workspace (no silent create)', () => {
    const existing = targetTeam(['Jordan Smith']);
    // Workspace WITHOUT the target team.
    const workspace: WorkspaceData = { ...workspaceWith(existing), teams: [OTHER_TEAM] };
    const { result } = executedTeamFor(playerPayload(['Brand New']), existing);
    if (result.status !== 'executed') throw new Error('expected executed');

    const committed = commitImportedTeamToWorkspace(workspace, result.executedTeam);
    expect(committed.committed).toBe(false);
    expect(committed.workspace.teams).toEqual([OTHER_TEAM]);
  });

  it('undo restores the exact pre-commit target team, preserving unrelated later changes', () => {
    const existing = targetTeam(['Jordan Smith', 'Taylor Johnson']);
    const workspace = workspaceWith(existing);
    const { result } = executedTeamFor(playerPayload(['Brand New']), existing);
    if (result.status !== 'executed') throw new Error('expected executed');

    const committed = commitImportedTeamToWorkspace(workspace, result.executedTeam);
    if (!committed.committed) throw new Error('expected committed');

    // Simulate an UNRELATED later change after commit: edit the other team's players.
    const afterUnrelatedChange: WorkspaceData = {
      ...committed.workspace,
      teams: committed.workspace.teams.map((t) =>
        t.teamId === OTHER_TEAM.teamId ? { ...t, players: [{ name: 'Newly Added Elsewhere' }] } : t
      ),
    };

    const undone = undoImportedTeamCommitInWorkspace(
      afterUnrelatedChange,
      committed.previousTeam
    );
    expect(undone.restored).toBe(true);
    if (!undone.restored) return;
    // Target team restored exactly.
    expect(undone.workspace.teams.find((t) => t.teamId === TARGET_TEAM_ID)).toEqual(existing);
    // The unrelated later change is preserved (undo only touched the target team).
    expect(
      undone.workspace.teams.find((t) => t.teamId === OTHER_TEAM.teamId)!.players
    ).toEqual([{ name: 'Newly Added Elsewhere' }]);
  });

  it('committed import survives the A2 export/restore round trip', () => {
    const existing = targetTeam(['Jordan Smith', 'Taylor Johnson']);
    const workspace = workspaceWith(existing);
    const { result } = executedTeamFor(playerPayload(['Brand New', 'Other New']), existing);
    if (result.status !== 'executed') throw new Error('expected executed');
    const committed = commitImportedTeamToWorkspace(workspace, result.executedTeam);
    if (!committed.committed) throw new Error('expected committed');

    const snapshot = buildWorkspaceSnapshot({
      workspace: {
        ...committed.workspace,
        selection: { seasonId: '2026', districtId: null, ageDivisionId: null, teamId: null },
      },
      generatedAt: '2026-06-28T02:00:00.000Z',
    });
    const parsed = parseWorkspaceSnapshotJson(JSON.stringify(snapshot));
    if (!parsed.ok) throw new Error('snapshot did not validate');
    const restored = restoreWorkspaceFromSnapshot(parsed.snapshot);

    const restoredTarget = restored.workspace.teams.find((t) => t.teamId === TARGET_TEAM_ID)!;
    expect(restoredTarget.players.map((p) => p.name)).toEqual([
      'Jordan Smith',
      'Taylor Johnson',
      'Brand New',
      'Other New',
    ]);
  });

  it('does not mutate the input workspace or its teams', () => {
    const existing = targetTeam(['Jordan Smith', 'Taylor Johnson']);
    const workspace = workspaceWith(existing);
    const before = JSON.stringify(workspace);
    const { result } = executedTeamFor(playerPayload(['Brand New']), existing);
    if (result.status !== 'executed') throw new Error('expected executed');

    const committed = commitImportedTeamToWorkspace(workspace, result.executedTeam);
    if (!committed.committed) throw new Error('expected committed');
    undoImportedTeamCommitInWorkspace(committed.workspace, committed.previousTeam);

    expect(JSON.stringify(workspace)).toBe(before);
  });
});
