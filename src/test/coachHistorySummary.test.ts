import { describe, it, expect } from 'vitest';
import type { AgeDivision, District, StaffCoach, Team, TeamCoachAssignment } from '../domain/types';
import {
  deriveCoachesAndAssignmentsFromTeams,
  buildStaffCoach,
} from '../engine/coachModel';
import {
  summarizeTeamCoachStaff,
  summarizeCoachHistory,
  buildCoachDirectory,
  validateCoachAssignments,
} from '../engine/coachHistorySummary';

const DISTRICTS: District[] = [
  { districtId: 'alta', name: 'Alta', mascot: 'Hawks', logoAssetPath: '', helmetAssetPath: '', primaryColor: '', secondaryColor: '' },
];
const AGE_DIVISIONS: AgeDivision[] = [
  { ageDivisionId: 'GR', name: 'Gremlin', leagueLabel: 'GR League', ordinal: 1, typicalAges: [9] },
];

function team(teamId: string, seasonId: string, head: string | null, assistants: string[]): Team {
  return {
    teamId, seasonId, districtId: 'alta', ageDivisionId: 'GR', teamCode: 'B1',
    draftOrder: 1, divisionTeamCount: 1,
    headCoach: head ? { name: head } : null,
    assistantCoaches: assistants.map((name) => ({ name })),
    players: [],
  };
}

// Jane Smith heads alta in 2025 and 2026 (returning); Sam Lee asst both; Morgan Davis asst 2026 only.
const TEAM_2025 = team('2025-alta-GR-B1', '2025', 'Jane Smith', ['Sam Lee']);
const TEAM_2026 = team('2026-alta-GR-B1', '2026', 'Jane Smith', ['Sam Lee', 'Morgan Davis']);
const TEAMS = [TEAM_2025, TEAM_2026];

const derived = deriveCoachesAndAssignmentsFromTeams(TEAMS);

describe('deriveCoachesAndAssignmentsFromTeams', () => {
  it('dedups coaches by identity across seasons/teams', () => {
    const names = derived.coaches.map((c) => c.displayName).sort();
    expect(names).toEqual(['Jane Smith', 'Morgan Davis', 'Sam Lee']);
  });

  it('creates one assignment per team-season coach', () => {
    // 2025: Jane + Sam = 2; 2026: Jane + Sam + Morgan = 3.
    expect(derived.coachAssignments).toHaveLength(5);
    const jane = buildStaffCoach('Jane Smith');
    const janeAssignments = derived.coachAssignments.filter((a) => a.coachId === jane.coachId);
    expect(janeAssignments.map((a) => a.seasonId).sort()).toEqual(['2025', '2026']);
  });

  it('does not mutate input teams', () => {
    const before = JSON.stringify(TEAMS);
    deriveCoachesAndAssignmentsFromTeams(TEAMS);
    expect(JSON.stringify(TEAMS)).toBe(before);
  });
});

