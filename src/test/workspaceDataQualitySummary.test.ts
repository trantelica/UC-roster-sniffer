import { describe, it, expect } from 'vitest';
import type {
  AgeDivision,
  District,
  Game,
  Player,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import { buildStaffCoach } from '../engine/coachModel';
import {
  buildWorkspaceDataQualitySummary,
  type ReviewItem,
} from '../engine/workspaceDataQualitySummary';

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: 'Hawks', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
  { districtId: 'brighton', name: 'Brighton', mascot: 'Bears', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 2, typicalAges: [9] },
  { ageDivisionId: 'PW', name: 'Peewee', leagueLabel: 'PW League', ordinal: 3, typicalAges: [10] },
];

const P = (name: string): Player => ({ name });

function team(
  teamId: string,
  districtId: string,
  ageDivisionId: string,
  seasonId: string,
  players: Player[] = [],
  head: string | null = null,
  assistants: string[] = []
): Team {
  return {
    teamId, seasonId, districtId, ageDivisionId, teamCode: 'B1',
    draftOrder: 1, divisionTeamCount: 2,
    headCoach: head ? { name: head } : null,
    assistantCoaches: assistants.map((name) => ({ name })),
    players,
  };
}

const JANE = buildStaffCoach('Jane Smith');
const SAM = buildStaffCoach('Sam Lee');
const ALEX = buildStaffCoach('Alex Martinez');

function head(teamId: string, seasonId: string, c: StaffCoach): TeamCoachAssignment {
  return { assignmentId: `${seasonId}:${teamId}:${c.coachId}:h`, seasonId, teamId, coachId: c.coachId, role: 'headCoach' };
}

function find(items: ReviewItem[], code: string): ReviewItem | undefined {
  return items.find((i) => i.code === code);
}

function build(over: Partial<Parameters<typeof buildWorkspaceDataQualitySummary>[0]>) {
  return buildWorkspaceDataQualitySummary({
    teams: [], games: [], districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    coaches: [], coachAssignments: [], ...over,
  });
}

// A "clean" two-season workspace: Alta + Brighton each have a prior-season team, players,
// coaches, and a full set of final games. (Used as the baseline that yields no warnings.)
const ALTA_2025 = team('2025-alta-GR-B1', 'alta', 'GR', '2025', [P('Jordan Smith'), P('Taylor Johnson')], 'Jane Smith');
const ALTA_2026 = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('Jordan Smith'), P('Casey Brown')], 'Jane Smith');
const BRIGHTON_2025 = team('2025-brighton-GR-B1', 'brighton', 'GR', '2025', [P('Pat Jones'), P('Lee Park')], 'Alex Martinez');
const BRIGHTON_2026 = team('2026-brighton-GR-B1', 'brighton', 'GR', '2026', [P('Pat Jones'), P('Quinn Vale')], 'Alex Martinez');
const CLEAN_TEAMS = [ALTA_2025, ALTA_2026, BRIGHTON_2025, BRIGHTON_2026];
const CLEAN_COACHES = [JANE, ALEX];
const CLEAN_ASSIGNMENTS = [
  head(ALTA_2025.teamId, '2025', JANE), head(ALTA_2026.teamId, '2026', JANE),
  head(BRIGHTON_2025.teamId, '2025', ALEX), head(BRIGHTON_2026.teamId, '2026', ALEX),
];

function game(over: Partial<Game> & Pick<Game, 'gameId'>): Game {
  return {
    seasonId: '2026', ageDivisionId: 'GR', weekLabel: 'W', scheduledDate: '2026-08-22',
    homeTeamId: ALTA_2026.teamId, awayTeamId: BRIGHTON_2026.teamId, status: 'final', homeScore: 0, awayScore: 0,
    ...over,
  };
}
// Both seasons have a final game so neither season is sparse and standings exist.
const CLEAN_GAMES: Game[] = [
  game({ gameId: 'g26', seasonId: '2026', homeScore: 21, awayScore: 14 }),
  game({ gameId: 'g25', seasonId: '2025', scheduledDate: '2025-08-22', homeTeamId: ALTA_2025.teamId, awayTeamId: BRIGHTON_2025.teamId, homeScore: 10, awayScore: 7 }),
];

