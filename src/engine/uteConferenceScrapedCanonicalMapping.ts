import type { AgeDivisionId } from './ageDivision';
import { parseTeamClassification } from './teamClassification';
import type { TeamClassificationCode } from './teamClassification';
import {
  listUteConferenceScrapedJsonTeamTargets,
  createPlayerRosterImportPreviewInputFromScrapedJson,
} from './uteConferenceScrapedJsonAdapter';
import type {
  UteScrapedTeamTarget,
  UteScrapedTeamTargetSelector,
  UtePlayerImportPreviewInputResult,
} from './uteConferenceScrapedJsonAdapter';

/**
 * Phase 5 slice 11: canonical SOURCE MAPPING for Ute Conference scraped JSON —
 * ENGINE ONLY.
 *
 * Slice 10 read harvested Ute Conference scrape JSON and exposed team targets + raw
 * source rows. This slice maps the scraped SOURCE LABELS (age-division label/alias,
 * district name, team name, year/event) into canonical internal import context
 * values: a canonical age division (SC/GR/PW/MM/GI/BA), an extracted team
 * classification code, a district id, and a season id — so a caller can produce a
 * preview input with canonical (or clearly provisional) target context.
 *
 * This is a MAPPING ADAPTER only. It is NOT UI, NOT persistence, NOT browser storage,
 * NOT file upload, NOT roster mutation, NOT an actual import commit/apply, NOT
 * movement derivation, NOT coach analytics, and NOT fuzzy identity matching. It
 * composes with (and never replaces) the slice 10 adapter, the slice 1 preview
 * contract, and the existing age-division / team-classification helpers.
 *
 * Roster authority rule (carried forward): loaded roster records are authoritative.
 * This module preserves raw source values EXACTLY (district names, team names, player
 * names) and never rewrites scraped source data. Mappings are deterministic; there is
 * NO broad fuzzy matching and NO invented color-to-classification mapping. Where a
 * value cannot be mapped safely it is reported `unknown` / review-needed, never
 * guessed.
 *
 * Confidence: `high` (a direct, explicit source mapping), `provisional` (an inferred
 * or slug-derived value, e.g. a team-name age-division prefix or a district slug with
 * no canonical registry), or `unknown` (no safe mapping). Caller overrides are
 * recorded as `caller-override` and never overwrite the preserved raw source.
 *
 * Purity: the input payload, target, and options are never mutated; output is
 * identical across repeated calls.
 */

export const UTE_CONFERENCE_SCRAPED_CANONICAL_MAPPING_LOGIC_VERSION =
  'phase5-slice11-ute-scraped-canonical-mapping-v1';

export type UteCanonicalMappingConfidence = 'high' | 'provisional' | 'unknown';

export type UteCanonicalMappingSource =
  | 'metadata-age-division'
  | 'metadata-age-division-alias'
  | 'district-name'
  | 'team-name'
  | 'metadata-year'
  | 'caller-override';

export type UteCanonicalMappingIssueSeverity = 'info' | 'warning' | 'error';

export type UteCanonicalMappingIssueCode =
  | 'missing-age-division'
  | 'unsupported-age-division'
  | 'conflicting-age-division-labels'
  | 'missing-team-name'
  | 'unsupported-team-classification'
  | 'color-team-classification-unknown'
  | 'missing-district'
  | 'district-mapping-provisional'
  | 'missing-season-year'
  | 'invalid-season-year'
  | 'target-not-found'
  | 'invalid-target'
  | 'caller-override-used';

export type UteCanonicalMappingIssue = {
  code: UteCanonicalMappingIssueCode;
  severity: UteCanonicalMappingIssueSeverity;
  message: string;
};

export type UteCanonicalAgeDivisionMappingResult = {
  rawValue: string | null;
  canonicalValue: AgeDivisionId | null;
  confidence: UteCanonicalMappingConfidence;
  source: UteCanonicalMappingSource | null;
  issues: UteCanonicalMappingIssue[];
};

