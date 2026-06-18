import { useMemo, useState } from 'react';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
} from '../engine/uteConferenceScrapedJsonImportSession';
import {
  buildScrapedJsonImportPreviewViewModel,
  type ScrapedImportTargetOption,
  type ScrapedImportSelectedView,
} from '../app/scrapedImportPreviewViewModel';

import playersPw from '../test/fixtures/ute-scraped-json/players-2023-pw-small.json';
import playersCoded from '../test/fixtures/ute-scraped-json/players-coded-classification-small.json';
import playersColor from '../test/fixtures/ute-scraped-json/players-color-team-small.json';
import coachesPw from '../test/fixtures/ute-scraped-json/coaches-2022-pw-small.json';
import playersEmpty from '../test/fixtures/ute-scraped-json/players-empty-league-small.json';

/**
 * Phase 5 slice 16: a READ-ONLY scraped JSON import preview shell.
 *
 * This component is a thin renderer over the existing engine: it creates a slice 14
 * import session from a chosen demo source, optionally selects one target, builds the
 * pure slice 16 view model, and renders it. It holds the chosen source and selected
 * target in component memory only — nothing is uploaded, persisted, applied, committed,
 * or mutated. There are deliberately no save/apply/commit controls.
 *
 * The demo sources are the existing scraped JSON TEST FIXTURES (temporary demo wiring
 * for this slice) plus two small inline payloads so the blocked and invalid-source
 * states are visible. A future slice replaces this with real source loading.
 */

type DemoSource = {
  id: string;
  label: string;
  payload: unknown;
};

// A tiny inline payload whose only row has a blank name, so the readiness engine marks
// the target `blocked` — used purely to show the blocked state in the read-only shell.
const blockedDemoPayload = {
  metadata: {
    organization: 'Ute Conference',
    event: 'Demo Fall Season',
    age_division: 'PW League 10',
    age_division_alias: 'PW',
    year: 2025,
    record_type: 'players',
    source_url: 'https://ute.example/demo/blocked',
  },
  districts: [
    {
      district: 'Alta',
      league: 'PW League 10',
      teams_count: 1,
      teams: [
        {
          team_name: 'PeeWee C1',
          source_url: 'https://ute.example/demo/blocked/c1',
          players_count: 1,
          players: [{ name: '   ' }],
        },
      ],
    },
  ],
};

// An unsupported record_type, so the engine reports an invalid-source session.
const invalidDemoPayload = {
  metadata: { organization: 'Ute Conference', record_type: 'banners' },
  districts: [],
};

const DEMO_SOURCES: DemoSource[] = [
  { id: 'players-2023-pw', label: 'Players — PeeWee, 2023 (fixture)', payload: playersPw },
  { id: 'players-coded', label: 'Players — coded classification (fixture)', payload: playersCoded },
  { id: 'players-color', label: 'Players — color team (fixture)', payload: playersColor },
  { id: 'coaches-2022-pw', label: 'Coaches — PeeWee, 2022 (fixture)', payload: coachesPw },
  { id: 'players-empty', label: 'Players — empty league (fixture)', payload: playersEmpty },
  { id: 'demo-blocked', label: 'Demo — blocked row (inline)', payload: blockedDemoPayload },
  { id: 'demo-invalid', label: 'Demo — unsupported source (inline)', payload: invalidDemoPayload },
];

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
  const [sourceId, setSourceId] = useState<string>(DEMO_SOURCES[0].id);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);

  const baseSession = useMemo(() => {
    const source = DEMO_SOURCES.find((s) => s.id === sourceId) ?? DEMO_SOURCES[0];
    return createUteScrapedJsonImportSessionFromPayload(source.payload);
  }, [sourceId]);

  const session = useMemo(() => {
    if (!selectedTargetId) return baseSession;
    return selectUteScrapedJsonImportSessionTarget(baseSession, selectedTargetId);
  }, [baseSession, selectedTargetId]);

  const vm = useMemo(
    () => buildScrapedJsonImportPreviewViewModel(session),
    [session]
  );

  function handleSourceChange(nextId: string) {
    setSourceId(nextId);
    setSelectedTargetId(null);
  }

  return (
    <div className="import-preview">
      <div className="import-preview-header">
        <h2 className="import-title">Read-only import preview</h2>
        <span className="import-tag">Preview only · not applied</span>
      </div>
      <p className="import-note">
        This shell views a scraped JSON import source through the existing engine. Nothing
        is uploaded, saved, applied, or committed — selecting a source or target only
        changes what is shown.
      </p>

      <div className="filter-group">
        <label htmlFor="import-source-select">Demo source</label>
        <select
          id="import-source-select"
          value={sourceId}
          onChange={(e) => handleSourceChange(e.target.value)}
        >
          {DEMO_SOURCES.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      <SourceSummary vm={vm} />

      {vm.invalidSource ? (
        <p className="import-empty">
          This source is not a supported scraped JSON players or coaches file, so there
          are no importable targets.
        </p>
      ) : (
        <>
          <SelectableTargets
            targets={vm.selectableTargets}
            selectedTargetId={vm.selected?.sourceTargetId ?? null}
            onSelect={setSelectedTargetId}
            onClear={() => setSelectedTargetId(null)}
          />
          <NonImportableTargets
            title="Blocked targets — not importable"
            targets={vm.blockedTargets}
          />
          <NonImportableTargets
            title="Empty targets — no rows"
            targets={vm.emptyTargets}
          />
          <SelectedTargetDetail selected={vm.selected} />
        </>
      )}
    </div>
  );
}

function SourceSummary({ vm }: { vm: ReturnType<typeof buildScrapedJsonImportPreviewViewModel> }) {
  return (
    <div className="import-summary">
      <div className="import-summary-line">
        <span>Status</span>
        <strong>{vm.status}</strong>
      </div>
      {vm.source && (
        <div className="import-summary-line">
          <span>Source</span>
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
          {vm.summary.selectableTargets} selectable · {vm.summary.blockedTargets} blocked ·{' '}
          {vm.summary.emptyTargets} empty
        </strong>
      </div>
    </div>
  );
}

function SelectableTargets({
  targets,
  selectedTargetId,
  onSelect,
  onClear,
}: {
  targets: ScrapedImportTargetOption[];
  selectedTargetId: string | null;
  onSelect: (id: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="import-section">
      <div className="import-section-head">
        <h3>Selectable targets</h3>
        {selectedTargetId && (
          <button type="button" className="import-link-button" onClick={onClear}>
            Clear selection
          </button>
        )}
      </div>
      {targets.length === 0 ? (
        <p className="import-empty">No selectable targets in this source.</p>
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

function NonImportableTargets({
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

function SelectedTargetDetail({ selected }: { selected: ScrapedImportSelectedView | null }) {
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
    </div>
  );
}
