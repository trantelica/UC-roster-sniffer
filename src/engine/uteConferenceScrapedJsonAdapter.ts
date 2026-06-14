import { createRosterImportPreview } from './rosterImportPreview';
import type {
  RosterImportPreviewInput,
  RosterImportPreviewRowInput,
  RosterImportPreviewResult,
  RosterImportPreviewTargetContext,
} from './rosterImportPreview';

/**
 * Phase 5 slice 10: Ute Conference scraped JSON SOURCE ADAPTER — ENGINE ONLY.
 *
 * The product owner harvested Ute Conference website-scrape JSON files. This module
 * reads that source shape and exposes importable team targets and source rows: for a
 * selected team it converts player data into the existing slice 1
 * `RosterImportPreviewInput`, and coach data into a separate coach import preview
 * shape. It answers: "can the system inspect harvested Ute Conference JSON and
 * convert selected team data into internal import-ready preview inputs without
 * mutating roster data?"
 *
 * This is a SOURCE ADAPTER only. It is NOT UI, NOT persistence, NOT browser storage,
 * NOT file upload, NOT roster mutation, NOT an actual import commit/apply, NOT coach
 * analytics, and NOT movement derivation. It composes with (and never replaces) the
 * existing slice 1 preview contract; it does not change the slice 9 parser.
 *
 * Roster authority rule (carried forward, see `docs/derived-logic.md`
 * "## Roster authority"): loaded roster records are authoritative. The adapter never
 * alters, removes, suppresses, merges, nullifies, rewrites, reorders, or ignores any
 * source row. Player names, coach names, coach titles, and source URLs are preserved
 * EXACTLY as harvested (no trimming of in-name commas or non-breaking spaces, no
 * de-duplication). Source order (district -> team -> row) is preserved. Empty league
 * snapshots are valid empty source data, not corrupt data.
 *
 * Provisional ids: when a caller does not supply explicit target-context ids, the
 * adapter derives PROVISIONAL ids with a deterministic slug helper
 * (`<seasonId>-<districtSlug>-<ageSlug>-<teamSlug>` etc.). These are clearly marked
 * provisional and are NOT canonical roster ids; a caller may override any field.
 *
 * Purity: the input payload is never mutated; output is identical across repeated
 * calls. Names/titles are referenced (and copied by value) but never normalized.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_ADAPTER_LOGIC_VERSION =
  'phase5-slice10-ute-scraped-json-adapter-v1';

export type UteScrapedRecordType = 'players' | 'coaches' | 'unknown';

export type UteScrapedAdapterIssueSeverity = 'info' | 'warning' | 'error';

export type UteScrapedAdapterIssueCode =
  | 'invalid-payload'
  | 'missing-metadata'
  | 'unsupported-record-type'
  | 'missing-districts'
  | 'missing-team-name'
  | 'missing-player-name'
  | 'missing-coach-name'
  | 'missing-coach-title'
  | 'count-mismatch'
  | 'empty-league'
  | 'invalid-target'
  | 'target-not-found';

export type UteScrapedAdapterIssue = {
  code: UteScrapedAdapterIssueCode;
  severity: UteScrapedAdapterIssueSeverity;
  message: string;
};

export type UteScrapedTeamTarget = {
  sourceTargetId: string;
  recordType: UteScrapedRecordType;
  year: string | null;
  event: string | null;
  seasonLabel: string | null;
  ageDivisionLabel: string | null;
  ageDivisionAlias: string | null;
  league: string | null;
  districtName: string | null;
  districtIndex: number;
  teamName: string | null;
  teamIndex: number;
  teamSourceUrl: string | null;
  sourceUrl: string | null;
  rowCount: number;
  playersCount: number | null;
  coachesCount: number | null;
};

export type UteScrapedJsonSummary = {
  recordType: UteScrapedRecordType;
  organization: string | null;
  event: string | null;
  year: string | null;
  ageDivision: string | null;
  ageDivisionAlias: string | null;
  totalDistricts: number;
  districtsWithLeague: number;
  districtsWithoutLeague: number;
  totalTeams: number;
  totalRows: number;
  teamsWithRows: number;
  emptyTeams: number;
  ok: boolean;
  issues: UteScrapedAdapterIssue[];
};

/** A selector identifying which team to adapt, plus optional target-context overrides. */
export type UteScrapedTeamTargetSelector =
  | string
  | {
      sourceTargetId?: string;
      districtIndex?: number;
      teamIndex?: number;
      targetContext?: {
        seasonId?: string;
        districtId?: string;
        ageDivisionId?: string;
        teamId?: string;
      };
    };

