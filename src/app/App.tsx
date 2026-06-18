import { useState, useEffect } from 'react';
import './App.css';
import { loadSampleData } from '../data/loadSampleData';
import { getDistinctSeasons } from '../engine/filters';
import { findPriorSeasonTeam } from '../engine/teamRosterStatusSummary';
import FilterBar from '../components/FilterBar';
import TeamView from '../components/TeamView';
import ScrapedImportPreview from '../components/ScrapedImportPreview';

const appData = loadSampleData();

type AppView = 'roster' | 'import';

export default function App() {
  const [view, setView] = useState<AppView>('roster');
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedAgeDivision, setSelectedAgeDivision] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  // Auto-select the most recent available season on load, so a season that can
  // show prior-season roster comparison is the default view.
  useEffect(() => {
    const seasons = getDistinctSeasons(appData.teams);
    if (seasons.length > 0 && selectedSeason === null) {
      setSelectedSeason(seasons[seasons.length - 1]);
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

  const priorTeam = selectedTeam
    ? findPriorSeasonTeam(appData.teams, selectedTeam)
    : null;

  const rosterContent = (
    <>
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
          priorPlayers={priorTeam?.players ?? null}
        />
      ) : (
        <p className="no-selection">Select a season, district, age division, and team to view the roster.</p>
      )}
    </>
  );

  return (
    <div>
      <h1>UC Roster Sniffer</h1>
      <nav className="app-nav">
        <button
          type="button"
          className={`app-nav-button ${view === 'roster' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'roster'}
          onClick={() => setView('roster')}
        >
          Roster
        </button>
        <button
          type="button"
          className={`app-nav-button ${view === 'import' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'import'}
          onClick={() => setView('import')}
        >
          Import preview (read-only)
        </button>
      </nav>

      {view === 'import' ? <ScrapedImportPreview /> : rosterContent}
    </div>
  );
}
