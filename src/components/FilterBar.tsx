import type { AgeDivision, District, Team } from '../domain/types';
import { AGE_DIVISION_ORDER } from '../domain/constants';
import {
  getDistinctSeasons,
  getDistinctDistricts,
  getDistinctAgeDivisions,
  filterTeams,
} from '../engine/filters';

interface FilterBarProps {
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
  selectedSeason: string | null;
  selectedDistrict: string | null;
  selectedAgeDivision: string | null;
  selectedTeamId: string | null;
  onSeasonChange: (seasonId: string) => void;
  onDistrictChange: (districtId: string) => void;
  onAgeDivisionChange: (ageDivisionId: string) => void;
  onTeamChange: (teamId: string) => void;
}

export default function FilterBar({
  teams,
  districts,
  ageDivisions,
  selectedSeason,
  selectedDistrict,
  selectedAgeDivision,
  selectedTeamId,
  onSeasonChange,
  onDistrictChange,
  onAgeDivisionChange,
  onTeamChange,
}: FilterBarProps) {
  const seasons = getDistinctSeasons(teams);

  const districtIds = selectedSeason
    ? getDistinctDistricts(teams, selectedSeason)
    : [];

  const ageDivisionIds =
    selectedSeason && selectedDistrict
      ? getDistinctAgeDivisions(teams, selectedSeason, selectedDistrict)
      : [];

  const sortedAgeDivisionIds = [...ageDivisionIds].sort((a, b) => {
    const ai = AGE_DIVISION_ORDER.indexOf(a as typeof AGE_DIVISION_ORDER[number]);
    const bi = AGE_DIVISION_ORDER.indexOf(b as typeof AGE_DIVISION_ORDER[number]);
    return ai - bi;
  });

  const filteredTeams =
    selectedSeason && selectedDistrict && selectedAgeDivision
      ? filterTeams(teams, selectedSeason, selectedDistrict, selectedAgeDivision)
      : [];

  const districtMap = new Map(districts.map((d) => [d.districtId, d.name]));
  const ageDivisionMap = new Map(ageDivisions.map((a) => [a.ageDivisionId, a.name]));

  return (
    <div className="filter-bar">
      <div className="filter-group">
        <label htmlFor="season-select">Season</label>
        <select
          id="season-select"
          value={selectedSeason ?? ''}
          onChange={(e) => onSeasonChange(e.target.value)}
        >
          <option value="" disabled>Select season</option>
          {seasons.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="district-select">District</label>
        <select
          id="district-select"
          value={selectedDistrict ?? ''}
          disabled={!selectedSeason}
          onChange={(e) => onDistrictChange(e.target.value)}
        >
          <option value="" disabled>Select district</option>
          {districtIds.map((id) => (
            <option key={id} value={id}>{districtMap.get(id) ?? id}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="age-division-select">Age Division</label>
        <select
          id="age-division-select"
          value={selectedAgeDivision ?? ''}
          disabled={!selectedDistrict}
          onChange={(e) => onAgeDivisionChange(e.target.value)}
        >
          <option value="" disabled>Select age division</option>
          {sortedAgeDivisionIds.map((id) => (
            <option key={id} value={id}>{ageDivisionMap.get(id) ?? id}</option>
          ))}
        </select>
      </div>

      <div className="filter-group">
        <label htmlFor="team-select">Team</label>
        <select
          id="team-select"
          value={selectedTeamId ?? ''}
          disabled={!selectedAgeDivision}
          onChange={(e) => onTeamChange(e.target.value)}
        >
          <option value="" disabled>Select team</option>
          {filteredTeams.map((t) => (
            <option key={t.teamId} value={t.teamId}>
              {(districtMap.get(t.districtId) ?? t.districtId)} {ageDivisionMap.get(t.ageDivisionId) ?? t.ageDivisionId} {t.teamCode}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