export type UtePlayerImportPreviewInputResult = {
  ok: boolean;
  recordType: UteScrapedRecordType;
  target: UteScrapedTeamTarget | null;
  targetContext: RosterImportPreviewTargetContext;
  /** Provisional when ids were derived (no caller override). */
  targetContextProvisional: boolean;
  /** A slice 1 preview input; `rows` is always present (possibly empty). */
  previewInput: RosterImportPreviewInput & { rows: RosterImportPreviewRowInput[] };
  /** Composition convenience: the slice 1 preview of `previewInput`. */
  previewResult: RosterImportPreviewResult | null;
  issues: UteScrapedAdapterIssue[];
};

export type UteCoachImportPreviewRow = {
  sourceRowId: string;
  rowIndex: number;
  /** Preserved EXACTLY as harvested (no trim, keeps non-breaking spaces). */
  rawName: string | null;
  /** Preserved EXACTLY as harvested. */
  rawTitle: string | null;
  districtName: string | null;
  league: string | null;
  teamName: string | null;
  year: string | null;
  teamSourceUrl: string | null;
  sourceUrl: string | null;
  issues: UteScrapedAdapterIssue[];
};

export type UteCoachImportPreviewSummary = {
  totalRows: number;
  withName: number;
  missingName: number;
  withTitle: number;
  missingTitle: number;
};

export type UteCoachImportPreviewResult = {
  ok: boolean;
  recordType: UteScrapedRecordType;
  target: UteScrapedTeamTarget | null;
  targetContext: RosterImportPreviewTargetContext;
  targetContextProvisional: boolean;
  rows: UteCoachImportPreviewRow[];
  summary: UteCoachImportPreviewSummary;
  issues: UteScrapedAdapterIssue[];
};

// ---------------------------------------------------------------------------
// Small pure helpers (no mutation, deterministic)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A present (non-blank) string, otherwise null. Never trims the returned value. */
function presentString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

