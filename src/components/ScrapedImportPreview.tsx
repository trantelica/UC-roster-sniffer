import { useMemo, useRef, useState } from 'react';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
} from '../engine/uteConferenceScrapedJsonImportSession';
import {
  buildScrapedJsonImportPreviewViewModel,
  type ScrapedImportPreviewViewModel,
  type ScrapedImportTargetOption,
} from '../app/scrapedImportPreviewViewModel';
import { parseScrapedJsonImportFileText } from '../app/scrapedImportFileParse';
import type {
  ScrapedImportReviewDecisionMap,
  ScrapedImportReviewDecisionKind,
  ScrapedImportReviewRow,
  ScrapedImportRosterAwareReview,
} from '../engine/uteConferenceScrapedJsonImportRosterAwareReview';
import type { ScrapedImportStagedProjection } from '../engine/uteConferenceScrapedJsonImportStagedProjection';
import { buildScrapedJsonImportPreviewArtifact } from '../engine/uteConferenceScrapedJsonImportPreviewArtifact';
import {
  buildScrapedJsonImportTransactionPlan,
  type ScrapedImportTransactionPlanResult,
} from '../engine/uteConferenceScrapedJsonImportTransactionPlan';
import {
  executeUteConferenceScrapedJsonImportTransaction,
  undoUteConferenceScrapedJsonImportExecution,
  evaluateScrapedJsonImportExecutionAvailability,
  type ScrapedImportExecutionResult,
} from '../engine/uteConferenceScrapedJsonImportExecution';
import type { Team } from '../domain/types';

import playersPw from '../test/fixtures/ute-scraped-json/players-2023-pw-small.json';
import coachesPw from '../test/fixtures/ute-scraped-json/coaches-2022-pw-small.json';

/**
 * Shared app state for a non-durable, in-memory import execution. The roster view renders
 * `teams` (the baseline with the executed additions applied) while this is non-null, and a
 * banner reminds the user it is in-memory only. Cleared (set to null) on undo / reset.
 */
export type InMemoryImportAppState = {
  teams: Team[];
  banner: {
    teamId: string;
    teamName: string | null;
    addedCount: number;
    beforeCount: number;
    afterCount: number;
  };
};

/**
 * Phase 5 slice 17–18: a local-first, roster-aware scraped JSON import workbench.
 *
 * This component is a thin renderer over the existing engine. It lets the user choose a
 * REAL local scraped JSON file (read in-browser via FileReader — no upload, no backend,
 * no storage) or a bundled demo source, parses it with a pure helper, creates a slice
 * 14 import session, and (slice 18) compares the selected player target's rows against
 * the existing local roster, lets the user resolve identity review cases in memory, and
 * shows a decision-aware dry-run — all via pure view-model / engine helpers.
 *
 * Everything is in component memory only. There are deliberately no save/apply/commit
 * controls. The dry-run projection is preview-only and clearly labelled.
 */

type DemoSource = { id: string; label: string; payload: unknown };

// A demo source whose canonical context (2026 / alta / GR / B1) matches an existing
// roster team, so roster-aware matching is visible: an exact match, a duplicate-name
// collision, and a brand-new player.
const rosterAwareDemoPayload = {
  metadata: {
    organization: 'Ute Conference',
    event: '2026 Fall Season',
    age_division: 'GR League 9',
    age_division_alias: 'GR',
    year: 2026,
    record_type: 'players',
    source_url: 'https://ute.example/demo/2026-gr',
  },
  districts: [
    {
      district: 'Alta',
      league: 'GR League 9',
      teams_count: 1,
      teams: [
        {
          team_name: 'Gremlin B1',
          source_url: 'https://ute.example/demo/2026-gr/b1',
          players_count: 3,
          players: [{ name: 'Jordan Smith' }, { name: 'Jamie Park' }, { name: 'New Recruit' }],
        },
      ],
    },
  ],
};

const DEMO_SOURCES: DemoSource[] = [
  { id: 'roster-aware-2026', label: 'Players — 2026 alta GR B1 (matches existing roster)', payload: rosterAwareDemoPayload },
  { id: 'players-2023-pw', label: 'Players — PeeWee, 2023 (no existing roster)', payload: playersPw },
  { id: 'coaches-2022-pw', label: 'Coaches — PeeWee, 2022 (demo fixture)', payload: coachesPw },
];

type LoadedSource = {
  sourceKind: 'file' | 'demo';
  name: string;
  payload: unknown;
};

type FileError = { name: string; message: string };

const READINESS_LABELS: Record<string, string> = {
  ready: 'Ready',
  'ready-with-warnings': 'Ready (warnings)',
  'needs-review': 'Needs review',
  blocked: 'Blocked',
  empty: 'Empty',
};

function ReadinessBadge({ status }: { status: string }) {
  return (
    <span className={`import-badge import-badge-${status}`}>
      {READINESS_LABELS[status] ?? status}
    </span>
  );
}

