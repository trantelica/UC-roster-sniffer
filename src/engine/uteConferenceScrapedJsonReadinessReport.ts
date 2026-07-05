import {
  detectUteConferenceScrapedJsonRecordType,
  summarizeUteConferenceScrapedJson,
  listUteConferenceScrapedJsonTeamTargets,
  createCoachImportPreviewInputFromScrapedJson,
} from './uteConferenceScrapedJsonAdapter';
import type {
  UteScrapedRecordType,
  UteScrapedTeamTarget,
  UteScrapedJsonSummary,
  UteCoachImportPreviewResult,
  UteCoachImportPreviewSummary,
} from './uteConferenceScrapedJsonAdapter';
import {
  mapUteScrapedTeamTargetToCanonicalContext,
  createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext,
} from './uteConferenceScrapedCanonicalMapping';
import type {
  UteCanonicalMappingOverride,
  UteCanonicalTeamContextMappingResult,
} from './uteConferenceScrapedCanonicalMapping';
import type { RosterImportPreviewSummary } from './rosterImportPreview';

/**
 * Phase 5 slice 12: full-file READINESS REPORT for harvested Ute Conference scraped
 * JSON — ENGINE ONLY.
 *
 * Given one scraped players-or-coaches JSON payload, this report classifies every
 * team target as `ready`, `ready-with-warnings`, `needs-review`, `blocked`, or
 * `empty`, so a caller can see — at a glance, for the whole file — what is
 * import-ready and what needs attention. It answers: "given one scraped players or
 * coaches JSON payload, what teams/rows are import-ready, empty, blocked, provisional,
 * or need review?"
 *
 * It is a REPORTING / ORCHESTRATION helper that COMPOSES the slice 10 source adapter
 * (`detectUteConferenceScrapedJsonRecordType`, `summarizeUteConferenceScrapedJson`,
 * `listUteConferenceScrapedJsonTeamTargets`,
 * `createCoachImportPreviewInputFromScrapedJson`) and the slice 11 canonical mapping
 * (`mapUteScrapedTeamTargetToCanonicalContext`,
 * `createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext`). It
 * REPLACES and DUPLICATES none of that logic.
 *
 * It is NOT UI, NOT persistence, NOT browser storage, NOT file upload, NOT roster
 * mutation, NOT an actual import commit/apply, NOT movement derivation, NOT coach
 * analytics, and NOT fuzzy matching. The payload is never mutated; rows, names,
 * titles, source URLs, and source order are preserved exactly; empty league/team
 * snapshots are valid source states; and no mapping is invented (color team names stay
 * review-needed, districts stay provisional until a registry is wired). Output is
 * identical across repeated calls.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_READINESS_REPORT_LOGIC_VERSION =
  'phase5-slice12-scraped-json-readiness-report-v1';

export type UteScrapedJsonReadinessStatus =
  | 'ready'
  | 'ready-with-warnings'
  | 'needs-review'
  | 'blocked'
  | 'empty';

export type UteScrapedJsonReadinessReason =
  | 'valid-player-preview'
  | 'valid-coach-preview'
  | 'empty-team'
  | 'empty-league'
  | 'provisional-district'
  | 'unresolved-parenthetical-district'
  | 'provisional-age-division'
  | 'unknown-team-classification'
  | 'color-team-classification-unknown'
  | 'missing-player-name'
  | 'missing-coach-name'
  | 'missing-coach-title'
  | 'invalid-target-context'
  | 'target-not-found'
  | 'count-mismatch'
  | 'unsupported-record-type'
  | 'invalid-payload';

export type UteScrapedJsonReadinessIssueSeverity = 'info' | 'warning' | 'error';

export type UteScrapedJsonReadinessIssueOrigin =
  | 'source'
  | 'mapping'
  | 'preview'
  | 'coach';

/** A unified, origin-tagged issue (codes come from the adapter or mapping enums). */
export type UteScrapedJsonReadinessIssue = {
  code: string;
  severity: UteScrapedJsonReadinessIssueSeverity;
  message: string;
  origin: UteScrapedJsonReadinessIssueOrigin;
};

