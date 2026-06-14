import {
  createCoachImportPreviewInputFromScrapedJson,
} from './uteConferenceScrapedJsonAdapter';
import type {
  UteScrapedRecordType,
  UteScrapedJsonSummary,
  UteCoachImportPreviewResult,
} from './uteConferenceScrapedJsonAdapter';
import {
  createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext,
} from './uteConferenceScrapedCanonicalMapping';
import type {
  UteCanonicalMappingOverride,
  UteCanonicalTeamContextMappingResult,
  UtePlayerCanonicalPreviewInputResult,
} from './uteConferenceScrapedCanonicalMapping';
import {
  createUteConferenceScrapedJsonReadinessReport,
  getUteScrapedJsonImportReadyTargets,
  getUteScrapedJsonTargetsNeedingReview,
  getUteScrapedJsonBlockedTargets,
  getUteScrapedJsonEmptyTargets,
} from './uteConferenceScrapedJsonReadinessReport';
import type {
  UteScrapedJsonReadinessReport,
  UteScrapedJsonReadinessReportOptions,
  UteScrapedJsonReadinessStatus,
  UteScrapedJsonReadinessTarget,
} from './uteConferenceScrapedJsonReadinessReport';
import type { RosterImportPreviewResult } from './rosterImportPreview';

/**
 * Phase 5 slice 14: in-memory IMPORT SESSION STATE for one scraped Ute Conference
 * JSON source file — ENGINE ONLY.
 *
 * This is a pure, deterministic session-state model that COMPOSES the slice 10
 * source adapter, the slice 11 canonical mapping, and the slice 12 readiness report
 * to hold, in memory, everything a future UI needs to drive one scraped JSON import:
 * the loaded source file (by reference), its readiness report, an optionally selected
 * team target, that target's canonical context mapping, and its preview output. It
 * answers: "can the system hold a scraped JSON source file, readiness report,
 * selected team target, canonical mapping, and preview state in a deterministic
 * session object without applying, writing, or persisting anything?"
 *
 * It REPLACES and DUPLICATES no slice 10/11/12 business logic — readiness
 * classification, canonical mapping, and preview building are all delegated to the
 * existing helpers.
 *
 * It is NOT UI, NOT persistence, NOT browser storage, NOT file upload, NOT roster
 * mutation, NOT an actual import commit/apply, NOT movement derivation, NOT coach
 * analytics, and NOT identity-review decision application. The payload is never
 * mutated; player names, coach names, coach titles, source rows, source URLs, and
 * source order are preserved exactly. Every helper returns a NEW session object and
 * never mutates its inputs. Output is identical across repeated calls.
 *
 * The source payload, when present, is held BY REFERENCE ONLY and is never mutated.
 * It is retained purely so target selection can re-run the existing mapping/preview
 * helpers (e.g. with a per-selection override) in memory; it is never written,
 * uploaded, or persisted.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_SESSION_LOGIC_VERSION =
  'phase5-slice14-scraped-json-import-session-state-v1';

export type UteScrapedJsonImportSessionStatus =
  | 'uninitialized'
  | 'source-loaded'
  | 'target-selected'
  | 'target-blocked'
  | 'ready-for-review'
  | 'ready-for-preview'
  | 'invalid-source';

export type UteScrapedJsonImportSessionIssueSeverity = 'info' | 'warning' | 'error';

export type UteScrapedJsonImportSessionIssueCode =
  | 'invalid-source'
  | 'unsupported-record-type'
  | 'readiness-report-failed'
  | 'target-not-found'
  | 'target-blocked'
  | 'target-empty'
  | 'target-needs-review'
  | 'selected-target-missing-preview'
  | 'source-fingerprint-mismatch';

export type UteScrapedJsonImportSessionIssue = {
  code: UteScrapedJsonImportSessionIssueCode;
  severity: UteScrapedJsonImportSessionIssueSeverity;
  message: string;
};

/** The selected team target plus its readiness verdict and selection issues. */
export type UteScrapedJsonImportSessionSelectedTarget = {
  sourceTargetId: string;
  recordType: UteScrapedRecordType;
  readinessStatus: UteScrapedJsonReadinessStatus;
  rowCount: number;
  /** The slice 12 readiness target snapshot for this selection. */
  readinessTarget: UteScrapedJsonReadinessTarget;
  /** Readiness issues plus selection-derived issues for this target. */
  issues: UteScrapedJsonImportSessionIssue[];
};

