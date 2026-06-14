import type {
  RosterImportPreviewIdentityMatchEntry,
  RosterImportPreviewIdentityMatchStatus,
} from './rosterImportPreviewIdentityMatch';

/**
 * Phase 5 slice 3: import identity review DECISION CONTRACT — ENGINE ONLY.
 *
 * Slice 2 (`createRosterImportPreviewIdentityMatches`) produced, per import preview
 * row, the existing roster records it might correspond to (a
 * `RosterImportPreviewIdentityMatchEntry`). This slice defines what a reviewer may
 * DO with one of those entries and how that choice is captured as an append-only
 * DECISION record. It mirrors the Phase 4 sequencing (action -> decision; a
 * repository comes later, not here).
 *
 * This is DECISION CAPTURE ONLY. It is NOT collision resolution, NOT import
 * apply/commit, NOT a repository, NOT persistence, NOT file parsing, NOT UI, and
 * NOT roster mutation. A decision is a future-facing instruction for a later apply
 * step; nothing here links, creates, rejects, or writes any roster record.
 *
 * Roster authority rule (carried forward, see `docs/derived-logic.md`
 * "## Roster authority"): loaded roster records are authoritative. A review decision
 * may affect future derived import-application behavior only. It NEVER alters,
 * removes, suppresses, merges, nullifies, rewrites, reorders, or ignores rostered
 * names, existing records, or preview rows.
 *
 * Chosen action contract (documented and tested):
 *   - `no-match`            -> create-new | manual-link | defer
 *   - `single-candidate`    -> accept-candidate | reject-candidates | manual-link | create-new | defer
 *   - `multiple-candidates` -> accept-candidate | reject-candidates | manual-link | create-new | defer
 *   - `skipped-invalid-preview-row`  -> defer only
 *   - `skipped-review-preview-row`   -> defer only
 *   - `accept-candidate` requires a `selectedExistingRecordId` that exists among the
 *     entry's candidates. `manual-link` requires a `manualExistingRecordId`.
 *   - A stable `previewSourceRowId` is required for any action (a row with no stable
 *     id cannot carry a decision). `reject-candidates` rejects the proposed
 *     interpretation for now — it never deletes the import row or any roster record.
 *     `create-new` is only a FUTURE apply instruction; no roster entry is created.
 *
 * Purity: ids and timestamps are CALLER-PROVIDED (the module never generates ids,
 * never calls `Date.now()`, and never infers user identity). Inputs (entry, action,
 * candidates) are never mutated. Output is JSON-compatible and deterministic.
 */

/** Bump when the decision derivation or contract shape changes. */
export const ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_LOGIC_VERSION =
  'phase5-slice3-import-identity-review-decision-v1';

export type RosterImportIdentityReviewActionType =
  | 'accept-candidate'
  | 'reject-candidates'
  | 'manual-link'
  | 'create-new'
  | 'defer';

export type RosterImportIdentityReviewActionEffect =
  | 'link-to-existing'
  | 'create-new-roster-entry'
  | 'reject-import-row'
  | 'defer-review'
  | 'no-effect';

export type RosterImportIdentityReviewActionReason =
  | 'accept-candidate-confirmed'
  | 'reject-candidates-recorded'
  | 'manual-link-recorded'
  | 'create-new-recorded'
  | 'review-deferred'
  | 'missing-preview-row-key'
  | 'missing-selected-existing-record-id'
  | 'selected-candidate-not-found'
  | 'missing-manual-existing-record-id'
  | 'action-not-allowed-for-entry-status'
  | 'invalid-action';

export type RosterImportIdentityReviewAction = {
  action: RosterImportIdentityReviewActionType;
  previewSourceRowId?: string | null;
  previewRowIndex?: number;
  selectedExistingRecordId?: string;
  manualExistingRecordId?: string;
  note?: string;
};