export type UteScrapedJsonReadinessTarget = {
  sourceTargetId: string;
  recordType: UteScrapedRecordType;
  year: string | null;
  event: string | null;
  seasonLabel: string | null;
  ageDivisionLabel: string | null;
  ageDivisionAlias: string | null;
  canonicalAgeDivisionId: string | null;
  districtName: string | null;
  canonicalDistrictId: string | null;
  teamName: string | null;
  teamClassification: string | null;
  classificationHierarchyCode: string | null;
  teamSourceUrl: string | null;
  rowCount: number;
  readinessStatus: UteScrapedJsonReadinessStatus;
  readinessReasons: UteScrapedJsonReadinessReason[];
  issues: UteScrapedJsonReadinessIssue[];
  canonicalContextMapping: UteCanonicalTeamContextMappingResult;
  contextConfidence: UteCanonicalTeamContextMappingResult['contextConfidence'];
  targetContextProvisional: boolean;
  previewSummary: RosterImportPreviewSummary | null;
  coachPreviewSummary: UteCoachImportPreviewSummary | null;
};

export type UteScrapedJsonReadinessSummary = {
  recordType: UteScrapedRecordType;
  totalTargets: number;
  readyTargets: number;
  readyWithWarningsTargets: number;
  needsReviewTargets: number;
  blockedTargets: number;
  emptyTargets: number;
  totalRows: number;
  playerRows: number;
  coachRows: number;
  issueCountsBySeverity: { info: number; warning: number; error: number };
  issueCountsByCode: Record<string, number>;
  canProceedToTeamSelection: boolean;
  canProceedWithoutReview: boolean;
};

export type UteScrapedJsonReadinessReport = {
  ok: boolean;
  recordType: UteScrapedRecordType;
  sourceSummary: UteScrapedJsonSummary;
  /** Source-level issues (from the slice 10 file summary). */
  issues: UteScrapedJsonReadinessIssue[];
  targets: UteScrapedJsonReadinessTarget[];
  summary: UteScrapedJsonReadinessSummary;
};