export type UteCanonicalTeamClassificationMappingResult = {
  rawValue: string | null;
  /** The literal coded classification (e.g. "A2", "B4", "C1", "D2"), or null. */
  canonicalValue: string | null;
  /** The hierarchy tier code from `parseTeamClassification` (e.g. "A", "B3_PLUS"). */
  hierarchyCode: TeamClassificationCode | null;
  confidence: UteCanonicalMappingConfidence;
  source: UteCanonicalMappingSource | null;
  issues: UteCanonicalMappingIssue[];
};

export type UteCanonicalDistrictMappingResult = {
  rawValue: string | null;
  canonicalValue: string | null;
  confidence: UteCanonicalMappingConfidence;
  source: UteCanonicalMappingSource | null;
  issues: UteCanonicalMappingIssue[];
};

export type UteCanonicalSeasonMappingResult = {
  rawValue: string | null;
  canonicalValue: string | null;
  seasonLabel: string | null;
  confidence: UteCanonicalMappingConfidence;
  source: UteCanonicalMappingSource | null;
  issues: UteCanonicalMappingIssue[];
};

export type UteCanonicalContext = {
  seasonId: string | null;
  districtId: string | null;
  ageDivisionId: string | null;
  teamId: string | null;
  teamClassification: string | null;
};

export type UteCanonicalMappingOverride = {
  seasonId?: string;
  districtId?: string;
  ageDivisionId?: string;
  teamId?: string;
  teamClassification?: string;
};

export type UteCanonicalMappingOptions = {
  override?: UteCanonicalMappingOverride;
  /** Optional exact-name district registry; absent -> provisional slug ids. */
  districtRegistry?: Record<string, string>;
};

export type UteCanonicalTeamContextMappingResult = {
  ok: boolean;
  target: UteScrapedTeamTarget | null;
  season: UteCanonicalSeasonMappingResult;
  ageDivision: UteCanonicalAgeDivisionMappingResult;
  district: UteCanonicalDistrictMappingResult;
  teamClassification: UteCanonicalTeamClassificationMappingResult;
  canonicalContext: UteCanonicalContext;
  contextConfidence: UteCanonicalMappingConfidence;
  issues: UteCanonicalMappingIssue[];
};

