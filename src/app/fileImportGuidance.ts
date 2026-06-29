import { classifyImportFileShape } from '../engine/importFileShape';
import type { WorkspaceSnapshotValidationError } from '../engine/workspaceSnapshot';

/**
 * Completion Milestone E2: PURE, deterministic translation of import failures into
 * plain-language, user-facing guidance — no engine code names, no raw stack traces as the
 * headline. It composes the existing deterministic validators (it never loosens them); it
 * only reshapes their verdicts for display and adds cross-path "wrong file here" guidance.
 */

export type UserFacingFileError = {
  /** Short headline. */
  title: string;
  /** "What happened" — one plain sentence. */
  what: string;
  /** "Try this" — the next action in plain language. */
  tryThis: string;
  /** Optional small technical line (safe to show, never the main message). */
  detail?: string;
};

function safeParse(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Portable Dataset Import (top toolbar)
// ---------------------------------------------------------------------------

const DATASET_CODE_MESSAGES: Partial<
  Record<WorkspaceSnapshotValidationError['code'], string>
> = {
  'unsupported-schema-version':
    'This dataset was saved by a different version of the app, so it cannot be imported here.',
  'wrong-snapshot-kind':
    "This JSON isn't a UC Roster Sniffer dataset export.",
  'missing-schema-version': "This JSON isn't a UC Roster Sniffer dataset export.",
  'not-an-object': "This file isn't a UC Roster Sniffer dataset export.",
  'invalid-workspace': 'This dataset is missing its workspace section.',
  'empty-workspace':
    'This dataset has no teams, so there would be nothing to load.',
  'invalid-districts': 'This dataset has an invalid districts section.',
  'invalid-age-divisions': 'This dataset has an invalid age-divisions section.',
  'invalid-teams': 'This dataset has an invalid teams section.',
  'invalid-games': 'This dataset has an invalid games/schedule section.',
  'unresolved-game-reference':
    'This dataset has a game that points at a team it does not contain.',
  'invalid-coaches': 'This dataset has an invalid coaches section.',
  'invalid-coach-assignments':
    'This dataset has an invalid coach-assignments section.',
  'unresolved-coach-reference':
    'This dataset has a coach assignment that points at a missing coach or team.',
};

/**
 * Builds plain-language guidance for a FAILED portable Dataset Import. Detects when the file
 * is actually a scraped Ute Conference file (belongs in Roster import) and says so. Pure.
 */
export function buildDatasetImportErrorGuidance(
  rawText: string,
  errors: WorkspaceSnapshotValidationError[]
): UserFacingFileError {
  const first = errors[0];
  const detail = first ? `${first.code}: ${first.message}` : undefined;

  if (first?.code === 'invalid-json') {
    return {
      title: 'We could not read this file.',
      what: "It isn't valid JSON, so it can't be opened.",
      tryThis:
        'Choose the .json file you saved with “Export Dataset”. If you exported it from another browser, make sure the whole file copied over.',
      detail,
    };
  }

  // The JSON parsed but failed validation — see whether it's actually a scraped file.
  const parsed = safeParse(rawText);
  const shape = parsed.ok ? classifyImportFileShape(parsed.value) : 'unknown';
  if (shape === 'scraped-players' || shape === 'scraped-coaches' || shape === 'scraped-unknown') {
    const kind =
      shape === 'scraped-players'
        ? 'players'
        : shape === 'scraped-coaches'
          ? 'coaches'
          : 'roster';
    return {
      title: 'We could not import this file.',
      what: `This looks like a scraped Ute Conference ${kind} file, not a UC Roster Sniffer dataset export.`,
      tryThis: 'Use the “Roster import” tab to load scraped Ute Conference JSON.',
      detail,
    };
  }

  return {
    title: 'We could not import this file.',
    what:
      (first && DATASET_CODE_MESSAGES[first.code]) ??
      "This file isn't a valid UC Roster Sniffer dataset export.",
    tryThis:
      'Choose a .json file you saved with “Export Dataset”. To load scraped Ute Conference JSON, use the “Roster import” tab instead.',
    detail,
  };
}

// ---------------------------------------------------------------------------
// Scraped Roster import (Roster import tab)
// ---------------------------------------------------------------------------

export type ScrapedImportErrorInput =
  | { kind: 'parse'; reason: 'empty-file' | 'invalid-json'; message: string }
  | { kind: 'invalid-source'; payload: unknown }
  | {
      kind: 'normalize';
      reason: 'unsupported-flat-rows' | 'empty-source';
      message: string;
    };

/**
 * Builds plain-language guidance for a FAILED scraped Roster import — either a file-level
 * parse failure (empty / invalid JSON) or a parsed-but-unsupported source. Detects when the
 * file is actually a UC Roster Sniffer dataset export (belongs in Dataset Import). Pure.
 */
export function buildScrapedImportErrorGuidance(
  input: ScrapedImportErrorInput
): UserFacingFileError {
  if (input.kind === 'parse') {
    if (input.reason === 'empty-file') {
      return {
        title: 'This file is empty.',
        what: 'The selected file has no contents.',
        tryThis: 'Choose a scraped Ute Conference JSON file that has data in it.',
      };
    }
    return {
      title: 'We could not read this file.',
      what: "It isn't valid JSON, so it can't be opened.",
      tryThis: 'Choose a scraped Ute Conference JSON file exported by the scraper.',
      detail: input.message,
    };
  }

  if (input.kind === 'normalize') {
    if (input.reason === 'empty-source') {
      return {
        title: 'This file has no rows.',
        what: 'The file is an empty list, so there is nothing to import.',
        tryThis: 'Choose a scraped file (nested or flat row-list) that contains rows.',
      };
    }
    return {
      title: 'We could not use this flat file.',
      what: input.message,
      tryThis:
        'Make sure each row has a district, an age group (age_group / league / ageDivision), a team (team / team_name), and a player name (player_name / name).',
    };
  }

  const shape = classifyImportFileShape(input.payload);
  if (shape === 'dataset-snapshot') {
    return {
      title: 'This file belongs in a different place.',
      what:
        'This looks like a UC Roster Sniffer dataset export, not a scraped Ute Conference file.',
      tryThis: 'Use “Import Dataset” in the top toolbar to load a dataset export.',
    };
  }
  if (shape === 'scraped-unknown') {
    return {
      title: 'We could not use this scraped file.',
      what:
        "This looks like a scraped file, but its metadata record_type isn't “players” or “coaches”.",
      tryThis:
        'Check that the file is a Ute Conference players or coaches scrape with a metadata.record_type field.',
    };
  }
  return {
    title: 'We could not use this file.',
    what:
      "This isn't a recognized scraped Ute Conference players or coaches file.",
    tryThis:
      'Choose a scraped Ute Conference JSON file. To load a dataset you exported, use “Import Dataset” in the top toolbar instead.',
  };
}
