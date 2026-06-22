import { useState } from 'react';
import type { Team, District, AgeDivision, Player, Game, GameStatus } from '../domain/types';
import { countPlayers, countHeadCoaches, countAssistantCoaches } from '../engine/summaries';
import { summarizeTeamRosterStatus } from '../engine/teamRosterStatusSummary';
import { summarizeTeamPriorSeasonComparison } from '../engine/priorSeasonRosterComparisonSummary';
import {
  deriveCurrentRosterPlayerStatuses,
  currentPlayerNeedsIdentityReview,
} from '../engine/currentRosterPlayerStatus';
import {
  summarizeTeamSchedule,
  type TeamScheduleGameView,
  type ContextRecord,
} from '../engine/teamScheduleSummary';
import type {
  GameResultPatch,
  GameResultUpdateResult,
} from '../engine/gameResultUpdate';
import { summarizeTeamCoachStaff } from '../engine/coachHistorySummary';
import {
  summarizeTeamCoachPerformance,
  type CoachPerformanceRecord,
} from '../engine/coachPerformanceSummary';
import type { StaffCoach, TeamCoachAssignment } from '../domain/types';
import { getTeamBranding } from '../engine/teamBrandingDisplay';
import CoachCard from './CoachCard';
import PlayerCard from './PlayerCard';
import TeamBrandBadge from './TeamBrandBadge';

interface TeamViewProps {
  team: Team;
  districts: District[];
  ageDivisions: AgeDivision[];
  priorPlayers?: Player[] | null;
  /** All teams in the workspace, used to resolve opponents (no opponent objects). */
  teams?: Team[];
  /** All games in the workspace; the team's schedule is derived from these. */
  games?: Game[];
  /** Normalized coach model (slice 27). */
  coaches?: StaffCoach[];
  coachAssignments?: TeamCoachAssignment[];
  /** Prior same-slot teamId, for coach continuity (slice 27). */
  priorSeasonTeamId?: string | null;
  /**
   * Optional in-memory result/status update handler (slice 25). When provided, each game
   * row gets an Edit Result control. Returns the update result (errors are shown inline).
   */
  onUpdateGameResult?: (gameId: string, patch: GameResultPatch) => GameResultUpdateResult;
  /** Opens an opponent team in My Team. Display-only navigation; never mutates data. */
  onOpenTeam?: (teamId: string) => void;
}

const GAME_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  final: 'Final',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
};

const EDITABLE_STATUSES: GameStatus[] = ['scheduled', 'final', 'cancelled', 'postponed'];

const ROLE_LABELS: Record<string, string> = {
  headCoach: 'Head Coach',
  assistantCoach: 'Assistant Coach',
  unknown: 'Unknown role',
};