describe('summarizeTeamCoachStaff', () => {
  it('summarizes staff by role', () => {
    const s = summarizeTeamCoachStaff({
      teamId: '2026-alta-GR-B1',
      seasonId: '2026',
      coaches: derived.coaches,
      coachAssignments: derived.coachAssignments,
    });
    expect(s.headCoaches.map((m) => m.displayName)).toEqual(['Jane Smith']);
    expect(s.assistantCoaches.map((m) => m.displayName)).toEqual(['Morgan Davis', 'Sam Lee']);
    expect(s.totalAssignedCoaches).toBe(3);
    expect(s.unresolvedCoachReferences).toBe(0);
  });

  it('handles a team with no coach data', () => {
    const s = summarizeTeamCoachStaff({
      teamId: 'team-no-coaches',
      seasonId: '2026',
      coaches: derived.coaches,
      coachAssignments: derived.coachAssignments,
    });
    expect(s.totalAssignedCoaches).toBe(0);
    expect(s.headCoaches).toEqual([]);
  });

  it('reports unresolved coach references without crashing', () => {
    const orphanAssignment: TeamCoachAssignment = {
      assignmentId: 'x', seasonId: '2026', teamId: '2026-alta-GR-B1', coachId: 'coach:ghost', role: 'assistantCoach',
    };
    const s = summarizeTeamCoachStaff({
      teamId: '2026-alta-GR-B1', seasonId: '2026',
      coaches: derived.coaches,
      coachAssignments: [...derived.coachAssignments, orphanAssignment],
    });
    expect(s.unresolvedCoachReferences).toBe(1);
  });

  it('detects returning/new/departed coaches vs prior same-slot team', () => {
    const s = summarizeTeamCoachStaff({
      teamId: '2026-alta-GR-B1', seasonId: '2026',
      coaches: derived.coaches,
      coachAssignments: derived.coachAssignments,
      priorSeasonTeamId: '2025-alta-GR-B1',
    });
    expect(s.continuity.available).toBe(true);
    expect(s.continuity.returningCoaches).toBe(2); // Jane + Sam
    expect(s.continuity.newToTeamCoaches).toBe(1); // Morgan
    expect(s.continuity.departedCoaches).toBe(0);
  });

  it('does not mutate inputs', () => {
    const before = JSON.stringify(derived);
    summarizeTeamCoachStaff({
      teamId: '2026-alta-GR-B1', seasonId: '2026',
      coaches: derived.coaches, coachAssignments: derived.coachAssignments,
      priorSeasonTeamId: '2025-alta-GR-B1',
    });
    expect(JSON.stringify(derived)).toBe(before);
  });
});

describe('summarizeCoachHistory', () => {
  it('summarizes a coach across seasons/teams', () => {
    const jane = buildStaffCoach('Jane Smith');
    const h = summarizeCoachHistory({
      coachId: jane.coachId,
      coaches: derived.coaches,
      coachAssignments: derived.coachAssignments,
      teams: TEAMS, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(h.displayName).toBe('Jane Smith');
    expect(h.seasonsActive).toEqual(['2025', '2026']);
    expect(h.teamsCoached).toEqual(['2025-alta-GR-B1', '2026-alta-GR-B1']);
    expect(h.rolesHeld).toEqual(['headCoach']);
    expect(h.latestAssignment?.seasonId).toBe('2026');
    expect(h.movementSummary.distinctSeasons).toBe(2);
  });

  it('flags unresolved team without crashing', () => {
    const coaches: StaffCoach[] = [{ coachId: 'coach:x', displayName: 'X', identityKey: 'x' }];
    const assignments: TeamCoachAssignment[] = [
      { assignmentId: 'a', seasonId: '2026', teamId: 'ghost-team', coachId: 'coach:x', role: 'headCoach' },
    ];
    const h = summarizeCoachHistory({
      coachId: 'coach:x', coaches, coachAssignments: assignments,
      teams: TEAMS, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(h.assignments[0].unresolvedTeam).toBe(true);
  });
});

describe('buildCoachDirectory', () => {
  it('lists coaches ordered by display name with latest assignment', () => {
    const rows = buildCoachDirectory({
      coaches: derived.coaches, coachAssignments: derived.coachAssignments,
      teams: TEAMS, districts: DISTRICTS, ageDivisions: AGE_DIVISIONS,
    });
    expect(rows.map((r) => r.displayName)).toEqual(['Jane Smith', 'Morgan Davis', 'Sam Lee']);
    const jane = rows[0];
    expect(jane.seasonsActiveCount).toBe(2);
    expect(jane.latestSeasonId).toBe('2026');
    expect(jane.latestRole).toBe('headCoach');
  });
});

describe('validateCoachAssignments', () => {
  it('returns empty when all references resolve', () => {
    expect(validateCoachAssignments(derived.coachAssignments, derived.coaches, TEAMS)).toEqual([]);
  });

  it('reports unresolved coach and team references', () => {
    const bad: TeamCoachAssignment[] = [
      { assignmentId: 'a1', seasonId: '2026', teamId: 'ghost', coachId: 'coach:ghost', role: 'headCoach' },
    ];
    const unresolved = validateCoachAssignments(bad, derived.coaches, TEAMS);
    expect(unresolved).toEqual([{ assignmentId: 'a1', missingCoachId: true, missingTeamId: true }]);
  });
});