/** A deterministic lowercase slug for PROVISIONAL ids only (never applied to names). */
function slug(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A slug for an id token, falling back to 'unknown' so ids never collapse to ''. */
function idToken(value: unknown): string {
  const s = slug(value);
  return s === '' ? 'unknown' : s;
}

function issue(
  code: UteScrapedAdapterIssueCode,
  severity: UteScrapedAdapterIssueSeverity,
  message: string
): UteScrapedAdapterIssue {
  return { code, severity, message };
}

function yearString(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const raw = metadata.year;
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  return presentString(raw);
}

function readMetadata(payload: unknown): Record<string, unknown> | null {
  if (!isPlainObject(payload)) return null;
  return isPlainObject(payload.metadata) ? payload.metadata : null;
}

function readDistricts(payload: unknown): unknown[] | null {
  if (!isPlainObject(payload)) return null;
  return Array.isArray(payload.districts) ? payload.districts : null;
}

function recordTypeFromMetadata(
  metadata: Record<string, unknown> | null
): UteScrapedRecordType {
  if (!metadata) return 'unknown';
  if (metadata.record_type === 'players') return 'players';
  if (metadata.record_type === 'coaches') return 'coaches';
  return 'unknown';
}

/** The team's row array for the given record type ('players' / 'coaches'). */
function teamRows(
  team: Record<string, unknown>,
  recordType: UteScrapedRecordType
): unknown[] {
  const key = recordType === 'coaches' ? 'coaches' : 'players';
  return Array.isArray(team[key]) ? (team[key] as unknown[]) : [];
}

function declaredRowCount(
  team: Record<string, unknown>,
  recordType: UteScrapedRecordType
): number | null {
  const key = recordType === 'coaches' ? 'coaches_count' : 'players_count';
  const value = team[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/** Detects the record type from `metadata.record_type`; `unknown` if absent/invalid. */
export function detectUteConferenceScrapedJsonRecordType(
  payload: unknown
): UteScrapedRecordType {
  return recordTypeFromMetadata(readMetadata(payload));
}

// ---------------------------------------------------------------------------
// Team target listing
// ---------------------------------------------------------------------------

/**
 * Lists importable team targets in source order (district index, then team index).
 * Empty districts and empty teams are preserved (a team with zero rows still yields a
 * target). Returns an empty list for an invalid payload / missing districts.
 */
export function listUteConferenceScrapedJsonTeamTargets(
  payload: unknown
): UteScrapedTeamTarget[] {
  const metadata = readMetadata(payload);
  const districts = readDistricts(payload);
  if (!metadata || !districts) return [];

  const recordType = recordTypeFromMetadata(metadata);
  const year = yearString(metadata);
  const yearTok = idToken(metadata.year);
  const event = presentString(metadata.event);
  const ageDivisionLabel = presentString(metadata.age_division);
  const ageDivisionAlias = presentString(metadata.age_division_alias);
  const ageTok = idToken(metadata.age_division);
  const sourceUrl = presentString(metadata.source_url);

  const targets: UteScrapedTeamTarget[] = [];

  districts.forEach((districtRaw, districtIndex) => {
    if (!isPlainObject(districtRaw)) return;
    const districtName = presentString(districtRaw.district);
    const league = presentString(districtRaw.league);
    const teams = Array.isArray(districtRaw.teams) ? districtRaw.teams : [];

    teams.forEach((teamRaw, teamIndex) => {
      if (!isPlainObject(teamRaw)) return;
      const teamName = presentString(teamRaw.team_name);
      const rows = teamRows(teamRaw, recordType);
      const declared = declaredRowCount(teamRaw, recordType);

      targets.push({
        sourceTargetId: `scraped:${yearTok}:${ageTok}:${districtIndex}:${teamIndex}`,
        recordType,
        year,
        event,
        seasonLabel: event,
        ageDivisionLabel,
        ageDivisionAlias,
        league,
        districtName,
        districtIndex,
        teamName,
        teamIndex,
        teamSourceUrl: presentString(teamRaw.source_url),
        sourceUrl,
        rowCount: rows.length,
        playersCount: recordType === 'players' ? declared : null,
        coachesCount: recordType === 'coaches' ? declared : null,
      });
    });
  });

  return targets;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/**
 * Summarizes a scraped JSON payload: record type, metadata, district/team/row counts,
 * and issues. Pure and deterministic; never mutates the payload. An empty-but-valid
 * snapshot (zero rows) is reported as `ok: true` with an informational `empty-league`
 * issue, not as corrupt data.
 */
export function summarizeUteConferenceScrapedJson(
  payload: unknown
): UteScrapedJsonSummary {
  const issues: UteScrapedAdapterIssue[] = [];
  const metadata = readMetadata(payload);
  const districts = readDistricts(payload);

  const base: UteScrapedJsonSummary = {
    recordType: 'unknown',
    organization: null,
    event: null,
    year: null,
    ageDivision: null,
    ageDivisionAlias: null,
    totalDistricts: 0,
    districtsWithLeague: 0,
    districtsWithoutLeague: 0,
    totalTeams: 0,
    totalRows: 0,
    teamsWithRows: 0,
    emptyTeams: 0,
    ok: false,
    issues,
  };

  if (!isPlainObject(payload)) {
    issues.push(issue('invalid-payload', 'error', 'Payload is not a JSON object.'));
    return base;
  }
  if (!metadata) {
    issues.push(issue('missing-metadata', 'error', 'Payload has no metadata object.'));
    return base;
  }

  const recordType = recordTypeFromMetadata(metadata);
  base.recordType = recordType;
  base.organization = presentString(metadata.organization);
  base.event = presentString(metadata.event);
  base.year = yearString(metadata);
  base.ageDivision = presentString(metadata.age_division);
  base.ageDivisionAlias = presentString(metadata.age_division_alias);

  if (recordType === 'unknown') {
    issues.push(
      issue(
        'unsupported-record-type',
        'error',
        `Unsupported record_type: ${String(metadata.record_type)}.`
      )
    );
  }
  if (!districts) {
    issues.push(
      issue('missing-districts', 'error', 'Payload has no districts array.')
    );
    return base;
  }

  let totalTeams = 0;
  let totalRows = 0;
  let teamsWithRows = 0;
  let emptyTeams = 0;
  let districtsWithLeague = 0;

  districts.forEach((districtRaw) => {
    if (!isPlainObject(districtRaw)) return;
    if (presentString(districtRaw.league) !== null) districtsWithLeague += 1;
    const teams = Array.isArray(districtRaw.teams) ? districtRaw.teams : [];
    const declaredTeams =
      typeof districtRaw.teams_count === 'number' ? districtRaw.teams_count : null;
    if (declaredTeams !== null && declaredTeams !== teams.length) {
      issues.push(
        issue(
          'count-mismatch',
          'warning',
          `District "${String(districtRaw.district)}" declares teams_count ${declaredTeams} but has ${teams.length} teams.`
        )
      );
    }
    teams.forEach((teamRaw) => {
      if (!isPlainObject(teamRaw)) return;
      totalTeams += 1;
      const rows =
        recordType === 'unknown' ? [] : teamRows(teamRaw, recordType);
      const declared = declaredRowCount(teamRaw, recordType);
      if (declared !== null && declared !== rows.length) {
        issues.push(
          issue(
            'count-mismatch',
            'warning',
            `Team "${String(teamRaw.team_name)}" declares ${declared} rows but has ${rows.length}.`
          )
        );
      }
      totalRows += rows.length;
      if (rows.length > 0) teamsWithRows += 1;
      else emptyTeams += 1;
    });
  });

  base.totalDistricts = districts.length;
  base.districtsWithLeague = districtsWithLeague;
  base.districtsWithoutLeague = districts.length - districtsWithLeague;
  base.totalTeams = totalTeams;
  base.totalRows = totalRows;
  base.teamsWithRows = teamsWithRows;
  base.emptyTeams = emptyTeams;

  // Declared-vs-actual metadata cross-checks (non-destructive warnings).
  crossCheckCount(issues, metadata.total_districts, districts.length, 'total_districts');
  crossCheckCount(issues, metadata.total_teams, totalTeams, 'total_teams');
  crossCheckCount(
    issues,
    recordType === 'coaches' ? metadata.total_coaches : metadata.total_players,
    totalRows,
    recordType === 'coaches' ? 'total_coaches' : 'total_players'
  );

  if (totalRows === 0 && recordType !== 'unknown') {
    issues.push(
      issue(
        'empty-league',
        'info',
        'Valid snapshot with no rows (empty league/source data).'
      )
    );
  }

  base.ok = !issues.some((i) => i.severity === 'error');
  return base;
}

function crossCheckCount(
  issues: UteScrapedAdapterIssue[],
  declared: unknown,
  actual: number,
  label: string
): void {
  if (typeof declared === 'number' && Number.isFinite(declared) && declared !== actual) {
    issues.push(
      issue(
        'count-mismatch',
        'warning',
        `metadata.${label} declares ${declared} but actual is ${actual}.`
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

type ResolvedTarget = {
  target: UteScrapedTeamTarget;
  team: Record<string, unknown>;
  metadata: Record<string, unknown>;
  overrides: {
    seasonId?: string;
    districtId?: string;
    ageDivisionId?: string;
    teamId?: string;
  };
};

type ResolveResult =
  | { ok: true; resolved: ResolvedTarget }
  | { ok: false; issue: UteScrapedAdapterIssue };

function resolveTarget(
  payload: unknown,
  selector: UteScrapedTeamTargetSelector
): ResolveResult {
  const metadata = readMetadata(payload);
  const districts = readDistricts(payload);
  if (!metadata || !districts) {
    return {
      ok: false,
      issue: issue(
        'invalid-payload',
        'error',
        'Payload is missing metadata or districts.'
      ),
    };
  }

  const sel =
    typeof selector === 'string' ? { sourceTargetId: selector } : selector ?? {};
  const overrides = (typeof selector === 'object' && selector?.targetContext) || {};

  const wantId = presentString(sel.sourceTargetId);
  const wantDistrict =
    typeof sel.districtIndex === 'number' ? sel.districtIndex : null;
  const wantTeam = typeof sel.teamIndex === 'number' ? sel.teamIndex : null;

  if (wantId === null && (wantDistrict === null || wantTeam === null)) {
    return {
      ok: false,
      issue: issue(
        'invalid-target',
        'error',
        'Target selector must provide a sourceTargetId or both districtIndex and teamIndex.'
      ),
    };
  }

  const targets = listUteConferenceScrapedJsonTeamTargets(payload);
  const match = targets.find((t) =>
    wantId !== null
      ? t.sourceTargetId === wantId
      : t.districtIndex === wantDistrict && t.teamIndex === wantTeam
  );

  if (!match) {
    return {
      ok: false,
      issue: issue('target-not-found', 'error', 'No team matches the target selector.'),
    };
  }

  const districtRaw = districts[match.districtIndex];
  const team =
    isPlainObject(districtRaw) && Array.isArray(districtRaw.teams)
      ? districtRaw.teams[match.teamIndex]
      : undefined;
  if (!isPlainObject(team)) {
    return {
      ok: false,
      issue: issue('target-not-found', 'error', 'Resolved team is not an object.'),
    };
  }

  return { ok: true, resolved: { target: match, team, metadata, overrides } };
}

/** Derives the (possibly provisional) target context for a resolved team. */
function deriveTargetContext(resolved: ResolvedTarget): {
  context: RosterImportPreviewTargetContext;
  provisional: boolean;
} {
  const { target, overrides } = resolved;
  const ageSource = target.ageDivisionAlias ?? target.ageDivisionLabel;

  const seasonId = presentString(overrides.seasonId) ?? target.year;
  const districtId =
    presentString(overrides.districtId) ??
    (target.districtName !== null ? slug(target.districtName) : null);
  const ageDivisionId =
    presentString(overrides.ageDivisionId) ??
    (ageSource !== null ? slug(ageSource) : null);
  const teamId =
    presentString(overrides.teamId) ??
    (target.teamName !== null
      ? `${idToken(target.year)}-${idToken(target.districtName)}-${idToken(
          ageSource
        )}-${idToken(target.teamName)}`
      : null);

  const provisional =
    presentString(overrides.seasonId) === null ||
    presentString(overrides.districtId) === null ||
    presentString(overrides.ageDivisionId) === null ||
    presentString(overrides.teamId) === null;

  return {
    context: { seasonId, districtId, ageDivisionId, teamId },
    provisional,
  };
}

// ---------------------------------------------------------------------------
// Player adapter
// ---------------------------------------------------------------------------

/**
 * Builds a slice 1 `RosterImportPreviewInput` for a selected player team target, and
 * composes it through `createRosterImportPreview`. Player names are preserved EXACTLY
 * (commas and extra spaces intact); a missing name is preserved as a row with a
 * `missing-player-name` issue. Returns an error result (ok false, empty input) when
 * the payload is not a players file or the target cannot be resolved.
 */
export function createPlayerRosterImportPreviewInputFromScrapedJson(
  payload: unknown,
  target: UteScrapedTeamTargetSelector
): UtePlayerImportPreviewInputResult {
  const recordType = detectUteConferenceScrapedJsonRecordType(payload);
  const emptyContext: RosterImportPreviewTargetContext = {
    seasonId: null,
    districtId: null,
    ageDivisionId: null,
    teamId: null,
  };
  const fail = (
    iss: UteScrapedAdapterIssue
  ): UtePlayerImportPreviewInputResult => ({
    ok: false,
    recordType,
    target: null,
    targetContext: emptyContext,
    targetContextProvisional: false,
    previewInput: { rows: [] },
    previewResult: null,
    issues: [iss],
  });

  if (recordType !== 'players') {
    return fail(
      issue(
        'unsupported-record-type',
        'error',
        `Player adapter requires a players file; got record_type "${recordType}".`
      )
    );
  }

  const resolution = resolveTarget(payload, target);
  if (!resolution.ok) return fail(resolution.issue);

  const { resolved } = resolution;
  const { context, provisional } = deriveTargetContext(resolved);
  const issues: UteScrapedAdapterIssue[] = [];

  if (resolved.target.teamName === null) {
    issues.push(
      issue('missing-team-name', 'warning', 'Selected team has no team_name.')
    );
  }

  const players = teamRows(resolved.team, 'players');
  const declared = declaredRowCount(resolved.team, 'players');
  if (declared !== null && declared !== players.length) {
    issues.push(
      issue(
        'count-mismatch',
        'warning',
        `Team declares players_count ${declared} but has ${players.length}.`
      )
    );
  }

  const yearTok = idToken(resolved.metadata.year);
  const ageTok = idToken(resolved.metadata.age_division);
  const { districtIndex, teamIndex } = resolved.target;

  const rows: RosterImportPreviewRowInput[] = players.map((playerRaw, playerIndex) => {
    const name = isPlainObject(playerRaw) ? playerRaw.name : undefined;
    const present = presentString(name);
    const sourceRowId = `scraped:${yearTok}:${ageTok}:${districtIndex}:${teamIndex}:player:${playerIndex}`;
    if (present === null) {
      issues.push(
        issue(
          'missing-player-name',
          'warning',
          `Player row ${playerIndex} has no name; preserved for preview validation.`
        )
      );
    }
    const row: RosterImportPreviewRowInput = {
      sourceRowId,
      raw: {
        sourceRowId,
        name: typeof name === 'string' ? name : null,
        districtName: resolved.target.districtName,
        league: resolved.target.league,
        teamName: resolved.target.teamName,
        teamSourceUrl: resolved.target.teamSourceUrl,
        sourceUrl: resolved.target.sourceUrl,
        year: resolved.target.year,
        recordType: 'players',
      },
    };
    // Preserve the player name EXACTLY when present; omit when blank so the preview
    // flags it. `presentString` returns the original (untrimmed) value, so commas and
    // extra spaces survive intact.
    if (present !== null) row.playerName = present;
    return row;
  });

  const previewInput: RosterImportPreviewInput & {
    rows: RosterImportPreviewRowInput[];
  } = {
    seasonId: context.seasonId ?? undefined,
    districtId: context.districtId ?? undefined,
    ageDivisionId: context.ageDivisionId ?? undefined,
    teamId: context.teamId ?? undefined,
    rows,
  };

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    recordType,
    target: resolved.target,
    targetContext: context,
    targetContextProvisional: provisional,
    previewInput,
    previewResult: createRosterImportPreview(previewInput),
    issues,
  };
}

// ---------------------------------------------------------------------------
// Coach adapter
// ---------------------------------------------------------------------------

/**
 * Builds coach import preview rows for a selected coach team target. Coach names and
 * titles are preserved EXACTLY (including non-breaking spaces); a missing name/title
 * is preserved as a row with a `missing-coach-name` / `missing-coach-title` issue.
 * Coaches are NEVER de-duplicated (repeat name/title rows are all preserved). This is
 * a SEPARATE shape from the player roster import preview — it is not wired into it,
 * and it produces no analytics and no persistence.
 */
export function createCoachImportPreviewInputFromScrapedJson(
  payload: unknown,
  target: UteScrapedTeamTargetSelector
): UteCoachImportPreviewResult {
  const recordType = detectUteConferenceScrapedJsonRecordType(payload);
  const emptyContext: RosterImportPreviewTargetContext = {
    seasonId: null,
    districtId: null,
    ageDivisionId: null,
    teamId: null,
  };
  const fail = (iss: UteScrapedAdapterIssue): UteCoachImportPreviewResult => ({
    ok: false,
    recordType,
    target: null,
    targetContext: emptyContext,
    targetContextProvisional: false,
    rows: [],
    summary: {
      totalRows: 0,
      withName: 0,
      missingName: 0,
      withTitle: 0,
      missingTitle: 0,
    },
    issues: [iss],
  });

  if (recordType !== 'coaches') {
    return fail(
      issue(
        'unsupported-record-type',
        'error',
        `Coach adapter requires a coaches file; got record_type "${recordType}".`
      )
    );
  }

  const resolution = resolveTarget(payload, target);
  if (!resolution.ok) return fail(resolution.issue);

  const { resolved } = resolution;
  const { context, provisional } = deriveTargetContext(resolved);
  const issues: UteScrapedAdapterIssue[] = [];

  if (resolved.target.teamName === null) {
    issues.push(
      issue('missing-team-name', 'warning', 'Selected team has no team_name.')
    );
  }

  const coaches = teamRows(resolved.team, 'coaches');
  const declared = declaredRowCount(resolved.team, 'coaches');
  if (declared !== null && declared !== coaches.length) {
    issues.push(
      issue(
        'count-mismatch',
        'warning',
        `Team declares coaches_count ${declared} but has ${coaches.length}.`
      )
    );
  }

  const yearTok = idToken(resolved.metadata.year);
  const ageTok = idToken(resolved.metadata.age_division);
  const { districtIndex, teamIndex } = resolved.target;

  let withName = 0;
  let missingName = 0;
  let withTitle = 0;
  let missingTitle = 0;

  const rows: UteCoachImportPreviewRow[] = coaches.map((coachRaw, coachIndex) => {
    const nameValue = isPlainObject(coachRaw) ? coachRaw.name : undefined;
    const titleValue = isPlainObject(coachRaw) ? coachRaw.title : undefined;
    const rowIssues: UteScrapedAdapterIssue[] = [];
    const sourceRowId = `scraped:${yearTok}:${ageTok}:${districtIndex}:${teamIndex}:coach:${coachIndex}`;

    // Preserve EXACTLY: keep the original string (untrimmed) so non-breaking spaces
    // survive. Presence is judged by a trimmed check but the stored value is raw.
    const rawName = typeof nameValue === 'string' ? nameValue : null;
    const rawTitle = typeof titleValue === 'string' ? titleValue : null;

    if (presentString(nameValue) === null) {
      missingName += 1;
      rowIssues.push(
        issue('missing-coach-name', 'warning', `Coach row ${coachIndex} has no name.`)
      );
    } else {
      withName += 1;
    }
    if (presentString(titleValue) === null) {
      missingTitle += 1;
      rowIssues.push(
        issue('missing-coach-title', 'warning', `Coach row ${coachIndex} has no title.`)
      );
    } else {
      withTitle += 1;
    }

    return {
      sourceRowId,
      rowIndex: coachIndex,
      rawName,
      rawTitle,
      districtName: resolved.target.districtName,
      league: resolved.target.league,
      teamName: resolved.target.teamName,
      year: resolved.target.year,
      teamSourceUrl: resolved.target.teamSourceUrl,
      sourceUrl: resolved.target.sourceUrl,
      issues: rowIssues,
    };
  });

  for (const row of rows) issues.push(...row.issues);

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    recordType,
    target: resolved.target,
    targetContext: context,
    targetContextProvisional: provisional,
    rows,
    summary: {
      totalRows: rows.length,
      withName,
      missingName,
      withTitle,
      missingTitle,
    },
    issues,
  };
}
