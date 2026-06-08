import type { Team, District, AgeDivision } from '../domain/types';
import { countPlayers, countHeadCoaches, countAssistantCoaches } from '../engine/summaries';
import CoachCard from './CoachCard';
import PlayerCard from './PlayerCard';

interface TeamViewProps {
  team: Team;
  districts: District[];
  ageDivisions: AgeDivision[];
}

export default function TeamView({ team, districts, ageDivisions }: TeamViewProps) {
  const district = districts.find((d) => d.districtId === team.districtId);
  const ageDivision = ageDivisions.find((a) => a.ageDivisionId === team.ageDivisionId);

  const districtName = district?.name ?? team.districtId;
  const ageDivisionName = ageDivision?.name ?? team.ageDivisionId;
  const teamName = `${districtName} ${ageDivisionName} ${team.teamCode}`;

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
          team.players.map((player, i) => (
            <PlayerCard key={i} player={player} />
          ))
        ) : (
          <p className="empty-state">No players</p>
        )}
      </section>
    </div>
  );
}
