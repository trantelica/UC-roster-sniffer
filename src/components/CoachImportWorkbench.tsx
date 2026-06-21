import { useMemo, useRef, useState } from 'react';
import type { StaffCoach, Team, TeamCoachAssignment } from '../domain/types';
import { parseScrapedJsonImportFileText } from '../app/scrapedImportFileParse';
import { buildCoachImportPreview } from '../engine/coachImportPreview';
import {
  executeCoachImport,
  undoCoachImport,
  type CoachImportExecutionResult,
} from '../engine/coachImportExecution';
import coachSample from '../../data-samples/coach-import.sample.json';

/**
 * Phase 7 slice 27: a local-first COACH IMPORT WORKBENCH.
 *
 * Thin renderer over the pure coach-import engine: reads a local coach JSON file (or a
 * bundled demo), previews add/update/skip/error/review outcomes, and executes the import
 * into the current in-memory coaches/assignments — and undoes it. In-memory only; durability
 * comes only from a workspace snapshot export. No upload, storage, or sync. Never touches
 * rosters or games.
 */

type LoadedSource = { name: string; payload: unknown };

const OUTCOME_LABELS: Record<string, string> = {
  add: 'Add',
  update: 'Update',
  skip: 'Skip',
  error: 'Error',
  review: 'Review',
};