export default function TeamView({
  team,
  districts,
  ageDivisions,
  priorPlayers,
  teams = [],
  games = [],
  coaches = [],
  coachAssignments = [],
  priorSeasonTeamId = null,
  onUpdateGameResult,
  onOpenTeam,
}: TeamViewProps) {
  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const gamesById = new Map(games.map((g) => [g.gameId, g]));
  const allTeams = teams.length > 0 ? teams : [team];
  const teamIds = new Set(allTeams.map((t) => t.teamId));
  const branding = getTeamBranding(team, districts, ageDivisions);
  const staff = summarizeTeamCoachStaff({
    teamId: team.teamId,
    seasonId: team.seasonId,
    coaches,
    coachAssignments,
    priorSeasonTeamId,
  });
  const coachPerformance = summarizeTeamCoachPerformance({
    teamId: team.teamId,
    seasonId: team.seasonId,
    coaches,
    coachAssignments,
    teams: teams.length > 0 ? teams : [team],
    games,
    districts,
    ageDivisions,
  });
  const district = districts.find((d) => d.districtId === team.districtId);
  const ageDivision = ageDivisions.find((a) => a.ageDivisionId === team.ageDivisionId);

  const districtName = district?.name ?? team.districtId;
  const ageDivisionName = ageDivision?.name ?? team.ageDivisionId;
  const teamName = `${districtName} ${ageDivisionName} ${team.teamCode}`;

  const rosterStatus = summarizeTeamRosterStatus(team.players, priorPlayers);
  const priorComparison = summarizeTeamPriorSeasonComparison(team.players, priorPlayers);
  const playerStatuses = deriveCurrentRosterPlayerStatuses(team.players, priorPlayers);
  const schedule = summarizeTeamSchedule({
    teamId: team.teamId,
    games,
    teams: teams.length > 0 ? teams : [team],
    districts,
    ageDivisions,
  });

  return (
    <div className="team-view">
      <h2 className="team-name">
        <TeamBrandBadge branding={branding} title={branding.districtName} />
        {teamName}
      </h2>

      <div className="team-meta">
        <span><strong>District:</strong> {districtName}</span>
        <span><strong>Age Division:</strong> {ageDivisionName}</span>
        <span><strong>Team Code:</strong> {team.teamCode}</span>
      </div>

      <div className="team-summary">
        <span>Players: {countPlayers(team)}</span>
        <span>Head Coaches: {countHeadCoaches(team)}</span>
        <span>Assistant Coaches: {countAssistantCoaches(team)}</span>
      </div>

      <section className="team-section">
        <h3>Roster Status</h3>
        {rosterStatus.available ? (
          <div className="roster-status-summary">
            <span className="roster-status-count">
              <strong>{rosterStatus.summary.returning}</strong> Returning
            </span>
            <span className="roster-status-count">
              <strong>{rosterStatus.summary.new}</strong> New
            </span>
            <span className="roster-status-count">
              <strong>{rosterStatus.summary.notReturning}</strong> Not returning
            </span>
            <span className="roster-status-count">
              <strong>{rosterStatus.summary.unknown}</strong> Unknown
            </span>
            <span className="roster-status-count">
              <strong>{rosterStatus.summary.highConfidence}</strong> High confidence
            </span>
            <span className="roster-status-count">
              <strong>{rosterStatus.summary.lowConfidence}</strong> Low confidence
            </span>
          </div>
        ) : (
          <p className="empty-state">
            Prior-season roster comparison is not available for this team.
          </p>
        )}
      </section>

      <section className="team-section">
        <h3>Prior-Season Comparison</h3>
        {priorComparison.available ? (
          <div className="roster-status-summary">
            <span className="roster-status-count">
              <strong>{priorComparison.summary.returning}</strong> Returning
            </span>
            <span className="roster-status-count">
              <strong>{priorComparison.summary.newToRoster}</strong> New to roster
            </span>
            <span className="roster-status-count">
              <strong>{priorComparison.summary.notReturning}</strong> Not returning
            </span>
            <span className="roster-status-count">
              <strong>{priorComparison.summary.unknownCurrent}</strong> Unknown current
            </span>
            <span className="roster-status-count">
              <strong>{priorComparison.summary.unknownPrior}</strong> Unknown prior
            </span>
            <span className="roster-status-count">
              <strong>{priorComparison.summary.totalCurrent}</strong> Total current
            </span>
            <span className="roster-status-count">
              <strong>{priorComparison.summary.totalPrior}</strong> Total prior
            </span>
            <span className="roster-status-count">
              <strong>{priorComparison.summary.highConfidence}</strong> High confidence
            </span>
            <span className="roster-status-count">
              <strong>{priorComparison.summary.lowConfidence}</strong> Low confidence
            </span>
          </div>
        ) : (
          <p className="empty-state">
            No prior-season same-slot team is available to compare against.
          </p>
        )}
      </section>

      <section className="team-section">
        <h3>Schedule &amp; Results</h3>
        {schedule.totalGames === 0 ? (
          <p className="empty-state">No schedule/results loaded for this team.</p>
        ) : (
          <>
            <div className="roster-status-summary">
              <span className="roster-status-count">
                <strong>
                  {schedule.wins}–{schedule.losses}–{schedule.ties}
                </strong>{' '}
                W–L–T
              </span>
              <span className="roster-status-count">
                <strong>{schedule.pointsFor}</strong> Points for
              </span>
              <span className="roster-status-count">
                <strong>{schedule.pointsAgainst}</strong> Points against
              </span>
              <span className="roster-status-count">
                <strong>
                  {schedule.pointDifferential >= 0 ? '+' : ''}
                  {schedule.pointDifferential}
                </strong>{' '}
                Differential
              </span>
              <span className="roster-status-count">
                <strong>{schedule.upcomingGames}</strong> Upcoming
              </span>
              <span className="roster-status-count">
                <strong>{schedule.cancelledGames}</strong> Cancelled
              </span>
            </div>

            <div className="roster-status-summary">
              <span className="roster-status-count">
                <strong>{formatRecord(schedule.regularSeasonRecord)}</strong> Regular season
              </span>
              <span className="roster-status-count">
                <strong>{formatRecord(schedule.playoffRecord)}</strong> Playoffs
              </span>
              <span className="roster-status-count">
                <strong>{formatRecord(schedule.championshipRecord)}</strong> Championship
              </span>
            </div>

            <p className="schedule-highlight">
              <strong>Next game:</strong>{' '}
              {schedule.nextGame
                ? `${formatGameLine(schedule.nextGame)}`
                : 'None scheduled'}
            </p>
            <p className="schedule-highlight">
              <strong>Last result:</strong>{' '}
              {schedule.lastGame
                ? `${formatGameLine(schedule.lastGame)}`
                : 'No completed games'}
            </p>

            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Date / Week</th>
                  <th>H/A</th>
                  <th>Opponent</th>
                  <th>Status</th>
                  <th>Score / Result</th>
                  <th>Location</th>
                  {onUpdateGameResult && <th>Result (in memory)</th>}
                </tr>
              </thead>
              <tbody>
                {schedule.games.map((game) => (
                  <tr key={game.gameId}>
                    <td>
                      {game.scheduledDate ?? 'TBD'}
                      <span className="schedule-week"> · {game.weekLabel}</span>
                    </td>
                    <td>{game.homeAway === 'home' ? 'Home' : 'Away'}</td>
                    <td>
                      {onOpenTeam &&
                      !game.unresolvedReference &&
                      teamIds.has(game.opponentTeamId) ? (
                        <button
                          type="button"
                          className="link-button-inline"
                          onClick={() => onOpenTeam(game.opponentTeamId)}
                          title="Open opponent in My Team"
                        >
                          {game.opponentDisplayName}
                        </button>
                      ) : (
                        game.opponentDisplayName
                      )}
                      {game.gameType === 'championship' && (
                        <span className="game-tag game-tag-championship">Championship</span>
                      )}
                      {game.gameType === 'playoff' && (
                        <span className="game-tag game-tag-playoff">Playoff</span>
                      )}
                      {game.isNeutralSite && (
                        <span className="game-tag game-tag-neutral">Neutral</span>
                      )}
                      {game.unresolvedReference && (
                        <span className="schedule-unresolved">
                          {' '}
                          (opponent reference could not be resolved)
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`schedule-status schedule-status-${game.status}`}>
                        {GAME_STATUS_LABELS[game.status] ?? game.status}
                      </span>
                    </td>
                    <td>
                      {game.scoreDisplay
                        ? `${game.scoreDisplay} ${game.resultDisplay}`
                        : '—'}
                    </td>
                    <td>{game.location ?? '—'}</td>
                    {onUpdateGameResult && (
                      <td>
                        <button
                          type="button"
                          className="import-link-button"
                          onClick={() => {
                            setEditingGameId(
                              editingGameId === game.gameId ? null : game.gameId
                            );
                            setEditErrors([]);
                          }}
                        >
                          {editingGameId === game.gameId ? 'Close' : 'Edit Result'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {onUpdateGameResult && editingGameId && gamesById.has(editingGameId) && (
              <GameResultEditor
                game={gamesById.get(editingGameId)!}
                errors={editErrors}
                onCancel={() => {
                  setEditingGameId(null);
                  setEditErrors([]);
                }}
                onSave={(patch) => {
                  const result = onUpdateGameResult(editingGameId, patch);
                  if (result.ok) {
                    setEditingGameId(null);
                    setEditErrors([]);
                  } else {
                    setEditErrors(result.errors.map((e) => e.message));
                  }
                }}
              />
            )}
          </>
        )}
      </section>

      <section className="team-section">
        <h3>Coaching Staff &amp; History</h3>
        {staff.totalAssignedCoaches === 0 ? (
          <p className="empty-state">No coach/staff data loaded for this team.</p>
        ) : (
          <>
            {staff.continuity.available && (
              <div className="roster-status-summary">
                <span className="roster-status-count">
                  <strong>{staff.continuity.returningCoaches}</strong> Returning
                </span>
                <span className="roster-status-count">
                  <strong>{staff.continuity.newToTeamCoaches}</strong> New to team
                </span>
                <span className="roster-status-count">
                  <strong>{staff.continuity.departedCoaches}</strong> Departed
                </span>
              </div>
            )}
            <StaffRoleList label="Head coach" members={staff.headCoaches} />
            <StaffRoleList label="Assistant coaches" members={staff.assistantCoaches} />
            {staff.unknownRoleCoaches.length > 0 && (
              <StaffRoleList label="Unknown role" members={staff.unknownRoleCoaches} />
            )}
            {staff.unresolvedCoachReferences > 0 && (
              <p className="schedule-unresolved">
                {staff.unresolvedCoachReferences} assignment(s) reference a coach not in the
                workspace.
              </p>
            )}

            <h4 className="staff-performance-heading">Coach performance</h4>
            {coachPerformance.hasFinalGames ? (
              <p className="import-reasons">
                “With this team” covers this team’s final games only. “Career” covers all of the
                coach’s assignments. Derived from final games — read-only.
              </p>
            ) : (
              <p className="import-reasons">
                No final games for this team yet — with-this-team records show 0–0–0. Career
                records reflect the coach’s other assigned teams. Read-only.
              </p>
            )}
            <table className="schedule-table">
              <thead>
                <tr>
                  <th>Coach</th>
                  <th>Role</th>
                  <th>With this team</th>
                  <th>Regular</th>
                  <th>Playoff</th>
                  <th>Championship</th>
                  <th>Career / all assignments</th>
                </tr>
              </thead>
              <tbody>
                {coachPerformance.members.map((m) => (
                  <tr key={m.assignmentId}>
                    <td>
                      {m.displayName}
                      {m.unresolvedCoach && (
                        <span className="schedule-unresolved"> (unresolved)</span>
                      )}
                    </td>
                    <td>{ROLE_LABELS[m.role] ?? m.role}</td>
                    <td>{formatPerfRecord(m.withTeamRecord)}</td>
                    <td>{formatRecord(m.withTeamRegularSeasonRecord)}</td>
                    <td>{formatRecord(m.withTeamPlayoffRecord)}</td>
                    <td>{formatRecord(m.withTeamChampionshipRecord)}</td>
                    <td>{formatPerfRecord(m.careerRecord)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {coachPerformance.unresolvedGameReferenceCount > 0 && (
              <p className="schedule-unresolved">
                {coachPerformance.unresolvedGameReferenceCount} credited game(s) reference an
                unresolved opponent.
              </p>
            )}
          </>
        )}
      </section>

      <section className="team-section">
        <h3>Head Coach</h3>
        {team.headCoach ? (
          <CoachCard coach={team.headCoach} role="headCoach" />
        ) : (
          <p className="empty-state">No head coach</p>
        )}
      </section>

      <section className="team-section">
        <h3>Assistant Coaches</h3>
        {team.assistantCoaches.length > 0 ? (
          team.assistantCoaches.map((coach, i) => (
            <CoachCard key={i} coach={coach} role="assistantCoach" />
          ))
        ) : (
          <p className="empty-state">No assistant coaches</p>
        )}
      </section>

      <section className="team-section">
        <h3>Players</h3>
        {team.players.length > 0 ? (
          playerStatuses.available ? (
            playerStatuses.statuses.map((entry, i) => (
              <PlayerCard
                key={i}
                player={entry.player}
                status={entry.derived.status}
                lowConfidence={currentPlayerNeedsIdentityReview(entry.derived)}
              />
            ))
          ) : (
            team.players.map((player, i) => <PlayerCard key={i} player={player} />)
          )
        ) : (
          <p className="empty-state">No players</p>
        )}
      </section>
    </div>
  );
}

function GameResultEditor({
  game,
  errors,
  onSave,
  onCancel,
}: {
  game: Game;
  errors: string[];
  onSave: (patch: GameResultPatch) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<GameStatus>(game.status);
  const [homeScore, setHomeScore] = useState<string>(
    game.homeScore === undefined ? '' : String(game.homeScore)
  );
  const [awayScore, setAwayScore] = useState<string>(
    game.awayScore === undefined ? '' : String(game.awayScore)
  );
  const [notes, setNotes] = useState<string>(game.notes ?? '');

  function save() {
    onSave({
      status,
      homeScore: homeScore.trim() === '' ? null : Number(homeScore),
      awayScore: awayScore.trim() === '' ? null : Number(awayScore),
      notes: notes.trim() === '' ? null : notes,
    });
  }

  return (
    <div className="game-result-editor">
      <h4>Edit result — {game.gameId} (in memory only)</h4>
      <div className="game-result-fields">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value as GameStatus)}>
            {EDITABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {GAME_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Home score
          <input
            type="number"
            value={homeScore}
            onChange={(e) => setHomeScore(e.target.value)}
            placeholder="—"
          />
        </label>
        <label>
          Away score
          <input
            type="number"
            value={awayScore}
            onChange={(e) => setAwayScore(e.target.value)}
            placeholder="—"
          />
        </label>
        <label className="game-result-notes">
          Notes
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>
      {errors.length > 0 && (
        <ul className="import-issues">
          {errors.map((message, i) => (
            <li key={i} className="import-issue import-issue-error">
              {message}
            </li>
          ))}
        </ul>
      )}
      <p className="import-reasons">
        Final games require both scores. Saved in memory only — export a workspace snapshot to
        keep it.
      </p>
      <button type="button" className="import-decision-button" onClick={save}>
        Save Result In Memory
      </button>
      <button type="button" className="import-link-button" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** Formats a context record as "W–L–T". */
function formatRecord(record: ContextRecord): string {
  return `${record.wins}–${record.losses}–${record.ties}`;
}

/** Formats a coach performance record as "W–L–T (.pct)"; pct omitted when no games. */
function formatPerfRecord(record: CoachPerformanceRecord): string {
  const base = `${record.wins}–${record.losses}–${record.ties}`;
  return record.gamesPlayed === 0 ? base : `${base} (${record.winPercentage.toFixed(3)})`;
}

function StaffRoleList({
  label,
  members,
}: {
  label: string;
  members: ReturnType<typeof summarizeTeamCoachStaff>['headCoaches'];
}) {
  return (
    <div className="staff-role">
      <span className="staff-role-label">{label}:</span>{' '}
      {members.length === 0 ? (
        <span className="empty-state">none</span>
      ) : (
        members.map((m, i) => (
          <span key={m.assignmentId} className="staff-coach-name">
            {i > 0 && ', '}
            {m.displayName}
            {m.sourceLabel && m.role === 'unknown' ? ` (${m.sourceLabel})` : ''}
            {m.unresolvedCoach && (
              <span className="schedule-unresolved"> (unresolved)</span>
            )}
          </span>
        ))
      )}
    </div>
  );
}

/** One-line summary of a game from the selected team's perspective. */
function formatGameLine(game: TeamScheduleGameView): string {
  const date = game.scheduledDate ?? 'TBD';
  const place = game.homeAway === 'home' ? 'vs' : 'at';
  const score = game.scoreDisplay ? ` (${game.scoreDisplay} ${game.resultDisplay})` : '';
  return `${date} · ${game.weekLabel} · ${place} ${game.opponentDisplayName}${score}`;
}