/**
 * The explicit outcome of validating one requested action against one slice 2
 * match entry. `accepted` is whether the action is allowed; `effect` is the
 * future-apply instruction it would carry (always `no-effect` when rejected).
 * Preview keys come from the ENTRY (authoritative), not the action.
 */
export type RosterImportIdentityReviewActionResult = {
  previewSourceRowId: string | null;
  previewRowIndex: number;
  entryStatus: RosterImportPreviewIdentityMatchStatus;
  requestedAction: RosterImportIdentityReviewActionType;
  accepted: boolean;
  effect: RosterImportIdentityReviewActionEffect;
  selectedExistingRecordId: string | null;
  manualExistingRecordId: string | null;
  reasonCodes: RosterImportIdentityReviewActionReason[];
  note?: string;
};

export type RosterImportIdentityReviewDecisionAudit = {
  logicVersion: string;
  sourceEntryStatus: RosterImportPreviewIdentityMatchStatus;
  supersedesDecisionId?: string;
};

/**
 * A persistable, append-only import identity review decision. It is a SEPARATE
 * record from any roster row or preview row — it captures a reviewer's choice and
 * the future-apply instruction it implies, and never rewrites source data.
 */
export type RosterImportIdentityReviewDecision = {
  decisionId: string;
  previewSourceRowId: string;
  previewRowIndex: number;
  action: RosterImportIdentityReviewActionType;
  effect: RosterImportIdentityReviewActionEffect;
  selectedExistingRecordId: string | null;
  manualExistingRecordId: string | null;
  reasonCodes: RosterImportIdentityReviewActionReason[];
  createdAt: string;
  reviewedAt: string;
  reviewedBy?: string;
  note?: string;
  audit: RosterImportIdentityReviewDecisionAudit;
};

export type CreateRosterImportIdentityReviewDecisionOptions = {
  decisionId: string;
  createdAt: string;
  reviewedAt: string;
  reviewedBy?: string;
  supersedesDecisionId?: string;
};

export type CreateRosterImportIdentityReviewDecisionReason =
  | 'created'
  | 'rejected-action-cannot-create-decision'
  | 'missing-preview-row-key'
  | 'missing-decision-id'
  | 'missing-created-at'
  | 'missing-reviewed-at';

export type CreateRosterImportIdentityReviewDecisionResult = {
  created: boolean;
  decision: RosterImportIdentityReviewDecision | null;
  reason: CreateRosterImportIdentityReviewDecisionReason;
  messages: string[];
};

export type RosterImportIdentityReviewDecisionValidationError =
  | 'missing-decision-id'
  | 'missing-preview-row-key'
  | 'invalid-preview-row-index'
  | 'invalid-action'
  | 'invalid-effect'
  | 'incoherent-action-and-effect'
  | 'link-effect-missing-target'
  | 'missing-created-at'
  | 'missing-reviewed-at';

export type ValidateRosterImportIdentityReviewDecisionResult = {
  valid: boolean;
  errors: RosterImportIdentityReviewDecisionValidationError[];
};

export type RosterImportIdentityReviewDecisionSummary = {
  total: number;
  byAction: {
    acceptCandidate: number;
    rejectCandidates: number;
    manualLink: number;
    createNew: number;
    defer: number;
  };
  byEffect: {
    linkToExisting: number;
    createNewRosterEntry: number;
    rejectImportRow: number;
    deferReview: number;
    noEffect: number;
  };
  superseding: number;
  withNote: number;
  invalid: number;
};

const VALID_ACTIONS: ReadonlySet<string> = new Set([
  'accept-candidate',
  'reject-candidates',
  'manual-link',
  'create-new',
  'defer',
]);

const VALID_EFFECTS: ReadonlySet<string> = new Set([
  'link-to-existing',
  'create-new-roster-entry',
  'reject-import-row',
  'defer-review',
  'no-effect',
]);

/** Which actions a reviewer may take for each entry status. */
const ALLOWED_ACTIONS: Record<
  RosterImportPreviewIdentityMatchStatus,
  ReadonlySet<RosterImportIdentityReviewActionType>
