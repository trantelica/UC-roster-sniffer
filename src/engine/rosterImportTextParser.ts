import {
  createRosterImportPreview,
} from './rosterImportPreview';
import type {
  RosterImportPreviewInput,
  RosterImportPreviewRowInput,
  RosterImportPreviewResult,
  RosterImportPreviewTargetContext,
} from './rosterImportPreview';

/**
 * Phase 5 slice 9: CSV / text roster PARSER into the import preview contract —
 * ENGINE ONLY.
 *
 * This module turns pasted roster text (or simple delimited / CSV-like input) into
 * Phase 5 slice 1 import preview INPUT rows, and can then hand those rows to the
 * existing `createRosterImportPreview` helper. It answers one question: "can the
 * system take pasted roster text and produce preserved import preview rows without
 * touching roster data?"
 *
 * This is PARSER-TO-PREVIEW only. It is NOT file upload, NOT the browser File API,
 * NOT UI, NOT persistence, NOT roster mutation, and NOT import apply/commit. It does
 * NOT decide whether a player is new / returning / linked / transferred / promoted /
 * relegated / y-up / z-down — it only stages rows for the existing preview ->
 * match -> review -> plan -> projection pipeline.
 *
 * Roster authority rule (carried forward, see `docs/derived-logic.md`
 * "## Roster authority"): loaded roster records are authoritative. Parsing only
 * produces staging input; it never alters, removes, suppresses, merges, nullifies,
 * rewrites, reorders, or ignores rostered names. Every non-empty source line is
 * preserved as a parsed row in source order, even when it is incomplete or
 * malformed; blank lines may be skipped but are counted and reported.
 *
 * Intentional scope (kept simple and deterministic):
 *   - Supported: comma / tab / pipe delimited rows, newline-separated plain names,
 *     an optional header row, auto delimiter detection, basic trimming, blank-line
 *     handling.
 *   - NOT supported (reported, never guessed): full RFC CSV quoting, escaped
 *     delimiters inside names, multi-line quoted fields, Excel files, browser file
 *     upload, and fuzzy column inference beyond the narrow documented header aliases.
 *
 * Purity: the input object, its `text`, `targetContext`, and `options` are never
 * mutated. `sourceRowId` is derived deterministically from the source line number
 * (`line-<n>`); there is no `Date.now()` and no random id. Output is identical across
 * repeated calls.
 */

export type RosterImportTextParseIssueSeverity = 'info' | 'warning' | 'error';

export type RosterImportTextParseIssueCode =
  | 'empty-input'
  | 'empty-line-skipped'
  | 'header-detected'
  | 'missing-player-name-column'
  | 'missing-player-name'
  | 'inconsistent-column-count'
  | 'unsupported-delimiter'
  | 'invalid-target-context'
  | 'quoted-csv-not-supported'
  | 'duplicate-source-row-id';

export type RosterImportTextParseIssue = {
  code: RosterImportTextParseIssueCode;
  severity: RosterImportTextParseIssueSeverity;
  message: string;
};

export type RosterImportTextDelimiter = ',' | '\t' | '|';

export type RosterImportTextColumnAliases = {
  playerName?: string;
  jerseyNumber?: string;
  grade?: string;
  notes?: string;
};

export type RosterImportTextParseOptions = {
  hasHeader?: boolean | 'auto';
  delimiter?: ',' | '\t' | '|' | 'auto';
  columns?: RosterImportTextColumnAliases;
};

export type RosterImportTextParseInput = {
  text: string;
  targetContext: {
    seasonId?: string;
    districtId?: string;
    ageDivisionId?: string;
    teamId?: string;
  };
  options?: RosterImportTextParseOptions;
};

export type RosterImportTextParseRow = {
  sourceRowId: string;
  sourceLineNumber: number;
  rawLine: string;
  cells: string[];
  playerName: string | null;
  jerseyNumber: string | null;
  grade: string | null;
  notes: string | null;
  issues: RosterImportTextParseIssue[];
};

export type RosterImportTextParseSummary = {
  totalLines: number;
  dataRows: number;
  skippedEmptyLines: number;
  headerDetected: boolean;
  withPlayerName: number;
  missingPlayerName: number;
  withJerseyNumber: number;
  withGrade: number;
  withNotes: number;
  inconsistentColumnRows: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
};

export type RosterImportTextParseResult = {
  ok: boolean;
  targetContext: RosterImportPreviewTargetContext;
  delimiter: RosterImportTextDelimiter;
  rows: RosterImportTextParseRow[];
  /** Parser-level issues (e.g. empty input, header detected). Row issues live on rows. */
  issues: RosterImportTextParseIssue[];
  summary: RosterImportTextParseSummary;
};

