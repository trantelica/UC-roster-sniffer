import { useState, useEffect, useRef } from 'react';
import './App.css';
import { loadSampleData, loadEmptyWorkspace } from '../data/loadSampleData';
import { getDistinctSeasons } from '../engine/filters';
import { findPriorSeasonTeam } from '../engine/teamRosterStatusSummary';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  restoreWorkspaceFromSnapshot,
  type WorkspaceData,
  type WorkspaceSnapshotSelection,
  type WorkspaceSnapshotSummary,
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
  type WholeFileImportCommitPayload,
} from '../components/ScrapedImportPreview';
import {
  commitImportedTeamToWorkspace,
  undoImportedTeamCommitInWorkspace,
  commitImportedTeamsToWorkspace,
  undoImportedTeamsCommitInWorkspace,
} from '../engine/workspaceImportCommit';
import {
  confirmUnknownScrapedDistrict,
  createDistrictFromInput,
  updateDistrict,
  inactivateDistrict,
  reactivateDistrict,
  type DistrictMaintenanceInput,
  type DistrictUpdatePatch,
} from '../engine/districtRegistry';
import DistrictMaintenanceView from '../components/DistrictMaintenanceView';
import EmptyState from '../components/EmptyState';
import { assessWorkspaceEmptiness } from '../engine/workspaceEmptyState';
import {
  buildDatasetImportErrorGuidance,
  type UserFacingFileError,
} from './fileImportGuidance';
import { executeWholeFilePlayerImportBatch } from '../engine/uteConferenceScrapedJsonWholeFileImport';
import ScheduleImportWorkbench from '../components/ScheduleImportWorkbench';
import StandingsView from '../components/StandingsView';
import CoachImportWorkbench from '../components/CoachImportWorkbench';
import CoachDirectoryView from '../components/CoachDirectoryView';
import MyTeamView from '../components/MyTeamView';
import AnalyticsView from '../components/AnalyticsView';
import ReviewCenterView from '../components/ReviewCenterView';

// Production startup is an EMPTY workspace (Part 3): a fresh browser opens to the first-run
// state, not bundled sample data. Sample data is available via an explicit action.
const initialAppData = loadEmptyWorkspace();

type AppView =
  | 'roster'
  | 'my-team'
  | 'import'
  | 'schedule'
  | 'standings'
  | 'coach-import'
  | 'coaches'
  | 'analytics'
  | 'review'
  | 'districts';

