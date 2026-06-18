import { useMemo, useRef, useState } from 'react';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
} from '../engine/uteConferenceScrapedJsonImportSession';
import {
  buildScrapedJsonImportPreviewViewModel,
  type ScrapedImportPreviewViewModel,
  type ScrapedImportTargetOption,
  type ScrapedImportSelectedView,
} from '../app/scrapedImportPreviewViewModel';
import { parseScrapedJsonImportFileText } from '../app/scrapedImportFileParse';

import playersPw from '../test/fixtures/ute-scraped-json/players-2023-pw-small.json';
import coachesPw from '../test/fixtures/ute-scraped-json/coaches-2022-pw-small.json';

/**
 * Phase 5 slice 17: a local-first scraped JSON import preview workbench.
 *
 * This component is a thin renderer over the existing engine. It lets the user choose a
 * REAL local scraped JSON file (read in-browser via FileReader — no upload, no backend,
 * no storage) or fall back to a bundled demo fixture, parses it with a pure helper,
 * creates a slice 14 import session, lets the user select a target, and renders the
 * readiness / preview / review / dry-run state via the pure slice 16/17 view model.
 *
 * Everything is in component memory only. There are deliberately no save/apply/commit
 * controls. The dry-run projection is preview-only and clearly labelled.
 */

type DemoSource = { id: string; label: string; payload: unknown };

const DEMO_SOURCES: DemoSource[] = [
  { id: 'players-2023-pw', label: 'Players — PeeWee, 2023 (demo fixture)', payload: playersPw },
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

export default function ScrapedImportPreview() {
  const [loaded, setLoaded] = useState<LoadedSource | null>(null);
  const [fileError, setFileError] = useState<FileError | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const baseSession = useMemo(
    () => (loaded ? createUteScrapedJsonImportSessionFromPayload(loaded.payload) : null),
    [loaded]
  );

  const session = useMemo(() => {
    if (!baseSession) return null;
    if (!selectedTargetId) return baseSession;
    return selectUteScrapedJsonImportSessionTarget(baseSession, selectedTargetId);
  }, [baseSession, selectedTargetId]);

  const vm = useMemo(
    () => (session ? buildScrapedJsonImportPreviewViewModel(session) : null),
    [session]
  );

  function resetSelection() {
    setSelectedTargetId(null);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
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

      <div className="import-source-controls">
        <div className="filter-group">
          <label htmlFor="import-file-input">Choose JSON file (local only)</label>
          <input
            id="import-file-input"
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileChange}
          />
        </div>
        <div className="filter-group">
          <label htmlFor="import-demo-select">…or load a demo source</label>
          <select
            id="import-demo-select"
            value={loaded?.sourceKind === 'demo' ? demoIdForLabel(loaded.name) : ''}
            onChange={(e) => handleDemoChange(e.target.value)}
          >
            <option value="">Select a demo source</option>
            {DEMO_SOURCES.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
        {(loaded || fileError) && (
          <button type="button" className="import-link-button" onClick={handleClearFile}>
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
          onSelect={setSelectedTargetId}
          onClearTarget={resetSelection}
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
}: {
  vm: ScrapedImportPreviewViewModel;
  sourceName: string;
  sourceKind: 'file' | 'demo';
  selectedTargetId: string | null;
  onSelect: (id: string) => void;
  onClearTarget: () => void;
}) {
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
          />
          <TargetSection
            title="Targets needing review"
            targets={vm.needsReviewTargets}
            selectedTargetId={selectedTargetId}
            onSelect={onSelect}
            onClearTarget={onClearTarget}
            emptyMessage={null}
          />
          <ReadonlyTargetSection title="Blocked targets — not importable" targets={vm.blockedTargets} />
          <ReadonlyTargetSection title="Empty targets — no rows" targets={vm.emptyTargets} />
          <SelectedTargetDetail selected={vm.selected} dryRun={vm.dryRun} />
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
}: {
  title: string;
  targets: ScrapedImportTargetOption[];
  selectedTargetId: string | null;
  onSelect: (id: string) => void;
  onClearTarget: () => void;
  emptyMessage: string | null;
}) {
  if (targets.length === 0 && emptyMessage === null) return null;
  const anySelectedHere = targets.some((t) => t.sourceTargetId === selectedTargetId);
  return (
    <div className="import-section">
      <div className="import-section-head">
        <h3>{title}</h3>
        {anySelectedHere && (
          <button type="button" className="import-link-button" onClick={onClearTarget}>
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
  selected,
  dryRun,
}: {
  selected: ScrapedImportSelectedView | null;
  dryRun: ScrapedImportPreviewViewModel['dryRun'];
}) {
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

      <DryRunPanel dryRun={dryRun} />
    </div>
  );
}

function DryRunPanel({ dryRun }: { dryRun: ScrapedImportPreviewViewModel['dryRun'] }) {
  return (
    <div className="import-section import-dryrun">
      <div className="import-section-head">
        <h3>Dry-run projection</h3>
        <span className="import-tag">Dry run only · nothing applied</span>
      </div>
      {!dryRun.available ? (
        <p className="import-empty">{dryRun.message}</p>
      ) : (
        <>
          <p className="import-reasons">
            Assumes a new import with no existing roster to match against. This is a
            preview of what an import would do — nothing has been written.
          </p>
          <p className="import-review">
            Would create {dryRun.summary.projectedCreateRows} · would link{' '}
            {dryRun.summary.projectedLinkRows} · deferred {dryRun.summary.projectedDeferRows} ·{' '}
            rejected {dryRun.summary.projectedRejectRows} · blocked {dryRun.summary.blockedRows}
          </p>
          <table className="import-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player name (raw)</th>
                <th>Would</th>
              </tr>
            </thead>
            <tbody>
              {dryRun.rows.map((row) => (
                <tr key={row.rowIndex}>
                  <td>{row.rowIndex + 1}</td>
                  <td>{row.projectedNewPlayerName ?? row.playerName ?? '(missing)'}</td>
                  <td>{row.projectionStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
