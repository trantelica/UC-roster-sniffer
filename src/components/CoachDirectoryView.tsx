import { useMemo, useState } from 'react';
import type { AgeDivision, District, Game, StaffCoach, Team, TeamCoachAssignment } from '../domain/types';
import { summarizeCoachHistory } from '../engine/coachHistorySummary';
import {
  summarizeCoachPerformance,
  summarizeCoachPerformanceDirectory,
  type CoachPerformanceRecord,
} from '../engine/coachPerformanceSummary';

/**
 * Phase 7 slice 28: read-only COACH PERFORMANCE dashboard.
 *
 * Lists coaches with their derived performance (overall/playoff/championship records, points,
 * latest assignment) and shows a selected coach's detail (assignment history, role splits,
 * context splits, unresolved-reference notes). Read-only — no coach editing here. Records are
 * derived at runtime from coach assignments + FINAL games; nothing is persisted.
 */

const ROLE_LABELS: Record<string, string> = {
  headCoach: 'Head Coach',
  assistantCoach: 'Assistant Coach',
  unknown: 'Unknown role',
};

function rolesLabel(roles: string[]): string {
  return roles.map((r) => ROLE_LABELS[r] ?? r).join(', ') || '—';
}

/** Formats a record as "W–L–T". */
function wlt(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}–${record.losses}–${record.ties}`;
}

/** Formats a win percentage as a deterministic 3-decimal string (e.g. ".750", "1.000"). */
function pct(record: CoachPerformanceRecord): string {
  if (record.gamesPlayed === 0) return '—';
  return record.winPercentage.toFixed(3);
}

function diff(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

export default function CoachDirectoryView({
  teams,
  districts,
  ageDivisions,
  coaches,
  coachAssignments,
  games = [],
  selectedCoachId: controlledSelectedCoachId,
  onSelectCoach,
  onOpenTeam,
}: {
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  games?: Game[];
  /** Externally controlled selected coach (e.g. cross-tab navigation). Uncontrolled if omitted. */
  selectedCoachId?: string | null;
  onSelectCoach?: (coachId: string | null) => void;
  /** Opens an assigned team in My Team. Display-only navigation; never mutates data. */
  onOpenTeam?: (teamId: string) => void;
}) {
  const directory = useMemo(
    () =>
      summarizeCoachPerformanceDirectory({
        coaches,
        coachAssignments,
        teams,
        games,
        districts,
        ageDivisions,
      }),
    [coaches, coachAssignments, teams, games, districts, ageDivisions]
  );
  // Selection is controlled when an onSelectCoach handler is supplied, otherwise local.
  const [internalSelectedCoachId, setInternalSelectedCoachId] = useState<string | null>(null);
  const isControlled = onSelectCoach !== undefined;
  const rawSelectedCoachId = isControlled
    ? controlledSelectedCoachId ?? null
    : internalSelectedCoachId;
  // Guard: a selected coach that is no longer in the workspace is treated as no selection.
  const selectedCoachId =
    rawSelectedCoachId && coaches.some((c) => c.coachId === rawSelectedCoachId)
      ? rawSelectedCoachId
      : null;
  const setSelectedCoachId = (id: string | null) => {
    if (isControlled) onSelectCoach!(id);
    else setInternalSelectedCoachId(id);
  };
  const teamIds = useMemo(() => new Set(teams.map((t) => t.teamId)), [teams]);

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

  const selectedPerformance = useMemo(() => {
    if (!selectedCoachId) return null;
    return summarizeCoachPerformance({
      coachId: selectedCoachId,
      coaches,
      coachAssignments,
      teams,
      games,
      districts,
      ageDivisions,
    });
  }, [selectedCoachId, coaches, coachAssignments, teams, games, districts, ageDivisions]);

  return (
    <div className="import-preview">
      <div className="import-preview-header">
        <h2 className="import-title">Coach performance</h2>
        <span className="import-tag">Read-only</span>
      </div>
      <p className="import-note">
        Coach performance is derived from coach assignments plus FINAL games for each assigned
        team. Scheduled, postponed, and cancelled games do not count. Championship games count
        toward both championship and playoff-context records. Coach analytics never mutate
        rosters, games, or assignments. Coach identity is name-based and deterministic; ambiguity
        is surfaced, never silently merged. No browser storage or cloud sync is used.
      </p>

      {directory.length === 0 ? (
        <p className="import-empty">No coach performance data available.</p>
      ) : (
        <table className="schedule-table">
          <thead>
            <tr>
              <th>Coach</th>
              <th>Latest assignment</th>
              <th>Seasons</th>
              <th>Roles held</th>
              <th>Overall</th>
              <th>Win%</th>
              <th>PF</th>
              <th>PA</th>
              <th>DIFF</th>
              <th>Playoff</th>
              <th>Championship</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {directory.map((row) => (
              <tr key={row.coachId}>
                <td>{row.displayName}</td>
                <td>
                  {row.latestAssignment
                    ? `${row.latestAssignment.teamDisplayName} (${row.latestAssignment.seasonId}, ${ROLE_LABELS[row.latestAssignment.role] ?? row.latestAssignment.role})`
                    : '—'}
                </td>
                <td>{row.seasonsActive.length}</td>
                <td>{rolesLabel(row.rolesHeld)}</td>
                <td>
                  {wlt(row.overallRecord)}
                  {row.overallRecord.gamesPlayed === 0 && (
                    <span className="schedule-week"> · no final games</span>
                  )}
                </td>
                <td>{pct(row.overallRecord)}</td>
                <td>{row.pointsFor}</td>
                <td>{row.pointsAgainst}</td>
                <td>{diff(row.pointDifferential)}</td>
                <td>{wlt(row.playoffRecord)}</td>
                <td>{wlt(row.championshipRecord)}</td>
                <td>
                  <button
                    type="button"
                    className="import-link-button"
                    onClick={() =>
                      setSelectedCoachId(selectedCoachId === row.coachId ? null : row.coachId)
                    }
                  >
                    {selectedCoachId === row.coachId ? 'Hide detail' : 'View detail'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {selectedPerformance && selectedHistory && (
        <div className="import-section">
          <h3>{selectedPerformance.displayName} — performance detail</h3>

          <div className="roster-status-summary">
            <span className="roster-status-count">
              <strong>{wlt(selectedPerformance.overallRecord)}</strong> Overall
            </span>
            <span className="roster-status-count">
              <strong>{wlt(selectedPerformance.regularSeasonRecord)}</strong> Regular season
            </span>
            <span className="roster-status-count">
              <strong>{wlt(selectedPerformance.playoffRecord)}</strong> Playoffs
            </span>
            <span className="roster-status-count">
              <strong>{wlt(selectedPerformance.championshipRecord)}</strong> Championship
            </span>
            <span className="roster-status-count">
              <strong>{diff(selectedPerformance.pointDifferential)}</strong> Differential
            </span>
          </div>

          <div className="roster-status-summary">
            <span className="roster-status-count">
              <strong>{wlt(selectedPerformance.headCoachRecord)}</strong> As head coach
            </span>
            <span className="roster-status-count">
              <strong>{wlt(selectedPerformance.assistantCoachRecord)}</strong> As assistant
            </span>
            {selectedPerformance.unknownRoleRecord.gamesPlayed > 0 && (
              <span className="roster-status-count">
                <strong>{wlt(selectedPerformance.unknownRoleRecord)}</strong> Unknown role
              </span>
            )}
          </div>

          {(selectedPerformance.unresolvedAssignmentCount > 0 ||
            selectedPerformance.unresolvedGameReferenceCount > 0) && (
            <p className="schedule-unresolved">
              {selectedPerformance.unresolvedAssignmentCount > 0 &&
                `${selectedPerformance.unresolvedAssignmentCount} assignment(s) reference an unknown team (no games credited). `}
              {selectedPerformance.unresolvedGameReferenceCount > 0 &&
                `${selectedPerformance.unresolvedGameReferenceCount} credited game(s) reference an unresolved opponent.`}
            </p>
          )}

          <h4>Assignment history</h4>
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
                      {onOpenTeam && !a.unresolvedTeam && teamIds.has(a.teamId) ? (
                        <button
                          type="button"
                          className="link-button-inline"
                          onClick={() => onOpenTeam(a.teamId)}
                          title="Open team in My Team"
                        >
                          {a.teamDisplayName}
                        </button>
                      ) : (
                        a.teamDisplayName
                      )}
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