export type UtePlayerCanonicalPreviewInputResult = {
  ok: boolean;
  canonicalContextMapping: UteCanonicalTeamContextMappingResult;
  previewInput: UtePlayerImportPreviewInputResult['previewInput'];
  previewResult: UtePlayerImportPreviewInputResult['previewResult'];
  playerAdapterResult: UtePlayerImportPreviewInputResult;
  issues: UteCanonicalMappingIssue[];
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function presentString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

function slug(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function idToken(value: unknown): string {
  const s = slug(value);
  return s === '' ? 'unknown' : s;
}

function issue(
  code: UteCanonicalMappingIssueCode,
  severity: UteCanonicalMappingIssueSeverity,
  message: string
): UteCanonicalMappingIssue {
  return { code, severity, message };
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Weakest of a set of confidences (unknown < provisional < high). */
function weakestConfidence(
  ...values: UteCanonicalMappingConfidence[]
): UteCanonicalMappingConfidence {
  if (values.includes('unknown')) return 'unknown';
  if (values.includes('provisional')) return 'provisional';
  return 'high';
}

// ---------------------------------------------------------------------------
// Age division mapping
// ---------------------------------------------------------------------------

const AGE_NAME_TABLE: Record<string, AgeDivisionId> = {
  scout: 'SC',
  scouts: 'SC',
  gremlin: 'GR',
  gremlins: 'GR',
  peewee: 'PW',
  peewees: 'PW',
  'pee wee': 'PW',
  'pee wees': 'PW',
  mitymite: 'MM',
  mitymites: 'MM',
  'mity mite': 'MM',
  'mity mites': 'MM',
  'mighty mite': 'MM',
  'mighty mites': 'MM',
  gridiron: 'GI',
  'grid iron': 'GI',
  bantam: 'BA',
  bantams: 'BA',
};

const AGE_PREFIX_TABLE: ReadonlyArray<readonly [string, AgeDivisionId]> = [
  ['scout', 'SC'],
  ['gremlin', 'GR'],
  ['peewee', 'PW'],
  ['pee wee', 'PW'],
  ['mitymite', 'MM'],
  ['mity mite', 'MM'],
  ['mighty mite', 'MM'],
  ['gridiron', 'GI'],
  ['grid iron', 'GI'],
  ['bantam', 'BA'],
];

/** Maps an explicit age-division label/alias to a canonical id, or null. */
function canonicalAgeFromText(raw: string): AgeDivisionId | null {
  const n = normalizeText(raw);
  if (n === '') return null;
  // Explicit code prefix: "SC", "SC League 7-8", "GR League 9", etc. The word
  // boundary keeps "scouts"/"gremlin" out of this branch (they fall to the table).
  const codeMatch = n.match(/^(sc|gr|pw|mm|gi|ba)\b/);
  if (codeMatch) return codeMatch[1].toUpperCase() as AgeDivisionId;
  if (n in AGE_NAME_TABLE) return AGE_NAME_TABLE[n];
  return null;
}

/** Maps a team name's leading age-cohort word to a canonical id, or null. */
function canonicalAgeFromTeamPrefix(teamName: string): AgeDivisionId | null {
  const n = normalizeText(teamName);
  for (const [prefix, code] of AGE_PREFIX_TABLE) {
    if (n === prefix || n.startsWith(`${prefix} `)) return code;
  }
  return null;
}

/**
 * Maps scraped age-division source values to a canonical age division. Precedence:
 * metadata label, then alias, then a team-name prefix fallback (used only when the
 * label/alias are missing or unmapped). Conflicting label vs alias mappings are
 * reported and resolved to the label with `provisional` confidence.
 */
export function mapUteScrapedAgeDivisionLabel(input: {
  label?: string;
  alias?: string;
  teamName?: string;
}): UteCanonicalAgeDivisionMappingResult {
  const rawLabel = presentString(input.label);
  const rawAlias = presentString(input.alias);
  const rawTeam = presentString(input.teamName);
  const fromLabel = rawLabel ? canonicalAgeFromText(rawLabel) : null;
  const fromAlias = rawAlias ? canonicalAgeFromText(rawAlias) : null;
  const issues: UteCanonicalMappingIssue[] = [];

  if (fromLabel !== null && fromAlias !== null && fromLabel !== fromAlias) {
    issues.push(
      issue(
        'conflicting-age-division-labels',
        'warning',
        `Age-division label "${rawLabel}" (${fromLabel}) conflicts with alias "${rawAlias}" (${fromAlias}); using the label.`
      )
    );
    return {
      rawValue: rawLabel,
      canonicalValue: fromLabel,
      confidence: 'provisional',
      source: 'metadata-age-division',
      issues,
    };
  }

  if (fromLabel !== null) {
    return {
      rawValue: rawLabel,
      canonicalValue: fromLabel,
      confidence: 'high',
      source: 'metadata-age-division',
      issues,
    };
  }
  if (fromAlias !== null) {
    return {
      rawValue: rawAlias,
      canonicalValue: fromAlias,
      confidence: 'high',
      source: 'metadata-age-division-alias',
      issues,
    };
  }

  const fromTeam = rawTeam ? canonicalAgeFromTeamPrefix(rawTeam) : null;
  if (fromTeam !== null) {
    return {
      rawValue: rawTeam,
      canonicalValue: fromTeam,
      confidence: 'provisional',
      source: 'team-name',
      issues,
    };
  }

  if (rawLabel !== null || rawAlias !== null) {
    issues.push(
      issue(
        'unsupported-age-division',
        'warning',
        `Unsupported age-division label: "${rawLabel ?? rawAlias}".`
      )
    );
    return {
      rawValue: rawLabel ?? rawAlias,
      canonicalValue: null,
      confidence: 'unknown',
      source: null,
      issues,
    };
  }

  issues.push(
    issue('missing-age-division', 'warning', 'No age-division label, alias, or team prefix.')
  );
  return {
    rawValue: null,
    canonicalValue: null,
    confidence: 'unknown',
    source: null,
    issues,
  };
}

// ---------------------------------------------------------------------------
// Team classification mapping
// ---------------------------------------------------------------------------

const KNOWN_TEAM_COLORS: ReadonlySet<string> = new Set([
  'white',
  'black',
  'gray',
  'grey',
  'silver',
]);

/**
 * Extracts a coded team classification (e.g. "A2", "B4", "C1", "D2") from the trailing
 * token of a scraped team name. Only explicit, validated codes are accepted (validated
 * via `parseTeamClassification`); color-based team names (e.g. "Scout White") and
 * other non-coded names are left `unknown` / review-needed — NO color-to-classification
 * mapping is invented.
 */
export function mapUteScrapedTeamClassification(input: {
  teamName?: string;
}): UteCanonicalTeamClassificationMappingResult {
  const rawTeamName = presentString(input.teamName);
  const issues: UteCanonicalMappingIssue[] = [];

  if (rawTeamName === null) {
    issues.push(issue('missing-team-name', 'warning', 'No team name to classify.'));
    return {
      rawValue: null,
      canonicalValue: null,
      hierarchyCode: null,
      confidence: 'unknown',
      source: null,
      issues,
    };
  }

  const tokens = rawTeamName.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];
  const lastUpper = last.toUpperCase();

  if (/^[ABCD]\d{1,2}$/.test(lastUpper)) {
    try {
      const parsed = parseTeamClassification(lastUpper);
      return {
        rawValue: rawTeamName,
        canonicalValue: lastUpper,
        hierarchyCode: parsed.code,
        confidence: 'high',
        source: 'team-name',
        issues,
      };
    } catch {
      issues.push(
        issue(
          'unsupported-team-classification',
          'warning',
          `Team code "${lastUpper}" is not a supported classification.`
        )
      );
      return {
        rawValue: rawTeamName,
        canonicalValue: null,
        hierarchyCode: null,
        confidence: 'unknown',
        source: null,
        issues,
      };
    }
  }

  if (KNOWN_TEAM_COLORS.has(last.toLowerCase())) {
    issues.push(
      issue(
        'color-team-classification-unknown',
        'warning',
        `Color-based team name "${rawTeamName}" has no deterministic classification; review needed.`
      )
    );
    return {
      rawValue: rawTeamName,
      canonicalValue: null,
      hierarchyCode: null,
      confidence: 'unknown',
      source: null,
      issues,
    };
  }

  issues.push(
    issue(
      'unsupported-team-classification',
      'warning',
      `Team name "${rawTeamName}" has no explicit classification code; review needed.`
    )
  );
  return {
    rawValue: rawTeamName,
    canonicalValue: null,
    hierarchyCode: null,
    confidence: 'unknown',
    source: null,
    issues,
  };
}

// ---------------------------------------------------------------------------
// District mapping
// ---------------------------------------------------------------------------

/**
 * Maps a scraped district name to a district id. The raw name is preserved EXACTLY.
 * If a caller supplies a `districtRegistry` with an exact-name entry, that id is used
 * at `high` confidence; otherwise a deterministic slug is derived and marked
 * `provisional`. Districts are never fuzzy-matched or collapsed (e.g. "Bingham" and
 * "Bingham Girls" stay distinct).
 */
export function mapUteScrapedDistrict(input: {
  districtName?: string;
  districtRegistry?: Record<string, string>;
}): UteCanonicalDistrictMappingResult {
  const raw = presentString(input.districtName);
  const issues: UteCanonicalMappingIssue[] = [];

  if (raw === null) {
    issues.push(issue('missing-district', 'warning', 'No district name.'));
    return {
      rawValue: null,
      canonicalValue: null,
      confidence: 'unknown',
      source: null,
      issues,
    };
  }

  const registered =
    input.districtRegistry && typeof input.districtRegistry[raw] === 'string'
      ? input.districtRegistry[raw]
      : null;
  if (registered !== null) {
    return {
      rawValue: raw,
      canonicalValue: registered,
      confidence: 'high',
      source: 'district-name',
      issues,
    };
  }

  issues.push(
    issue(
      'district-mapping-provisional',
      'info',
      `No canonical district registry; derived a provisional slug for "${raw}".`
    )
  );
  return {
    rawValue: raw,
    canonicalValue: slug(raw),
    confidence: 'provisional',
    source: 'district-name',
    issues,
  };
}

// ---------------------------------------------------------------------------
// Season mapping
// ---------------------------------------------------------------------------

/**
 * Maps `metadata.year` to a canonical season id (and `metadata.event` to a season
 * label). A finite integer year or a 4-digit numeric string is accepted at `high`
 * confidence; a missing year reports `missing-season-year` and an unparseable year
 * reports `invalid-season-year`. The year is NEVER inferred from a filename.
 */
export function mapUteScrapedSeason(input: {
  year?: unknown;
  event?: string;
}): UteCanonicalSeasonMappingResult {
  const issues: UteCanonicalMappingIssue[] = [];
  const seasonLabel = presentString(input.event);
  const year = input.year;

  let canonicalValue: string | null = null;
  let rawValue: string | null = null;

  if (year === null || year === undefined || (typeof year === 'string' && year.trim() === '')) {
    issues.push(issue('missing-season-year', 'warning', 'metadata.year is missing.'));
    return {
      rawValue: null,
      canonicalValue: null,
      seasonLabel,
      confidence: 'unknown',
      source: null,
      issues,
    };
  }

  if (typeof year === 'number' && Number.isInteger(year)) {
    rawValue = String(year);
    canonicalValue = String(year);
  } else if (typeof year === 'string' && /^\d{4}$/.test(year.trim())) {
    rawValue = year.trim();
    canonicalValue = year.trim();
  } else {
    rawValue = String(year);
    issues.push(
      issue('invalid-season-year', 'warning', `metadata.year is not a valid year: ${rawValue}.`)
    );
    return {
      rawValue,
      canonicalValue: null,
      seasonLabel,
      confidence: 'unknown',
      source: null,
      issues,
    };
  }

  return {
    rawValue,
    canonicalValue,
    seasonLabel,
    confidence: 'high',
    source: 'metadata-year',
    issues,
  };
}

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

type TargetResolution =
  | { ok: true; target: UteScrapedTeamTarget }
  | { ok: false; issue: UteCanonicalMappingIssue };

function resolveTarget(
  payload: unknown,
  selector: UteScrapedTeamTargetSelector
): TargetResolution {
  const sel = typeof selector === 'string' ? { sourceTargetId: selector } : selector ?? {};
  const wantId = presentString(sel.sourceTargetId);
  const wantDistrict = typeof sel.districtIndex === 'number' ? sel.districtIndex : null;
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
  return { ok: true, target: match };
}

// ---------------------------------------------------------------------------
// Team target -> canonical context
// ---------------------------------------------------------------------------

/**
 * Maps a selected scraped team target to a canonical (or provisional) import context:
 * season, age division, district, and an extracted team classification, composed into
 * a `canonicalContext` (`seasonId` / `districtId` / `ageDivisionId` / `teamId` /
 * `teamClassification`). Caller overrides replace derived values, are recorded as
 * `caller-override`, and never overwrite the preserved raw source. Pure; never mutates
 * the payload.
 */
export function mapUteScrapedTeamTargetToCanonicalContext(
  payload: unknown,
  target: UteScrapedTeamTargetSelector,
  options?: UteCanonicalMappingOptions
): UteCanonicalTeamContextMappingResult {
  const override = options?.override ?? {};
  const emptyMapping = (): UteCanonicalTeamContextMappingResult => {
    const resolution = resolveTarget(payload, target);
    const failIssue = resolution.ok ? null : resolution.issue;
    const nullAge: UteCanonicalAgeDivisionMappingResult = {
      rawValue: null,
      canonicalValue: null,
      confidence: 'unknown',
      source: null,
      issues: [],
    };
    const nullClass: UteCanonicalTeamClassificationMappingResult = {
      rawValue: null,
      canonicalValue: null,
      hierarchyCode: null,
      confidence: 'unknown',
      source: null,
      issues: [],
    };
    const nullDistrict: UteCanonicalDistrictMappingResult = {
      rawValue: null,
      canonicalValue: null,
      confidence: 'unknown',
      source: null,
      issues: [],
    };
    const nullSeason: UteCanonicalSeasonMappingResult = {
      rawValue: null,
      canonicalValue: null,
      seasonLabel: null,
      confidence: 'unknown',
      source: null,
      issues: [],
    };
    return {
      ok: false,
      target: null,
      season: nullSeason,
      ageDivision: nullAge,
      district: nullDistrict,
      teamClassification: nullClass,
      canonicalContext: {
        seasonId: null,
        districtId: null,
        ageDivisionId: null,
        teamId: null,
        teamClassification: null,
      },
      contextConfidence: 'unknown',
      issues: failIssue ? [failIssue] : [],
    };
  };

  const resolution = resolveTarget(payload, target);
  if (!resolution.ok) return emptyMapping();
  const t = resolution.target;

  const season = mapUteScrapedSeason({ year: t.year, event: t.event ?? undefined });
  const ageDivision = mapUteScrapedAgeDivisionLabel({
    label: t.ageDivisionLabel ?? undefined,
    alias: t.ageDivisionAlias ?? undefined,
    teamName: t.teamName ?? undefined,
  });
  const district = mapUteScrapedDistrict({
    districtName: t.districtName ?? undefined,
    districtRegistry: options?.districtRegistry,
  });
  const teamClassification = mapUteScrapedTeamClassification({
    teamName: t.teamName ?? undefined,
  });

  const issues: UteCanonicalMappingIssue[] = [
    ...season.issues,
    ...ageDivision.issues,
    ...district.issues,
    ...teamClassification.issues,
  ];

  // Apply caller overrides (preserve raw source; record as caller-override).
  let seasonId = season.canonicalValue;
  let seasonConfidence = season.confidence;
  if (presentString(override.seasonId) !== null) {
    seasonId = override.seasonId as string;
    seasonConfidence = 'high';
    season.source = 'caller-override';
    issues.push(issue('caller-override-used', 'info', 'seasonId overridden by caller.'));
  }

  let districtId = district.canonicalValue;
  let districtConfidence = district.confidence;
  if (presentString(override.districtId) !== null) {
    districtId = override.districtId as string;
    districtConfidence = 'high';
    district.source = 'caller-override';
    issues.push(issue('caller-override-used', 'info', 'districtId overridden by caller.'));
  }

  let ageDivisionId: string | null = ageDivision.canonicalValue;
  let ageConfidence = ageDivision.confidence;
  if (presentString(override.ageDivisionId) !== null) {
    ageDivisionId = override.ageDivisionId as string;
    ageConfidence = 'high';
    ageDivision.source = 'caller-override';
    issues.push(issue('caller-override-used', 'info', 'ageDivisionId overridden by caller.'));
  }

  let teamClassificationValue = teamClassification.canonicalValue;
  let classificationConfidence = teamClassification.confidence;
  if (presentString(override.teamClassification) !== null) {
    teamClassificationValue = override.teamClassification as string;
    classificationConfidence = 'high';
    teamClassification.source = 'caller-override';
    issues.push(
      issue('caller-override-used', 'info', 'teamClassification overridden by caller.')
    );
  }

  // Derive teamId: prefer an explicit override, then a canonical code, else a slug of
  // the team name (provisional).
  let teamId: string | null;
  let teamIdConfidence: UteCanonicalMappingConfidence;
  if (presentString(override.teamId) !== null) {
    teamId = override.teamId as string;
    teamIdConfidence = 'high';
    issues.push(issue('caller-override-used', 'info', 'teamId overridden by caller.'));
  } else if (
    seasonId !== null &&
    districtId !== null &&
    ageDivisionId !== null &&
    (teamClassificationValue !== null || t.teamName !== null)
  ) {
    const codePart =
      teamClassificationValue !== null
        ? idToken(teamClassificationValue)
        : idToken(t.teamName);
    teamId = `${idToken(seasonId)}-${idToken(districtId)}-${idToken(
      ageDivisionId
    )}-${codePart}`;
    teamIdConfidence = teamClassificationValue !== null ? 'high' : 'provisional';
  } else {
    teamId = null;
    teamIdConfidence = 'unknown';
  }

  const canonicalContext: UteCanonicalContext = {
    seasonId,
    districtId,
    ageDivisionId,
    teamId,
    teamClassification: teamClassificationValue,
  };

  const coreNull =
    seasonId === null || districtId === null || ageDivisionId === null || teamId === null;
  const contextConfidence: UteCanonicalMappingConfidence = coreNull
    ? 'unknown'
    : weakestConfidence(
        seasonConfidence,
        ageConfidence,
        districtConfidence,
        teamIdConfidence
      );
  // Classification-unknown does not by itself void the context, but it never raises it.
  void classificationConfidence;

  const ok = !coreNull && !issues.some((i) => i.severity === 'error');

  return {
    ok,
    target: t,
    season,
    ageDivision,
    district,
    teamClassification,
    canonicalContext,
    contextConfidence,
    issues,
  };
}

/**
 * Coach-target variant of {@link mapUteScrapedTeamTargetToCanonicalContext}. The
 * canonical context derivation is identical for player and coach files (it maps the
 * same team-target labels); this thin wrapper exists for call-site clarity. It builds
 * NO coach analytics and persists nothing.
 */
export function mapCoachScrapedTeamTargetToCanonicalContext(
  payload: unknown,
  target: UteScrapedTeamTargetSelector,
  options?: UteCanonicalMappingOptions
): UteCanonicalTeamContextMappingResult {
  return mapUteScrapedTeamTargetToCanonicalContext(payload, target, options);
}

// ---------------------------------------------------------------------------
// Player preview integration with canonical context
// ---------------------------------------------------------------------------

/**
 * Builds a slice 1 player preview input from a scraped team target, supplying the
 * derived canonical (or provisional) target context to the slice 10 player adapter.
 * Returns the canonical context mapping plus the preview input and preview result.
 * Player names are preserved EXACTLY (the slice 10 adapter is reused unchanged); the
 * payload is never mutated and no roster records are written.
 */
export function createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
  payload: unknown,
  target: UteScrapedTeamTargetSelector,
  options?: UteCanonicalMappingOptions
): UtePlayerCanonicalPreviewInputResult {
  const canonicalContextMapping = mapUteScrapedTeamTargetToCanonicalContext(
    payload,
    target,
    options
  );

  const ctx = canonicalContextMapping.canonicalContext;
  const selector: UteScrapedTeamTargetSelector = canonicalContextMapping.target
    ? {
        sourceTargetId: canonicalContextMapping.target.sourceTargetId,
        targetContext: {
          seasonId: ctx.seasonId ?? undefined,
          districtId: ctx.districtId ?? undefined,
          ageDivisionId: ctx.ageDivisionId ?? undefined,
          teamId: ctx.teamId ?? undefined,
        },
      }
    : target;

  const playerAdapterResult = createPlayerRosterImportPreviewInputFromScrapedJson(
    payload,
    selector
  );

  return {
    ok: canonicalContextMapping.ok && playerAdapterResult.ok,
    canonicalContextMapping,
    previewInput: playerAdapterResult.previewInput,
    previewResult: playerAdapterResult.previewResult,
    playerAdapterResult,
    issues: canonicalContextMapping.issues,
  };
}
