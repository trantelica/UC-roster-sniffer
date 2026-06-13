import type {
  CohortReviewDecision,
  CohortReviewDecisionValidationError,
} from './cohortReviewDecision';
import { validateCohortReviewDecision } from './cohortReviewDecision';

/**
 * Phase 4 slice 9: local cohort review decision REPOSITORY — STORAGE BOUNDARY ONLY.
 *
 * Slice 7 defined the append-only `CohortReviewDecision` contract and slice 8
 * applied decisions to derived assignments in memory. This slice adds the narrow
 * repository / storage-boundary layer: how decisions are appended, loaded,
 * validated, and exported / imported at the local data boundary.
 *
 * The app has no browser-storage persistence layer yet (only static JSON sample
 * loading via `src/data/loadSampleData.ts`). So this is an IN-MEMORY repository
 * adapter plus a documented, JSON-compatible export/import contract — NOT a real
 * storage implementation. It does NOT write to localStorage / IndexedDB / files /
 * sample data / app state.
 *
 * Invariants:
 *   - Append-only: accepted decisions are added to the end; superseded decisions
 *     are NEVER removed (they are excluded from the ACTIVE view only).
 *   - Pure and deterministic: every operation returns a NEW state object and never
 *     mutates the input state, the input decisions, or any roster / assignment /
 *     first-year / player / team object.
 *   - Validation gate: only decisions that pass `validateCohortReviewDecision` are
 *     accepted; duplicates (by `decisionId`) are rejected, never overwritten.
 *
 * Decision objects are stored and returned BY REFERENCE (not cloned). The
 * repository never mutates them, so this is safe by convention; callers must treat
 * returned decisions as read-only.
 */

export const COHORT_REVIEW_DECISION_REPOSITORY_VERSION =
  'cohort-review-decisions.v1';

export type CohortReviewDecisionRepositoryState = {
  version: string;
  decisions: CohortReviewDecision[];
};

export type CohortReviewDecisionRejectionReason =
  | 'invalid-decision'
  | 'duplicate-decision-id'
  | 'unsupported-repository-version'
  | 'invalid-repository-payload'
  | 'missing-decision-list';

export type RejectedCohortReviewDecision = {
  decision: CohortReviewDecision | null;
  reason: CohortReviewDecisionRejectionReason;
  validationErrors?: CohortReviewDecisionValidationError[];
};

/**
 * The outcome of an append or import. `state` is always a usable repository state
 * (the prior state plus any accepted decisions; an empty state for envelope-level
 * import errors). `ok` is true only when nothing was rejected.
 */
export type CohortReviewDecisionAppendResult = {
  ok: boolean;
  state: CohortReviewDecisionRepositoryState;
  accepted: CohortReviewDecision[];
  rejected: RejectedCohortReviewDecision[];
  messages: string[];
};

/** A plain, JSON-compatible export of the repository. Contains no functions. */
export type CohortReviewDecisionRepositoryPayload = {
  version: string;
  decisions: CohortReviewDecision[];
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
export function createEmptyCohortReviewDecisionRepositoryState(): CohortReviewDecisionRepositoryState {
  return {
    version: COHORT_REVIEW_DECISION_REPOSITORY_VERSION,
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
export function appendCohortReviewDecisions(
  state: CohortReviewDecisionRepositoryState,
  decisions: readonly CohortReviewDecision[]
): CohortReviewDecisionAppendResult {
  const existingIds = new Set(state.decisions.map((d) => d.decisionId));
  const acceptedIds = new Set<string>();
  const accepted: CohortReviewDecision[] = [];
  const rejected: RejectedCohortReviewDecision[] = [];

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

    const validation = validateCohortReviewDecision(decision);
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

  const newState: CohortReviewDecisionRepositoryState = {
    version: state.version,
    decisions: [...state.decisions, ...accepted],
  };

  return {
    ok: rejected.length === 0,
    state: newState,
    accepted,
    rejected,
    messages: [
      `${accepted.length} accepted, ${rejected.length} rejected.`,
    ],
  };
}

/**
 * Appends a single decision. Thin wrapper over {@link appendCohortReviewDecisions}.
 */
export function appendCohortReviewDecision(
  state: CohortReviewDecisionRepositoryState,
  decision: CohortReviewDecision
): CohortReviewDecisionAppendResult {
  return appendCohortReviewDecisions(state, [decision]);
}

/**
 * Returns all decisions in repository (append) order. Returns a fresh array so the
 * caller cannot reorder or splice the internal list; the decision objects
 * themselves are shared by reference and must be treated as read-only.
 */
export function getCohortReviewDecisions(
  state: CohortReviewDecisionRepositoryState
): CohortReviewDecision[] {
  return [...state.decisions];
}

/**
 * Returns the ACTIVE decisions — those not superseded by another decision in the
 * repository. A decision A is superseded when some decision B has
 * `audit.supersedesDecisionId === A.decisionId`. Superseded decisions are NOT
 * removed from history (see {@link getCohortReviewDecisions}); they are only
 * excluded here. Append order is preserved.
 */
export function getActiveCohortReviewDecisions(
  state: CohortReviewDecisionRepositoryState
): CohortReviewDecision[] {
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
export function exportCohortReviewDecisionRepository(
  state: CohortReviewDecisionRepositoryState
): CohortReviewDecisionRepositoryPayload {
  return {
    version: state.version,
    decisions: [...state.decisions],
  };
}

/**
 * Imports a repository payload into a fresh state. Validates the envelope (object
 * shape, supported version, present decisions array) and then validates every
 * decision via {@link appendCohortReviewDecisions}, accepting valid non-duplicate
 * decisions and rejecting invalid / duplicate ones (partial import, clearly
 * reported). Envelope-level failures return `ok: false` with an empty state and an
 * explaining rejection. Never mutates the payload or any roster data.
 */
export function importCohortReviewDecisionRepository(
  payload: unknown
): CohortReviewDecisionAppendResult {
  const envelopeError = (
    reason: CohortReviewDecisionRejectionReason,
    message: string
  ): CohortReviewDecisionAppendResult => ({
    ok: false,
    state: createEmptyCohortReviewDecisionRepositoryState(),
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
  if (payload.version !== COHORT_REVIEW_DECISION_REPOSITORY_VERSION) {
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

  return appendCohortReviewDecisions(
    createEmptyCohortReviewDecisionRepositoryState(),
    payload.decisions as CohortReviewDecision[]
  );
}
