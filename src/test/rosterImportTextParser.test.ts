import { describe, it, expect } from 'vitest';
import {
  parseRosterImportText,
  createRosterImportPreviewFromText,
  summarizeRosterImportTextParseRows,
} from '../engine/rosterImportTextParser';
import type { RosterImportTextParseInput } from '../engine/rosterImportTextParser';

const TARGET = {
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GI',
  teamId: '2026-alta-GI-A1',
};

function parse(
  text: string,
  options?: RosterImportTextParseInput['options'],
  targetContext: RosterImportTextParseInput['targetContext'] = TARGET
) {
  return parseRosterImportText({ text, targetContext, options });
}

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

// ---------------------------------------------------------------------------
// 1. empty input
// ---------------------------------------------------------------------------

describe('empty input', () => {
  it('1. returns empty-input issue and no rows', () => {
    const result = parse('');
    expect(result.ok).toBe(false);
    expect(codes(result.issues)).toContain('empty-input');
    expect(result.rows).toEqual([]);
  });

  it('treats whitespace-only / blank lines as empty input', () => {
    const result = parse('\n  \n\t\n');
    expect(codes(result.issues)).toContain('empty-input');
    expect(result.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. plain names
// ---------------------------------------------------------------------------

describe('plain newline-separated names', () => {
  it('2. become single-column player-name rows', () => {
    const result = parse('Alice\nBob\nCharlie');
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.playerName)).toEqual([
      'Alice',
      'Bob',
      'Charlie',
    ]);
    expect(result.rows.every((r) => r.jerseyNumber === null)).toBe(true);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3-5. explicit delimiters
// ---------------------------------------------------------------------------

describe('delimiters', () => {
  it('3. comma-delimited rows parse correctly', () => {
    const result = parse('12,Alice\n7,Bob', { delimiter: ',', hasHeader: false });
    expect(result.delimiter).toBe(',');
    expect(result.rows[0].cells).toEqual(['12', 'Alice']);
    expect(result.rows[0].jerseyNumber).toBe('12');
    expect(result.rows[0].playerName).toBe('Alice');
  });

  it('4. tab-delimited rows parse correctly', () => {
    const result = parse('12\tAlice', { delimiter: '\t', hasHeader: false });
    expect(result.delimiter).toBe('\t');
    expect(result.rows[0].cells).toEqual(['12', 'Alice']);
    expect(result.rows[0].playerName).toBe('Alice');
  });

  it('5. pipe-delimited rows parse correctly', () => {
    const result = parse('12|Alice', { delimiter: '|', hasHeader: false });
    expect(result.delimiter).toBe('|');
    expect(result.rows[0].cells).toEqual(['12', 'Alice']);
    expect(result.rows[0].playerName).toBe('Alice');
  });
});

// ---------------------------------------------------------------------------
// 6-9. auto detection & override
// ---------------------------------------------------------------------------

describe('auto delimiter detection', () => {
  it('6. auto detects comma', () => {
    expect(parse('12,Alice', { delimiter: 'auto', hasHeader: false }).delimiter).toBe(
      ','
    );
  });

  it('7. auto detects tab', () => {
    expect(
      parse('12\tAlice', { delimiter: 'auto', hasHeader: false }).delimiter
    ).toBe('\t');
  });

  it('8. auto detects pipe', () => {
    expect(parse('12|Alice', { delimiter: 'auto', hasHeader: false }).delimiter).toBe(
      '|'
    );
  });

  it('9. explicit delimiter overrides auto', () => {
    const result = parse('12,Alice', { delimiter: '|', hasHeader: false });
    expect(result.delimiter).toBe('|');
    // With '|' there is no split point, so the whole line is one cell.
    expect(result.rows[0].cells).toEqual(['12,Alice']);
    expect(result.rows[0].playerName).toBe('12,Alice');
  });
});

// ---------------------------------------------------------------------------
// Comma-in-name correction (Phase 5 slice 9 correction pass)
//
// A single comma between two non-numeric text cells is the real-world
// "Last, First" player_name shape and must be preserved in auto mode, not split.
// ---------------------------------------------------------------------------

describe('comma-in-name preservation (auto delimiter)', () => {
  it('auto preserves "Cary, Hudson" as one playerName', () => {
    const result = parse('Cary, Hudson');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].playerName).toBe('Cary, Hudson');
    expect(result.rows[0].jerseyNumber).toBeNull();
    expect(result.rows[0].cells).toEqual(['Cary, Hudson']);
  });

  it('auto preserves multiple last-first style names line-by-line', () => {
    const result = parse('Cary, Hudson\nSmith, John\nDoe, Jane');
    expect(result.rows.map((r) => r.playerName)).toEqual([
      'Cary, Hudson',
      'Smith, John',
      'Doe, Jane',
    ]);
    expect(result.rows.every((r) => r.jerseyNumber === null)).toBe(true);
  });

  it('explicit comma delimiter still parses two-column rows', () => {
    const result = parse('12, Hudson Cary', { delimiter: ',' });
    expect(result.delimiter).toBe(',');
    expect(result.rows[0].jerseyNumber).toBe('12');
    expect(result.rows[0].playerName).toBe('Hudson Cary');
  });

  it('comma header still parses recognized columns in auto mode', () => {
    const result = parse('jersey,name\n12,Hudson Cary');
    expect(result.summary.headerDetected).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].jerseyNumber).toBe('12');
    expect(result.rows[0].playerName).toBe('Hudson Cary');
  });

  it('numeric jersey/name comma row still parses as two columns in auto mode', () => {
    const result = parse('12, Hudson Cary', { hasHeader: false });
    expect(result.delimiter).toBe(',');
    expect(result.rows[0].jerseyNumber).toBe('12');
    expect(result.rows[0].playerName).toBe('Hudson Cary');
  });

  it('name/jersey comma row (numeric second cell) still parses as two columns', () => {
    const result = parse('Hudson Cary, 12', { hasHeader: false });
    expect(result.rows[0].playerName).toBe('Hudson Cary');
    expect(result.rows[0].jerseyNumber).toBe('12');
  });

  it('repeated calls are deterministic for comma-in-name input', () => {
    const input = {
      text: 'Cary, Hudson\nSmith, John',
      targetContext: TARGET,
      options: { delimiter: 'auto' as const },
    };
    expect(parseRosterImportText(input)).toEqual(parseRosterImportText(input));
  });
});

// ---------------------------------------------------------------------------
// 10-12. header handling
// ---------------------------------------------------------------------------

describe('header handling', () => {
  it('10. hasHeader=true maps recognized header columns', () => {
    const result = parse('name,jersey\nAlice,12', { hasHeader: true });
    expect(result.summary.headerDetected).toBe(true);
    expect(codes(result.issues)).toContain('header-detected');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].playerName).toBe('Alice');
    expect(result.rows[0].jerseyNumber).toBe('12');
  });

  it('11. hasHeader=false treats the first line as data', () => {
    const result = parse('name,jersey\nAlice,12', { hasHeader: false });
    expect(result.summary.headerDetected).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].rawLine).toBe('name,jersey');
  });

  it('12. hasHeader=auto detects a common header row', () => {
    const result = parse('player,number\nAlice,12', { hasHeader: 'auto' });
    expect(result.summary.headerDetected).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].playerName).toBe('Alice');
    expect(result.rows[0].jerseyNumber).toBe('12');
  });

  it('maps caller-provided column aliases', () => {
    const result = parse('athlete_name,shirt\nAlice,12', {
      hasHeader: true,
      columns: { playerName: 'athlete_name', jerseyNumber: 'shirt' },
    });
    expect(result.rows[0].playerName).toBe('Alice');
    expect(result.rows[0].jerseyNumber).toBe('12');
  });

  it('reports missing-player-name-column when a header lacks a name column', () => {
    const result = parse('jersey,grade\n12,5', { hasHeader: true });
    expect(codes(result.issues)).toContain('missing-player-name-column');
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13-17. no-header positional column mapping
// ---------------------------------------------------------------------------

describe('no-header positional mapping', () => {
  it('13. one column maps to playerName', () => {
    const result = parse('Alice', { hasHeader: false });
    expect(result.rows[0].playerName).toBe('Alice');
    expect(result.rows[0].jerseyNumber).toBeNull();
  });

  it('14. two-column jersey/name maps correctly', () => {
    const result = parse('12,Alice', { hasHeader: false });
    expect(result.rows[0].jerseyNumber).toBe('12');
    expect(result.rows[0].playerName).toBe('Alice');
  });

  it('15. two-column name/jersey maps correctly', () => {
    const result = parse('Alice,12', { hasHeader: false });
    expect(result.rows[0].playerName).toBe('Alice');
    expect(result.rows[0].jerseyNumber).toBe('12');
  });

  it('16. three columns map jersey/name/grade', () => {
    const result = parse('12,Alice,5', { hasHeader: false });
    expect(result.rows[0].jerseyNumber).toBe('12');
    expect(result.rows[0].playerName).toBe('Alice');
    expect(result.rows[0].grade).toBe('5');
  });

  it('17. four-plus columns map notes from remaining cells', () => {
    const result = parse('12,Alice,5,Captain,MVP', { hasHeader: false });
    expect(result.rows[0].jerseyNumber).toBe('12');
    expect(result.rows[0].playerName).toBe('Alice');
    expect(result.rows[0].grade).toBe('5');
    expect(result.rows[0].notes).toBe('Captain MVP');
  });
});

// ---------------------------------------------------------------------------
// 18-21. preservation & reporting
// ---------------------------------------------------------------------------

describe('preservation and reporting', () => {
  it('18. missing player name preserves the row and adds an issue', () => {
    const result = parse('12,,5', { hasHeader: false });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].playerName).toBeNull();
    expect(codes(result.rows[0].issues)).toContain('missing-player-name');
    expect(result.summary.missingPlayerName).toBe(1);
  });

  it('19. blank lines are skipped and counted', () => {
    const result = parse('Alice\n\nBob\n\n', { hasHeader: false });
    expect(result.rows.map((r) => r.playerName)).toEqual(['Alice', 'Bob']);
    expect(result.summary.skippedEmptyLines).toBeGreaterThanOrEqual(2);
    expect(result.summary.dataRows).toBe(2);
    // Source line numbers reflect the true source position.
    expect(result.rows[0].sourceLineNumber).toBe(1);
    expect(result.rows[1].sourceLineNumber).toBe(3);
  });

  it('20. inconsistent column counts are reported but rows preserved', () => {
    const result = parse('12,Alice\n7,Bob,9', { hasHeader: false });
    expect(result.rows).toHaveLength(2);
    expect(codes(result.rows[1].issues)).toContain('inconsistent-column-count');
    expect(result.summary.inconsistentColumnRows).toBe(1);
  });

  it('21. quoted CSV is reported when a quote is detected', () => {
    const result = parse('"Alice",12', { hasHeader: false });
    expect(result.rows).toHaveLength(1);
    expect(codes(result.rows[0].issues)).toContain('quoted-csv-not-supported');
  });
});