export default function CoachImportWorkbench({
  teams,
  coaches,
  coachAssignments,
  onApplyCoachData,
}: {
  teams: Team[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  onApplyCoachData: (coaches: StaffCoach[], coachAssignments: TeamCoachAssignment[]) => void;
}) {
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [executionResult, setExecutionResult] =
    useState<CoachImportExecutionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const executed = executionResult !== null && executionResult.status === 'executed';

  const preview = useMemo(
    () =>
      loaded
        ? buildCoachImportPreview({
            payload: loaded.payload,
            teams,
            existingCoaches: coaches,
            existingAssignments: coachAssignments,
          })
        : null,
    [loaded, teams, coaches, coachAssignments]
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
    setLoaded({ name: 'coach-import.sample.json (demo)', payload: coachSample });
  }

  function clearLoaded() {
    if (executed) return;
    setLoaded(null);
    setFileError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function execute() {
    if (!preview || !preview.isExecutable || executed) return;
    const result = executeCoachImport({
      preview,
      coaches,
      coachAssignments,
      transactionId: `coach-import:${Date.now()}`,
      executedAt: new Date().toISOString(),
    });
    if (result.status === 'executed') {
      setExecutionResult(result);
      onApplyCoachData(result.coaches, result.coachAssignments);
    }
  }

  function undo() {
    if (!executionResult || executionResult.status !== 'executed') return;
    const result = undoCoachImport({
      executionResult,
      coaches,
      coachAssignments,
      undoneAt: new Date().toISOString(),
    });
    if (result.status === 'undone') {
      onApplyCoachData(result.coaches, result.coachAssignments);
      setExecutionResult(null);
    }
  }

  return (
    <div className="import-preview">
      <div className="import-preview-header">
        <h2 className="import-title">Coach import workbench</h2>
        <span className="import-tag">In-memory only · no durable save</span>
      </div>
      <p className="import-note">
        Choose a coach JSON file (the <code>coach-import.sample.json</code> row contract:
        <code> coachName</code> + <code>teamId</code> + <code>role</code>) to preview and
        apply coach assignments to existing teams. Coach import is in-memory only until you
        export a workspace snapshot — workspace snapshot export is the durability path. No
        browser storage or cloud sync is used. Rosters and games are never modified.
      </p>

      {executed && (
        <p className="import-warn">
          A coach import is executed in memory. Undo it below before loading a different coach
          file. (In-memory only — export a workspace snapshot to keep it.)
        </p>
      )}

      <div className="import-source-controls">
        <div className="filter-group">
          <label htmlFor="coach-file-input">Choose coach JSON (local only)</label>
          <input
            id="coach-file-input"
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
            disabled={executed}
          />
        </div>
        <button type="button" className="workspace-button" onClick={loadDemo} disabled={executed}>
          Load demo coach import
        </button>
        {loaded && !executed && (
          <button type="button" className="import-link-button" onClick={clearLoaded}>
            Clear loaded file
          </button>
        )}
      </div>

      {fileError && <p className="import-warn">Could not load file: {fileError}</p>}

      {!loaded && !fileError && (
        <p className="import-empty">No coach file loaded. Choose a local JSON file to begin.</p>
      )}

      {loaded && preview && !executed && (
        <CoachPreviewPanel preview={preview} onExecute={execute} />
      )}

      {executed && executionResult.status === 'executed' && (
        <CoachExecutedPanel executionResult={executionResult} onUndo={undo} />
      )}
    </div>
  );
}

function CoachPreviewPanel({
  preview,
  onExecute,
}: {
  preview: ReturnType<typeof buildCoachImportPreview>;
  onExecute: () => void;
}) {
  if (!preview.available) {
    return (
      <p className="import-warn">
        This file is not a supported coach import: {preview.shapeError?.message}
      </p>
    );
  }

  return (
    <div className="import-section">
      <div className="import-section-head">
        <h3>Coach import preview</h3>
        <span className="import-tag">Dry run · nothing applied</span>
      </div>
      <div className="roster-status-summary">
        <span className="roster-status-count"><strong>{preview.totalRows}</strong> rows</span>
        <span className="roster-status-count"><strong>{preview.validRows}</strong> valid</span>
        <span className="roster-status-count"><strong>{preview.invalidRows}</strong> invalid</span>
        <span className="roster-status-count"><strong>{preview.coachesToAdd}</strong> coaches to add</span>
        <span className="roster-status-count"><strong>{preview.assignmentsToAdd}</strong> assignments to add</span>
        <span className="roster-status-count"><strong>{preview.assignmentsToUpdate}</strong> assignments to update</span>
        <span className="roster-status-count"><strong>{preview.skippedRows}</strong> skipped</span>
        <span className="roster-status-count"><strong>{preview.ambiguousIdentityRows}</strong> review</span>
        <span className="roster-status-count"><strong>{preview.blockingErrors.length}</strong> blocking errors</span>
      </div>

      <table className="schedule-table">
        <thead>
          <tr>
            <th>Coach</th>
            <th>Team / Season</th>
            <th>Role</th>
            <th>Outcome</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {preview.rows.map((row) => (
            <tr key={`${row.sourceRowId}-${row.rowIndex}`}>
              <td>{row.coachName ?? '—'}</td>
              <td>
                {row.teamId ?? '—'}
                <span className="schedule-week"> · {row.seasonId ?? '—'}</span>
              </td>
              <td>{row.role ?? '—'}</td>
              <td>
                <span className={`schedule-outcome schedule-outcome-${row.outcome === 'review' ? 'error' : row.outcome}`}>
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
            Ready to add {preview.coachesToAdd} coach(es), {preview.assignmentsToAdd}{' '}
            assignment(s), and update {preview.assignmentsToUpdate} — in memory. No durable
            save occurs.
          </p>
          <button type="button" className="import-decision-button" onClick={onExecute}>
            Execute Coach Import (In Memory)
          </button>
        </>
      ) : (
        <p className="import-empty">
          Not executable: resolve the blocking/review rows above (or there are no
          add/update rows).
        </p>
      )}
    </div>
  );
}

function CoachExecutedPanel({
  executionResult,
  onUndo,
}: {
  executionResult: Extract<CoachImportExecutionResult, { status: 'executed' }>;
  onUndo: () => void;
}) {
  return (
    <div className="import-section import-execution">
      <div className="import-section-head">
        <h3>Coach import executed (in memory)</h3>
        <span className="import-tag">In-memory only · no durable save</span>
      </div>
      <div className="roster-status-summary">
        <span className="roster-status-count">
          <strong>{executionResult.addedCoachIds.length}</strong> coaches added
        </span>
        <span className="roster-status-count">
          <strong>{executionResult.addedAssignmentIds.length}</strong> assignments added
        </span>
        <span className="roster-status-count">
          <strong>{executionResult.updatedAssignmentIds.length}</strong> assignments updated
        </span>
      </div>
      <p className="import-reasons">
        Imported coaches now appear in team staff and the coach directory. This is in-memory
        only — export a workspace snapshot to keep it; it does not persist after reload.
        Rosters and games were not modified.
      </p>
      <button type="button" className="import-decision-button" onClick={onUndo}>
        Undo Coach Import
      </button>
    </div>
  );
}
