import { useMemo, useState } from 'react';
import type { AgeDivision, District, StaffCoach, Team, TeamCoachAssignment } from '../domain/types';
import {
  buildCoachDirectory,
  summarizeCoachHistory,
} from '../engine/coachHistorySummary';

/**
 * Phase 7 slice 27: read-only COACH DIRECTORY / dashboard.
 *
 * Lists coaches with latest assignment + counts, and shows a selected coach's assignment
 * history across seasons/teams. Read-only — no coach editing here.
 */

const ROLE_LABELS: Record<string, string> = {
  headCoach: 'Head Coach',
  assistantCoach: 'Assistant Coach',
  unknown: 'Unknown role',
};

function rolesLabel(roles: string[]): string {
  return roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') || '—';
}

export default function CoachDirectoryView({
  teams,
  districts,
  ageDivisions,
  coaches,
  coachAssignments,
}: {
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
}) {
  const directory = useMemo(
    () => buildCoachDirectory({ coaches, coachAssignments, teams, districts, ageDivisions }),
    [coaches, coachAssignments, teams, districts, ageDivisions]
  );
  const [selectedCoachId, setSelectedCoachId] = useState<string | null>(null);

  const selectedHistory = useMemo(() => {
    if (!selectedCoachId) return null;
    return summarizeCoachHistory({
      coachId: selectedCoachId,
      coaches,
      coachAssignments,
      teams,
      districts,
      ageDivisions,
    });
  }, [selectedCoachId, coaches, coachAssignments, teams, districts, ageDivisions]);

  return (
    <div className="import-preview">
      <div className="import-preview-header">
        <h2 className="import-title">Coach directory</h2>
        <span className="import-tag">Read-only</span>
      </div>
      <p className="import-note">
        Coaches and their assignment history across seasons/teams. Coach data is separate from
        player rosters and schedules/results. Coach identity is name-based and deterministic;
        ambiguity is surfaced, never silently merged. No browser storage or cloud sync is used.
      </p>

      {directory.length === 0 ? (
        <p className="import-empty">No coach/staff data loaded.</p>
      ) : (
        <table className="schedule-table">
          <thead>
            <tr>
              <th>Coach</th>
              <th>Latest assignment</th>
              <th>Seasons</th>
              <th>Teams</th>
              <th>Roles held</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {directory.map((row) => (
              <tr key={row.coachId}>
                <td>{row.displayName}</td>
                <td>
                  {row.latestTeamDisplayName
                    ? `${row.latestTeamDisplayName} (${row.latestSeasonId}, ${ROLE_LABELS[row.latestRole ?? 'unknown'] ?? row.latestRole})`
                    : '—'}
                </td>
                <td>{row.seasonsActiveCount}</td>
                <td>{row.teamsCoachedCount}</td>
                <td>{rolesLabel(row.rolesHeld)}</td>
                <td>
                  <button
                    type="button"
                    className="import-link-button"
                    onClick={() =>
                      setSelectedCoachId(selectedCoachId === row.coachId ? null : row.coachId)
                    }
                  >
                    {selectedCoachId === row.coachId ? 'Hide history' : 'View history'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedHistory && (
        <div className="import-section">
          <h3>{selectedHistory.displayName} — assignment history</h3>
          {selectedHistory.assignments.length === 0 ? (
            <p className="import-empty">No assignments.</p>
          ) : (
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Season</th>
                  <th>Team</th>
                  <th>Role</th>
                  <th>Source label</th>
                </tr>
              </thead>
              <tbody>
                {selectedHistory.assignments.map((a) => (
                  <tr key={a.assignmentId}>
                    <td>{a.seasonId}</td>
                    <td>
                      {a.teamDisplayName}
                      {a.unresolvedTeam && (
                        <span className="schedule-unresolved"> (unresolved team)</span>
                      )}
                    </td>
                    <td>{ROLE_LABELS[a.role] ?? a.role}</td>
                    <td>{a.sourceLabel ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