// ---------------------------------------------------------------------------
// 22. deterministic ids
// ---------------------------------------------------------------------------

describe('deterministic ids', () => {
  it('22. sourceRowId and sourceLineNumber follow the source line number', () => {
    const result = parse('Alice\nBob', { hasHeader: false });
    expect(result.rows[0].sourceRowId).toBe('line-1');
    expect(result.rows[0].sourceLineNumber).toBe(1);
    expect(result.rows[1].sourceRowId).toBe('line-2');
    expect(result.rows[1].sourceLineNumber).toBe(2);

    const withLeadingBlank = parse('\nAlice', { hasHeader: false });
    expect(withLeadingBlank.rows[0].sourceRowId).toBe('line-2');
    expect(withLeadingBlank.rows[0].sourceLineNumber).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 23. preview integration
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewFromText', () => {
  it('23. calls into the slice 1 preview contract and returns a preview result', () => {
    const result = createRosterImportPreviewFromText({
      text: 'Alice\nBob',
      targetContext: TARGET,
      options: { hasHeader: false },
    });
    expect(result.parse.rows).toHaveLength(2);
    expect(result.preview).not.toBeNull();
    expect(result.preview?.rows).toHaveLength(2);
    expect(result.preview?.target.seasonId).toBe('2026');
    expect(result.preview?.rows[0].playerName).toBe('Alice');
    // The preview's own validation runs (it owns row status / preview issues).
    expect(result.preview?.rows[0].status).toBe('ready');
    expect(result.preview?.rows[0].fields.raw).toBe('Alice');
  });

  it('returns a null preview for empty input', () => {
    const result = createRosterImportPreviewFromText({
      text: '',
      targetContext: TARGET,
    });
    expect(result.preview).toBeNull();
    expect(codes(result.parse.issues)).toContain('empty-input');
  });

  it('missing player names flow into preview validation as invalid rows', () => {
    const result = createRosterImportPreviewFromText({
      text: '12,,5',
      targetContext: TARGET,
      options: { hasHeader: false },
    });
    // Parser preserves the row; the preview marks it invalid (distinct issue sets).
    expect(codes(result.parse.rows[0].issues)).toContain('missing-player-name');
    expect(result.preview?.rows[0].status).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// 24. invalid target context
// ---------------------------------------------------------------------------

describe('invalid target context', () => {
  it('24. is reported by the parser', () => {
    const result = parse('Alice', { hasHeader: false }, {
      seasonId: '2026',
      districtId: 'alta',
      ageDivisionId: 'GI',
      // teamId missing
    });
    expect(codes(result.issues)).toContain('invalid-target-context');
    expect(result.ok).toBe(false);
    expect(result.targetContext.teamId).toBeNull();
  });

  it('passes an invalid target context through to the preview as well', () => {
    const result = createRosterImportPreviewFromText({
      text: 'Alice',
      targetContext: { seasonId: '2026', districtId: 'alta', ageDivisionId: 'GI' },
      options: { hasHeader: false },
    });
    expect(codes(result.parse.issues)).toContain('invalid-target-context');
    expect(result.preview?.targetValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 25-26. immutability & determinism
// ---------------------------------------------------------------------------

describe('immutability and determinism', () => {
  it('25. does not mutate the input text or options', () => {
    const input: RosterImportTextParseInput = {
      text: '12,Alice,5,Captain MVP',
      targetContext: { ...TARGET },
      options: {
        hasHeader: false,
        delimiter: ',',
        columns: { playerName: 'name' },
      },
    };
    const before = JSON.parse(JSON.stringify(input));
    parseRosterImportText(input);
    createRosterImportPreviewFromText(input);
    expect(JSON.parse(JSON.stringify(input))).toEqual(before);
  });

  it('26. produces deterministic output across repeated calls', () => {
    const input: RosterImportTextParseInput = {
      text: 'name,jersey,grade\nAlice,12,5\n\nBob,7,4',
      targetContext: TARGET,
      options: { hasHeader: 'auto' },
    };
    expect(parseRosterImportText(input)).toEqual(parseRosterImportText(input));
    expect(createRosterImportPreviewFromText(input)).toEqual(
      createRosterImportPreviewFromText(input)
    );
  });
});

// ---------------------------------------------------------------------------
// summarize helper
// ---------------------------------------------------------------------------

describe('summarizeRosterImportTextParseRows', () => {
  it('counts row-derived fields (context fields left at defaults)', () => {
    const result = parse('12,Alice,5\n,,', { hasHeader: false });
    const summary = summarizeRosterImportTextParseRows(result.rows);
    expect(summary.dataRows).toBe(result.rows.length);
    expect(summary.withPlayerName).toBe(1);
    expect(summary.missingPlayerName).toBe(1);
    expect(summary.totalLines).toBe(0);
    expect(summary.headerDetected).toBe(false);
  });
});
