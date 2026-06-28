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
  type WorkspaceSnapshotSelection,
  type WorkspaceSnapshotSummary,
  type WorkspaceSnapshotValidationError,
} from '../engine/workspaceSnapshot';
import { updateGameResult, type GameResultPatch } from '../engine/gameResultUpdate';
import {
  loadWorkspaceRecord,
  resolvePersistedWorkspaceLoad,
  saveWorkspaceSnapshot,
} from '../storage/workspaceIndexedDbStore';
import type { Game, StaffCoach, TeamCoachAssignment, Team } from '../domain/types';
import FilterBar from '../components/FilterBar';
import TeamView from '../components/TeamView';
import ScrapedImportPreview, {
  type InMemoryImportAppState,
  type ScrapedImportCommitPayload,
} from '../components/ScrapedImportPreview';
import {
  commitImportedTeamToWorkspace,
  undoImportedTeamCommitInWorkspace,
} from '../engine/workspaceImportCommit';
import ScheduleImportWorkbench from '../components/ScheduleImportWorkbench';
import StandingsView from '../components/StandingsView';
import CoachImportWorkbench from '../components/CoachImportWorkbench';
import CoachDirectoryView from '../components/CoachDirectoryView';
import MyTeamView from '../components/MyTeamView';
import AnalyticsView from '../components/AnalyticsView';
import ReviewCenterView from '../components/ReviewCenterView';

const initialAppData = loadSampleData();

type AppView =
  | 'roster'
  | 'my-team'
  | 'import'
  | 'schedule'
  | 'standings'
  | 'coach-import'
  | 'coaches'
  | 'analytics'
  | 'review';

type SnapshotNotice =
  | { kind: 'restored'; fileName: string; summary: WorkspaceSnapshotSummary }
  | { kind: 'error'; fileName: string; errors: WorkspaceSnapshotValidationError[] };

// Automatic IndexedDB persistence status, surfaced as a small save-state indicator (A1).
type PersistenceStatus =
  | 'loading' // reading any saved workspace from IndexedDB on startup
  | 'idle' // hydrated; nothing saved yet this session (e.g. fresh/empty store)
  | 'saving' // a debounced auto-save is in flight
  | 'saved' // the current workspace is saved locally in this browser
  | 'save-failed' // the most recent auto-save failed
  | 'load-failed'; // a stored workspace existed but could not be loaded/restored

