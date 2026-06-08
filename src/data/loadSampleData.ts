import districtConfig from '../../data-samples/district-config.sample.json';
import rosterImport from '../../data-samples/roster-import.sample.json';
import type { AppData, Team, Coach } from '../domain/types';

function toCoach(raw: { name: string }): Coach {
  return { name: raw.name };
}

export function loadSampleData(): AppData {
  const seasonId = rosterImport.seasonId;

  const teams: Team[] = rosterImport.teams.map((t) => ({
    teamId: t.teamId,
    seasonId,
    districtId: t.districtId,
    ageDivisionId: t.ageDivisionId,
    teamCode: t.teamCode,
    draftOrder: t.draftOrder,
    divisionTeamCount: t.divisionTeamCount,
    headCoach: t.headCoach ? toCoach(t.headCoach) : null,
    assistantCoaches: t.assistantCoaches.map(toCoach),
    players: t.players.map((p) => ({
      name: p.name,
      notes: p.notes ?? undefined,
    })),
  }));

  return {
    districts: districtConfig.districts,
    ageDivisions: districtConfig.ageDivisions,
    teams,
  };
}