export type UteScrapedJsonImportSessionSummary = {
  status: UteScrapedJsonImportSessionStatus;
  recordType: UteScrapedRecordType;
  totalTargets: number;
  selectableTargets: number;
  blockedTargets: number;
  emptyTargets: number;
  selectedSourceTargetId: string | null;
  selectedStatus: UteScrapedJsonReadinessStatus | null;
  selectedRowCount: number;
  selectedIssueCount: number;
  canSelectTarget: boolean;
  canProceedToPreview: boolean;
  canProceedWithoutReview: boolean;
};

export type UteScrapedJsonImportSession = {
  status: UteScrapedJsonImportSessionStatus;
  /** Deterministic, non-cryptographic source/debug identifier (empty when no source). */
  sourceFingerprint: string;
  recordType: UteScrapedRecordType;
  sourceSummary: UteScrapedJsonSummary | null;
  readinessReport: UteScrapedJsonReadinessReport | null;
  selectedSourceTargetId: string | null;
  selectedTarget: UteScrapedJsonImportSessionSelectedTarget | null;
  selectedCanonicalContextMapping: UteCanonicalTeamContextMappingResult | null;
  selectedPlayerPreviewInput:
    | UtePlayerCanonicalPreviewInputResult['previewInput']
    | null;
  selectedPlayerPreviewResult: RosterImportPreviewResult | null;
  selectedCoachPreviewResult: UteCoachImportPreviewResult | null;
  /** Session-level (source / selection) issues. */
  issues: UteScrapedJsonImportSessionIssue[];
  summary: UteScrapedJsonImportSessionSummary;
  /**
   * The loaded source payload, held BY REFERENCE ONLY and never mutated. In-memory
   * only — never written, uploaded, or persisted. Retained so target selection can
   * re-run the existing mapping/preview helpers. Null when no source is loaded.
   */
  sourcePayload: unknown;
  /**
   * The readiness-report options used at load time, held by reference. Reused by
   * selection so per-target overrides and the district registry stay consistent.
   */
  loadOptions: UteScrapedJsonReadinessReportOptions | null;
};