describe('buildWorkspaceDataQualitySummary — clean workspace', () => {
  it('produces no blocker/warning items for a complete two-season workspace', () => {
    const s = build({ teams: CLEAN_TEAMS, games: CLEAN_GAMES, coaches: CLEAN_COACHES, coachAssignments: CLEAN_ASSIGNMENTS });
    expect(s.counts.blocker).toBe(0);
    expect(s.counts.warning).toBe(0);
    // 2025 teams correctly carry an info "no prior team" note; that is not a warning.
    expect(s.status).toBe('clean');
  });

  it('reports an empty summary for an empty workspace', () => {
    const s = build({});
    expect(s.counts.total).toBe(0);
    expect(s.items).toEqual([]);
    expect(s.status).toBe('clean');
  });
});

describe('buildWorkspaceDataQualitySummary — roster signals', () => {
  it('detects a team with no players', () => {
    const empty = team('2026-alta-GR-B1', 'alta', 'GR', '2026', []);
    const s = build({ teams: [empty] });
    const item = find(s.items, 'team-no-players')!;
    expect(item).toBeDefined();
    expect(item.severity).toBe('warning');
    expect(item.category).toBe('roster');
    expect(item.teamId).toBe(empty.teamId);
    expect(item.navigationTarget).toEqual({ kind: 'team', teamId: empty.teamId });
  });

  it('detects duplicate roster identity groups', () => {
    const dup = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('Jordan Smith'), P('Jordan Smith')]);
    const s = build({ teams: [dup] });
    const item = find(s.items, 'roster-identity-duplicates')!;
    expect(item.severity).toBe('warning');
    expect(item.message).toContain('1 duplicate-name group');
  });

  it('detects missing prior same-slot team as info', () => {
    const t = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('A B')]);
    const s = build({ teams: [t] });
    const item = find(s.items, 'no-prior-team')!;
    expect(item.severity).toBe('info');
    expect(item.category).toBe('roster');
  });

  it('detects ambiguous (unknown) roster movement vs prior season', () => {
    // Two "Jordan Smith" current players => ambiguous current identity.
    const prior = team('2025-alta-GR-B1', 'alta', 'GR', '2025', [P('Jordan Smith')]);
    const current = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('Jordan Smith'), P('Jordan Smith')]);
    const s = build({ teams: [prior, current] });
    expect(find(s.items, 'roster-movement-unknown')).toBeDefined();
  });

  it('detects y-up / z-down cohort candidate signals', () => {
    // Jordan moves PW (2025) -> GR (2026): a down move = z-down candidate.
    const prior = team('2025-alta-PW-B1', 'alta', 'PW', '2025', [P('Jordan Smith')]);
    const current = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('Jordan Smith')]);
    const s = build({ teams: [prior, current] });
    const item = find(s.items, 'cohort-reclassification-candidate')!;
    expect(item).toBeDefined();
    expect(item.severity).toBe('info');
    expect(item.teamId).toBe(current.teamId);
  });
});

describe('buildWorkspaceDataQualitySummary — schedule signals', () => {
  const t = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('A B')]);
  const opp = team('2026-brighton-GR-B1', 'brighton', 'GR', '2026', [P('C D')]);

  it('detects a team with no schedule', () => {
    const s = build({ teams: [t, opp] });
    expect(find(s.items, 'team-no-schedule')).toBeDefined();
  });

  it('detects unresolved game references', () => {
    const g = game({ gameId: 'orphan', homeTeamId: t.teamId, awayTeamId: 'ghost-team', homeScore: 5, awayScore: 0 });
    const s = build({ teams: [t, opp], games: [g] });
    const item = find(s.items, 'unresolved-game-reference')!;
    expect(item.severity).toBe('warning');
    expect(item.category).toBe('schedule');
    expect(item.gameId).toBe('orphan');
    expect(item.navigationTarget).toEqual({ kind: 'team', teamId: t.teamId });
  });

  it('detects a final game with missing scores', () => {
    const g = game({ gameId: 'noscore', homeTeamId: t.teamId, awayTeamId: opp.teamId, homeScore: undefined, awayScore: undefined });
    const s = build({ teams: [t, opp], games: [g] });
    const item = find(s.items, 'final-game-missing-score')!;
    expect(item.severity).toBe('warning');
  });

  it('detects a team with games but no final results', () => {
    const g = game({ gameId: 'sched', homeTeamId: t.teamId, awayTeamId: opp.teamId, status: 'scheduled', homeScore: undefined, awayScore: undefined });
    const s = build({ teams: [t, opp], games: [g] });
    expect(find(s.items, 'team-no-final-games')).toBeDefined();
  });

  it('detects provisional standings (no final games in the group)', () => {
    const g = game({ gameId: 'sched', homeTeamId: t.teamId, awayTeamId: opp.teamId, status: 'scheduled', homeScore: undefined, awayScore: undefined });
    const s = build({ teams: [t, opp], games: [g] });
    const item = find(s.items, 'standings-unavailable')!;
    expect(item.category).toBe('standings');
    expect(item.navigationTarget).toEqual({ kind: 'view', view: 'standings' });
  });
});

