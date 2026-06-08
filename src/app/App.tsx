import { useState, useEffect } from 'react';
import './App.css';
import { loadSampleData } from '../data/loadSampleData';
import { getDistinctSeasons } from '../engine/filters';
import FilterBar from '../components/FilterBar';
import TeamView from '../components/TeamView';

const appData = loadSampleData();

export default function App() {
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedAgeDivision, setSelectedAgeDivision] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Auto-select the first available season on load
  useEffect(() => {
    const seasons = getDistinctSeasons(appData.teams);
    if (seasons.length > 0 && selectedSeason === null) {
      setSelectedSeason(seasons[0]);
    }
  }, [selectedSeason]);

  function handleSeasonChange(seasonId: string) {
    setSelectedSeason(seasonId);
    setSelectedDistrict(null);
    setSelectedAgeDivision(null);
    setSelectedTeamId(null);
  }

  function handleDistrictChange(districtId: string) {
    setSelectedDistrict(districtId);
    setSelectedAgeDivision(null);
    setSelectedTeamId(null);
  }

  function handleAgeDivisionChange(ageDivisionId: string) {
    setSelectedAgeDivision(ageDivisionId);
    setSelectedTeamId(null);
  }

  function handleTeamChange(teamId: string) {
    setSelectedTeamId(teamId);
  }

  const selectedTeam = selectedTeamId
    ? appData.teams.find((t) => t.teamId === selectedTeamId) ?? null
    : null;

  return (
    <div>
      <h1>UC Roster Sniffer</h1>
      <FilterBar
        teams={appData.teams}
        districts={appData.districts}
        ageDivisions={appData.ageDivisions}
        selectedSeason={selectedSeason}
        selectedDistrict={selectedDistrict}
        selectedAgeDivision={selectedAgeDivision}
        selectedTeamId={selectedTeamId}
        onSeasonChange={handleSeasonChange}
        onDistrictChange={handleDistrictChange}
        onAgeDivisionChange={handleAgeDivisionChange}
        onTeamChange={handleTeamChange}
      />
      {selectedTeam ? (
        <TeamView
          team={selectedTeam}
          districts={appData.districts}
          ageDivisions={appData.ageDivisions}
        />
      ) : (
        <p className="no-selection">Select a season, district, age division, and team to view the roster.</p>
      )}
    </div>
  );
}