export type UteScrapedJsonImportSessionSelectOptions = {
  /** A per-selection canonical context override for this one target. */
  override?: UteCanonicalMappingOverride;
  /** A per-selection district registry; falls back to the load-time registry. */
  districtRegistry?: Record<string, string>;
  /**
   * When provided and it does not equal the session's fingerprint, the selection
   * fails deterministically with a `source-fingerprint-mismatch` issue and the
   * session is returned unchanged.
   */
  expectedSourceFingerprint?: string;
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function issue(
  code: UteScrapedJsonImportSessionIssueCode,
  severity: UteScrapedJsonImportSessionIssueSeverity,
  message: string
): UteScrapedJsonImportSessionIssue {
  return { code, severity, message };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A present (non-blank) string, otherwise null. Never trims the returned value. */
function presentString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

/** Reads `metadata.source_url` from a payload without mutating it. */
function sourceUrlFromPayload(payload: unknown): string | null {
  if (!isPlainObject(payload)) return null;
  const metadata = payload.metadata;
  if (!isPlainObject(metadata)) return null;
  return presentString(metadata.source_url);
}

/** A deterministic 32-bit FNV-1a hash rendered as 8 lowercase hex chars. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts, kept unsigned.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Builds a deterministic, non-cryptographic fingerprint from stable source metadata
 * and target/row counts. Never uses Date.now(), randomness, or object identity, so
 * the same source payload always yields the same fingerprint.
 */
function computeSourceFingerprint(
  summary: UteScrapedJsonSummary,
  payload: unknown
): string {
  const basis = [
    ['rt', summary.recordType],
    ['y', summary.year],
    ['e', summary.event],
    ['ad', summary.ageDivision],
    ['ada', summary.ageDivisionAlias],
    ['url', sourceUrlFromPayload(payload)],
    ['t', String(summary.totalTeams)],
    ['r', String(summary.totalRows)],
  ]
    .map(([k, v]) => `${k}=${v ?? ''}`)
    .join('|');
  return `ute-scraped-session-${fnv1aHex(basis)}`;
}

const READINESS_STATUS_TO_SESSION_STATUS: Record<
  UteScrapedJsonReadinessStatus,
  UteScrapedJsonImportSessionStatus
> = {
  ready: 'ready-for-preview',
  'ready-with-warnings': 'ready-for-preview',
  'needs-review': 'ready-for-review',
  blocked: 'target-blocked',
  empty: 'target-selected',
};

/** Selectable targets in source order: ready, ready-with-warnings, or needs-review. */
function selectableTargetsFromReport(
  report: UteScrapedJsonReadinessReport
): UteScrapedJsonReadinessTarget[] {
  const selectableIds = new Set<string>([
    ...getUteScrapedJsonImportReadyTargets(report).map((t) => t.sourceTargetId),
    ...getUteScrapedJsonTargetsNeedingReview(report).map((t) => t.sourceTargetId),
  ]);
  // Filter the report's targets directly so source order is preserved.
  return report.targets.filter((t) => selectableIds.has(t.sourceTargetId));
}

/** Re-tags slice 12 readiness-target issues as session issues. */
function readinessTargetIssuesToSessionIssues(
  target: UteScrapedJsonReadinessTarget
): UteScrapedJsonImportSessionIssue[] {
  return target.issues.map((i) =>
    issue(
      i.code as UteScrapedJsonImportSessionIssueCode,
      i.severity,
      i.message
    )
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function summarizeSession(
  session: Omit<UteScrapedJsonImportSession, 'summary'>
): UteScrapedJsonImportSessionSummary {
  const report = session.readinessReport;
  const selected = session.selectedTarget;

  const totalTargets = report ? report.targets.length : 0;
  const selectableTargets = report ? selectableTargetsFromReport(report).length : 0;
  const blockedTargets = report ? getUteScrapedJsonBlockedTargets(report).length : 0;
  const emptyTargets = report ? getUteScrapedJsonEmptyTargets(report).length : 0;

  const sourceUsable = report !== null && report.ok;
  const selectedStatus = selected ? selected.readinessStatus : null;

  const selectedIsUsable =
    selectedStatus === 'ready' ||
    selectedStatus === 'ready-with-warnings' ||
    selectedStatus === 'needs-review';
  const selectedHasPreview =
    (session.selectedPlayerPreviewResult?.ok ?? false) ||
    (session.selectedCoachPreviewResult?.ok ?? false);
  const canProceedToPreview = selectedIsUsable && selectedHasPreview;
  const canProceedWithoutReview =
    (selectedStatus === 'ready' || selectedStatus === 'ready-with-warnings') &&
    selectedHasPreview;

  return {
    status: session.status,
    recordType: session.recordType,
    totalTargets,
    selectableTargets,
    blockedTargets,
    emptyTargets,
    selectedSourceTargetId: session.selectedSourceTargetId,
    selectedStatus,
    selectedRowCount: selected ? selected.rowCount : 0,
    selectedIssueCount: selected ? selected.issues.length : 0,
    canSelectTarget: sourceUsable && selectableTargets > 0,
    canProceedToPreview,
    canProceedWithoutReview,
  };
}

/** Public re-derivation of a session summary; pure and never mutates the session. */
export function summarizeUteScrapedJsonImportSession(
  session: UteScrapedJsonImportSession
): UteScrapedJsonImportSessionSummary {
  return summarizeSession(session);
}

// ---------------------------------------------------------------------------
// Session construction
// ---------------------------------------------------------------------------

/** An empty, uninitialized session with no source loaded. */
export function createEmptyUteScrapedJsonImportSession(): UteScrapedJsonImportSession {
  const base: Omit<UteScrapedJsonImportSession, 'summary'> = {
    status: 'uninitialized',
    sourceFingerprint: '',
    recordType: 'unknown',
    sourceSummary: null,
    readinessReport: null,
    selectedSourceTargetId: null,
    selectedTarget: null,
    selectedCanonicalContextMapping: null,
    selectedPlayerPreviewInput: null,
    selectedPlayerPreviewResult: null,
    selectedCoachPreviewResult: null,
    issues: [],
    sourcePayload: null,
    loadOptions: null,
  };
  return { ...base, summary: summarizeSession(base) };
}

/**
 * Loads one scraped JSON payload into a fresh session. Builds the slice 12 readiness
 * report immediately and computes a deterministic source fingerprint. No target is
 * selected by default. An unsupported / invalid source yields an `invalid-source`
 * session. Pure and deterministic; the payload is never mutated.
 */
export function createUteScrapedJsonImportSessionFromPayload(
  payload: unknown,
  options?: UteScrapedJsonReadinessReportOptions
): UteScrapedJsonImportSession {
  const loadOptions = options ?? null;

  let report: UteScrapedJsonReadinessReport;
  try {
    report = createUteConferenceScrapedJsonReadinessReport(payload, options);
  } catch {
    const failedBase: Omit<UteScrapedJsonImportSession, 'summary'> = {
      status: 'invalid-source',
      sourceFingerprint: '',
      recordType: 'unknown',
      sourceSummary: null,
      readinessReport: null,
      selectedSourceTargetId: null,
      selectedTarget: null,
      selectedCanonicalContextMapping: null,
      selectedPlayerPreviewInput: null,
      selectedPlayerPreviewResult: null,
      selectedCoachPreviewResult: null,
      issues: [
        issue(
          'readiness-report-failed',
          'error',
          'The readiness report could not be built for this source.'
        ),
      ],
      sourcePayload: payload,
      loadOptions,
    };
    return { ...failedBase, summary: summarizeSession(failedBase) };
  }

  const recordType = report.recordType;
  const sourceFingerprint = computeSourceFingerprint(report.sourceSummary, payload);

  const issues: UteScrapedJsonImportSessionIssue[] = [];
  let status: UteScrapedJsonImportSessionStatus;
  if (recordType === 'unknown' || !report.ok) {
    status = 'invalid-source';
    const hasUnsupported = report.sourceSummary.issues.some(
      (i) => i.code === 'unsupported-record-type'
    );
    if (hasUnsupported) {
      issues.push(
        issue(
          'unsupported-record-type',
          'error',
          'The source record_type is not players or coaches.'
        )
      );
    }
    issues.push(
      issue('invalid-source', 'error', 'The scraped JSON source is not importable.')
    );
  } else {
    status = 'source-loaded';
  }

  const base: Omit<UteScrapedJsonImportSession, 'summary'> = {
    status,
    sourceFingerprint,
    recordType,
    sourceSummary: report.sourceSummary,
    readinessReport: report,
    selectedSourceTargetId: null,
    selectedTarget: null,
    selectedCanonicalContextMapping: null,
    selectedPlayerPreviewInput: null,
    selectedPlayerPreviewResult: null,
    selectedCoachPreviewResult: null,
    issues,
    sourcePayload: payload,
    loadOptions,
  };
  return { ...base, summary: summarizeSession(base) };
}

// ---------------------------------------------------------------------------
// Selection / clearing
// ---------------------------------------------------------------------------

/** A loaded-but-unselected snapshot derived from a session (preserves source/report). */
function clearedBase(
  session: UteScrapedJsonImportSession
): Omit<UteScrapedJsonImportSession, 'summary'> {
  const report = session.readinessReport;
  const sourceUsable = report !== null && report.ok;
  return {
    status: sourceUsable
      ? 'source-loaded'
      : report
        ? 'invalid-source'
        : 'uninitialized',
    sourceFingerprint: session.sourceFingerprint,
    recordType: session.recordType,
    sourceSummary: session.sourceSummary,
    readinessReport: report,
    selectedSourceTargetId: null,
    selectedTarget: null,
    selectedCanonicalContextMapping: null,
    selectedPlayerPreviewInput: null,
    selectedPlayerPreviewResult: null,
    selectedCoachPreviewResult: null,
    issues: [],
    sourcePayload: session.sourcePayload,
    loadOptions: session.loadOptions,
  };
}

/**
 * Selects one team target by its source target id. Re-runs the existing mapping and
 * preview helpers (optionally with a per-selection override) and stores the selected
 * target, its canonical context mapping, and its preview output. Selecting a blocked
 * or empty target is allowed but does not produce a usable preview. A missing target
 * id, an unloaded/invalid source, or a fingerprint mismatch fails deterministically.
 * Returns a NEW session; the input session and payload are never mutated.
 */
export function selectUteScrapedJsonImportSessionTarget(
  session: UteScrapedJsonImportSession,
  sourceTargetId: string,
  options?: UteScrapedJsonImportSessionSelectOptions
): UteScrapedJsonImportSession {
  // Fingerprint guard: a mismatch fails without changing the current selection.
  if (
    options?.expectedSourceFingerprint !== undefined &&
    options.expectedSourceFingerprint !== session.sourceFingerprint
  ) {
    const { summary: _summary, ...rest } = session;
    const mismatchBase: Omit<UteScrapedJsonImportSession, 'summary'> = {
      ...rest,
      issues: [
        issue(
          'source-fingerprint-mismatch',
          'error',
          'The expected source fingerprint does not match this session.'
        ),
      ],
    };
    return { ...mismatchBase, summary: summarizeSession(mismatchBase) };
  }

  const report = session.readinessReport;
  const payload = session.sourcePayload;

  // No usable source: cannot select.
  if (!report || !report.ok) {
    const base = clearedBase(session);
    base.issues = [
      issue('invalid-source', 'error', 'No importable source is loaded to select from.'),
    ];
    return { ...base, summary: summarizeSession(base) };
  }

  // Resolve per-selection overrides, falling back to the load-time options.
  const loadOptions = session.loadOptions ?? {};
  const overridesById = {
    ...(loadOptions.targetContextOverridesBySourceTargetId ?? {}),
  };
  if (options?.override) overridesById[sourceTargetId] = options.override;
  const districtRegistry =
    options?.districtRegistry ?? loadOptions.districtRegistry;

  // A per-selection override changes mapping/status, so re-run the report; otherwise
  // reuse the already-built load-time report. Either path delegates to slice 12.
  const usesSelectionOverride =
    options?.override !== undefined || options?.districtRegistry !== undefined;
  const effectiveReport = usesSelectionOverride
    ? createUteConferenceScrapedJsonReadinessReport(payload, {
        ...loadOptions,
        targetContextOverridesBySourceTargetId: overridesById,
        districtRegistry,
      })
    : report;

  const readinessTarget = effectiveReport.targets.find(
    (t) => t.sourceTargetId === sourceTargetId
  );
  if (!readinessTarget) {
    const base = clearedBase(session);
    base.issues = [
      issue(
        'target-not-found',
        'error',
        `No team target with source target id "${sourceTargetId}" exists in this source.`
      ),
    ];
    return { ...base, summary: summarizeSession(base) };
  }

  const mapOptions = {
    override: overridesById[sourceTargetId],
    districtRegistry,
  };

  let selectedPlayerPreviewInput: UteScrapedJsonImportSession['selectedPlayerPreviewInput'] =
    null;
  let selectedPlayerPreviewResult: RosterImportPreviewResult | null = null;
  let selectedCoachPreviewResult: UteCoachImportPreviewResult | null = null;

  const isEmpty = readinessTarget.readinessStatus === 'empty';
  if (!isEmpty) {
    if (effectiveReport.recordType === 'players') {
      const player =
        createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
          payload,
          sourceTargetId,
          mapOptions
        );
      selectedPlayerPreviewInput = player.previewInput;
      selectedPlayerPreviewResult = player.previewResult;
    } else {
      selectedCoachPreviewResult = createCoachImportPreviewInputFromScrapedJson(
        payload,
        sourceTargetId
      );
    }
  }

  // Selection-derived issues, on top of the readiness target's own issues.
  const selectionIssues: UteScrapedJsonImportSessionIssue[] = [
    ...readinessTargetIssuesToSessionIssues(readinessTarget),
  ];
  switch (readinessTarget.readinessStatus) {
    case 'blocked':
      selectionIssues.push(
        issue('target-blocked', 'error', 'The selected target is blocked from import.')
      );
      break;
    case 'empty':
      selectionIssues.push(
        issue('target-empty', 'info', 'The selected target has no rows.')
      );
      break;
    case 'needs-review':
      selectionIssues.push(
        issue(
          'target-needs-review',
          'warning',
          'The selected target needs review before import.'
        )
      );
      break;
    default:
      break;
  }
  const usablePreview =
    (selectedPlayerPreviewResult?.ok ?? false) ||
    (selectedCoachPreviewResult?.ok ?? false);
  const expectsPreview =
    readinessTarget.readinessStatus === 'ready' ||
    readinessTarget.readinessStatus === 'ready-with-warnings' ||
    readinessTarget.readinessStatus === 'needs-review';
  if (expectsPreview && !usablePreview) {
    selectionIssues.push(
      issue(
        'selected-target-missing-preview',
        'error',
        'The selected target did not produce a usable preview.'
      )
    );
  }

  const selectedTarget: UteScrapedJsonImportSessionSelectedTarget = {
    sourceTargetId: readinessTarget.sourceTargetId,
    recordType: readinessTarget.recordType,
    readinessStatus: readinessTarget.readinessStatus,
    rowCount: readinessTarget.rowCount,
    readinessTarget,
    issues: selectionIssues,
  };

  const base: Omit<UteScrapedJsonImportSession, 'summary'> = {
    status: READINESS_STATUS_TO_SESSION_STATUS[readinessTarget.readinessStatus],
    sourceFingerprint: session.sourceFingerprint,
    recordType: session.recordType,
    sourceSummary: session.sourceSummary,
    readinessReport: report,
    selectedSourceTargetId: readinessTarget.sourceTargetId,
    selectedTarget,
    selectedCanonicalContextMapping: readinessTarget.canonicalContextMapping,
    selectedPlayerPreviewInput,
    selectedPlayerPreviewResult,
    selectedCoachPreviewResult,
    issues: [],
    sourcePayload: payload,
    loadOptions: session.loadOptions,
  };
  return { ...base, summary: summarizeSession(base) };
}

/**
 * Clears the selected target, preserving the loaded source, readiness report, and
 * fingerprint. Returns a NEW session; the input is never mutated.
 */
export function clearUteScrapedJsonImportSessionTarget(
  session: UteScrapedJsonImportSession
): UteScrapedJsonImportSession {
  const base = clearedBase(session);
  return { ...base, summary: summarizeSession(base) };
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/** The currently selected target, or null when nothing is selected. */
export function getSelectedUteScrapedJsonImportSessionTarget(
  session: UteScrapedJsonImportSession
): UteScrapedJsonImportSessionSelectedTarget | null {
  return session.selectedTarget;
}

/**
 * Targets a caller can select toward preview/review (ready, ready-with-warnings, or
 * needs-review), in source order. Empty when no usable source is loaded.
 */
export function getUteScrapedJsonImportSessionSelectableTargets(
  session: UteScrapedJsonImportSession
): UteScrapedJsonReadinessTarget[] {
  const report = session.readinessReport;
  if (!report || !report.ok) return [];
  return selectableTargetsFromReport(report);
}