describe('buildWorkspaceDataQualitySummary — coach signals', () => {
  const t = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('A B')]);

  it('detects a team with no coach data', () => {
    const s = build({ teams: [t] });
    expect(find(s.items, 'team-no-coach-data')).toBeDefined();
  });

  it('detects a coach assignment referencing an unknown coach/team', () => {
    const orphan: TeamCoachAssignment = {
      assignmentId: 'a1', seasonId: '2026', teamId: t.teamId, coachId: 'coach:ghost', role: 'headCoach',
    };
    const s = build({ teams: [t], coaches: [], coachAssignments: [orphan] });
    const item = find(s.items, 'unresolved-coach-assignment')!;
    expect(item.severity).toBe('warning');
    expect(item.message).toContain('coach');
    expect(item.navigationTarget).toEqual({ kind: 'team', teamId: t.teamId });
  });

  it('detects a coach with assignments but no final-game performance', () => {
    const s = build({ teams: [t], coaches: [SAM], coachAssignments: [head(t.teamId, '2026', SAM)] });
    const item = find(s.items, 'coach-no-final-games')!;
    expect(item.severity).toBe('info');
    expect(item.coachId).toBe(SAM.coachId);
    expect(item.navigationTarget).toEqual({ kind: 'coach', coachId: SAM.coachId });
  });
});

describe('buildWorkspaceDataQualitySummary — workspace/import signals', () => {
  it('detects sparse season data', () => {
    const t = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('A B')]);
    const s = build({ teams: [t] });
    expect(find(s.items, 'sparse-season-data')).toBeDefined();
  });

  it('surfaces import state when passed', () => {
    const t = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('A B')]);
    const s = build({ teams: [t], importState: { inMemoryRosterImportActive: true, importedWorkspace: true } });
    expect(find(s.items, 'in-memory-import-active')).toBeDefined();
    expect(find(s.items, 'in-memory-import-active')!.category).toBe('import');
    expect(find(s.items, 'imported-workspace-only')).toBeDefined();
  });
});

describe('buildWorkspaceDataQualitySummary — aggregation, ordering, ids, no mutation', () => {
  const dup = team('2026-alta-GR-B1', 'alta', 'GR', '2026', [P('Jordan Smith'), P('Jordan Smith')]);
  const inputs = { teams: [dup], games: [], coaches: [], coachAssignments: [] };

  it('aggregates counts by severity and category', () => {
    const s = build(inputs);
    expect(s.counts.total).toBe(s.items.length);
    expect(s.bySeverity.warning + s.bySeverity.info + s.bySeverity.blocker).toBe(s.counts.total);
    const categorySum = Object.values(s.byCategory).reduce((a, b) => a + b, 0);
    expect(categorySum).toBe(s.counts.total);
  });

  it('orders items by severity (warning before info) then category', () => {
    const s = build(inputs);
    const severities = s.items.map((i) => i.severity);
    const firstInfo = severities.indexOf('info');
    const lastWarning = severities.lastIndexOf('warning');
    if (firstInfo !== -1 && lastWarning !== -1) expect(lastWarning).toBeLessThan(firstInfo);
  });

  it('generates stable deterministic issue ids', () => {
    const a = build(inputs).items.map((i) => i.issueId);
    const b = build(inputs).items.map((i) => i.issueId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length); // unique
    expect(a).toContain('roster-identity-duplicates|2026-alta-GR-B1');
  });

  it('provides navigation targets for resolvable team/coach issues', () => {
    const s = build(inputs);
    const teamItem = s.items.find((i) => i.entityType === 'team' && i.navigationTarget);
    expect(teamItem?.navigationTarget).toEqual({ kind: 'team', teamId: dup.teamId });
  });

  it('does not mutate inputs', () => {
    const teams = [dup].map((t) => ({ ...t, players: [...t.players] }));
    const before = JSON.stringify(teams);
    buildWorkspaceDataQualitySummary({
      teams, games: [], districts: DISTRICTS, ageDivisions: AGE_DIVISIONS, coaches: [], coachAssignments: [],
    });
    expect(JSON.stringify(teams)).toBe(before);
  });
});