> = {
  'no-match': new Set(['create-new', 'manual-link', 'defer']),
  'single-candidate': new Set([
    'accept-candidate',
    'reject-candidates',
    'manual-link',
    'create-new',
    'defer',
  ]),
  'multiple-candidates': new Set([
    'accept-candidate',
    'reject-candidates',
    'manual-link',
    'create-new',
    'defer',
  ]),
  'skipped-invalid-preview-row': new Set(['defer']),
  'skipped-review-preview-row': new Set(['defer']),
};

/** The single coherent future-apply effect for each accepted action. */
const EFFECT_BY_ACTION: Record<
  RosterImportIdentityReviewActionType,
  RosterImportIdentityReviewActionEffect
> = {
  'accept-candidate': 'link-to-existing',
  'manual-link': 'link-to-existing',
  'reject-candidates': 'reject-import-row',
  'create-new': 'create-new-roster-entry',
  defer: 'defer-review',
};

const ACCEPT_REASON_BY_ACTION: Record<
  RosterImportIdentityReviewActionType,
  RosterImportIdentityReviewActionReason
> = {
  'accept-candidate': 'accept-candidate-confirmed',
  'manual-link': 'manual-link-recorded',
  'reject-candidates': 'reject-candidates-recorded',
  'create-new': 'create-new-recorded',
  defer: 'review-deferred',
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function presentOrNull(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

/**
 * Validates a requested review action against one slice 2 match entry and returns
 * the verdict. Pure: reads only the entry's status and candidates and the action's
 * fields; never mutates anything.
 *
 * Precedence (each returns `accepted: false`, `effect: no-effect`):
 *   1. Unknown action type                          -> invalid-action.
 *   2. Entry has no stable previewSourceRowId        -> missing-preview-row-key.
 *   3. Action not allowed for the entry status       -> action-not-allowed-for-entry-status.
 *   4. accept-candidate without a selected id        -> missing-selected-existing-record-id.
 *   5. accept-candidate selected id not a candidate  -> selected-candidate-not-found.
 *   6. manual-link without a manual id               -> missing-manual-existing-record-id.
 */
export function applyRosterImportIdentityReviewAction(
  entry: RosterImportPreviewIdentityMatchEntry,
  action: RosterImportIdentityReviewAction
): RosterImportIdentityReviewActionResult {
  const previewSourceRowId = entry.previewSourceRowId;
  const previewRowIndex = entry.previewRowIndex;
  const selectedExistingRecordId = presentOrNull(action.selectedExistingRecordId);
  const manualExistingRecordId = presentOrNull(action.manualExistingRecordId);
  const note = presentOrNull(action.note);

  const base = {
    previewSourceRowId,
    previewRowIndex,
    entryStatus: entry.status,
    requestedAction: action.action,
    selectedExistingRecordId,
    manualExistingRecordId,
  };

  const reject = (
    reason: RosterImportIdentityReviewActionReason
  ): RosterImportIdentityReviewActionResult => ({
    ...base,
    accepted: false,
    effect: 'no-effect',
    reasonCodes: [reason],
    ...(note !== null ? { note } : {}),
  });

  // 1. Unknown action type.
  if (!VALID_ACTIONS.has(action.action)) {
    return reject('invalid-action');
  }

  // 2. A decision needs a stable preview row key.
  if (!isNonEmptyString(previewSourceRowId)) {
    return reject('missing-preview-row-key');
  }

  // 3. Action must be allowed for this entry status.
  const allowed = ALLOWED_ACTIONS[entry.status];
  if (!allowed || !allowed.has(action.action)) {
    return reject('action-not-allowed-for-entry-status');
  }

  // 4/5. accept-candidate needs a selected id that is one of the entry's candidates.
  if (action.action === 'accept-candidate') {
    if (selectedExistingRecordId === null) {
      return reject('missing-selected-existing-record-id');
    }
    const found = entry.candidates.some(
      (candidate) => candidate.existingRecordId === selectedExistingRecordId
    );
    if (!found) {
      return reject('selected-candidate-not-found');
    }
  }

  // 6. manual-link needs an explicit existing record id.
  if (action.action === 'manual-link' && manualExistingRecordId === null) {
    return reject('missing-manual-existing-record-id');
  }

  return {
    ...base,
    accepted: true,
    effect: EFFECT_BY_ACTION[action.action],
    reasonCodes: [ACCEPT_REASON_BY_ACTION[action.action]],
    ...(note !== null ? { note } : {}),
  };
}

/**
 * Builds an append-only decision from an ACCEPTED action result plus caller-provided
 * deterministic ids/timestamps. Pure: never generates ids, never reads the clock,
 * never infers identity, and returns a result object instead of throwing.
 *
 * Validation precedence (each returns `created: false`):
 *   1. Action result not accepted -> rejected-action-cannot-create-decision.
 *   2. No stable preview row key  -> missing-preview-row-key.
 *   3. Missing decisionId         -> missing-decision-id.
 *   4. Missing createdAt          -> missing-created-at.
 *   5. Missing reviewedAt         -> missing-reviewed-at.
 */
export function createRosterImportIdentityReviewDecision(
  actionResult: RosterImportIdentityReviewActionResult,
  options: CreateRosterImportIdentityReviewDecisionOptions
): CreateRosterImportIdentityReviewDecisionResult {
  const skip = (
    reason: CreateRosterImportIdentityReviewDecisionReason,
    message: string
  ): CreateRosterImportIdentityReviewDecisionResult => ({
    created: false,
    decision: null,
    reason,
    messages: [message],
  });

  if (!actionResult.accepted) {
    return skip(
      'rejected-action-cannot-create-decision',
      'Only accepted review action results can become decisions.'
    );
  }
  if (!isNonEmptyString(actionResult.previewSourceRowId)) {
    return skip(
      'missing-preview-row-key',
      'A decision requires a stable previewSourceRowId.'
    );
  }
  if (!isNonEmptyString(options.decisionId)) {
    return skip(
      'missing-decision-id',
      'A caller-provided decisionId is required (this helper never generates ids).'
    );
  }
  if (!isNonEmptyString(options.createdAt)) {
    return skip(
      'missing-created-at',
      'A caller-provided createdAt is required (this helper never calls Date.now()).'
    );
  }
  if (!isNonEmptyString(options.reviewedAt)) {
    return skip(
      'missing-reviewed-at',
      'A caller-provided reviewedAt is required (this helper never calls Date.now()).'
    );
  }

  const decision: RosterImportIdentityReviewDecision = {
    decisionId: options.decisionId,
    previewSourceRowId: actionResult.previewSourceRowId,
    previewRowIndex: actionResult.previewRowIndex,
    action: actionResult.requestedAction,
    effect: actionResult.effect,
    selectedExistingRecordId: actionResult.selectedExistingRecordId,
    manualExistingRecordId: actionResult.manualExistingRecordId,
    reasonCodes: [...actionResult.reasonCodes],
    createdAt: options.createdAt,
    reviewedAt: options.reviewedAt,
    audit: {
      logicVersion: ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_LOGIC_VERSION,
      sourceEntryStatus: actionResult.entryStatus,
    },
  };

  if (isNonEmptyString(actionResult.note)) {
    decision.note = actionResult.note;
  }
  if (isNonEmptyString(options.reviewedBy)) {
    decision.reviewedBy = options.reviewedBy;
  }
  if (isNonEmptyString(options.supersedesDecisionId)) {
    decision.audit.supersedesDecisionId = options.supersedesDecisionId;
  }

  return { created: true, decision, reason: 'created', messages: [] };
}

/**
 * Validates a persisted (or candidate) decision against the contract. Pure: reads
 * only the decision and returns a structured result; never throws or mutates.
 */
export function validateRosterImportIdentityReviewDecision(
  decision: RosterImportIdentityReviewDecision
): ValidateRosterImportIdentityReviewDecisionResult {
  const errors: RosterImportIdentityReviewDecisionValidationError[] = [];

  if (!isNonEmptyString(decision.decisionId)) {
    errors.push('missing-decision-id');
  }
  if (!isNonEmptyString(decision.previewSourceRowId)) {
    errors.push('missing-preview-row-key');
  }
  if (
    typeof decision.previewRowIndex !== 'number' ||
    !Number.isInteger(decision.previewRowIndex) ||
    decision.previewRowIndex < 0
  ) {
    errors.push('invalid-preview-row-index');
  }

  const validAction = VALID_ACTIONS.has(decision.action);
  const validEffect = VALID_EFFECTS.has(decision.effect);
  if (!validAction) {
    errors.push('invalid-action');
  }
  if (!validEffect) {
    errors.push('invalid-effect');
  }
  if (
    validAction &&
    validEffect &&
    EFFECT_BY_ACTION[decision.action] !== decision.effect
  ) {
    errors.push('incoherent-action-and-effect');
  }

  if (
    decision.effect === 'link-to-existing' &&
    !isNonEmptyString(decision.selectedExistingRecordId) &&
    !isNonEmptyString(decision.manualExistingRecordId)
  ) {
    errors.push('link-effect-missing-target');
  }

  if (!isNonEmptyString(decision.createdAt)) {
    errors.push('missing-created-at');
  }
  if (!isNonEmptyString(decision.reviewedAt)) {
    errors.push('missing-reviewed-at');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Counts decisions by action, effect, supersession, note presence, and validity.
 * Pure and deterministic; validity is computed via
 * {@link validateRosterImportIdentityReviewDecision} and never mutates inputs.
 */
export function summarizeRosterImportIdentityReviewDecisions(
  decisions: RosterImportIdentityReviewDecision[]
): RosterImportIdentityReviewDecisionSummary {
  const summary: RosterImportIdentityReviewDecisionSummary = {
    total: decisions.length,
    byAction: {
      acceptCandidate: 0,
      rejectCandidates: 0,
      manualLink: 0,
      createNew: 0,
      defer: 0,
    },
    byEffect: {
      linkToExisting: 0,
      createNewRosterEntry: 0,
      rejectImportRow: 0,
      deferReview: 0,
      noEffect: 0,
    },
    superseding: 0,
    withNote: 0,
    invalid: 0,
  };

  for (const decision of decisions) {
    switch (decision.action) {
      case 'accept-candidate':
        summary.byAction.acceptCandidate += 1;
        break;
      case 'reject-candidates':
        summary.byAction.rejectCandidates += 1;
        break;
      case 'manual-link':
        summary.byAction.manualLink += 1;
        break;
      case 'create-new':
        summary.byAction.createNew += 1;
        break;
      case 'defer':
        summary.byAction.defer += 1;
        break;
    }

    switch (decision.effect) {
      case 'link-to-existing':
        summary.byEffect.linkToExisting += 1;
        break;
      case 'create-new-roster-entry':
        summary.byEffect.createNewRosterEntry += 1;
        break;
      case 'reject-import-row':
        summary.byEffect.rejectImportRow += 1;
        break;
      case 'defer-review':
        summary.byEffect.deferReview += 1;
        break;
      case 'no-effect':
        summary.byEffect.noEffect += 1;
        break;
    }

    if (isNonEmptyString(decision.audit?.supersedesDecisionId)) {
      summary.superseding += 1;
    }
    if (isNonEmptyString(decision.note)) {
      summary.withNote += 1;
    }
    if (!validateRosterImportIdentityReviewDecision(decision).valid) {
      summary.invalid += 1;
    }
  }

  return summary;
}
