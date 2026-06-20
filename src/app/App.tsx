import { useState, useEffect } from 'react';
import './App.css';
import { loadSampleData } from '../data/loadSampleData';
import { getDistinctSeasons } from '../engine/filters';
import { findPriorSeasonTeam } from '../engine/teamRosterStatusSummary';
import FilterBar from '../components/FilterBar';
import TeamView from '../components/TeamView';
import ScrapedImportPreview, {
  type InMemoryImportAppState,
} from '../components/ScrapedImportPreview';

const appData = loadSampleData();

// The baseline roster is the loaded sample data, never mutated. An explicit in-memory
// import execution (slice 22) produces a separate live roster value; undo / reset returns
// to this baseline. Reloading the app always starts from the baseline — the in-memory
// execution is deliberately NOT durable.
const baselineTeams = appData.teams;

type AppView = 'roster' | 'import';

export default function App() {
  const [view, setView] = useState<AppView>('roster');
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedAgeDivision, setSelectedAgeDivision] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  // Non-durable, in-memory import execution state (null = showing the baseline roster).
  const [inMemoryImport, setInMemoryImport] =
    useState<InMemoryImportAppState | null>(null);

  const liveTeams = inMemoryImport ? inMemoryImport.teams : baselineTeams;

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
    ? liveTeams.find((t) => t.teamId === selectedTeamId) ?? null
    : null;

  const priorTeam = selectedTeam
    ? findPriorSeasonTeam(liveTeams, selectedTeam)
    : null;

  const rosterContent = (
    <>
      {inMemoryImport && (
        <div className="in-memory-import-banner">
          <strong>In-memory import active.</strong>{' '}
          {inMemoryImport.banner.teamName ?? inMemoryImport.banner.teamId}:{' '}
          {inMemoryImport.banner.beforeCount} → {inMemoryImport.banner.afterCount} players (
          {inMemoryImport.banner.addedCount} added in memory). This is in-memory only — no
          saved roster data, and it does not persist after reload. Undo it from the Import
          tab to restore the baseline roster.
        </div>
      )}
      <FilterBar
        teams={liveTeams}
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

      {/*
        Both views stay mounted (visibility toggled) so an in-memory import execution and
        its Undo control are never lost by switching tabs while an execution is active.
      */}
      <div hidden={view !== 'roster'}>{rosterContent}</div>
      <div hidden={view !== 'import'}>
        <ScrapedImportPreview
          baselineTeams={baselineTeams}
          onInMemoryImportChange={setInMemoryImport}
        />
      </div>
    </div>
  );
}