export type RosterImportPreviewFromTextResult = {
  /** The parser result (parser issues). */
  parse: RosterImportTextParseResult;
  /** The slice 1 preview result (preview issues), or null when parsing was blocked. */
  preview: RosterImportPreviewResult | null;
};

/** Narrow, documented header aliases (lowercased). No broad fuzzy matching. */
const HEADER_ALIASES: Record<keyof RosterImportTextColumnAliases, string[]> = {
  playerName: ['name', 'player', 'player name', 'athlete'],
  jerseyNumber: ['jersey', 'jersey #', 'number', 'no', '#'],
  grade: ['grade'],
  notes: ['note', 'notes'],
};

const SUPPORTED_DELIMITERS: readonly RosterImportTextDelimiter[] = [
  ',',
  '\t',
  '|',
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** A trimmed non-empty string, or null. */
function presentOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function issue(
  code: RosterImportTextParseIssueCode,
  severity: RosterImportTextParseIssueSeverity,
  message: string
): RosterImportTextParseIssue {
  return { code, severity, message };
}

/** Looks like a jersey number: optional leading '#', 1–3 digits. */
function looksLikeJersey(value: string): boolean {
  return /^#?\d{1,3}$/.test(value.trim());
}

/** Looks like a name: contains a letter and is not a bare jersey number. */
function looksLikeName(value: string): boolean {
  return /[A-Za-z]/.test(value) && !looksLikeJersey(value);
}

/** Counts occurrences of a single character in a string. */
function countChar(line: string, ch: string): number {
  let n = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === ch) n += 1;
  }
  return n;
}

type AutoDelimiterResolution = {
  delimiter: RosterImportTextDelimiter;
  /** Whether to actually split lines on the delimiter. False preserves in-name commas. */
  split: boolean;
};

/**
 * Resolves an auto / omitted delimiter from a sample line. Presence precedence: tab,
 * then pipe, then comma. Tabs and pipes are unambiguous and always split.
 *
 * Comma is special-cased to protect the real-world "Last, First" `player_name` shape
 * (e.g. "Cary, Hudson"): a single comma between two NON-numeric text cells is treated
 * as part of the name (no split) unless a header forces columns. A comma still splits
 * when the row is clearly tabular — a recognized header row, 3+ comma cells, or a
 * 2-cell row where either cell looks like a jersey number (e.g. "12, Hudson Cary" or
 * "Alice, 12"). To force comma columns regardless, pass an explicit `delimiter: ','`.
 */
function resolveAutoDelimiter(
  sample: string,
  options: RosterImportTextParseOptions | undefined
): AutoDelimiterResolution {
  if (countChar(sample, '\t') > 0) return { delimiter: '\t', split: true };
  if (countChar(sample, '|') > 0) return { delimiter: '|', split: true };
  if (countChar(sample, ',') > 0) {
    const commaCells = sample.split(',').map((cell) => cell.trim());
    const headerByOption = options?.hasHeader === true;
    const headerByAuto =
      options?.hasHeader !== false &&
      looksLikeHeader(commaCells, options?.columns);
    if (headerByOption || headerByAuto) return { delimiter: ',', split: true };
    if (commaCells.length >= 3) return { delimiter: ',', split: true };
    if (
      commaCells.length === 2 &&
      (looksLikeJersey(commaCells[0]) || looksLikeJersey(commaCells[1]))
    ) {
      return { delimiter: ',', split: true };
    }
    // Ambiguous single comma between two non-numeric text cells: preserve as a name.
    return { delimiter: ',', split: false };
  }
  return { delimiter: ',', split: true };
}

/** Splits a line into trimmed cells on the delimiter. */
function splitCells(line: string, delimiter: RosterImportTextDelimiter): string[] {
  return line.split(delimiter).map((cell) => cell.trim());
}

/** Matches a header cell against caller column overrides, then default aliases. */
function fieldForHeaderCell(
  cell: string,
  columns: RosterImportTextColumnAliases | undefined
): keyof RosterImportTextColumnAliases | null {
  const normalized = cell.trim().toLowerCase();
  if (normalized === '') return null;

  if (columns) {
    for (const key of [
      'playerName',
      'jerseyNumber',
      'grade',
      'notes',
    ] as (keyof RosterImportTextColumnAliases)[]) {
      const alias = columns[key];
      if (isNonEmptyString(alias) && alias.trim().toLowerCase() === normalized) {
        return key;
      }
    }
  }

  for (const key of [
    'playerName',
    'jerseyNumber',
    'grade',
    'notes',
  ] as (keyof RosterImportTextColumnAliases)[]) {
    if (HEADER_ALIASES[key].includes(normalized)) return key;
  }
  return null;
}