export default function ScrapedImportPreview({
  baselineTeams,
  onInMemoryImportChange,
}: {
  baselineTeams: Team[];
  onInMemoryImportChange: (state: InMemoryImportAppState | null) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [fileError, setFileError] = useState<FileError | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [reviewDecisions, setReviewDecisions] =
    useState<ScrapedImportReviewDecisionMap>({});
  // Staged projection is an explicit in-memory action; it is invalidated by any change
  // to the loaded source, the selected target, or the identity decisions.
  const [staged, setStaged] = useState(false);
  // Slice 22: the explicit in-memory execution result (null = not executed). While this is
  // non-null the workflow is LOCKED — execution-affecting inputs must be undone first.
  const [executionResult, setExecutionResult] =
    useState<ScrapedImportExecutionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const executed =
    executionResult !== null && executionResult.status === 'executed';

  const baseSession = useMemo(
    () => (loaded ? createUteScrapedJsonImportSessionFromPayload(loaded.payload) : null),
    [loaded]
  );

  const session = useMemo(() => {
    if (!baseSession) return null;
    if (!selectedTargetId) return baseSession;
    return selectUteScrapedJsonImportSessionTarget(baseSession, selectedTargetId);
  }, [baseSession, selectedTargetId]);

  // The view model always derives against the immutable baseline roster, never the live
  // (possibly executed) roster, so staging / readiness / the transaction plan are stable
  // and re-running them after an execution cannot duplicate additions.
  const vm = useMemo(
    () =>
      session
        ? buildScrapedJsonImportPreviewViewModel(session, {
            existingTeams: baselineTeams,
            reviewDecisions,
          })
        : null,
    [session, reviewDecisions, baselineTeams]
  );

  // Selecting / switching a target isolates identity decisions to that target and
  // invalidates any staged projection. Locked while an in-memory import is executed.
  function selectTarget(id: string) {
    if (executed) return;
    setSelectedTargetId(id);
    setReviewDecisions({});
    setStaged(false);
  }

  function clearTarget() {
    if (executed) return;
    setSelectedTargetId(null);
    setReviewDecisions({});
    setStaged(false);
  }

  function setRowDecision(
    sourceRowId: string,
    kind: ScrapedImportReviewDecisionKind | null
  ) {
    if (executed) return;
    setStaged(false);
    setReviewDecisions((prev) => {
      const next = { ...prev };
      if (kind === null) delete next[sourceRowId];
      else next[sourceRowId] = kind;
      return next;
    });
  }

  function resetSelection() {
    setSelectedTargetId(null);
    setReviewDecisions({});
    setStaged(false);
  }

  // Explicit in-memory execution: builds a fresh transaction plan with a real id/timestamp,
  // executes it against the baseline target team, updates the live roster, and locks the
  // workflow until undo. No durable write occurs.
  function executeInMemory() {
    if (!vm || executed) return;
    const targetTeamId = vm.artifactTarget.existingTeamId;
    if (!targetTeamId) return;
    const existingTeam = baselineTeams.find((t) => t.teamId === targetTeamId) ?? null;
    const generatedAt = new Date().toISOString();
    const transactionPlan = buildScrapedJsonImportTransactionPlan({
      transactionId: `import-transaction:${Date.now()}`,
      generatedAt,
      source: { ...vm.artifactSource },
      target: vm.artifactTarget,
      review: vm.rosterReview,
      stagedProjection: vm.stagedProjection,
      readiness: vm.futureReadiness,
    });
    const result = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam,
      executedAt: generatedAt,
    });
    if (result.status !== 'executed') {
      setExecutionResult(result);
      return;
    }
    setExecutionResult(result);
    const nextTeams = baselineTeams.map((t) =>
      t.teamId === result.executedTeam.teamId ? result.executedTeam : t
    );
    onInMemoryImportChange({
      teams: nextTeams,
      banner: {
        teamId: result.afterRosterSummary.teamId,
        teamName: vm.artifactTarget.teamName,
        addedCount: result.rosterDeltaSummary.addedCount,
        beforeCount: result.beforeRosterSummary.playerCount,
        afterCount: result.afterRosterSummary.playerCount,
      },
    });
  }

  // Explicit in-memory undo: restores the baseline roster and unlocks the workflow.
  function undoInMemory() {
    if (!executionResult || executionResult.status !== 'executed') return;
    undoUteConferenceScrapedJsonImportExecution({
      executionResult,
      undoneAt: new Date().toISOString(),
    });
    setExecutionResult(null);
    onInMemoryImportChange(null);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (executed) {
      // Re-sync the input value so a locked change is not silently swallowed.
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    resetSelection();
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const parsed = parseScrapedJsonImportFileText(text);
      if (parsed.ok) {
        setFileError(null);
        setLoaded({ sourceKind: 'file', name: file.name, payload: parsed.payload });
      } else {
        setLoaded(null);
        setFileError({ name: file.name, message: parsed.message });
      }
    };
    reader.onerror = () => {
      setLoaded(null);
      setFileError({ name: file.name, message: 'The file could not be read locally.' });
    };
    reader.readAsText(file);
  }

  function handleDemoChange(id: string) {
    if (executed) return;
    resetSelection();
    setFileError(null);
    if (id === '') {
      setLoaded(null);
      return;
    }
    const demo = DEMO_SOURCES.find((s) => s.id === id);
    if (demo) setLoaded({ sourceKind: 'demo', name: demo.label, payload: demo.payload });
  }

  function handleClearFile() {
    if (executed) return;
    resetSelection();
    setLoaded(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div className="import-preview">
      <div className="import-preview-header">
        <h2 className="import-title">Import preview workbench</h2>
        <span className="import-tag">Preview only · nothing applied</span>
      </div>
      <p className="import-note">
        Choose a Ute Conference scraped JSON file from your computer. It is read locally in
        your browser only — never uploaded, saved, or committed. You can inspect readiness,
        select a target, review rows, and see a dry-run projection of what an import would
        do.
      </p>

      {executed && (
        <p className="import-warn">
          An in-memory import is executed. Undo it below before changing the source, target,
          review decisions, or staged preview. (In-memory only — no durable commit occurs.)
        </p>
      )}

      <div className="import-source-controls">
        <div className="filter-group">
          <label htmlFor="import-file-input">Choose JSON file (local only)</label>
          <input
            id="import-file-input"
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            disabled={executed}
          />
        </div>
        <div className="filter-group">
          <label htmlFor="import-demo-select">…or load a demo source</label>
          <select
            id="import-demo-select"
            value={loaded?.sourceKind === 'demo' ? demoIdForLabel(loaded.name) : ''}
            onChange={(e) => handleDemoChange(e.target.value)}
            disabled={executed}
          >
            <option value="">Select a demo source</option>
            {DEMO_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        {(loaded || fileError) && (
          <button
            type="button"
            className="import-link-button"
            onClick={handleClearFile}
            disabled={executed}
          >
            Clear loaded file
          </button>
        )}
      </div>

      {fileError && (
        <p className="import-warn">
          Could not load “{fileError.name}”: {fileError.message}
        </p>
      )}

      {!loaded && !fileError && (
        <p className="import-empty">No source loaded. Choose a local JSON file to begin.</p>
      )}

      {loaded && vm && (
        <Workbench
          vm={vm}
          sourceName={loaded.name}
          sourceKind={loaded.sourceKind}
          selectedTargetId={selectedTargetId}
          onSelect={selectTarget}
          onClearTarget={clearTarget}
          onSetRowDecision={setRowDecision}
          staged={staged}
          onStage={() => !executed && setStaged(true)}
          onClearStaged={() => !executed && setStaged(false)}
          executionResult={executionResult}
          onExecute={executeInMemory}
          onUndo={undoInMemory}
        />
      )}
    </div>
  );
}

function demoIdForLabel(label: string): string {
  return DEMO_SOURCES.find((s) => s.label === label)?.id ?? '';
}

function Workbench({
  vm,
  sourceName,
  sourceKind,
  selectedTargetId,
  onSelect,
  onClearTarget,
  onSetRowDecision,
  staged,
  onStage,
  onClearStaged,
  executionResult,
  onExecute,
  onUndo,
}: {
  vm: ScrapedImportPreviewViewModel;
  sourceName: string;
  sourceKind: 'file' | 'demo';
  selectedTargetId: string | null;
  onSelect: (id: string) => void;
  onClearTarget: () => void;
  onSetRowDecision: (sourceRowId: string, kind: ScrapedImportReviewDecisionKind | null) => void;
  staged: boolean;
  onStage: () => void;
  onClearStaged: () => void;
  executionResult: ScrapedImportExecutionResult | null;
  onExecute: () => void;
  onUndo: () => void;
}) {
  const executed = executionResult !== null && executionResult.status === 'executed';
  return (
    <>
      <div className="import-summary">
        <div className="import-summary-line">
          <span>{sourceKind === 'file' ? 'Local file' : 'Demo source'}</span>
          <strong>{sourceName}</strong>
        </div>
        <div className="import-summary-line">
          <span>Source type</span>
          <strong>{vm.recordType}</strong>
        </div>
        <div className="import-summary-line">
          <span>Status</span>
          <strong>{vm.status}</strong>
        </div>
        {vm.source && (
          <div className="import-summary-line">
            <span>Details</span>
            <strong>
              {[vm.source.organization, vm.source.event, vm.source.ageDivision]
                .filter(Boolean)
                .join(' · ') || '—'}
            </strong>
          </div>
        )}
        <div className="import-summary-line">
          <span>Targets</span>
          <strong>
            {vm.readyTargets.length} ready · {vm.needsReviewTargets.length} needs review ·{' '}
            {vm.blockedTargets.length} blocked · {vm.emptyTargets.length} empty
          </strong>
        </div>
      </div>

      {vm.invalidSource ? (
        <p className="import-empty">
          This source is not a supported scraped JSON players or coaches file, so there are
          no importable targets.
        </p>
      ) : (
        <>
          <TargetSection
            title="Ready targets"
            targets={vm.readyTargets}
            selectedTargetId={selectedTargetId}
            onSelect={onSelect}
            onClearTarget={onClearTarget}
            emptyMessage="No ready targets in this source."
            locked={executed}
          />
          <TargetSection
            title="Targets needing review"
            targets={vm.needsReviewTargets}
            selectedTargetId={selectedTargetId}
            onSelect={onSelect}
            onClearTarget={onClearTarget}
            emptyMessage={null}
            locked={executed}
          />
          <ReadonlyTargetSection title="Blocked targets — not importable" targets={vm.blockedTargets} />
          <ReadonlyTargetSection title="Empty targets — no rows" targets={vm.emptyTargets} />
          <SelectedTargetDetail
            vm={vm}
            sourceName={sourceName}
            sourceKind={sourceKind}
            staged={staged}
            onSetRowDecision={onSetRowDecision}
            onStage={onStage}
            onClearStaged={onClearStaged}
            executionResult={executionResult}
            executed={executed}
            onExecute={onExecute}
            onUndo={onUndo}
          />
        </>
      )}
    </>
  );
}

function TargetSection({
  title,
  targets,
  selectedTargetId,
  onSelect,
  onClearTarget,
  emptyMessage,
  locked,
}: {
  title: string;
  targets: ScrapedImportTargetOption[];
  selectedTargetId: string | null;
  onSelect: (id: string) => void;
  onClearTarget: () => void;
  emptyMessage: string | null;
  locked: boolean;
}) {
  if (targets.length === 0 && emptyMessage === null) return null;
  const anySelectedHere = targets.some((t) => t.sourceTargetId === selectedTargetId);
  return (
    <div className="import-section">
      <div className="import-section-head">
        <h3>{title}</h3>
        {anySelectedHere && (
          <button
            type="button"
            className="import-link-button"
            onClick={onClearTarget}
            disabled={locked}
          >
            Clear selected target
          </button>
        )}
      </div>
      {targets.length === 0 ? (
        <p className="import-empty">{emptyMessage}</p>
      ) : (
        <ul className="import-target-list">
          {targets.map((target) => {
            const isSelected = target.sourceTargetId === selectedTargetId;
            return (
              <li key={target.sourceTargetId}>
                <button
                  type="button"
                  className={`import-target ${isSelected ? 'import-target-selected' : ''}`}
                  aria-pressed={isSelected}
                  onClick={() => onSelect(target.sourceTargetId)}
                  disabled={locked && !isSelected}
                >
                  <span className="import-target-name">
                    {target.teamName ?? '(unnamed team)'}
                  </span>
                  <span className="import-target-meta">
                    {[target.districtName, target.ageDivisionLabel].filter(Boolean).join(' · ')}
                    {' · '}{target.rowCount} rows
                  </span>
                  <ReadinessBadge status={target.readinessStatus} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ReadonlyTargetSection({
  title,
  targets,
}: {
  title: string;
  targets: ScrapedImportTargetOption[];
}) {
  if (targets.length === 0) return null;
  return (
    <div className="import-section">
      <h3>{title}</h3>
      <ul className="import-target-list">
        {targets.map((target) => (
          <li key={target.sourceTargetId} className="import-target import-target-readonly">
            <span className="import-target-name">{target.teamName ?? '(unnamed team)'}</span>
            <span className="import-target-meta">
              {[target.districtName, target.ageDivisionLabel].filter(Boolean).join(' · ')}
              {' · '}{target.rowCount} rows
            </span>
            <ReadinessBadge status={target.readinessStatus} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SelectedTargetDetail({
  vm,
  sourceName,
  sourceKind,
  staged,
  onSetRowDecision,
  onStage,
  onClearStaged,
  executionResult,
  executed,
  onExecute,
  onUndo,
}: {
  vm: ScrapedImportPreviewViewModel;
  sourceName: string;
  sourceKind: 'file' | 'demo';
  staged: boolean;
  onSetRowDecision: (sourceRowId: string, kind: ScrapedImportReviewDecisionKind | null) => void;
  onStage: () => void;
  onClearStaged: () => void;
  executionResult: ScrapedImportExecutionResult | null;
  executed: boolean;
  onExecute: () => void;
  onUndo: () => void;
}) {
  const selected = vm.selected;
  const rosterReview = vm.rosterReview;
  const stagedProjection = vm.stagedProjection;
  if (!selected) {
    return (
      <div className="import-section">
        <p className="import-empty">Select a target above to see its read-only preview.</p>
      </div>
    );
  }

  return (
    <div className="import-section import-selected">
      <div className="import-section-head">
        <h3>{selected.teamName ?? '(unnamed team)'}</h3>
        <ReadinessBadge status={selected.readinessStatus} />
      </div>

      {!selected.importable && (
        <p className="import-warn">
          This target is {selected.readinessStatus} and is not importable.
        </p>
      )}

      {selected.canonicalContext && (
        <div className="import-summary">
          <div className="import-summary-line">
            <span>Season</span>
            <strong>{selected.canonicalContext.seasonId ?? '—'}</strong>
          </div>
          <div className="import-summary-line">
            <span>District</span>
            <strong>{selected.canonicalContext.districtId ?? '—'}</strong>
          </div>
          <div className="import-summary-line">
            <span>Age division</span>
            <strong>{selected.canonicalContext.ageDivisionId ?? '—'}</strong>
          </div>
          <div className="import-summary-line">
            <span>Classification</span>
            <strong>{selected.canonicalContext.teamClassification ?? '—'}</strong>
          </div>
          <div className="import-summary-line">
            <span>Context confidence</span>
            <strong>{selected.canonicalContext.contextConfidence}</strong>
          </div>
        </div>
      )}

      {selected.readinessReasons.length > 0 && (
        <p className="import-reasons">Reasons: {selected.readinessReasons.join(', ')}</p>
      )}

      {selected.issues.length > 0 && (
        <ul className="import-issues">
          {selected.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`} className={`import-issue import-issue-${issue.severity}`}>
              <strong>{issue.severity}</strong>: {issue.message}
            </li>
          ))}
        </ul>
      )}

      {selected.reviewSummary && (
        <p className="import-review">
          Review state: {selected.reviewSummary.reviewedRowCount} reviewed ·{' '}
          {selected.reviewSummary.unreviewedRowCount} unreviewed (read-only)
        </p>
      )}

      {selected.recordType === 'players' && (
        <div className="import-section">
          <h3>Player rows — read-only preview</h3>
          {selected.playerPreviewRows.length === 0 ? (
            <p className="import-empty">No player rows to preview.</p>
          ) : (
            <table className="import-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player name (raw)</th>
                  <th>Row status</th>
                </tr>
              </thead>
              <tbody>
                {selected.playerPreviewRows.map((row) => (
                  <tr key={row.rowIndex}>
                    <td>{row.rowIndex + 1}</td>
                    <td>{row.playerName ?? '(missing)'}</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selected.recordType === 'coaches' && (
        <div className="import-section">
          <h3>Coach rows — read-only preview</h3>
          {selected.coachPreviewSummary && (
            <p className="import-reasons">
              {selected.coachPreviewSummary.totalRows} rows ·{' '}
              {selected.coachPreviewSummary.withName} with name ·{' '}
              {selected.coachPreviewSummary.withTitle} with title
            </p>
          )}
          {selected.coachPreviewRows.length === 0 ? (
            <p className="import-empty">No coach rows to preview.</p>
          ) : (
            <table className="import-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Coach name (raw)</th>
                  <th>Title (raw)</th>
                </tr>
              </thead>
              <tbody>
                {selected.coachPreviewRows.map((row) => (
                  <tr key={row.rowIndex}>
                    <td>{row.rowIndex + 1}</td>
                    <td>{row.rawName ?? '(missing)'}</td>
                    <td>{row.rawTitle ?? '(missing)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {selected.recordType === 'players' && (
        <RosterReviewPanel
          rosterReview={rosterReview}
          onSetRowDecision={onSetRowDecision}
          locked={executed}
        />
      )}

      {selected.recordType === 'players' && (
        <StagedProjectionPanel
          stagedProjection={stagedProjection}
          staged={staged}
          onStage={onStage}
          onClearStaged={onClearStaged}
          locked={executed}
        />
      )}

      {selected.recordType === 'players' && (
        <FutureImportReadinessPanel
          vm={vm}
          sourceName={sourceName}
          sourceKind={sourceKind}
          executionResult={executionResult}
        />
      )}

      {selected.recordType === 'players' && (
        <TransactionPlanPanel transactionPlan={vm.transactionPlan} />
      )}

      {selected.recordType === 'players' && (
        <InMemoryExecutionPanel
          vm={vm}
          executionResult={executionResult}
          staged={staged}
          onExecute={onExecute}
          onUndo={onUndo}
        />
      )}
    </div>
  );
}

function InMemoryExecutionPanel({
  vm,
  executionResult,
  staged,
  onExecute,
  onUndo,
}: {
  vm: ScrapedImportPreviewViewModel;
  executionResult: ScrapedImportExecutionResult | null;
  staged: boolean;
  onExecute: () => void;
  onUndo: () => void;
}) {
  const executed = executionResult !== null && executionResult.status === 'executed';
  const availability = evaluateScrapedJsonImportExecutionAvailability({
    transactionPlan: vm.transactionPlan,
    staged,
    alreadyExecuted: executed,
  });

  return (
    <div className="import-section import-execution">
      <div className="import-section-head">
        <h3>In-memory import execution</h3>
        <span className="import-tag">
          In-memory only · no durable commit occurs
        </span>
      </div>

      {executed && executionResult.status === 'executed' ? (
        <>
          <p className="import-readiness-verdict import-execution-done">
            Executed in memory — the roster view now reflects these additions.
          </p>
          <div className="import-readiness-counts">
            <span className="import-readiness-count">
              <strong>{executionResult.rosterDeltaSummary.addedCount}</strong> added
            </span>
            <span className="import-readiness-count">
              <strong>{executionResult.rosterDeltaSummary.noOpLinkCount}</strong> linked
              (no-op)
            </span>
            <span className="import-readiness-count">
              <strong>{executionResult.rosterDeltaSummary.skippedDeferredCount}</strong>{' '}
              deferred (skipped)
            </span>
            <span className="import-readiness-count">
              <strong>{executionResult.rosterDeltaSummary.skippedRejectedCount}</strong>{' '}
              rejected (skipped)
            </span>
          </div>
          <p className="import-review">
            Roster: {executionResult.beforeRosterSummary.playerCount} →{' '}
            <strong>{executionResult.afterRosterSummary.playerCount}</strong> players (net{' '}
            {executionResult.rosterDeltaSummary.netRosterRecordChange >= 0 ? '+' : ''}
            {executionResult.rosterDeltaSummary.netRosterRecordChange})
          </p>
          <p className="import-reasons">
            In-memory only · no saved roster data · this does not persist after reload · no
            durable commit occurs. Undo to restore the pre-execution roster.
          </p>
          <button type="button" className="import-decision-button" onClick={onUndo}>
            Undo In-Memory Import
          </button>
        </>
      ) : (
        <>
          <p className="import-reasons">
            Execute the staged, ready transaction into the current roster view — in-memory
            only. No saved roster data; this does not persist after reload; no durable commit
            occurs.
          </p>
          {!availability.canExecute && (
            <p className="import-empty">{availability.message}</p>
          )}
          <button
            type="button"
            className="import-decision-button"
            onClick={onExecute}
            disabled={!availability.canExecute}
          >
            Execute In-Memory Import
          </button>
        </>
      )}
    </div>
  );
}

function TransactionPlanPanel({
  transactionPlan,
}: {
  transactionPlan: ScrapedImportTransactionPlanResult;
}) {
  return (
    <div className="import-section import-transaction">
      <div className="import-section-head">
        <h3>Future import transaction plan</h3>
        <span className="import-tag">
          Not executed · no roster data is written in this preview
        </span>
      </div>

      {transactionPlan.status === 'rejected' ? (
        <>
          <p className="import-readiness-verdict import-readiness-blocked">
            No transaction plan — the staged preview is not ready for a future commit.
          </p>
          <p className="import-reasons">{transactionPlan.message}</p>
          {transactionPlan.blockingReasons.length > 0 && (
            <ul className="import-issues">
              {transactionPlan.blockingReasons.map((reason) => (
                <li key={reason.code} className="import-issue import-issue-warning">
                  <strong>
                    {READINESS_REASON_LABELS[reason.code] ?? reason.code}
                  </strong>
                  : {reason.message}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="import-readiness-verdict import-readiness-ready">
            Reversible transaction plan ready (preview only — never executed).
          </p>
          <div className="import-readiness-counts">
            <span className="import-readiness-count">
              <strong>{transactionPlan.addOperations.length}</strong> add
            </span>
            <span className="import-readiness-count">
              <strong>{transactionPlan.linkOperations.length}</strong> link (no-op)
            </span>
            <span className="import-readiness-count">
              <strong>{transactionPlan.deferredRows.length}</strong> deferred
            </span>
            <span className="import-readiness-count">
              <strong>{transactionPlan.rejectedRows.length}</strong> rejected
            </span>
          </div>
          <p className="import-review">
            Roster: {transactionPlan.beforeRosterSummary.playerCount} →{' '}
            <strong>{transactionPlan.afterRosterSummary.playerCount}</strong> (net record
            change {transactionPlan.rosterDeltaSummary.netRosterRecordChange >= 0 ? '+' : ''}
            {transactionPlan.rosterDeltaSummary.netRosterRecordChange})
          </p>

          {transactionPlan.addOperations.length > 0 && (
            <table className="import-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Imported name (raw)</th>
                  <th>Operation</th>
                </tr>
              </thead>
              <tbody>
                {transactionPlan.addOperations.map((op) => (
                  <tr key={`add-${op.rowIndex}`}>
                    <td>{op.rowIndex + 1}</td>
                    <td>{op.projectedRecordName ?? '(missing)'}</td>
                    <td>
                      <span className="import-outcome import-outcome-projected-create">
                        Add as new roster row
                      </span>
                    </td>
                  </tr>
                ))}
                {transactionPlan.linkOperations.map((op) => (
                  <tr key={`link-${op.rowIndex}`}>
                    <td>{op.rowIndex + 1}</td>
                    <td>{op.importedName ?? '(missing)'}</td>
                    <td>
                      <span className="import-outcome import-outcome-projected-link">
                        Link → {op.linkTargetExistingName ?? '(existing)'} (no-op)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="import-section-head">
            <h4>Undo preview</h4>
          </div>
          <p className="import-reasons">{transactionPlan.rollbackPlan.summary}</p>
        </>
      )}
    </div>
  );
}

const READINESS_REASON_LABELS: Record<string, string> = {
  'review-unavailable': 'Roster-aware review unavailable',
  'no-incoming-rows': 'No incoming rows',
  'unresolved-rows-remain': 'Unresolved rows remain',
  'blocked-rows-present': 'Blocked rows present',
  'staged-projection-unavailable': 'Staged projection unavailable',
};

/**
 * Builds the preview artifact from current in-memory state and triggers a local JSON
 * download. This is a client-side download only — no upload, no localStorage/IndexedDB,
 * no backend, no roster mutation. Nothing is committed, applied, or saved to the app.
 */
function exportPreviewArtifact(
  vm: ScrapedImportPreviewViewModel,
  sourceName: string,
  sourceKind: 'file' | 'demo',
  executionResult: ScrapedImportExecutionResult | null
) {
  const generatedAt = new Date().toISOString();
  const source = { ...vm.artifactSource, name: sourceName, kind: sourceKind };
  // A fresh transaction plan with a real (non-sentinel) id/timestamp for the export.
  const transactionPlan = buildScrapedJsonImportTransactionPlan({
    transactionId: `import-transaction:${Date.now()}`,
    generatedAt,
    source,
    target: vm.artifactTarget,
    review: vm.rosterReview,
    stagedProjection: vm.stagedProjection,
    readiness: vm.futureReadiness,
  });
  const artifact = buildScrapedJsonImportPreviewArtifact({
    generatedAt,
    source,
    target: vm.artifactTarget,
    review: vm.rosterReview,
    stagedProjection: vm.stagedProjection,
    readiness: vm.futureReadiness,
    transactionPlan,
    // Captures the current in-memory execution state (in-memory only; never durable).
    execution: executionResult ?? undefined,
  });
  const json = JSON.stringify(artifact, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'import-preview-artifact.json';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function FutureImportReadinessPanel({
  vm,
  sourceName,
  sourceKind,
  executionResult,
}: {
  vm: ScrapedImportPreviewViewModel;
  sourceName: string;
  sourceKind: 'file' | 'demo';
  executionResult: ScrapedImportExecutionResult | null;
}) {
  const readiness = vm.futureReadiness;
  return (
    <div className="import-section import-readiness">
      <div className="import-section-head">
        <h3>Future import readiness</h3>
        <span className="import-tag">No commit occurs in this preview</span>
      </div>

      {!readiness.available ? (
        <p className="import-empty">{readiness.explanation}</p>
      ) : (
        <>
          <p
            className={`import-readiness-verdict ${
              readiness.isReadyForFutureCommit
                ? 'import-readiness-ready'
                : 'import-readiness-blocked'
            }`}
          >
            {readiness.isReadyForFutureCommit
              ? 'Ready for a future import commit'
              : 'Not ready for a future import commit'}
          </p>

          <div className="import-readiness-counts">
            <span className="import-readiness-count">
              <strong>{readiness.readyAdditions}</strong> ready to add (new)
            </span>
            <span className="import-readiness-count">
              <strong>{readiness.readyLinks}</strong> linked (existing)
            </span>
            <span className="import-readiness-count">
              <strong>{readiness.deferredRows}</strong> deferred
            </span>
            <span className="import-readiness-count">
              <strong>{readiness.unresolvedRows}</strong> unresolved
            </span>
            <span className="import-readiness-count">
              <strong>{readiness.blockedRows}</strong> blocked
            </span>
          </div>

          <p className="import-reasons">{readiness.explanation}</p>

          {readiness.blockingReasons.length > 0 && (
            <ul className="import-issues">
              {readiness.blockingReasons.map((reason) => (
                <li key={reason.code} className="import-issue import-issue-warning">
                  <strong>
                    {READINESS_REASON_LABELS[reason.code] ?? reason.code}
                  </strong>
                  : {reason.message}
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="import-decision-button"
            onClick={() =>
              exportPreviewArtifact(vm, sourceName, sourceKind, executionResult)
            }
          >
            Export preview artifact
          </button>
          <p className="import-reasons">
            Exports the current preview state as a JSON file (downloaded locally only).
            Nothing is committed, applied, or saved to the app.
          </p>
        </>
      )}
    </div>
  );
}

function StagedProjectionPanel({
  stagedProjection,
  staged,
  onStage,
  onClearStaged,
  locked,
}: {
  stagedProjection: ScrapedImportStagedProjection;
  staged: boolean;
  onStage: () => void;
  onClearStaged: () => void;
  locked: boolean;
}) {
  return (
    <div className="import-section import-staged">
      <div className="import-section-head">
        <h3>Staged projection</h3>
        <span className="import-tag">Preview only · in memory only · nothing has been applied</span>
      </div>

      {!stagedProjection.stageable ? (
        <p className="import-empty">{stagedProjection.message}</p>
      ) : !staged ? (
        <>
          <p className="import-reasons">
            The dry run is clean. Stage a preview-only projected roster to inspect the
            result in memory. Nothing is applied, saved, or written.
          </p>
          <button
            type="button"
            className="import-decision-button"
            onClick={onStage}
            disabled={locked}
          >
            Stage preview
          </button>
        </>
      ) : (
        <>
          <div className="import-section-head">
            <p className="import-review">
              Projected roster for {stagedProjection.existingTeamId}:{' '}
              {stagedProjection.actualRosterCount} current +{' '}
              {stagedProjection.stagedNewCount} new ={' '}
              <strong>{stagedProjection.projectedRosterCount}</strong> projected
              {stagedProjection.stagedLinkCount > 0
                ? ` · ${stagedProjection.stagedLinkCount} linked`
                : ''}
              {stagedProjection.deferredCount > 0
                ? ` · ${stagedProjection.deferredCount} deferred`
                : ''}
            </p>
            <button
              type="button"
              className="import-link-button"
              onClick={onClearStaged}
              disabled={locked}
            >
              Clear staged preview
            </button>
          </div>

          <div className="import-roster-columns">
            <div className="import-roster-column import-roster-actual">
              <h4>Actual roster ({stagedProjection.actualRosterCount})</h4>
              <ul className="import-roster-list">
                {stagedProjection.existingPlayers.map((player, index) => (
                  <li key={index}>
                    {player.name}
                    {player.linked && (
                      <span className="import-roster-tag import-roster-linked">
                        ← links {player.linkedFromImportedName}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div className="import-roster-column import-roster-projected">
              <h4>Projected roster ({stagedProjection.projectedRosterCount})</h4>
              <ul className="import-roster-list">
                {stagedProjection.existingPlayers.map((player, index) => (
                  <li key={`e-${index}`}>
                    {player.name}
                    <span className="import-roster-tag">existing</span>
                  </li>
                ))}
                {stagedProjection.projectedNewPlayers.map((player) => (
                  <li key={`n-${player.rowIndex}`} className="import-roster-new">
                    {player.name ?? '(missing)'}
                    <span className="import-roster-tag import-roster-new-tag">new</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {stagedProjection.deferredRows.length > 0 && (
            <p className="import-reasons">
              Deferred (not added):{' '}
              {stagedProjection.deferredRows.map((r) => r.name ?? '(missing)').join(', ')}
            </p>
          )}
        </>
      )}
    </div>
  );
}

const MATCH_STATUS_LABELS: Record<string, string> = {
  'likely-new': 'Likely new',
  'likely-existing': 'Likely existing',
  ambiguous: 'Ambiguous',
  'needs-review': 'Needs review',
  blocked: 'Blocked',
};

const OUTCOME_LABELS: Record<string, string> = {
  'projected-create': 'Add as new roster row',
  'projected-link': 'Link to existing record',
  deferred: 'Deferred — not added',
  'blocked-unresolved': 'Unresolved — needs review',
  blocked: 'Blocked — cannot proceed',
};

function RosterReviewPanel({
  rosterReview,
  onSetRowDecision,
  locked,
}: {
  rosterReview: ScrapedImportRosterAwareReview;
  onSetRowDecision: (sourceRowId: string, kind: ScrapedImportReviewDecisionKind | null) => void;
  locked: boolean;
}) {
  return (
    <div className="import-section import-dryrun">
      <div className="import-section-head">
        <h3>Roster-aware review &amp; dry run</h3>
        <span className="import-tag">Dry run only · nothing applied</span>
      </div>
      {!rosterReview.available ? (
        <p className="import-empty">{rosterReview.message}</p>
      ) : (
        <>
          <p className="import-reasons">
            Compared against existing roster {rosterReview.existingTeamId} (
            {rosterReview.existingPlayerCount} players). Resolve matches below — nothing has
            been applied.
          </p>
          <p className="import-review">
            Would add (new) {rosterReview.summary.projectedCreateRows} · would link
            (existing) {rosterReview.summary.projectedLinkRows} · deferred{' '}
            {rosterReview.summary.deferredRows} · unresolved{' '}
            {rosterReview.summary.unresolvedRows} ·{' '}
            {rosterReview.summary.canCommit
              ? 'dry run is clean'
              : 'dry run not clean (unresolved rows remain)'}
          </p>
          <ul className="import-row-legend">
            <li>
              <span className="import-row-legend-swatch import-row-legend-create" />
              <strong>Add as new roster row</strong> — a new player added in a future
              commit
            </li>
            <li>
              <span className="import-row-legend-swatch import-row-legend-link" />
              <strong>Link to existing record</strong> — matches a current roster player;
              not added as new
            </li>
            <li>
              <span className="import-row-legend-swatch import-row-legend-defer" />
              <strong>Deferred — not added</strong> — intentionally held back from this
              import
            </li>
            <li>
              <span className="import-row-legend-swatch import-row-legend-block" />
              <strong>Unresolved / blocked</strong> — needs a reviewer decision before a
              future commit
            </li>
          </ul>
          <table className="import-table">
            <thead>
              <tr>
                <th>Imported name (raw)</th>
                <th>Match</th>
                <th>Candidate(s)</th>
                <th>Would</th>
                <th>Decision</th>
              </tr>
            </thead>
            <tbody>
              {rosterReview.rows.map((row) => (
                <ReviewRow
                  key={`${row.sourceRowId}:${row.rowIndex}`}
                  row={row}
                  onSetRowDecision={onSetRowDecision}
                  locked={locked}
                />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ReviewRow({
  row,
  onSetRowDecision,
  locked,
}: {
  row: ScrapedImportReviewRow;
  onSetRowDecision: (sourceRowId: string, kind: ScrapedImportReviewDecisionKind | null) => void;
  locked: boolean;
}) {
  const rowId = row.sourceRowId;
  const candidateText =
    row.candidates.length === 0
      ? '—'
      : row.candidates.map((c) => c.existingPlayerName ?? '(unnamed)').join(', ');
  const outcomeText =
    row.outcome === 'projected-link' && row.linkTargetExistingName
      ? `Link → ${row.linkTargetExistingName}`
      : OUTCOME_LABELS[row.outcome] ?? row.outcome;
  return (
    <tr>
      <td>{row.playerName ?? '(missing)'}</td>
      <td>
        <span className={`import-match import-match-${row.matchStatus}`}>
          {MATCH_STATUS_LABELS[row.matchStatus] ?? row.matchStatus}
        </span>
      </td>
      <td>{candidateText}</td>
      <td>
        <span className={`import-outcome import-outcome-${row.outcome}`}>
          {outcomeText}
        </span>
      </td>
      <td>
        {rowId === null ? (
          <span className="import-empty">—</span>
        ) : (
          <span className="import-decision-controls">
            {row.confirmable && (
              <button
                type="button"
                className={`import-decision-button ${row.decision === 'confirm-match' ? 'import-decision-active' : ''}`}
                onClick={() => onSetRowDecision(rowId, 'confirm-match')}
                disabled={locked}
              >
                Confirm match
              </button>
            )}
            <button
              type="button"
              className={`import-decision-button ${row.decision === 'create-new' ? 'import-decision-active' : ''}`}
              onClick={() => onSetRowDecision(rowId, 'create-new')}
              disabled={locked}
            >
              Create new
            </button>
            <button
              type="button"
              className={`import-decision-button ${row.decision === 'needs-review' ? 'import-decision-active' : ''}`}
              onClick={() => onSetRowDecision(rowId, 'needs-review')}
              disabled={locked}
            >
              Needs review
            </button>
            {row.decision !== null && (
              <button
                type="button"
                className="import-link-button"
                onClick={() => onSetRowDecision(rowId, null)}
                disabled={locked}
              >
                Clear
              </button>
            )}
          </span>
        )}
      </td>
    </tr>
  );
}
