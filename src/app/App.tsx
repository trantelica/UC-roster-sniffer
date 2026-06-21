import { useState, useEffect, useRef } from 'react';
import './App.css';
import { loadSampleData } from '../data/loadSampleData';
import { getDistinctSeasons } from '../engine/filters';
import { findPriorSeasonTeam } from '../engine/teamRosterStatusSummary';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  restoreWorkspaceFromSnapshot,
  type WorkspaceData,
  type WorkspaceSnapshotSummary,
  type WorkspaceSnapshotValidationError,
} from '../engine/workspaceSnapshot';
import { updateGameResult, type GameResultPatch } from '../engine/gameResultUpdate';
import type { Game, StaffCoach, TeamCoachAssignment } from '../domain/types';
import FilterBar from '../components/FilterBar';
import TeamView from '../components/TeamView';
import ScrapedImportPreview, {
  type InMemoryImportAppState,
} from '../components/ScrapedImportPreview';
import ScheduleImportWorkbench from '../components/ScheduleImportWorkbench';
import StandingsView from '../components/StandingsView';
import CoachImportWorkbench from '../components/CoachImportWorkbench';
import CoachDirectoryView from '../components/CoachDirectoryView';

const initialAppData = loadSampleData();

type AppView = 'roster' | 'import' | 'schedule' | 'standings' | 'coach-import' | 'coaches';

type SnapshotNotice =
  | { kind: 'restored'; fileName: string; summary: WorkspaceSnapshotSummary }
  | { kind: 'error'; fileName: string; errors: WorkspaceSnapshotValidationError[] };