/** True when a line (split by delimiter) looks like a header row. */
function looksLikeHeader(
  cells: string[],
  columns: RosterImportTextColumnAliases | undefined
): boolean {
  return cells.some((cell) => fieldForHeaderCell(cell, columns) !== null);
}

type ColumnMap = Partial<
  Record<keyof RosterImportTextColumnAliases, number>
>;

/** Builds a column index map from a header row's cells (first match per field wins). */
function buildColumnMap(
  headerCells: string[],
  columns: RosterImportTextColumnAliases | undefined
): ColumnMap {
  const map: ColumnMap = {};
  headerCells.forEach((cell, index) => {
    const field = fieldForHeaderCell(cell, columns);
    if (field !== null && map[field] === undefined) {
      map[field] = index;
    }
  });
  return map;
}

/**
 * Parses pasted roster text into preserved parse rows. Pure and deterministic; the
 * input is never mutated. Every non-empty source line becomes one parse row in
 * source order; blank lines are skipped and counted.
 */
export function parseRosterImportText(
  input: RosterImportTextParseInput
): RosterImportTextParseResult {
  const resultIssues: RosterImportTextParseIssue[] = [];

  // Target context is validated independently of the text and passed through exactly.
  const targetContext: RosterImportPreviewTargetContext = {
    seasonId: presentOrNull(input.targetContext?.seasonId),
    districtId: presentOrNull(input.targetContext?.districtId),
    ageDivisionId: presentOrNull(input.targetContext?.ageDivisionId),
    teamId: presentOrNull(input.targetContext?.teamId),
  };
  const targetValid =
    targetContext.seasonId !== null &&
    targetContext.districtId !== null &&
    targetContext.ageDivisionId !== null &&
    targetContext.teamId !== null;
  if (!targetValid) {
    resultIssues.push(
      issue(
        'invalid-target-context',
        'error',
        'Target context is missing one or more of seasonId, districtId, ageDivisionId, teamId.'
      )
    );
  }

  const text = typeof input.text === 'string' ? input.text : '';
  const lines = text.split(/\r?\n/);
  const totalLines = lines.length;

  // Resolve the delimiter (explicit > auto). Defensive: an unsupported explicit
  // delimiter falls back to auto detection with a warning. `splitEnabled` is false
  // only when auto detection decides a comma is part of a name (see
  // `resolveAutoDelimiter`); an explicit delimiter always splits.
  const firstNonEmpty = lines.find((line) => line.trim() !== '');
  const requested = input.options?.delimiter;
  const fallbackResolution: AutoDelimiterResolution = {
    delimiter: ',',
    split: true,
  };
  let delimiter: RosterImportTextDelimiter;
  let splitEnabled: boolean;
  if (requested === undefined || requested === 'auto') {
    const resolved = firstNonEmpty
      ? resolveAutoDelimiter(firstNonEmpty, input.options)
      : fallbackResolution;
    delimiter = resolved.delimiter;
    splitEnabled = resolved.split;
  } else if ((SUPPORTED_DELIMITERS as readonly string[]).includes(requested)) {
    delimiter = requested as RosterImportTextDelimiter;
    splitEnabled = true;
  } else {
    resultIssues.push(
      issue(
        'unsupported-delimiter',
        'warning',
        `Unsupported delimiter "${String(requested)}"; falling back to auto detection.`
      )
    );
    const resolved = firstNonEmpty
      ? resolveAutoDelimiter(firstNonEmpty, input.options)
      : fallbackResolution;
    delimiter = resolved.delimiter;
    splitEnabled = resolved.split;
  }
  const toCells = (line: string): string[] =>
    splitEnabled ? splitCells(line, delimiter) : [line.trim()];

  // Empty input: nothing to parse.
  const hasContent = firstNonEmpty !== undefined;
  if (!hasContent) {
    resultIssues.push(
      issue('empty-input', 'error', 'Input text is empty or only blank lines.')
    );
    const rows: RosterImportTextParseRow[] = [];
    return {
      ok: false,
      targetContext,
      delimiter,
      rows,
      issues: resultIssues,
      summary: buildSummary(rows, resultIssues, {
        totalLines,
        skippedEmptyLines: totalLines === 1 && text === '' ? 0 : totalLines,
        headerDetected: false,
      }),
    };
  }

  // Decide whether the first non-empty line is a header.
  const firstCells = toCells(firstNonEmpty);
  const hasHeaderOption = input.options?.hasHeader;
  let headerDetected = false;
  if (hasHeaderOption === true) {
    headerDetected = true;
  } else if (hasHeaderOption === false) {
    headerDetected = false;
  } else {
    // 'auto' or omitted: detect only on recognized header labels.
    headerDetected = looksLikeHeader(firstCells, input.options?.columns);
  }

  let columnMap: ColumnMap | null = null;
  if (headerDetected) {
    resultIssues.push(
      issue('header-detected', 'info', 'First non-empty line treated as a header row.')
    );
    columnMap = buildColumnMap(firstCells, input.options?.columns);
    if (columnMap.playerName === undefined) {
      resultIssues.push(
        issue(
          'missing-player-name-column',
          'error',
          'Header row has no recognized player-name column.'
        )
      );
    }
  }

  // Expected column count for consistency checks.
  const expectedColumns = headerDetected
    ? firstCells.length
    : firstCells.length;

  let skippedEmptyLines = 0;
  let headerConsumed = false;
  const rows: RosterImportTextParseRow[] = [];

  lines.forEach((rawLine, index) => {
    const sourceLineNumber = index + 1;
    if (rawLine.trim() === '') {
      skippedEmptyLines += 1;
      return;
    }
    // Consume the header (first non-empty line) without producing a data row.
    if (headerDetected && !headerConsumed) {
      headerConsumed = true;
      return;
    }

    const cells = toCells(rawLine);
    const rowIssues: RosterImportTextParseIssue[] = [];

    if (rawLine.includes('"')) {
      rowIssues.push(
        issue(
          'quoted-csv-not-supported',
          'warning',
          'Line contains a quote character; quoted CSV fields are not supported and were treated literally.'
        )
      );
    }

    if (cells.length !== expectedColumns) {
      rowIssues.push(
        issue(
          'inconsistent-column-count',
          'warning',
          `Row has ${cells.length} column(s); expected ${expectedColumns}.`
        )
      );
    }

    const extracted = extractFields(cells, headerDetected ? columnMap : null);

    if (extracted.playerName === null) {
      rowIssues.push(
        issue('missing-player-name', 'error', 'Row has no resolvable player name.')
      );
    }

    rows.push({
      sourceRowId: `line-${sourceLineNumber}`,
      sourceLineNumber,
      rawLine,
      cells,
      playerName: extracted.playerName,
      jerseyNumber: extracted.jerseyNumber,
      grade: extracted.grade,
      notes: extracted.notes,
      issues: rowIssues,
    });
  });

  const summary = buildSummary(rows, resultIssues, {
    totalLines,
    skippedEmptyLines,
    headerDetected,
  });

  // Parser ok reflects structural success: no parser-level (result) error issues.
  // Row-level errors (e.g. missing-player-name) are preserved and surfaced by the
  // slice 1 preview's own validation, keeping parser and preview issues distinct.
  const ok = !resultIssues.some((i) => i.severity === 'error');

  return {
    ok,
    targetContext,
    delimiter,
    rows,
    issues: resultIssues,
    summary,
  };
}

