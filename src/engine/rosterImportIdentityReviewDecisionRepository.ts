import type {
  RosterImportIdentityReviewDecision,
  RosterImportIdentityReviewDecisionValidationError,
} from './rosterImportIdentityReviewDecision';
import { validateRosterImportIdentityReviewDecision } from './rosterImportIdentityReviewDecision';

/**
 * Phase 5 slice 4: import identity review decision REPOSITORY — STORAGE BOUNDARY ONLY.
 *
 * Slice 3 defined the append-only `RosterImportIdentityReviewDecision` contract
 * (`applyRosterImportIdentityReviewAction` -> `createRosterImportIdentityReviewDecision`).
 * This slice adds the narrow repository / storage-boundary layer: how those
 * decisions are appended, loaded, validated, and exported / imported at the local
 * data boundary. It mirrors the Phase 4 slice 9 cohort decision repository.
 *
 * The app has no browser-storage persistence layer yet (only static JSON sample
 * loading). So this is an IN-MEMORY repository adapter plus a documented,
 * JSON-compatible export/import contract — NOT a real storage implementation. It
 * does NOT write to localStorage / IndexedDB / files / sample data / app state, and
 * it does NOT apply decisions to import preview rows, existing records, or roster
 * data.
 *
 * Invariants:
 *   - Append-only: accepted decisions are added to the end; superseded decisions
 *     are NEVER removed (they are excluded from the ACTIVE view only).
 *   - Pure and deterministic: every operation returns a NEW state object and never
 *     mutates the input state, the input decisions, or any roster / preview /
 *     existing-record object. No `Date.now()`, no generated ids.
 *   - Validation gate: only decisions that pass
 *     `validateRosterImportIdentityReviewDecision` are accepted; duplicates (by
 *     `decisionId`) are rejected, never overwritten.
 *
 * Decision objects are stored and returned BY REFERENCE (not cloned). The
 * repository never mutates them, so this is safe by convention; callers must treat
 * returned decisions as read-only.
 */

export const ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION =
  'roster-import-identity-review-decisions.v1';

export type RosterImportIdentityReviewDecisionRepositoryState = {
  version: string;
  decisions: RosterImportIdentityReviewDecision[];
};

export type RosterImportIdentityReviewDecisionRepositoryRejectionReason =
  | 'invalid-decision'
  | 'duplicate-decision-id'
  | 'unsupported-repository-version'
  | 'invalid-repository-payload'
  | 'missing-decision-list';

export type RejectedRosterImportIdentityReviewDecision = {
  decision: RosterImportIdentityReviewDecision | null;
  reason: RosterImportIdentityReviewDecisionRepositoryRejectionReason;
  validationErrors?: RosterImportIdentityReviewDecisionValidationError[];
};

/**
 * The outcome of an append or import. `state` is always a usable repository state
 * (the prior state plus any accepted decisions; an empty state for envelope-level
 * import errors). `ok` is true only when nothing was rejected.
 */
export type RosterImportIdentityReviewDecisionRepositoryResult = {
  ok: boolean;
  state: RosterImportIdentityReviewDecisionRepositoryState;
  accepted: RosterImportIdentityReviewDecision[];
  rejected: RejectedRosterImportIdentityReviewDecision[];
  messages: string[];
};