export default function App() {
  const [view, setView] = useState<AppView>('roster');
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);
  const [selectedAgeDivision, setSelectedAgeDivision] = useState<string | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  // The current local workspace (districts / age divisions / teams). Starts from the
  // bundled sample data; a workspace-snapshot import REPLACES it (slice 23).
  const [workspace, setWorkspace] = useState<WorkspaceData>(initialAppData);
  // Non-durable, in-memory import execution state (null = showing the baseline roster).
  const [inMemoryImport, setInMemoryImport] =
    useState<InMemoryImportAppState | null>(null);
  // Bumped on a snapshot restore to force-remount the import workbench, clearing its
  // transient state (loaded source, review decisions, staged preview, execution/undo).
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [snapshotNotice, setSnapshotNotice] = useState<SnapshotNotice | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const liveTeams = inMemoryImport ? inMemoryImport.teams : workspace.teams;

  // Auto-select the most recent available season on load, so a season that can
  // show prior-season roster comparison is the default view.
  useEffect(() => {
    const seasons = getDistinctSeasons(workspace.teams);
    if (seasons.length > 0 && selectedSeason === null) {
      setSelectedSeason(seasons[seasons.length - 1]);
    }
  }, [selectedSeason, workspace]);

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

  // --- Slice 25: in-memory games (schedule import execution/undo + result edits) ---

  // Replaces the in-memory games array (used by schedule import execute/undo and result
  // edits). In-memory only — durability comes solely from a workspace snapshot export.
  function handleApplyGames(games: Game[]) {
    setWorkspace((current) => ({ ...current, games }));
  }

  function handleUpdateGameResult(gameId: string, patch: GameResultPatch) {
    const result = updateGameResult({ games: workspace.games, gameId, patch });
    if (result.ok) {
      setWorkspace((current) => ({ ...current, games: result.games }));
    }
    return result;
  }

  // --- Slice 27: in-memory coach data (coach import execute/undo) -----------
  function handleApplyCoachData(
    coaches: StaffCoach[],
    coachAssignments: TeamCoachAssignment[]
  ) {
    setWorkspace((current) => ({ ...current, coaches, coachAssignments }));
  }

  // --- Slice 23: portable workspace snapshot export / import ---------------

  function handleExportSnapshot() {
    const snapshot = buildWorkspaceSnapshot({
      workspace: {
        districts: workspace.districts,
        ageDivisions: workspace.ageDivisions,
        // The CURRENT in-memory roster, including any executed in-memory import additions.
        teams: liveTeams,
        // Schedules/results travel with the workspace snapshot (slice 24).
        games: workspace.games,
        // Coaches/assignments travel with the workspace snapshot (slice 27).
        coaches: workspace.coaches,
        coachAssignments: workspace.coachAssignments,
        selection: {
          seasonId: selectedSeason,
          districtId: selectedDistrict,
          ageDivisionId: selectedAgeDivision,
          teamId: selectedTeamId,
        },
      },
      generatedAt: new Date().toISOString(),
    });
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `uc-roster-sniffer-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function handleImportFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const result = parseWorkspaceSnapshotJson(text);
      if (!result.ok) {
        // Invalid snapshot: current workspace state is left completely unchanged.
        setSnapshotNotice({ kind: 'error', fileName: file.name, errors: result.errors });
      } else {
        // Valid snapshot: REPLACE the workspace (never merge) and clear all transient
        // import-execution / workbench state.
        const restored = restoreWorkspaceFromSnapshot(result.snapshot);
        setWorkspace(restored.workspace);
        setInMemoryImport(null);
        setSelectedSeason(restored.selection.seasonId);
        setSelectedDistrict(restored.selection.districtId);
        setSelectedAgeDivision(restored.selection.ageDivisionId);
        setSelectedTeamId(restored.selection.teamId);
        setWorkspaceEpoch((epoch) => epoch + 1);
        setSnapshotNotice({
          kind: 'restored',
          fileName: file.name,
          summary: restored.summary,
        });
      }
      if (importInputRef.current) importInputRef.current.value = '';
    };
    reader.onerror = () => {
      setSnapshotNotice({
        kind: 'error',
        fileName: file.name,
        errors: [{ code: 'invalid-json', message: 'The file could not be read locally.' }],
      });
      if (importInputRef.current) importInputRef.current.value = '';
    };
    reader.readAsText(file);
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
        districts={workspace.districts}
        ageDivisions={workspace.ageDivisions}
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
          districts={workspace.districts}
          ageDivisions={workspace.ageDivisions}
          priorPlayers={priorTeam?.players ?? null}
          teams={liveTeams}
          games={workspace.games}
          coaches={workspace.coaches}
          coachAssignments={workspace.coachAssignments}
          priorSeasonTeamId={priorTeam?.teamId ?? null}
          onUpdateGameResult={handleUpdateGameResult}
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
        <button
          type="button"
          className={`app-nav-button ${view === 'schedule' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'schedule'}
          onClick={() => setView('schedule')}
        >
          Schedule import
        </button>
        <button
          type="button"
          className={`app-nav-button ${view === 'standings' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'standings'}
          onClick={() => setView('standings')}
        >
          Standings
        </button>
        <button
          type="button"
          className={`app-nav-button ${view === 'coach-import' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'coach-import'}
          onClick={() => setView('coach-import')}
        >
          Coach import
        </button>
        <button
          type="button"
          className={`app-nav-button ${view === 'coaches' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'coaches'}
          onClick={() => setView('coaches')}
        >
          Coaches
        </button>
      </nav>

      <WorkspaceToolbar
        importInputRef={importInputRef}
        notice={snapshotNotice}
        onExport={handleExportSnapshot}
        onImportFileChange={handleImportFileChange}
        onDismissNotice={() => setSnapshotNotice(null)}
        inMemoryImportActive={inMemoryImport !== null}
      />

      {/*
        Both views stay mounted (visibility toggled) so an in-memory import execution and
        its Undo control are never lost by switching tabs while an execution is active.
      */}
      <div hidden={view !== 'roster'}>{rosterContent}</div>
      <div hidden={view !== 'import'}>
        <ScrapedImportPreview
          key={workspaceEpoch}
          baselineTeams={workspace.teams}
          onInMemoryImportChange={setInMemoryImport}
        />
      </div>
      <div hidden={view !== 'schedule'}>
        <ScheduleImportWorkbench
          key={workspaceEpoch}
          teams={liveTeams}
          games={workspace.games}
          onApplyGames={handleApplyGames}
        />
      </div>
      <div hidden={view !== 'standings'}>
        <StandingsView
          key={workspaceEpoch}
          teams={liveTeams}
          games={workspace.games}
          districts={workspace.districts}
          ageDivisions={workspace.ageDivisions}
          defaultSeasonId={selectedSeason}
        />
      </div>
      <div hidden={view !== 'coach-import'}>
        <CoachImportWorkbench
          key={workspaceEpoch}
          teams={liveTeams}
          coaches={workspace.coaches}
          coachAssignments={workspace.coachAssignments}
          onApplyCoachData={handleApplyCoachData}
        />
      </div>
      <div hidden={view !== 'coaches'}>
        <CoachDirectoryView
          key={workspaceEpoch}
          teams={liveTeams}
          districts={workspace.districts}
          ageDivisions={workspace.ageDivisions}
          coaches={workspace.coaches}
          coachAssignments={workspace.coachAssignments}
          games={workspace.games}
        />
      </div>
    </div>
  );
}

function WorkspaceToolbar({
  importInputRef,
  notice,
  onExport,
  onImportFileChange,
  onDismissNotice,
  inMemoryImportActive,
}: {
  importInputRef: React.RefObject<HTMLInputElement>;
  notice: SnapshotNotice | null;
  onExport: () => void;
  onImportFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDismissNotice: () => void;
  inMemoryImportActive: boolean;
}) {
  return (
    <div className="workspace-toolbar">
      <div className="workspace-toolbar-actions">
        <button type="button" className="workspace-button" onClick={onExport}>
          Export Workspace Snapshot
        </button>
        <label className="workspace-button workspace-import-label">
          Import Workspace Snapshot
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFileChange}
            className="workspace-import-input"
          />
        </label>
        <span className="workspace-toolbar-note">
          Portable JSON · replaces current in-memory workspace · no browser storage is used
        </span>
      </div>
      <p className="workspace-toolbar-warning">
        Importing a snapshot <strong>replaces</strong> the current in-memory workspace after
        validation and clears any active in-memory import (including undo).
        {inMemoryImportActive
          ? ' An in-memory import is currently active — importing will discard it.'
          : ''}{' '}
        Export saves a portable JSON file only; nothing is written to a database or browser
        storage.
      </p>

      {notice && notice.kind === 'restored' && (
        <div className="workspace-notice workspace-notice-ok">
          <strong>Workspace restored from “{notice.fileName}”.</strong>{' '}
          {notice.summary.seasonCount} seasons · {notice.summary.districtCount} districts ·{' '}
          {notice.summary.teamCount} teams · {notice.summary.playerCount} players ·{' '}
          {notice.summary.gameCount} games. The current in-memory workspace was replaced (no
          browser/database persistence).
          <button type="button" className="import-link-button" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}
      {notice && notice.kind === 'error' && (
        <div className="workspace-notice workspace-notice-error">
          <strong>Could not import “{notice.fileName}”.</strong> The current workspace was
          left unchanged.
          <ul className="import-issues">
            {notice.errors.map((e, index) => (
              <li key={`${e.code}-${index}`} className="import-issue import-issue-error">
                <strong>{e.code}</strong>: {e.message}
              </li>
            ))}
          </ul>
          <button type="button" className="import-link-button" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