type ExtractedFields = {
  playerName: string | null;
  jerseyNumber: string | null;
  grade: string | null;
  notes: string | null;
};

/** Maps a row's cells to fields, by header column map or positional no-header rules. */
function extractFields(
  cells: string[],
  columnMap: ColumnMap | null
): ExtractedFields {
  const at = (index: number | undefined): string | null =>
    index === undefined ? null : presentOrNull(cells[index]);

  if (columnMap) {
    return {
      playerName: at(columnMap.playerName),
      jerseyNumber: at(columnMap.jerseyNumber),
      grade: at(columnMap.grade),
      notes: at(columnMap.notes),
    };
  }

  // No header: positional rules based on this row's own cell count.
  const count = cells.length;
  if (count <= 1) {
    return {
      playerName: at(0),
      jerseyNumber: null,
      grade: null,
      notes: null,
    };
  }
  if (count === 2) {
    // Default jersey + name, unless first looks like a name and second a jersey.
    if (looksLikeName(cells[0]) && looksLikeJersey(cells[1])) {
      return {
        playerName: presentOrNull(cells[0]),
        jerseyNumber: presentOrNull(cells[1]),
        grade: null,
        notes: null,
      };
    }
    return {
      playerName: presentOrNull(cells[1]),
      jerseyNumber: presentOrNull(cells[0]),
      grade: null,
      notes: null,
    };
  }
  if (count === 3) {
    return {
      playerName: presentOrNull(cells[1]),
      jerseyNumber: presentOrNull(cells[0]),
      grade: presentOrNull(cells[2]),
      notes: null,
    };
  }
  // 4+ columns: jersey, name, grade, notes (remaining cells joined by a space).
  const notesJoined = cells.slice(3).join(' ').trim();
  return {
    playerName: presentOrNull(cells[1]),
    jerseyNumber: presentOrNull(cells[0]),
    grade: presentOrNull(cells[2]),
    notes: notesJoined === '' ? null : notesJoined,
  };
}