/** A plain, JSON-compatible export of the repository. Contains no functions. */
export type RosterImportIdentityReviewDecisionRepositoryPayload = {
  version: string;
  decisions: RosterImportIdentityReviewDecision[];
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Creates a deterministic empty repository state pinned to the current version.
 */
export function createEmptyRosterImportIdentityReviewDecisionRepositoryState(): RosterImportIdentityReviewDecisionRepositoryState {
  return {
    version: ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION,
    decisions: [],
  };
}

/**
 * Appends multiple decisions to a repository state. Validates each decision and
 * rejects invalid ones (`invalid-decision`) and duplicate `decisionId`s
 * (`duplicate-decision-id`) — duplicates are detected against both the existing
 * state AND decisions accepted earlier in the same batch. Returns a new state
 * (prior decisions plus accepted ones, in order); never mutates the input state or
 * decisions. `ok` is true only when every decision was accepted.
 */
export function appendRosterImportIdentityReviewDecisions(
  state: RosterImportIdentityReviewDecisionRepositoryState,
  decisions: readonly RosterImportIdentityReviewDecision[]
): RosterImportIdentityReviewDecisionRepositoryResult {
  const existingIds = new Set(state.decisions.map((d) => d.decisionId));
  const acceptedIds = new Set<string>();
  const accepted: RosterImportIdentityReviewDecision[] = [];
  const rejected: RejectedRosterImportIdentityReviewDecision[] = [];

  for (const decision of decisions) {
    // Defensive: import paths may pass malformed entries.
    if (!isPlainObject(decision)) {
      rejected.push({
        decision: null,
        reason: 'invalid-decision',
        validationErrors: [],
      });
      continue;
    }

    const validation = validateRosterImportIdentityReviewDecision(decision);
    if (!validation.valid) {
      rejected.push({
        decision,
        reason: 'invalid-decision',
        validationErrors: validation.errors,
      });
      continue;
    }

    const id = decision.decisionId;
    if (existingIds.has(id) || acceptedIds.has(id)) {
      rejected.push({ decision, reason: 'duplicate-decision-id' });
      continue;
    }

    acceptedIds.add(id);
    accepted.push(decision);
  }

  const newState: RosterImportIdentityReviewDecisionRepositoryState = {
    version: state.version,
    decisions: [...state.decisions, ...accepted],
  };

  return {
    ok: rejected.length === 0,
    state: newState,
    accepted,
    rejected,
    messages: [`${accepted.length} accepted, ${rejected.length} rejected.`],
  };
}

/**
 * Appends a single decision. Thin wrapper over
 * {@link appendRosterImportIdentityReviewDecisions}.
 */
export function appendRosterImportIdentityReviewDecision(
  state: RosterImportIdentityReviewDecisionRepositoryState,
  decision: RosterImportIdentityReviewDecision
): RosterImportIdentityReviewDecisionRepositoryResult {
  return appendRosterImportIdentityReviewDecisions(state, [decision]);
}

/**
 * Returns all decisions in repository (append) order. Returns a fresh array so the
 * caller cannot reorder or splice the internal list; the decision objects
 * themselves are shared by reference and must be treated as read-only.
 */
export function getRosterImportIdentityReviewDecisions(
  state: RosterImportIdentityReviewDecisionRepositoryState
): RosterImportIdentityReviewDecision[] {
  return [...state.decisions];
}

/**
 * Returns the ACTIVE decisions — those not superseded by another decision in the
 * repository. A decision A is superseded when some decision B has
 * `audit.supersedesDecisionId === A.decisionId`. Superseded decisions are NOT
 * removed from history (see {@link getRosterImportIdentityReviewDecisions}); they
 * are only excluded here. Append order is preserved.
 */
export function getActiveRosterImportIdentityReviewDecisions(
  state: RosterImportIdentityReviewDecisionRepositoryState
): RosterImportIdentityReviewDecision[] {
  const supersededIds = new Set<string>();
  for (const decision of state.decisions) {
    if (isNonEmptyString(decision.audit?.supersedesDecisionId)) {
      supersededIds.add(decision.audit.supersedesDecisionId);
    }
  }
  return state.decisions.filter((d) => !supersededIds.has(d.decisionId));
}

/**
 * Exports the repository as a plain, JSON-compatible payload: the version and the
 * decisions in order. Contains no functions. The returned `decisions` array is a
 * fresh array (decision objects are shared by reference and must not be mutated).
 */
export function exportRosterImportIdentityReviewDecisionRepository(
  state: RosterImportIdentityReviewDecisionRepositoryState
): RosterImportIdentityReviewDecisionRepositoryPayload {
  return {
    version: state.version,
    decisions: [...state.decisions],
  };
}

/**
 * Imports a repository payload into a fresh state. Validates the envelope (object
 * shape, supported version, present decisions array) and then validates every
 * decision via {@link appendRosterImportIdentityReviewDecisions}, accepting valid
 * non-duplicate decisions and rejecting invalid / duplicate ones (partial import,
 * clearly reported). Envelope-level failures return `ok: false` with an empty state
 * and an explaining rejection. Never mutates the payload or any roster data.
 */
export function importRosterImportIdentityReviewDecisionRepository(
  payload: unknown
): RosterImportIdentityReviewDecisionRepositoryResult {
  const envelopeError = (
    reason: RosterImportIdentityReviewDecisionRepositoryRejectionReason,
    message: string
  ): RosterImportIdentityReviewDecisionRepositoryResult => ({
    ok: false,
    state: createEmptyRosterImportIdentityReviewDecisionRepositoryState(),
    accepted: [],
    rejected: [{ decision: null, reason }],
    messages: [message],
  });

  if (!isPlainObject(payload)) {
    return envelopeError(
      'invalid-repository-payload',
      'Repository payload must be a JSON object.'
    );
  }
  if (
    payload.version !==
    ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION
  ) {
    return envelopeError(
      'unsupported-repository-version',
      `Unsupported repository version: ${String(payload.version)}.`
    );
  }
  if (!Array.isArray(payload.decisions)) {
    return envelopeError(
      'missing-decision-list',
      'Repository payload is missing a decisions array.'
    );
  }

  return appendRosterImportIdentityReviewDecisions(
    createEmptyRosterImportIdentityReviewDecisionRepositoryState(),
    payload.decisions as RosterImportIdentityReviewDecision[]
  );
}
