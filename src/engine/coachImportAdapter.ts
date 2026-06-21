import type { CoachRole, Team } from '../domain/types';
import { coachIdentityKey } from './coachModel';

/**
 * Phase 7 slice 27: PURE, deterministic COACH IMPORT ADAPTER — ENGINE ONLY.
 *
 * Maps a row-per-assignment coach-import contract (`importType: "coach"`; rows with
 * `coachName` + `teamId` + `role`) into resolved assignment candidates. Teams resolve
 * through existing `Team.teamId`; coach identity is name-based (deterministic identity key).
 * Raw coach names and source labels are preserved exactly.
 *
 * (The Phase 5 scraped coaches JSON, e.g. `coaches-2022-pw-small.json`, is a separate nested
 * team-label contract resolved via the canonical mapping pipeline — a future scraped-coach
 * import path. This slice uses the focused teamId-referenced contract, matching the schedule
 * import precedent.)
 *
 * Guardrails: never mutates inputs; never creates opponent/venue entities; returns stable
 * per-row validation errors with reason codes.
 */

export const COACH_IMPORT_ADAPTER_LOGIC_VERSION = 'phase7-slice27-coach-import-adapter-v1';

const VALID_ROLES: CoachRole[] = ['headCoach', 'assistantCoach', 'unknown'];

export type CoachImportRowErrorCode =
  | 'invalid-row-shape'
  | 'unresolved-team'
  | 'invalid-role';

export type CoachImportRowError = { code: CoachImportRowErrorCode; message: string };

export type CoachImportSource = {
  coachName: string | null;
  teamId: string | null;
  role: string | null;
  sourceLabel: string | null;
};

export type CoachImportCandidate = {
  coachName: string;
  identityKey: string;
  teamId: string;
  seasonId: string;
  role: CoachRole;
  sourceLabel: string | null;
  sourceRowId: string;
};

export type CoachImportAdaptedRow = {
  rowIndex: number;
  sourceRowId: string;
  source: CoachImportSource;
  candidate: CoachImportCandidate | null;
  errors: CoachImportRowError[];
};

export type CoachImportShapeErrorCode =
  | 'not-an-object'
  | 'wrong-import-type'
  | 'missing-assignments-array';

export type CoachImportAdaptResult =
  | { ok: false; shapeError: { code: CoachImportShapeErrorCode; message: string } }
  | { ok: true; importType: string; seasonId: string | null; rows: CoachImportAdaptedRow[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function adaptRow(
  raw: unknown,
  rowIndex: number,
  teamsById: Map<string, Team>
): CoachImportAdaptedRow {
  const errors: CoachImportRowError[] = [];
  if (!isObject(raw)) {
    return {
      rowIndex,
      sourceRowId: `coach-row-${rowIndex}`,
      source: { coachName: null, teamId: null, role: null, sourceLabel: null },
      candidate: null,
      errors: [{ code: 'invalid-row-shape', message: 'Row is not an object.' }],
    };
  }

  const source: CoachImportSource = {
    coachName: asNullableString(raw.coachName),
    teamId: asNullableString(raw.teamId),
    role: asNullableString(raw.role),
    sourceLabel: asNullableString(raw.sourceLabel),
  };
  const sourceRowId =
    asNullableString(raw.sourceRowId) ?? `coach-row-${rowIndex}`;

  const coachName = source.coachName;
  const teamId = source.teamId;
  if (!coachName || coachName.trim() === '' || !teamId) {
    errors.push({
      code: 'invalid-row-shape',
      message: 'Row is missing a coachName and/or teamId.',
    });
  }

  const team = teamId ? teamsById.get(teamId) ?? null : null;
  if (teamId && !team) {
    errors.push({ code: 'unresolved-team', message: `Team "${teamId}" is not an existing team.` });
  }

  let role: CoachRole = 'unknown';
  if (source.role !== null) {
    if (!VALID_ROLES.includes(source.role as CoachRole)) {
      errors.push({
        code: 'invalid-role',
        message: `role must be one of ${VALID_ROLES.join(', ')}.`,
      });
    } else {
      role = source.role as CoachRole;
    }
  }

  if (errors.length > 0 || !coachName || !team) {
    return { rowIndex, sourceRowId, source, candidate: null, errors };
  }

  const candidate: CoachImportCandidate = {
    coachName,
    identityKey: coachIdentityKey(coachName),
    teamId: team.teamId,
    // The resolved team's season is authoritative for the assignment.
    seasonId: team.seasonId,
    role,
    sourceLabel: source.sourceLabel,
    sourceRowId,
  };
  return { rowIndex, sourceRowId, source, candidate, errors: [] };
}

/**
 * Adapts a parsed coach-import payload into resolved assignment candidates. Pure; never
 * mutates inputs. Validates file shape, then each row independently.
 */
export function adaptCoachImport(
  payload: unknown,
  options: { teams: Team[] }
): CoachImportAdaptResult {
  if (!isObject(payload)) {
    return { ok: false, shapeError: { code: 'not-an-object', message: 'Coach import is not a JSON object.' } };
  }
  if (payload.importType !== 'coach') {
    return {
      ok: false,
      shapeError: {
        code: 'wrong-import-type',
        message: `Expected importType "coach" but found "${String(payload.importType)}".`,
      },
    };
  }
  if (!Array.isArray(payload.assignments)) {
    return {
      ok: false,
      shapeError: { code: 'missing-assignments-array', message: 'Coach import has no assignments array.' },
    };
  }

  const teamsById = new Map(options.teams.map((t) => [t.teamId, t]));
  const fileSeasonId = asNullableString(payload.seasonId);
  const rows = (payload.assignments as unknown[]).map((raw, index) =>
    adaptRow(raw, index, teamsById)
  );
  return { ok: true, importType: 'coach', seasonId: fileSeasonId, rows };
}