/**
 * Tallies parse rows into row-derived counts. Context fields (`totalLines`,
 * `skippedEmptyLines`, `headerDetected`) are not derivable from rows alone; the
 * rows-only call leaves them at 0 / false and `parseRosterImportText` supplies them.
 * Severity counts include row issues here; the parser augments them with
 * result-level issue severities when it builds the authoritative summary.
 */
export function summarizeRosterImportTextParseRows(
  rows: RosterImportTextParseRow[]
): RosterImportTextParseSummary {
  return buildSummary(rows, [], {
    totalLines: 0,
    skippedEmptyLines: 0,
    headerDetected: false,
  });
}

function buildSummary(
  rows: RosterImportTextParseRow[],
  resultIssues: RosterImportTextParseIssue[],
  context: {
    totalLines: number;
    skippedEmptyLines: number;
    headerDetected: boolean;
  }
): RosterImportTextParseSummary {
  const summary: RosterImportTextParseSummary = {
    totalLines: context.totalLines,
    dataRows: rows.length,
    skippedEmptyLines: context.skippedEmptyLines,
    headerDetected: context.headerDetected,
    withPlayerName: 0,
    missingPlayerName: 0,
    withJerseyNumber: 0,
    withGrade: 0,
    withNotes: 0,
    inconsistentColumnRows: 0,
    errorCount: 0,
    warningCount: 0,
    infoCount: 0,
  };

  for (const row of rows) {
    if (row.playerName !== null) summary.withPlayerName += 1;
    else summary.missingPlayerName += 1;
    if (row.jerseyNumber !== null) summary.withJerseyNumber += 1;
    if (row.grade !== null) summary.withGrade += 1;
    if (row.notes !== null) summary.withNotes += 1;
    if (row.issues.some((i) => i.code === 'inconsistent-column-count')) {
      summary.inconsistentColumnRows += 1;
    }
    for (const i of row.issues) {
      tallySeverity(summary, i.severity);
    }
  }

  for (const i of resultIssues) {
    tallySeverity(summary, i.severity);
  }

  return summary;
}

function tallySeverity(
  summary: RosterImportTextParseSummary,
  severity: RosterImportTextParseIssueSeverity
): void {
  if (severity === 'error') summary.errorCount += 1;
  else if (severity === 'warning') summary.warningCount += 1;
  else summary.infoCount += 1;
}

/**
 * Parses pasted roster text and, unless parsing was blocked by empty input, hands the
 * parsed rows to the existing slice 1 `createRosterImportPreview` helper. Returns both
 * results so parser issues and preview issues stay distinguishable. Pure: the input
 * is never mutated, and no slice 1 validation is duplicated here.
 */
export function createRosterImportPreviewFromText(
  input: RosterImportTextParseInput
): RosterImportPreviewFromTextResult {
  const parse = parseRosterImportText(input);

  // Empty input has no rows to preview. Target-context problems are passed through to
  // the preview, which reports them with its own (distinct) issue.
  const isEmptyInput = parse.issues.some((i) => i.code === 'empty-input');
  if (isEmptyInput) {
    return { parse, preview: null };
  }

  const previewRows: RosterImportPreviewRowInput[] = parse.rows.map((row) => {
    const rowInput: RosterImportPreviewRowInput = {
      sourceRowId: row.sourceRowId,
      raw: row.rawLine,
    };
    if (row.playerName !== null) rowInput.playerName = row.playerName;
    if (row.jerseyNumber !== null) rowInput.jerseyNumber = row.jerseyNumber;
    if (row.grade !== null) rowInput.grade = row.grade;
    if (row.notes !== null) rowInput.notes = row.notes;
    return rowInput;
  });

  const previewInput: RosterImportPreviewInput = {
    seasonId: parse.targetContext.seasonId ?? undefined,
    districtId: parse.targetContext.districtId ?? undefined,
    ageDivisionId: parse.targetContext.ageDivisionId ?? undefined,
    teamId: parse.targetContext.teamId ?? undefined,
    rows: previewRows,
  };

  return { parse, preview: createRosterImportPreview(previewInput) };
}