type SnapshotNotice =
  | { kind: 'restored'; fileName: string; summary: WorkspaceSnapshotSummary }
  | { kind: 'error'; fileName: string; guidance: UserFacingFileError };

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
  // B2: current-session undo for a whole-file batch commit. Holds the pre-batch values of
  // every affected team. Not persisted (the committed batch itself is durable via A1; this
  // undo affordance is session-only). A failed batch surfaces a calm notice instead.
  const [wholeFileImportUndo, setWholeFileImportUndo] = useState<{
    previousTeams: Team[];
    teamsCommitted: number;
    totalAdded: number;
    skippedCount: number;
    beforeCount: number;
    afterCount: number;
  } | null>(null);
  const [wholeFileImportError, setWholeFileImportError] = useState<string | null>(null);
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

  // --- Milestone B2: whole-file batch commit of all ready player teams ---

  // Executes the committable targets all-or-nothing, then writes the resulting teams into the
  // committed workspace in one update (auto-saved via A1, exported by A2). If execution or the
  // batch workspace transform fails, NO workspace change is applied and a calm error is shown,
  // so a failed batch can never partially corrupt the workspace. Clears any transient overlay,
  // remembers the pre-batch teams for a session undo, and remounts the workbench.
  function handleCommitWholeFilePlayerImport(payload: WholeFileImportCommitPayload) {
    setWholeFileImportError(null);
    const generatedAt = new Date().toISOString();
    const execution = executeWholeFilePlayerImportBatch({
      committableTargets: payload.committableTargets,
      generatedAt,
    });
    if (execution.status !== 'executed') {
      setWholeFileImportError(
        execution.status === 'nothing-to-commit'
          ? 'No ready teams to commit.'
          : `Batch import was not applied: ${execution.message} No teams were changed.`
      );
      return;
    }
    const commit = commitImportedTeamsToWorkspace(workspace, execution.committedTeams);
    if (!commit.committed) {
      setWholeFileImportError(
        `Batch import was not applied: ${commit.missingTeamIds.length} target team(s) were not found in the workspace. No teams were changed.`
      );
      return;
    }
    setWorkspace(commit.workspace);
    setInMemoryImport(null);
    const beforeCount = execution.perTeam.reduce((sum, p) => sum + p.beforeCount, 0);
    const afterCount = execution.perTeam.reduce((sum, p) => sum + p.afterCount, 0);
    setWholeFileImportUndo({
      previousTeams: commit.previousTeams,
      teamsCommitted: execution.teamsCommitted,
      totalAdded: execution.totalAdded,
      skippedCount: payload.summary.skippedCount,
      beforeCount,
      afterCount,
    });
    setWorkspaceEpoch((epoch) => epoch + 1);
  }

  // B2: current-session undo. Restores every affected team to its exact pre-batch state in the
  // CURRENT workspace (preserving unrelated later changes to other teams), auto-saves via A1,
  // and clears the undo affordance.
  function handleUndoWholeFilePlayerImport() {
    if (!wholeFileImportUndo) return;
    const result = undoImportedTeamsCommitInWorkspace(
      workspace,
      wholeFileImportUndo.previousTeams
    );
    if (result.restored) setWorkspace(result.workspace);
    setWholeFileImportUndo(null);
    setWorkspaceEpoch((epoch) => epoch + 1);
  }

  // --- Milestone C3: confirm/add an unknown scraped district into the registry ---

  // Adds the exact scraped district name into the committed workspace district registry as an
  // active, placeholder-branded record (idempotent — an existing exact match is reused). The
  // workspace-data change auto-saves via A1 and is included by A2 Export Dataset. No epoch
  // bump: the import workbench takes `workspace.districts` as a prop and re-derives its
  // mapping reactively, so the just-confirmed district resolves without losing the loaded
  // source or selected target.
  function handleConfirmScrapedDistrict(rawName: string) {
    setWorkspace((current) => {
      const result = confirmUnknownScrapedDistrict(current.districts, rawName);
      // `changed` covers both appending a new district and reactivating an inactive-only
      // exact match, so confirming an inactive district is never a dead no-op.
      if (!result.changed) return current;
      return { ...current, districts: result.districts };
    });
  }

  // --- Milestone C2: District Maintenance (add / edit / inactivate / reactivate) ---
  // All four update committed `workspace.districts`, so A1 auto-saves and A2 exports them,
  // and the import workbench (C3/B2) re-derives its active-registry lookup from the districts
  // prop. No epoch bump — district edits never disturb a loaded import session.
  function handleCreateDistrict(input: DistrictMaintenanceInput) {
    setWorkspace((current) => {
      const result = createDistrictFromInput(current.districts, input);
      return { ...current, districts: result.districts };
    });
  }

  function handleUpdateDistrict(districtId: string, patch: DistrictUpdatePatch) {
    setWorkspace((current) => {
      const result = updateDistrict(current.districts, districtId, patch);
      if (!result.changed) return current;
      return { ...current, districts: result.districts };
    });
  }

  function handleInactivateDistrict(districtId: string) {
    setWorkspace((current) => {
      const result = inactivateDistrict(current.districts, districtId);
      if (!result.changed) return current;
      return { ...current, districts: result.districts };
    });
  }

  function handleReactivateDistrict(districtId: string) {
    setWorkspace((current) => {
      const result = reactivateDistrict(current.districts, districtId);
      if (!result.changed) return current;
      return { ...current, districts: result.districts };
    });
  }

  // --- Part 3: reset to an empty workspace / load bundled sample data ----------

  // Clears all transient session state and selection after a wholesale workspace replacement.
  function resetTransientStateForWorkspaceReplace() {
    setInMemoryImport(null);
    setCommittedImportUndo(null);
    setWholeFileImportUndo(null);
    setWholeFileImportError(null);
    setSnapshotNotice(null);
    setWorkspaceFromImport(false);
    setSelectedSeason(null);
    setSelectedDistrict(null);
    setSelectedAgeDivision(null);
    setSelectedTeamId(null);
    setSelectedCoachId(null);
    setWorkspaceEpoch((epoch) => epoch + 1);
  }

  // Replaces THIS browser's workspace with an empty one (baseline registries kept). The change
  // auto-saves via A1, so the empty state survives reload. Confirmed because it is destructive
  // to local data. Export a dataset first to keep a backup.
  function handleResetWorkspace() {
    const confirmed = window.confirm(
      'Reset this browser’s workspace to empty?\n\nThis replaces all roster, team, game, and ' +
        'coach data saved in THIS browser. The district registry and age divisions are kept. ' +
        'Export a dataset first if you want a backup. This cannot be undone.'
    );
    if (!confirmed) return;
    setWorkspace(loadEmptyWorkspace());
    resetTransientStateForWorkspaceReplace();
  }

  // Loads the bundled sample/demo data into this browser's workspace (replaces current data).
  function handleLoadSampleData() {
    const confirmed = window.confirm(
      'Load bundled sample/demo data into this browser’s workspace?\n\nThis replaces the ' +
        'current local workspace data. Export a dataset first if you want a backup.'
    );
    if (!confirmed) return;
    setWorkspace(loadSampleData());
    resetTransientStateForWorkspaceReplace();
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
        // Invalid snapshot: current workspace state is left completely unchanged. The
        // validation verdict is translated into plain-language, actionable guidance (E2).
        setSnapshotNotice({
          kind: 'error',
          fileName: file.name,
          guidance: buildDatasetImportErrorGuidance(text, result.errors),
        });
      } else {
        // Valid snapshot: REPLACE the workspace (never merge) and clear all transient
        // import-execution / workbench state.
        const restored = restoreWorkspaceFromSnapshot(result.snapshot);
        setWorkspace(restored.workspace);
        setWorkspaceFromImport(true);
        setInMemoryImport(null);
        // The whole workspace was replaced, so any prior committed-import undo (single-team
        // B1 or whole-file B2) and any whole-file error are now stale and must be cleared.
        setCommittedImportUndo(null);
        setWholeFileImportUndo(null);
        setWholeFileImportError(null);
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
        guidance: {
          title: 'We could not read this file.',
          what: 'The file could not be read from your computer.',
          tryThis: 'Try choosing the file again, or pick a different copy of it.',
        },
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

  // E1: workspace emptiness drives the first-run / empty states.
  const emptiness = assessWorkspaceEmptiness(workspace);
  function triggerDatasetImport() {
    importInputRef.current?.click();
  }

  // The first-run / no-roster-data state: a calm explainer of what this tool is and the next
  // actions to get data in. Reachable whenever the workspace has no teams.
  const firstRunState = (
    <EmptyState
      title="No roster data yet"
      message={
        <>
          <p>
            Everything here stays <strong>local to this browser</strong> — nothing is uploaded
            anywhere, and your work auto-saves on this machine. To get started:
          </p>
          <ul className="empty-state-list">
            <li>
              <strong>Roster import</strong> — load a scraped Ute Conference players JSON file
              and commit a team (or all ready teams).
            </li>
            <li>
              <strong>Import Dataset</strong> — open a portable <code>.json</code> dataset
              someone exported (e.g. another coach).
            </li>
            <li>
              <strong>Districts</strong> — set up the district registry imports match against.
            </li>
          </ul>
        </>
      }
      actions={[
        { label: 'Go to Roster import', onClick: () => setView('import'), primary: true },
        { label: 'Import Dataset (.json)', onClick: triggerDatasetImport },
        { label: 'Manage Districts', onClick: () => setView('districts') },
      ]}
    />
  );

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
      {!emptiness.hasTeams ? (
        firstRunState
      ) : (
        <>
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
            <p className="no-selection">
              Pick a season, district, age division, and team above to view a roster.
            </p>
          )}
        </>
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
          Roster import
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
        <button
          type="button"
          className={`app-nav-button ${view === 'districts' ? 'app-nav-button-active' : ''}`}
          aria-pressed={view === 'districts'}
          onClick={() => setView('districts')}
        >
          Districts
        </button>
      </nav>

      <WorkspaceToolbar
        importInputRef={importInputRef}
        notice={snapshotNotice}
        onExport={handleExportSnapshot}
        onImportFileChange={handleImportFileChange}
        onDismissNotice={() => setSnapshotNotice(null)}
        onResetWorkspace={handleResetWorkspace}
        onLoadSampleData={handleLoadSampleData}
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

      {wholeFileImportUndo && (
        <div className="committed-import-banner">
          <div>
            <strong>Whole-file import saved locally.</strong>{' '}
            {wholeFileImportUndo.teamsCommitted} team
            {wholeFileImportUndo.teamsCommitted === 1 ? '' : 's'} committed (
            {wholeFileImportUndo.beforeCount} → {wholeFileImportUndo.afterCount} players across
            them · {wholeFileImportUndo.totalAdded} added · {wholeFileImportUndo.skippedCount}{' '}
            skipped). This is now part of your workspace and auto-saves to this browser (it
            survives reload). Undo is available only for this session.
          </div>
          <button
            type="button"
            className="committed-import-undo-button"
            onClick={handleUndoWholeFilePlayerImport}
          >
            Undo Whole-file Import
          </button>
        </div>
      )}

      {wholeFileImportError && (
        <div className="workspace-notice workspace-notice-error">
          <strong>{wholeFileImportError}</strong>
          <button
            type="button"
            className="import-link-button"
            onClick={() => setWholeFileImportError(null)}
          >
            Dismiss
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
          districts={workspace.districts}
          onInMemoryImportChange={setInMemoryImport}
          onCommitImport={handleCommitScrapedImport}
          onConfirmDistrict={handleConfirmScrapedDistrict}
          onCommitWholeFile={handleCommitWholeFilePlayerImport}
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
      <div hidden={view !== 'districts'}>
        <DistrictMaintenanceView
          districts={workspace.districts}
          teams={workspace.teams}
          onCreate={handleCreateDistrict}
          onUpdate={handleUpdateDistrict}
          onInactivate={handleInactivateDistrict}
          onReactivate={handleReactivateDistrict}
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
  onResetWorkspace,
  onLoadSampleData,
  inMemoryImportActive,
  persistenceStatus,
}: {
  importInputRef: React.RefObject<HTMLInputElement>;
  notice: SnapshotNotice | null;
  onExport: () => void;
  onImportFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onDismissNotice: () => void;
  onResetWorkspace: () => void;
  onLoadSampleData: () => void;
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
        <button type="button" className="workspace-button" onClick={onLoadSampleData}>
          Load sample data
        </button>
        <button
          type="button"
          className="workspace-button workspace-button-danger"
          onClick={onResetWorkspace}
        >
          Reset workspace
        </button>
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
          <strong>{notice.guidance.title}</strong>{' '}
          <span className="file-error-file">(“{notice.fileName}” — your current workspace was left unchanged.)</span>
          <p className="file-error-what">
            <strong>What happened:</strong> {notice.guidance.what}
          </p>
          <p className="file-error-try">
            <strong>Try this:</strong> {notice.guidance.tryThis}
          </p>
          {notice.guidance.detail && (
            <p className="file-error-detail">Details: {notice.guidance.detail}</p>
          )}
          <button type="button" className="import-link-button" onClick={onDismissNotice}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