export type UteScrapedJsonReadinessReportOptions = {
  targetContextOverridesBySourceTargetId?: Record<
    string,
    UteCanonicalMappingOverride
  >;
  districtRegistry?: Record<string, string>;
  /** Default true: include empty teams as `empty` targets. */
  includeEmptyTeams?: boolean;
  /** Default true: attach per-target preview summaries. */
  includePreviewResults?: boolean;
  /** Default false: when true, a count mismatch elevates a target to needs-review. */
  strictCounts?: boolean;
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function tagIssues(
  issues: ReadonlyArray<{ code: string; severity: string; message: string }>,
  origin: UteScrapedJsonReadinessIssueOrigin
): UteScrapedJsonReadinessIssue[] {
  return issues.map((i) => ({
    code: i.code,
    severity: i.severity as UteScrapedJsonReadinessIssueSeverity,
    message: i.message,
    origin,
  }));
}

function dedupeReasons(
  reasons: UteScrapedJsonReadinessReason[]
): UteScrapedJsonReadinessReason[] {
  const seen = new Set<UteScrapedJsonReadinessReason>();
  const out: UteScrapedJsonReadinessReason[] = [];
  for (const r of reasons) {
    if (!seen.has(r)) {
      seen.add(r);
      out.push(r);
    }
  }
  return out;
}

/** Warning-level readiness reasons derived from the post-override mapping result. */
function warningReasonsFromMapping(
  mapping: UteCanonicalTeamContextMappingResult
): UteScrapedJsonReadinessReason[] {
  const reasons: UteScrapedJsonReadinessReason[] = [];
  if (
    mapping.district.source !== 'caller-override' &&
    mapping.district.confidence === 'provisional'
  ) {
    reasons.push('provisional-district');
  }
  if (
    mapping.ageDivision.source !== 'caller-override' &&
    mapping.ageDivision.confidence !== 'high'
  ) {
    reasons.push('provisional-age-division');
  }
  if (
    mapping.teamClassification.source !== 'caller-override' &&
    mapping.teamClassification.canonicalValue === null
  ) {
    const isColor = mapping.teamClassification.issues.some(
      (i) => i.code === 'color-team-classification-unknown'
    );
    reasons.push(
      isColor ? 'color-team-classification-unknown' : 'unknown-team-classification'
    );
  }
  return reasons;
}

/** Blocking readiness reasons from a mapping that failed to resolve a target. */
function mappingErrorReasons(
  mapping: UteCanonicalTeamContextMappingResult
): UteScrapedJsonReadinessReason[] {
  const reasons: UteScrapedJsonReadinessReason[] = [];
  if (mapping.issues.some((i) => i.code === 'target-not-found')) {
    reasons.push('target-not-found');
  }
  if (mapping.issues.some((i) => i.code === 'invalid-target')) {
    reasons.push('invalid-target-context');
  }
  if (mapping.issues.some((i) => i.code === 'unresolved-parenthetical-district')) {
    reasons.push('unresolved-parenthetical-district');
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Per-target classification
// ---------------------------------------------------------------------------

type Classification = {
  status: UteScrapedJsonReadinessStatus;
  reasons: UteScrapedJsonReadinessReason[];
};

function classifyPlayerTarget(
  mapping: UteCanonicalTeamContextMappingResult,
  player: ReturnType<
    typeof createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext
  >,
  strictCounts: boolean
): Classification {
  const preview = player.previewResult;
  if (mapping.issues.some((i) => i.severity === 'error') || preview === null) {
    const reasons = mappingErrorReasons(mapping);
    return {
      status: 'blocked',
      reasons: dedupeReasons(reasons.length ? reasons : ['target-not-found']),
    };
  }

  const adapterIssues = player.playerAdapterResult.issues;
  const hasCountMismatch = adapterIssues.some((i) => i.code === 'count-mismatch');

  if (!preview.ok) {
    const reasons: UteScrapedJsonReadinessReason[] = [];
    if (preview.summary.invalidRows > 0) reasons.push('missing-player-name');
    if (!preview.targetValid) reasons.push('invalid-target-context');
    return {
      status: 'blocked',
      reasons: dedupeReasons(reasons.length ? reasons : ['invalid-target-context']),
    };
  }

  const warn = warningReasonsFromMapping(mapping);
  const reasons: UteScrapedJsonReadinessReason[] = ['valid-player-preview', ...warn];
  if (hasCountMismatch) reasons.push('count-mismatch');

  const reviewByRows = preview.summary.needsReviewRows > 0;
  const reviewByStrictCount = strictCounts && hasCountMismatch;
  if (reviewByRows || reviewByStrictCount) {
    return { status: 'needs-review', reasons: dedupeReasons(reasons) };
  }
  if (warn.length > 0 || hasCountMismatch) {
    return { status: 'ready-with-warnings', reasons: dedupeReasons(reasons) };
  }
  return { status: 'ready', reasons: dedupeReasons(reasons) };
}

function classifyCoachTarget(
  mapping: UteCanonicalTeamContextMappingResult,
  coach: UteCoachImportPreviewResult,
  strictCounts: boolean
): Classification {
  if (mapping.issues.some((i) => i.severity === 'error') || !coach.ok) {
    const reasons = mappingErrorReasons(mapping);
    if (coach.issues.some((i) => i.code === 'target-not-found')) {
      reasons.push('target-not-found');
    }
    return {
      status: 'blocked',
      reasons: dedupeReasons(reasons.length ? reasons : ['target-not-found']),
    };
  }

  const warn = warningReasonsFromMapping(mapping);
  const hasCountMismatch = coach.issues.some((i) => i.code === 'count-mismatch');
  const reasons: UteScrapedJsonReadinessReason[] = ['valid-coach-preview', ...warn];
  if (hasCountMismatch) reasons.push('count-mismatch');
  if (coach.summary.missingName > 0) reasons.push('missing-coach-name');
  if (coach.summary.missingTitle > 0) reasons.push('missing-coach-title');

  const needsReview =
    coach.summary.missingName > 0 ||
    coach.summary.missingTitle > 0 ||
    (strictCounts && hasCountMismatch);
  if (needsReview) return { status: 'needs-review', reasons: dedupeReasons(reasons) };
  if (warn.length > 0 || hasCountMismatch) {
    return { status: 'ready-with-warnings', reasons: dedupeReasons(reasons) };
  }
  return { status: 'ready', reasons: dedupeReasons(reasons) };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/**
 * Builds a full-file readiness report for one scraped Ute Conference JSON payload.
 * Pure and deterministic; composes the slice 10/11 helpers, preserves source order,
 * and never mutates the payload.
 */
export function createUteConferenceScrapedJsonReadinessReport(
  payload: unknown,
  options?: UteScrapedJsonReadinessReportOptions
): UteScrapedJsonReadinessReport {
  const includeEmptyTeams = options?.includeEmptyTeams !== false;
  const includePreviewResults = options?.includePreviewResults !== false;
  const strictCounts = options?.strictCounts === true;
  const overrides = options?.targetContextOverridesBySourceTargetId ?? {};
  const districtRegistry = options?.districtRegistry;

  const recordType = detectUteConferenceScrapedJsonRecordType(payload);
  const sourceSummary = summarizeUteConferenceScrapedJson(payload);
  const sourceIssues = tagIssues(sourceSummary.issues, 'source');

  const targets: UteScrapedJsonReadinessTarget[] = [];

  if (recordType !== 'unknown') {
    const sourceTargets = listUteConferenceScrapedJsonTeamTargets(payload);
    for (const target of sourceTargets) {
      if (target.rowCount === 0 && !includeEmptyTeams) continue;

      const sel = target.sourceTargetId;
      const override = overrides[sel];
      const mapOptions = { override, districtRegistry };

      // Empty team: short-circuit before any preview (still map for context fields).
      if (target.rowCount === 0) {
        const mapping = mapUteScrapedTeamTargetToCanonicalContext(
          payload,
          sel,
          mapOptions
        );
        targets.push(
          buildTarget(target, mapping, 'empty', ['empty-team'], [
            ...tagIssues(mapping.issues, 'mapping'),
          ], null, null)
        );
        continue;
      }

      if (recordType === 'players') {
        const player =
          createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
            payload,
            sel,
            mapOptions
          );
        const mapping = player.canonicalContextMapping;
        const { status, reasons } = classifyPlayerTarget(
          mapping,
          player,
          strictCounts
        );
        const issues = [
          ...tagIssues(mapping.issues, 'mapping'),
          ...tagIssues(player.playerAdapterResult.issues, 'preview'),
        ];
        const previewSummary =
          includePreviewResults && player.previewResult
            ? player.previewResult.summary
            : null;
        targets.push(
          buildTarget(target, mapping, status, reasons, issues, previewSummary, null)
        );
      } else {
        const mapping = mapUteScrapedTeamTargetToCanonicalContext(
          payload,
          sel,
          mapOptions
        );
        const coach = createCoachImportPreviewInputFromScrapedJson(payload, sel);
        const { status, reasons } = classifyCoachTarget(mapping, coach, strictCounts);
        const issues = [
          ...tagIssues(mapping.issues, 'mapping'),
          ...tagIssues(coach.issues, 'coach'),
        ];
        const coachPreviewSummary = includePreviewResults ? coach.summary : null;
        targets.push(
          buildTarget(target, mapping, status, reasons, issues, null, coachPreviewSummary)
        );
      }
    }
  }

  const ok = sourceSummary.ok && recordType !== 'unknown';

  const report: UteScrapedJsonReadinessReport = {
    ok,
    recordType,
    sourceSummary,
    issues: sourceIssues,
    targets,
    summary: emptySummary(recordType),
  };
  report.summary = summarizeUteConferenceScrapedJsonReadinessReport(report);
  return report;
}

function buildTarget(
  target: UteScrapedTeamTarget,
  mapping: UteCanonicalTeamContextMappingResult,
  status: UteScrapedJsonReadinessStatus,
  reasons: UteScrapedJsonReadinessReason[],
  issues: UteScrapedJsonReadinessIssue[],
  previewSummary: RosterImportPreviewSummary | null,
  coachPreviewSummary: UteCoachImportPreviewSummary | null
): UteScrapedJsonReadinessTarget {
  return {
    sourceTargetId: target.sourceTargetId,
    recordType: target.recordType,
    year: target.year,
    event: target.event,
    seasonLabel: target.seasonLabel,
    ageDivisionLabel: target.ageDivisionLabel,
    ageDivisionAlias: target.ageDivisionAlias,
    canonicalAgeDivisionId: mapping.canonicalContext.ageDivisionId,
    districtName: target.districtName,
    canonicalDistrictId: mapping.canonicalContext.districtId,
    teamName: target.teamName,
    teamClassification: mapping.canonicalContext.teamClassification,
    classificationHierarchyCode: mapping.teamClassification.hierarchyCode,
    teamSourceUrl: target.teamSourceUrl,
    rowCount: target.rowCount,
    readinessStatus: status,
    readinessReasons: dedupeReasons(reasons),
    issues,
    canonicalContextMapping: mapping,
    contextConfidence: mapping.contextConfidence,
    targetContextProvisional: mapping.contextConfidence !== 'high',
    previewSummary,
    coachPreviewSummary,
  };
}

function emptySummary(
  recordType: UteScrapedRecordType
): UteScrapedJsonReadinessSummary {
  return {
    recordType,
    totalTargets: 0,
    readyTargets: 0,
    readyWithWarningsTargets: 0,
    needsReviewTargets: 0,
    blockedTargets: 0,
    emptyTargets: 0,
    totalRows: 0,
    playerRows: 0,
    coachRows: 0,
    issueCountsBySeverity: { info: 0, warning: 0, error: 0 },
    issueCountsByCode: {},
    canProceedToTeamSelection: false,
    canProceedWithoutReview: false,
  };
}

/**
 * Derives the readiness summary from a report. Pure: reads target statuses, row
 * counts, and issue tallies; never mutates anything.
 */
export function summarizeUteConferenceScrapedJsonReadinessReport(
  report: UteScrapedJsonReadinessReport
): UteScrapedJsonReadinessSummary {
  const summary = emptySummary(report.recordType);
  summary.totalTargets = report.targets.length;

  for (const target of report.targets) {
    switch (target.readinessStatus) {
      case 'ready':
        summary.readyTargets += 1;
        break;
      case 'ready-with-warnings':
        summary.readyWithWarningsTargets += 1;
        break;
      case 'needs-review':
        summary.needsReviewTargets += 1;
        break;
      case 'blocked':
        summary.blockedTargets += 1;
        break;
      case 'empty':
        summary.emptyTargets += 1;
        break;
    }
    summary.totalRows += target.rowCount;
    for (const i of target.issues) {
      summary.issueCountsBySeverity[i.severity] += 1;
      summary.issueCountsByCode[i.code] =
        (summary.issueCountsByCode[i.code] ?? 0) + 1;
    }
  }

  for (const i of report.issues) {
    summary.issueCountsBySeverity[i.severity] += 1;
    summary.issueCountsByCode[i.code] =
      (summary.issueCountsByCode[i.code] ?? 0) + 1;
  }

  summary.playerRows = report.recordType === 'players' ? summary.totalRows : 0;
  summary.coachRows = report.recordType === 'coaches' ? summary.totalRows : 0;

  const usableTargets =
    summary.readyTargets +
    summary.readyWithWarningsTargets +
    summary.needsReviewTargets;
  summary.canProceedToTeamSelection = report.ok && usableTargets > 0;
  summary.canProceedWithoutReview =
    report.ok &&
    summary.readyTargets > 0 &&
    summary.needsReviewTargets === 0 &&
    summary.blockedTargets === 0;

  return summary;
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

/** Import-ready targets: `ready` and `ready-with-warnings`. */
export function getUteScrapedJsonImportReadyTargets(
  report: UteScrapedJsonReadinessReport
): UteScrapedJsonReadinessTarget[] {
  return report.targets.filter(
    (t) =>
      t.readinessStatus === 'ready' || t.readinessStatus === 'ready-with-warnings'
  );
}

/** Targets that need human review before import. */
export function getUteScrapedJsonTargetsNeedingReview(
  report: UteScrapedJsonReadinessReport
): UteScrapedJsonReadinessTarget[] {
  return report.targets.filter((t) => t.readinessStatus === 'needs-review');
}

/** Targets blocked from import (unresolved target / invalid rows / context). */
export function getUteScrapedJsonBlockedTargets(
  report: UteScrapedJsonReadinessReport
): UteScrapedJsonReadinessTarget[] {
  return report.targets.filter((t) => t.readinessStatus === 'blocked');
}

/** Empty teams (zero rows) — a valid source state, not corruption. */
export function getUteScrapedJsonEmptyTargets(
  report: UteScrapedJsonReadinessReport
): UteScrapedJsonReadinessTarget[] {
  return report.targets.filter((t) => t.readinessStatus === 'empty');
}
