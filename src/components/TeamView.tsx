import type { Team, District, AgeDivision, Player, Game } from '../domain/types';
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
} from '../engine/teamScheduleSummary';
import CoachCard from './CoachCard';
import PlayerCard from './PlayerCard';

interface TeamViewProps {
  team: Team;
  districts: District[];
  ageDivisions: AgeDivision[];
  priorPlayers?: Player[] | null;
  /** All teams in the workspace, used to resolve opponents (no opponent objects). */
  teams?: Team[];
  /** All games in the workspace; the team's schedule is derived from these. */
  games?: Game[];
}

const GAME_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  final: 'Final',
  cancelled: 'Cancelled',
  postponed: 'Postponed',
};

export default function TeamView({
  team,
  districts,
  ageDivisions,
  priorPlayers,
  teams = [],
  games = [],
}: TeamViewProps) {
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
      <h2 className="team-name">{teamName}</h2>

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
                      {game.opponentDisplayName}
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
                  </tr>
                ))}
              </tbody>
            </table>
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

/** One-line summary of a game from the selected team's perspective. */
function formatGameLine(game: TeamScheduleGameView): string {
  const date = game.scheduledDate ?? 'TBD';
  const place = game.homeAway === 'home' ? 'vs' : 'at';
  const score = game.scoreDisplay ? ` (${game.scoreDisplay} ${game.resultDisplay})` : '';
  return `${date} · ${game.weekLabel} · ${place} ${game.opponentDisplayName}${score}`;
}