// Debounce window for auto-save after a workspace change (A1: ~500-1000ms).
const AUTO_SAVE_DEBOUNCE_MS = 700;

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
  // B1: current-session undo for a committed scraped-JSON team import. Holds the pre-commit
  // team value. Not persisted: the committed import itself is durable via A1, but this undo
  // affordance is session-only and does not survive a reload.
  const [committedImportUndo, setCommittedImportUndo] = useState<{
    previousTeam: Team;
    committedTeamId: string;
    teamName: string | null;
    addedCount: number;
    beforeCount: number;
    afterCount: number;
  } | null>(null);
  // Bumped on a snapshot restore to force-remount the import workbench, clearing its
  // transient state (loaded source, review decisions, staged preview, execution/undo).
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0);
  const [snapshotNotice, setSnapshotNotice] = useState<SnapshotNotice | null>(null);
  // True once the current workspace has been replaced by an imported snapshot. Used only as a
  // read-only durability cue in the My Team command center; not persisted anywhere.
  const [workspaceFromImport, setWorkspaceFromImport] = useState(false);
  // Selected coach for the Coaches tab detail (slice 31). Component/app state only; cross-tab
  // navigation can target a specific coach. Cleared if that coach leaves the workspace.
  const [selectedCoachId, setSelectedCoachId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  // --- Slice A1: automatic IndexedDB workspace persistence -------------------
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('loading');
  // Gate auto-save until the initial load/restore has completed, so we never overwrite a
  // stored workspace before reading it, and never persist the untouched sample default.
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Latest selection, captured by ref so auto-save (triggered by workspace-data changes)
  // can include the current selection without firing on selection-only navigation.
  const selectionRef = useRef<WorkspaceSnapshotSelection>({
    seasonId: null,
    districtId: null,
    ageDivisionId: null,
    teamId: null,
  });
  selectionRef.current = {
    seasonId: selectedSeason,
    districtId: selectedDistrict,
    ageDivisionId: selectedAgeDivision,
    teamId: selectedTeamId,
  };

  const liveTeams = inMemoryImport ? inMemoryImport.teams : workspace.teams;

  // Startup: restore the saved workspace from IndexedDB if one exists. An empty store keeps
  // the default sample data; a corrupt/unrestorable record falls back calmly with a warning
  // and is never auto-deleted. Runs once on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const resolved = resolvePersistedWorkspaceLoad(await loadWorkspaceRecord());
      if (cancelled) return;
      if (resolved.status === 'restored') {
        const { restore } = resolved;
        setWorkspace(restore.workspace);
        setSelectedSeason(restore.selection.seasonId);
        setSelectedDistrict(restore.selection.districtId);
        setSelectedAgeDivision(restore.selection.ageDivisionId);
        setSelectedTeamId(restore.selection.teamId);
        setInMemoryImport(null);
        setWorkspaceEpoch((epoch) => epoch + 1);
        setPersistenceStatus('saved');
      } else if (resolved.status === 'error') {
        setPersistenceStatus('load-failed');
      } else {
        setPersistenceStatus('idle');
      }
      // Enable auto-save only after the initial read has resolved.
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-save the committed workspace (debounced) whenever its DATA changes. We persist
  // `workspace` — not `liveTeams` — so a transient, undoable in-memory import is not silently
  // committed by persistence. Selection rides along from `selectionRef` but does not itself
  // trigger a save, so mere navigation never persists the untouched sample default.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    setPersistenceStatus('saving');
    saveTimerRef.current = setTimeout(() => {
      const now = new Date().toISOString();
      const snapshot = buildWorkspaceSnapshot({
        workspace: {
          districts: workspace.districts,
          ageDivisions: workspace.ageDivisions,
          teams: workspace.teams,
          games: workspace.games,
          coaches: workspace.coaches,
          coachAssignments: workspace.coachAssignments,
          selection: selectionRef.current,
        },
        generatedAt: now,
      });
      saveWorkspaceSnapshot(snapshot, now)
        .then(() => setPersistenceStatus('saved'))
        .catch(() => setPersistenceStatus('save-failed'));
    }, AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [workspace]);

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

  // Clear a selected coach that no longer exists (e.g. after a workspace snapshot import).
  useEffect(() => {
    if (selectedCoachId && !workspace.coaches.some((c) => c.coachId === selectedCoachId)) {
      setSelectedCoachId(null);
    }
  }, [selectedCoachId, workspace.coaches]);

  // Cross-tab navigation (slice 31): open a team in My Team, or a coach in Coaches. These only
  // change selection/view state — they never mutate source data and persist nothing.
  function handleOpenTeam(teamId: string) {
    handleSelectMyTeam(teamId);
    setView('my-team');
  }

  function handleOpenCoach(coachId: string) {
    setSelectedCoachId(coachId);
    setView('coaches');
  }

  // My Team selection: set the team and sync the season/district/age-division cascade to that
  // team's slot, so switching to the Roster tab stays consistent. Reuses existing selection
  // state — no separate My Team data model.
  function handleSelectMyTeam(teamId: string) {
    if (teamId === '') {
      setSelectedTeamId(null);
      return;
    }
    const team = liveTeams.find((t) => t.teamId === teamId);
    if (!team) {
      setSelectedTeamId(teamId);
      return;
    }
    setSelectedSeason(team.seasonId);
    setSelectedDistrict(team.districtId);
    setSelectedAgeDivision(team.ageDivisionId);
    setSelectedTeamId(team.teamId);
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

  // --- Milestone B1: commit a previewed scraped-JSON team into the workspace ---

  // Writes the committed (executed) team into the committed workspace, replacing only that
  // team. The workspace state change triggers the A1 auto-save naturally; the committed team
  // is then plain workspace data (and is included by A2 Export Dataset). Clears any transient
  // in-memory preview overlay, remembers the pre-commit team for a session undo, and selects
  // the committed team so it is visible in the roster view.
  function handleCommitScrapedImport(payload: ScrapedImportCommitPayload) {
    const result = commitImportedTeamToWorkspace(workspace, payload.committedTeam);
    if (!result.committed) return;
    setWorkspace(result.workspace);
    setInMemoryImport(null);
    setCommittedImportUndo({
      previousTeam: result.previousTeam,
      committedTeamId: payload.committedTeam.teamId,
      teamName: payload.summary.teamName,
      addedCount: payload.summary.addedCount,
      beforeCount: payload.summary.beforeCount,
      afterCount: payload.summary.afterCount,
    });
    const committed = result.workspace.teams.find(
      (t) => t.teamId === payload.committedTeam.teamId
    );
    if (committed) {
      setSelectedSeason(committed.seasonId);
      setSelectedDistrict(committed.districtId);
      setSelectedAgeDivision(committed.ageDivisionId);
      setSelectedTeamId(committed.teamId);
    }
    // Remount the import workbench so it re-derives against the new baseline (the committed
    // import is no longer a pending preview).
    setWorkspaceEpoch((epoch) => epoch + 1);
  }

  // B1: current-session undo. Restores the affected team to its exact pre-commit state in the
  // CURRENT workspace (preserving any unrelated later changes), auto-saves via A1, and clears
  // the undo affordance.
  function handleUndoCommittedImport() {
    if (!committedImportUndo) return;
    const result = undoImportedTeamCommitInWorkspace(
      workspace,
      committedImportUndo.previousTeam
    );
    if (result.restored) setWorkspace(result.workspace);
    setCommittedImportUndo(null);
    setWorkspaceEpoch((epoch) => epoch + 1);
  }

  // --- Slice 23 + A2: portable dataset export / import --------------------

  // Export the COMMITTED workspace dataset only. We deliberately use `workspace.teams`,
  // not `liveTeams`, so a transient/undoable in-memory import overlay is never written into
  // the portable file as if it were committed data (A2 critical product rule). The toolbar
  // copy tells the user the active import preview is excluded when an overlay is active.
  function handleExportSnapshot() {
    const snapshot = buildWorkspaceSnapshot({
      workspace: {
        districts: workspace.districts,
        ageDivisions: workspace.ageDivisions,
        teams: workspace.teams,
        // Schedules/results travel with the dataset (slice 24).
        games: workspace.games,
        // Coaches/assignments travel with the dataset (slice 27).
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
    anchor.download = `uc-roster-sniffer-dataset-${new Date().toISOString().slice(0, 10)}.json`;
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
        setWorkspaceFromImport(true);
        setInMemoryImport(null);
        // The whole workspace was replaced, so a prior committed-import undo is now stale.
        setCommittedImportUndo(null);
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
          onOpenTeam={handleOpenTeam}
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
          className={`app-nav-button ${view === 'my-team' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'my-team'}
          onClick={() => setView('my-team')}
        >
          My Team
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
        <button
          type="button"
          className={`app-nav-button ${view === 'analytics' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'analytics'}
          onClick={() => setView('analytics')}
        >
          Analytics
        </button>
        <button
          type="button"
          className={`app-nav-button ${view === 'review' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'review'}
          onClick={() => setView('review')}
        >
          Review Center
        </button>
      </nav>

      <WorkspaceToolbar
        importInputRef={importInputRef}
        notice={snapshotNotice}
        onExport={handleExportSnapshot}
        onImportFileChange={handleImportFileChange}
        onDismissNotice={() => setSnapshotNotice(null)}
        inMemoryImportActive={inMemoryImport !== null}
        persistenceStatus={persistenceStatus}
      />

      {committedImportUndo && (
        <div className="committed-import-banner">
          <div>
            <strong>Committed import saved locally.</strong>{' '}
            {committedImportUndo.teamName ?? committedImportUndo.committedTeamId}:{' '}
            {committedImportUndo.beforeCount} → {committedImportUndo.afterCount} players (
            {committedImportUndo.addedCount} added). This is now part of your workspace and
            auto-saves to this browser (it survives reload). Undo is available only for this
            session.
          </div>
          <button
            type="button"
            className="committed-import-undo-button"
            onClick={handleUndoCommittedImport}
          >
            Undo Committed Import
          </button>
        </div>
      )}

      {/*
        Both views stay mounted (visibility toggled) so an in-memory import execution and
        its Undo control are never lost by switching tabs while an execution is active.
      */}
      <div hidden={view !== 'roster'}>{rosterContent}</div>
      <div hidden={view !== 'my-team'}>
        <MyTeamView
          teams={liveTeams}
          districts={workspace.districts}
          ageDivisions={workspace.ageDivisions}
          games={workspace.games}
          coaches={workspace.coaches}
          coachAssignments={workspace.coachAssignments}
          selectedTeamId={selectedTeamId}
          onSelectTeam={handleSelectMyTeam}
          onNavigate={(target) => setView(target)}
          onOpenTeam={handleOpenTeam}
          onOpenCoach={handleOpenCoach}
          onOpenReview={() => setView('review')}
          importedWorkspace={workspaceFromImport}
        />
      </div>
      <div hidden={view !== 'import'}>
        <ScrapedImportPreview
          key={workspaceEpoch}
          baselineTeams={workspace.teams}
          onInMemoryImportChange={setInMemoryImport}
          onCommitImport={handleCommitScrapedImport}
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
          onOpenTeam={handleOpenTeam}
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
          selectedCoachId={selectedCoachId}
          onSelectCoach={setSelectedCoachId}
          onOpenTeam={handleOpenTeam}
        />
      </div>
      <div hidden={view !== 'analytics'}>
        <AnalyticsView
          key={workspaceEpoch}
          teams={liveTeams}
          districts={workspace.districts}
          ageDivisions={workspace.ageDivisions}
          games={workspace.games}
          coaches={workspace.coaches}
          coachAssignments={workspace.coachAssignments}
          onOpenTeam={handleOpenTeam}
          onOpenCoach={handleOpenCoach}
          onOpenReview={() => setView('review')}
        />
      </div>
      <div hidden={view !== 'review'}>
        <ReviewCenterView
          key={workspaceEpoch}
          teams={liveTeams}
          districts={workspace.districts}
          ageDivisions={workspace.ageDivisions}
          games={workspace.games}
          coaches={workspace.coaches}
          coachAssignments={workspace.coachAssignments}
          importState={{
            inMemoryRosterImportActive: inMemoryImport !== null,
            importedWorkspace: workspaceFromImport,
          }}
          onOpenTeam={handleOpenTeam}
          onOpenCoach={handleOpenCoach}
          onNavigate={(target) => setView(target)}
        />
      </div>
    </div>
  );
}

const PERSISTENCE_INDICATOR: Record<
  PersistenceStatus,
  { label: string; tone: 'info' | 'ok' | 'busy' | 'warn' }
> = {
  loading: { label: 'Loading saved workspace…', tone: 'info' },
  idle: { label: 'Auto-save on (this browser)', tone: 'info' },
  saving: { label: 'Saving…', tone: 'busy' },
  saved: { label: 'Saved locally', tone: 'ok' },
  'save-failed': { label: 'Save failed', tone: 'warn' },
  'load-failed': { label: 'Saved workspace could not be loaded', tone: 'warn' },
};

function PersistenceIndicator({ status }: { status: PersistenceStatus }) {
  const { label, tone } = PERSISTENCE_INDICATOR[status];
  return (
    <span
      className={`persistence-indicator persistence-indicator-${tone}`}
      role="status"
      aria-live="polite"
    >
      {label}
    </span>
  );
}

function WorkspaceToolbar({
  importInputRef,
  notice,
  onExport,
  onImportFileChange,
  onDismissNotice,
  inMemoryImportActive,
  persistenceStatus,
}: {
  importInputRef: React.RefObject<HTMLInputElement>;
  notice: SnapshotNotice | null;
  onExport: () => void;
  onImportFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDismissNotice: () => void;
  inMemoryImportActive: boolean;
  persistenceStatus: PersistenceStatus;
}) {
  return (
    <div className="workspace-toolbar">
      <div className="workspace-toolbar-actions">
        <button type="button" className="workspace-button" onClick={onExport}>
          Export Dataset (.json)
        </button>
        <label className="workspace-button workspace-import-label">
          Import Dataset (.json)
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            onChange={onImportFileChange}
            className="workspace-import-input"
          />
        </label>
        <PersistenceIndicator status={persistenceStatus} />
        <span className="workspace-toolbar-note">
          Auto-save (IndexedDB) keeps your work in this browser · Export Dataset makes a
          portable file you can hand to another coach
        </span>
      </div>
      <p className="workspace-toolbar-warning">
        <strong>Two separate things:</strong> your workspace <em>auto-saves to this browser</em>
        {' '}(local IndexedDB) and reloads automatically next time — that stays on this machine.
        {' '}<strong>Export Dataset</strong> writes a portable <code>.json</code> of your whole
        committed dataset that someone else can <strong>Import Dataset</strong> in their own
        browser to get the same workspace; nothing is sent off this machine.{' '}
        <strong>Import Dataset replaces</strong> the current workspace after validation and
        clears any active in-memory import (including undo).
        {inMemoryImportActive
          ? ' Note: an in-memory import preview is active — it is NOT part of an exported' +
            ' dataset (only committed data is exported), and importing will discard it.'
          : ''}
      </p>

      {notice && notice.kind === 'restored' && (
        <div className="workspace-notice workspace-notice-ok">
          <strong>Dataset imported from “{notice.fileName}”.</strong>{' '}
          {notice.summary.seasonCount} seasons · {notice.summary.districtCount} districts ·{' '}
          {notice.summary.teamCount} teams · {notice.summary.playerCount} players ·{' '}
          {notice.summary.gameCount} games · {notice.summary.coachCount} coaches. The current
          workspace was replaced and saved locally to this browser.
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
