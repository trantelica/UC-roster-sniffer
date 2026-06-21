import { useMemo } from 'react';
import type {
  AgeDivision,
  District,
  Game,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import {
  buildMyTeamSummary,
  type AttentionSeverity,
  type MyTeamAttentionItem,
} from '../engine/myTeamSummary';
import type { TeamScheduleGameView } from '../engine/teamScheduleSummary';
import type { CoachPerformanceRecord } from '../engine/coachPerformanceSummary';

/**
 * Phase 8 slice 29: read-only MY TEAM command center.
 *
 * Consolidates one selected team's intelligence (identity, roster movement, schedule/results,
 * standings, coaches, and attention items) by reading the deterministic `buildMyTeamSummary`
 * engine. It is read-only — no editing — and points the user to the existing detailed tabs
 * rather than duplicating them. Nothing is persisted; workspace snapshot export is the
 * durability path.
 */

const SEVERITY_LABELS: Record<AttentionSeverity, string> = {
  info: 'Info',
  warning: 'Review',
  blocker: 'Blocker',
};

function wlt(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}–${record.losses}–${record.ties}`;
}

function diff(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function pct(value: number): string {
  return value.toFixed(3);
}

function formatGameLine(game: TeamScheduleGameView): string {
  const date = game.scheduledDate ?? 'TBD';
  const place = game.homeAway === 'home' ? 'vs' : 'at';
  const score = game.scoreDisplay ? ` (${game.scoreDisplay} ${game.resultDisplay})` : '';
  return `${date} · ${game.weekLabel} · ${place} ${game.opponentDisplayName}${score}`;
}

export default function MyTeamView({
  teams,
  districts,
  ageDivisions,
  games,
  coaches,
  coachAssignments,
  selectedTeamId,
  onSelectTeam,
  onNavigate,
  importedWorkspace = false,
}: {
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
  games: Game[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  selectedTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  /** Optional read-only affordance to jump to an existing tab. */
  onNavigate?: (view: 'roster' | 'schedule' | 'standings' | 'coaches') => void;
  importedWorkspace?: boolean;
}) {
  const summary = useMemo(() => {
    if (!selectedTeamId) return null;
    return buildMyTeamSummary({
      teamId: selectedTeamId,
      teams,
      games,
      districts,
      ageDivisions,
      coaches,
      coachAssignments,
      importedWorkspace,
    });
  }, [
    selectedTeamId,
    teams,
    games,
    districts,
    ageDivisions,
    coaches,
    coachAssignments,
    importedWorkspace,
  ]);

  // A deterministic team picker, grouped by season for readability.
  const teamOptions = useMemo(
    () =>
      teams
        .map((t) => ({
          teamId: t.teamId,
          label: `${t.seasonId} · ${districtName(districts, t.districtId)} ${ageDivisionName(ageDivisions, t.ageDivisionId)} ${t.teamCode}`,
        }))
        .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    [teams, districts, ageDivisions]
  );

  return (
    <div className="my-team">
      <div className="import-preview-header">
        <h2 className="import-title">My Team command center</h2>
        <span className="import-tag">Read-only</span>
      </div>
      <p className="import-note">
        A consolidated, read-only view of one team: roster movement, schedule/results, standings
        position, coaching staff, and attention items. Everything is derived at runtime from the
        current workspace — no data is duplicated or persisted. Use the detailed tabs to drill in;
        export a workspace snapshot to keep changes.
      </p>

      <div className="my-team-picker">
        <label htmlFor="my-team-select">Team</label>
        <select
          id="my-team-select"
          value={selectedTeamId ?? ''}
          onChange={(e) => onSelectTeam(e.target.value)}
        >
          <option value="">Select a team</option>
          {teamOptions.map((o) => (
            <option key={o.teamId} value={o.teamId}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {!selectedTeamId && (
        <p className="empty-state">
          Select a team above to see its consolidated command center.
        </p>
      )}

      {selectedTeamId && summary === null && (
        <p className="empty-state">
          The selected team is no longer in the workspace. Pick another team above.
        </p>
      )}

      {summary && (
        <div className="my-team-grid">
          {/* Header card */}
          <section className="my-team-card my-team-card-header">
            <h3>{summary.identity.displayName}</h3>
            <div className="team-meta">
              <span><strong>Season:</strong> {summary.identity.seasonId}</span>
              <span><strong>District:</strong> {summary.identity.districtName}</span>
              <span><strong>Age Division:</strong> {summary.identity.ageDivisionName}</span>
              <span><strong>Class / Code:</strong> {summary.identity.teamCode}</span>
              {summary.identity.mascot && (
                <span><strong>Mascot:</strong> {summary.identity.mascot}</span>
              )}
            </div>
            <div className="roster-status-summary">
              <span className="roster-status-count">
                <strong>{wlt(summary.schedule.overallRecord)}</strong> Overall W–L–T
              </span>
              <span className="roster-status-count">
                <strong>{pct(summary.schedule.winPercentage)}</strong> Win%
              </span>
              <span className="roster-status-count">
                <strong>{diff(summary.schedule.pointDifferential)}</strong> Differential
              </span>
              <span className="roster-status-count">
                <strong>
                  {summary.standings.rank !== null ? `#${summary.standings.rank}` : '—'}
                </strong>{' '}
                of {summary.standings.totalTeams} in standings
              </span>
            </div>
          </section>

          {/* Roster Intelligence card */}
          <section className="my-team-card">
            <h3>Roster Intelligence</h3>
            <div className="roster-status-summary">
              <span className="roster-status-count">
                <strong>{summary.roster.totalPlayers}</strong> Players
              </span>
              <span className="roster-status-count">
                <strong>{summary.roster.duplicateGroupCount}</strong> Duplicate-name groups
              </span>
            </div>
            {summary.roster.priorSeasonComparison.available ? (
              <div className="roster-status-summary">
                <span className="roster-status-count">
                  <strong>{summary.roster.priorSeasonComparison.returning}</strong> Returning
                </span>
                <span className="roster-status-count">
                  <strong>{summary.roster.priorSeasonComparison.newToRoster}</strong> New
                </span>
                <span className="roster-status-count">
                  <strong>{summary.roster.priorSeasonComparison.notReturning}</strong> Not returning
                </span>
                <span className="roster-status-count">
                  <strong>{summary.roster.priorSeasonComparison.unknownCurrent}</strong> Unknown
                </span>
                <span className="roster-status-count">
                  <strong>{summary.roster.priorSeasonComparison.identityReviewCount}</strong>{' '}
                  Identity review
                </span>
              </div>
            ) : (
              <p className="empty-state">
                No prior-season same-slot team — returning/new comparison is unavailable.
              </p>
            )}
            {onNavigate && (
              <button
                type="button"
                className="import-link-button"
                onClick={() => onNavigate('roster')}
              >
                Open full roster →
              </button>
            )}
          </section>

          {/* Schedule & Results card */}
          <section className="my-team-card">
            <h3>Schedule &amp; Results</h3>
            {summary.schedule.totalGames === 0 ? (
              <p className="empty-state">No schedule or results loaded for this team.</p>
            ) : (
              <>
                <div className="roster-status-summary">
                  <span className="roster-status-count">
                    <strong>{wlt(summary.schedule.overallRecord)}</strong> Overall
                  </span>
                  <span className="roster-status-count">
                    <strong>{wlt(summary.schedule.regularSeasonRecord)}</strong> Regular
                  </span>
                  <span className="roster-status-count">
                    <strong>{wlt(summary.schedule.playoffRecord)}</strong> Playoffs
                  </span>
                  <span className="roster-status-count">
                    <strong>{wlt(summary.schedule.championshipRecord)}</strong> Championship
                  </span>
                </div>
                <div className="roster-status-summary">
                  <span className="roster-status-count">
                    <strong>{summary.schedule.pointsFor}</strong> PF
                  </span>
                  <span className="roster-status-count">
                    <strong>{summary.schedule.pointsAgainst}</strong> PA
                  </span>
                  <span className="roster-status-count">
                    <strong>{diff(summary.schedule.pointDifferential)}</strong> DIFF
                  </span>
                  <span className="roster-status-count">
                    <strong>{summary.schedule.upcomingGames}</strong> Upcoming
                  </span>
                  <span className="roster-status-count">
                    <strong>{summary.schedule.cancelledGames}</strong> Cancelled
                  </span>
                </div>
                <p className="schedule-highlight">
                  <strong>Next game:</strong>{' '}
                  {summary.schedule.nextGame
                    ? formatGameLine(summary.schedule.nextGame)
                    : 'None scheduled'}
                </p>
                <p className="schedule-highlight">
                  <strong>Last result:</strong>{' '}
                  {summary.schedule.lastGame
                    ? formatGameLine(summary.schedule.lastGame)
                    : 'No completed games'}
                </p>
              </>
            )}
            {onNavigate && (
              <button
                type="button"
                className="import-link-button"
                onClick={() => onNavigate('schedule')}
              >
                Open schedule import →
              </button>
            )}
          </section>

          {/* Standings card */}
          <section className="my-team-card">
            <h3>Standings</h3>
            {summary.standings.hasFinalGames ? (
              <div className="roster-status-summary">
                <span className="roster-status-count">
                  <strong>
                    {summary.standings.rank !== null ? `#${summary.standings.rank}` : '—'}
                  </strong>{' '}
                  Rank
                </span>
                <span className="roster-status-count">
                  <strong>{summary.standings.totalTeams}</strong> Teams
                </span>
                <span className="roster-status-count">
                  <strong>{pct(summary.standings.winPercentage)}</strong> Win%
                </span>
                <span className="roster-status-count">
                  <strong>{diff(summary.standings.pointDifferential)}</strong> Differential
                </span>
              </div>
            ) : (
              <p className="empty-state">
                No final games in this season/age division yet — standings position is provisional.
              </p>
            )}
            {onNavigate && (
              <button
                type="button"
                className="import-link-button"
                onClick={() => onNavigate('standings')}
              >
                Open standings →
              </button>
            )}
          </section>

          {/* Coaches card */}
          <section className="my-team-card">
            <h3>Coaching Staff</h3>
            {summary.coaches.totalAssignedCoaches === 0 ? (
              <p className="empty-state">No coach or staff data loaded for this team.</p>
            ) : (
              <>
                <p className="staff-line">
                  <strong>Head coach:</strong>{' '}
                  {summary.coaches.headCoaches.length > 0
                    ? summary.coaches.headCoaches.map((m) => m.displayName).join(', ')
                    : '—'}
                </p>
                <p className="staff-line">
                  <strong>Assistants:</strong>{' '}
                  {summary.coaches.assistantCoaches.length > 0
                    ? summary.coaches.assistantCoaches.map((m) => m.displayName).join(', ')
                    : '—'}
                </p>
                <div className="roster-status-summary">
                  <span className="roster-status-count">
                    <strong>{formatPerf(summary.coaches.withTeamRecord)}</strong> Staff record with
                    this team
                  </span>
                  {summary.coaches.continuity.available && (
                    <>
                      <span className="roster-status-count">
                        <strong>{summary.coaches.continuity.returningCoaches}</strong> Returning
                      </span>
                      <span className="roster-status-count">
                        <strong>{summary.coaches.continuity.newToTeamCoaches}</strong> New
                      </span>
                      <span className="roster-status-count">
                        <strong>{summary.coaches.continuity.departedCoaches}</strong> Departed
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
            {onNavigate && (
              <button
                type="button"
                className="import-link-button"
                onClick={() => onNavigate('coaches')}
              >
                Open coach performance →
              </button>
            )}
          </section>

          {/* Attention Items card */}
          <section className="my-team-card my-team-card-attention">
            <h3>Attention Items</h3>
            {summary.attentionItems.length === 0 ? (
              <p className="empty-state">Nothing needs attention for this team right now.</p>
            ) : (
              <ul className="my-team-attention-list">
                {summary.attentionItems.map((item) => (
                  <AttentionRow key={item.code} item={item} />
                ))}
              </ul>
            )}
          </section>

          {/* Workspace status card */}
          <section className="my-team-card my-team-card-workspace">
            <h3>Workspace</h3>
            <p className="import-reasons">
              This command center is recomputed from the in-memory workspace. There is no
              auto-save, browser storage, or cloud sync. Export a workspace snapshot to keep your
              data; import one to restore it.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function AttentionRow({ item }: { item: MyTeamAttentionItem }) {
  return (
    <li className={`my-team-attention-item my-team-attention-${item.severity}`}>
      <span className={`my-team-severity my-team-severity-${item.severity}`}>
        {SEVERITY_LABELS[item.severity]}
      </span>
      <span className="my-team-attention-message">{item.message}</span>
    </li>
  );
}

function formatPerf(record: CoachPerformanceRecord): string {
  const base = `${record.wins}–${record.losses}–${record.ties}`;
  return record.gamesPlayed === 0 ? base : `${base} (${record.winPercentage.toFixed(3)})`;
}

// Local label resolvers for the picker (kept tiny; the engine owns display logic for the cards).
function districtName(districts: District[], districtId: string): string {
  return districts.find((d) => d.districtId === districtId)?.name ?? districtId;
}
function ageDivisionName(ageDivisions: AgeDivision[], ageDivisionId: string): string {
  return ageDivisions.find((a) => a.ageDivisionId === ageDivisionId)?.name ?? ageDivisionId;
}
