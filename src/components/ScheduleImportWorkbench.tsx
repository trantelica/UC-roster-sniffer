import { useMemo, useRef, useState } from 'react';
import type { Game, Team } from '../domain/types';
import { parseScrapedJsonImportFileText } from '../app/scrapedImportFileParse';
import { buildScheduleImportPreview } from '../engine/scheduleImportPreview';
import {
  executeScheduleImport,
  undoScheduleImport,
  type ScheduleImportExecutionResult,
} from '../engine/scheduleImportExecution';
import scheduleSample from '../../data-samples/schedule-import.sample.json';

/**
 * Phase 6 slice 25: a local-first SCHEDULE IMPORT WORKBENCH.
 *
 * Thin renderer over the pure schedule-import engine: it reads a local schedule JSON file
 * (or a bundled demo), previews add/update/skip/error outcomes, and lets the user execute
 * the import into the current in-memory games — and undo it. Everything is in-memory only;
 * durability comes only from a workspace snapshot export. No upload, storage, or sync.
 */

type LoadedSource = { name: string; payload: unknown };

const OUTCOME_LABELS: Record<string, string> = {
  add: 'Add',
  update: 'Update',
  skip: 'Skip',
  error: 'Error',
};

export default function ScheduleImportWorkbench({
  teams,
  games,
  onApplyGames,
}: {
  teams: Team[];
  games: Game[];
  onApplyGames: (games: Game[]) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] =
    useState<ScheduleImportExecutionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const executed = executionResult !== null && executionResult.status === 'executed';

  const preview = useMemo(
    () =>
      loaded
        ? buildScheduleImportPreview({ payload: loaded.payload, teams, existingGames: games })
        : null,
    [loaded, teams, games]
  );

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (executed) {
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const parsed = parseScrapedJsonImportFileText(text);
      if (parsed.ok) {
        setFileError(null);
        setLoaded({ name: file.name, payload: parsed.payload });
      } else {
        setLoaded(null);
        setFileError(parsed.message);
      }
    };
    reader.onerror = () => {
      setLoaded(null);
      setFileError('The file could not be read locally.');
    };
    reader.readAsText(file);
  }

  function loadDemo() {
    if (executed) return;
    setFileError(null);
    setLoaded({ name: 'schedule-import.sample.json (demo)', payload: scheduleSample });
  }

  function clearLoaded() {
    if (executed) return;
    setLoaded(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function execute() {
    if (!preview || !preview.isExecutable || executed) return;
    const result = executeScheduleImport({
      preview,
      games,
      transactionId: `schedule-import:${Date.now()}`,
      executedAt: new Date().toISOString(),
    });
    if (result.status === 'executed') {
      setExecutionResult(result);
      onApplyGames(result.games);
    }
  }

  function undo() {
    if (!executionResult || executionResult.status !== 'executed') return;
    const result = undoScheduleImport({
      executionResult,
      games,
      undoneAt: new Date().toISOString(),
    });
    if (result.status === 'undone') {
      onApplyGames(result.games);
      setExecutionResult(null);
    }
  }

  return (
    <div className="import-preview">
      <div className="import-preview-header">
        <h2 className="import-title">Schedule import workbench</h2>
        <span className="import-tag">In-memory only · no durable save</span>
      </div>
      <p className="import-note">
        Choose a schedule JSON file (the preserved <code>schedule-import.sample.json</code>{' '}
        row contract) to preview and apply games between existing teams. Schedule import is
        in-memory only until you export a workspace snapshot — workspace snapshot export is
        the durability path. No browser storage or cloud sync is used.
      </p>

      {executed && (
        <p className="import-warn">
          A schedule import is executed in memory. Undo it below before loading a different
          schedule file. (In-memory only — export a workspace snapshot to keep it.)
        </p>
      )}

      <div className="import-source-controls">
        <div className="filter-group">
          <label htmlFor="schedule-file-input">Choose schedule JSON (local only)</label>
          <input
            id="schedule-file-input"
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            disabled={executed}
          />
        </div>
        <button
          type="button"
          className="workspace-button"
          onClick={loadDemo}
          disabled={executed}
        >
          Load demo schedule
        </button>
        {loaded && !executed && (
          <button type="button" className="import-link-button" onClick={clearLoaded}>
            Clear loaded file
          </button>
        )}
      </div>

      {fileError && <p className="import-warn">Could not load file: {fileError}</p>}

      {!loaded && !fileError && (
        <p className="import-empty">No schedule file loaded. Choose a local JSON file to begin.</p>
      )}

      {loaded && preview && !executed && (
        <SchedulePreviewPanel preview={preview} onExecute={execute} />
      )}

      {executed && executionResult.status === 'executed' && (
        <ScheduleExecutedPanel executionResult={executionResult} onUndo={undo} />
      )}
    </div>
  );
}

function SchedulePreviewPanel({
  preview,
  onExecute,
}: {
  preview: ReturnType<typeof buildScheduleImportPreview>;
  onExecute: () => void;
}) {
  if (!preview.available) {
    return (
      <p className="import-warn">
        This file is not a supported schedule import: {preview.shapeError?.message}
      </p>
    );
  }

  return (
    <div className="import-section">
      <div className="import-section-head">
        <h3>Schedule import preview</h3>
        <span className="import-tag">Dry run · nothing applied</span>
      </div>
      <div className="roster-status-summary">
        <span className="roster-status-count"><strong>{preview.totalRows}</strong> rows</span>
        <span className="roster-status-count"><strong>{preview.validRows}</strong> valid</span>
        <span className="roster-status-count"><strong>{preview.invalidRows}</strong> invalid</span>
        <span className="roster-status-count"><strong>{preview.addCandidates}</strong> additions</span>
        <span className="roster-status-count"><strong>{preview.updateCandidates}</strong> updates</span>
        <span className="roster-status-count"><strong>{preview.skippedRows}</strong> skipped</span>
        <span className="roster-status-count"><strong>{preview.blockingErrors.length}</strong> blocking errors</span>
      </div>

      <table className="schedule-table">
        <thead>
          <tr>
            <th>Date / Week</th>
            <th>Home</th>
            <th>Away</th>
            <th>Status</th>
            <th>Score</th>
            <th>Outcome</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={`${row.sourceRowId}-${row.rowIndex}`}>
              <td>
                {row.game?.scheduledDate ?? row.source.gameDate ?? 'TBD'}
                <span className="schedule-week"> · {row.game?.weekLabel ?? row.source.weekLabel ?? ''}</span>
              </td>
              <td>{row.game?.homeTeamId ?? row.source.teamId ?? '—'}</td>
              <td>{row.game?.awayTeamId ?? row.source.opponentTeamId ?? '—'}</td>
              <td>{row.game?.status ?? '—'}</td>
              <td>
                {row.game && row.game.homeScore !== undefined && row.game.awayScore !== undefined
                  ? `${row.game.homeScore}–${row.game.awayScore}`
                  : '—'}
              </td>
              <td>
                <span className={`schedule-outcome schedule-outcome-${row.outcome}`}>
                  {OUTCOME_LABELS[row.outcome] ?? row.outcome}
                </span>
              </td>
              <td className="schedule-reason">
                {row.reasons.map((r) => r.message).join('; ') || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {preview.isExecutable ? (
        <>
          <p className="import-reasons">
            Ready to apply {preview.addCandidates} addition(s) and {preview.updateCandidates}{' '}
            update(s) into the in-memory workspace. No durable save occurs.
          </p>
          <button type="button" className="import-decision-button" onClick={onExecute}>
            Execute Schedule Import (In Memory)
          </button>
        </>
      ) : (
        <p className="import-empty">
          Not executable: resolve the blocking errors above (or there are no add/update rows).
        </p>
      )}
    </div>
  );
}

function ScheduleExecutedPanel({
  executionResult,
  onUndo,
}: {
  executionResult: Extract<ScheduleImportExecutionResult, { status: 'executed' }>;
  onUndo: () => void;
}) {
  return (
    <div className="import-section import-execution">
      <div className="import-section-head">
        <h3>Schedule import executed (in memory)</h3>
        <span className="import-tag">In-memory only · no durable save</span>
      </div>
      <div className="roster-status-summary">
        <span className="roster-status-count">
          <strong>{executionResult.addedGameIds.length}</strong> added
        </span>
        <span className="roster-status-count">
          <strong>{executionResult.updatedGameIds.length}</strong> updated
        </span>
        <span className="roster-status-count">
          <strong>{executionResult.skippedRowIds.length}</strong> skipped
        </span>
      </div>
      <p className="import-reasons">
        Imported games now appear in the team Schedule &amp; Results view. This is in-memory
        only — export a workspace snapshot to keep it; it does not persist after reload.
      </p>
      <button type="button" className="import-decision-button" onClick={onUndo}>
        Undo Schedule Import
      </button>
    </div>
  );
}
