import type {
  RosterImportPreviewIdentityMatchEntry,
  RosterImportPreviewIdentityMatchStatus,
} from './rosterImportPreviewIdentityMatch';
import type {
  RosterImportIdentityReviewDecision,
  RosterImportIdentityReviewActionType,
  RosterImportIdentityReviewDecisionValidationError,
} from './rosterImportIdentityReviewDecision';
import { validateRosterImportIdentityReviewDecision } from './rosterImportIdentityReviewDecision';

/**
 * Phase 5 slice 5: import identity review decision APPLICATION — ENGINE ONLY.
 *
 * Slice 2 derived, per import preview row, the existing records it might match (a
 * `RosterImportPreviewIdentityMatchEntry`). Slice 3 captured a reviewer's choice as
 * an append-only `RosterImportIdentityReviewDecision`. Slice 4 stored those
 * decisions in a repository. This slice resolves the two: given match entries and
 * a list of (active) review decisions, it computes the EFFECTIVE import outcome per
 * row, deterministically and in memory.
 *
 * This is EFFECTIVE-STATE COMPUTATION ONLY. It is NOT import apply/commit, NOT
 * roster mutation, NOT creating/linking roster records, NOT deleting/rejecting rows
 * from storage, NOT persistence, NOT file parsing, and NOT UI. A
 * link/create/reject/defer outcome is a FUTURE-apply instruction, never an
 * immediate write. It never compares against prior seasons or derives roster
 * movement.
 *
 * Roster authority rule (carried forward): loaded roster records are authoritative.
 * This helper never alters, removes, suppresses, merges, nullifies, rewrites,
 * reorders, or ignores rostered names, existing records, preview rows, or
 * candidates. Source entries and decisions are preserved by reference; effective
 * metadata is fresh.
 *
 * Decision handling:
 *   - Decisions match an entry on `previewSourceRowId` + `previewRowIndex`.
 *   - Invalid decisions (per `validateRosterImportIdentityReviewDecision`) are
 *     ignored; a decision with no stable preview row key is ignored.
 *   - Append-only supersession: any decision referenced by another decision's
 *     `audit.supersedesDecisionId` is ignored.
 *   - If two or more valid, non-superseded decisions match the same (matchable)
 *     entry, NONE is applied — the entry is a `conflict` and every such decision is
 *     ignored with `duplicate-current-decision`. Array order never picks a winner.
 *   - A matched decision is applied only when its action is allowed for the entry's
 *     CURRENT status; otherwise it is ignored with `decision-entry-status-mismatch`.
 *     An `accept-candidate` decision whose `selectedExistingRecordId` is no longer
 *     among the entry's candidates is ignored with `selected-candidate-not-found`.
 *   - Skipped entries (`skipped-invalid-preview-row` / `skipped-review-preview-row`)
 *     accept NO decisions at this layer; they always resolve to their skip outcome
 *     and any matching decision is ignored with `decision-entry-status-mismatch`.
 *   - With no applicable decision, a matchable entry is `unresolved`. A
 *     high-confidence single candidate is NEVER auto-linked.
 *   - Decisions matching no entry are ignored with `no-matching-entry`.
 */

export type RosterImportIdentityReviewEffectiveOutcome =
  | 'unresolved'
  | 'link-to-existing'
  | 'create-new'
  | 'rejected'
  | 'deferred'
  | 'skipped-invalid-preview-row'
  | 'skipped-review-preview-row'
  | 'conflict';

export type RosterImportIdentityReviewEffectiveConfidence =
  | 'high'
  | 'medium'
  | 'low'
  | 'none';

export type RosterImportIdentityReviewApplicationReason =
  | 'no-decision-unresolved'
  | 'accept-candidate-applied'
  | 'manual-link-applied'
  | 'reject-candidates-applied'
  | 'create-new-applied'
  | 'deferred-applied'
  | 'skipped-invalid-preview-row'
  | 'skipped-review-preview-row'
  | 'duplicate-current-decision';

export type RosterImportIdentityReviewIgnoredDecisionReason =
  | 'invalid-decision'
  | 'superseded-decision'
  | 'missing-preview-row-key'
  | 'no-matching-entry'
  | 'duplicate-current-decision'
  | 'decision-entry-status-mismatch'
  | 'selected-candidate-not-found';

export type RosterImportIdentityReviewApplicationIssue = {
  code: RosterImportIdentityReviewApplicationReason;
  severity: 'info' | 'warning' | 'error';
  message: string;
};

export type AppliedRosterImportIdentityReviewDecisionEntry = {
  previewSourceRowId: string | null;
  previewRowIndex: number;
  previewPlayerName: string | null;
  sourceEntryStatus: RosterImportPreviewIdentityMatchStatus;
  effectiveOutcome: RosterImportIdentityReviewEffectiveOutcome;
  effectiveConfidence: RosterImportIdentityReviewEffectiveConfidence;
  appliedDecisionId: string | null;
  selectedExistingRecordId: string | null;
  manualExistingRecordId: string | null;
  reasons: RosterImportIdentityReviewApplicationReason[];
  issues: RosterImportIdentityReviewApplicationIssue[];
  originalEntry: RosterImportPreviewIdentityMatchEntry;
};

export type IgnoredRosterImportIdentityReviewDecisionEntry = {
  decision: RosterImportIdentityReviewDecision;
  decisionId: string;
  reason: RosterImportIdentityReviewIgnoredDecisionReason;
  validationErrors?: RosterImportIdentityReviewDecisionValidationError[];
};

export type AppliedRosterImportIdentityReviewDecisionSummary = {
  totalEntries: number;
  unresolved: number;
  linkToExisting: number;
  createNew: number;
  rejected: number;
  deferred: number;
  conflict: number;
  skippedInvalid: number;
  skippedReview: number;
  decisionsApplied: number;
  ignoredDecisions: number;
  invalidDecisions: number;
  supersededDecisions: number;
  missingPreviewRowKey: number;
  noMatchingEntry: number;
  duplicateCurrentDecision: number;
  decisionEntryStatusMismatch: number;
  selectedCandidateNotFound: number;
  highConfidence: number;
  mediumConfidence: number;
  lowConfidence: number;
  noneConfidence: number;
};

export type AppliedRosterImportIdentityReviewDecisionResult = {
  entries: AppliedRosterImportIdentityReviewDecisionEntry[];
  ignoredDecisions: IgnoredRosterImportIdentityReviewDecisionEntry[];
  summary: AppliedRosterImportIdentityReviewDecisionSummary;
};

/** Actions allowed for an entry status at application time. Skipped rows accept none. */
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
  'skipped-invalid-preview-row': new Set([]),
  'skipped-review-preview-row': new Set([]),
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function isSkippedStatus(
  status: RosterImportPreviewIdentityMatchStatus
): boolean {
  return (
    status === 'skipped-invalid-preview-row' ||
    status === 'skipped-review-preview-row'
  );
}

/** Stable match key over previewSourceRowId + previewRowIndex, or null when unkeyed. */
function matchKey(
  previewSourceRowId: string | null | undefined,
  previewRowIndex: number
): string | null {
  if (!isNonEmptyString(previewSourceRowId)) return null;
  if (typeof previewRowIndex !== 'number') return null;
  return `${previewSourceRowId} ${previewRowIndex}`;
}

type AppliedVerdict = {
  effectiveOutcome: RosterImportIdentityReviewEffectiveOutcome;
  effectiveConfidence: RosterImportIdentityReviewEffectiveConfidence;
  reason: RosterImportIdentityReviewApplicationReason;
  selectedExistingRecordId: string | null;
  manualExistingRecordId: string | null;
};

/** Maps an applied decision to the effective outcome for its entry. */
function verdictForDecision(
  decision: RosterImportIdentityReviewDecision
): AppliedVerdict {
  switch (decision.action) {
    case 'accept-candidate':
      return {
        effectiveOutcome: 'link-to-existing',
        effectiveConfidence: 'high',
        reason: 'accept-candidate-applied',
        selectedExistingRecordId: decision.selectedExistingRecordId,
        manualExistingRecordId: null,
      };
    case 'manual-link':
      return {
        effectiveOutcome: 'link-to-existing',
        effectiveConfidence: 'high',
        reason: 'manual-link-applied',
        selectedExistingRecordId: null,
        manualExistingRecordId: decision.manualExistingRecordId,
      };
    case 'reject-candidates':
      return {
        effectiveOutcome: 'rejected',
        effectiveConfidence: 'high',
        reason: 'reject-candidates-applied',
        selectedExistingRecordId: null,
        manualExistingRecordId: null,
      };
    case 'create-new':
      return {
        effectiveOutcome: 'create-new',
        effectiveConfidence: 'high',
        reason: 'create-new-applied',
        selectedExistingRecordId: null,
        manualExistingRecordId: null,
      };
    case 'defer':
    default:
      return {
        effectiveOutcome: 'deferred',
        effectiveConfidence: 'low',
        reason: 'deferred-applied',
        selectedExistingRecordId: null,
        manualExistingRecordId: null,
      };
  }
}

/** The base outcome for an entry when no decision is applied. */
function baseVerdict(
  status: RosterImportPreviewIdentityMatchStatus
): {
  effectiveOutcome: RosterImportIdentityReviewEffectiveOutcome;
  effectiveConfidence: RosterImportIdentityReviewEffectiveConfidence;
  reason: RosterImportIdentityReviewApplicationReason;
} {
  if (status === 'skipped-invalid-preview-row') {
    return {
      effectiveOutcome: 'skipped-invalid-preview-row',
      effectiveConfidence: 'none',
      reason: 'skipped-invalid-preview-row',
    };
  }
  if (status === 'skipped-review-preview-row') {
    return {
      effectiveOutcome: 'skipped-review-preview-row',
      effectiveConfidence: 'none',
      reason: 'skipped-review-preview-row',
    };
  }
  return {
    effectiveOutcome: 'unresolved',
    effectiveConfidence: 'none',
    reason: 'no-decision-unresolved',
  };
}

/**
 * Applies active import identity review decisions to match entries, computing the
 * effective import outcome per entry in memory. Pure and deterministic: exactly one
 * entry per input entry (in input order), and ignored decisions are reported in
 * decision input order. Nothing is mutated and nothing is written.
 */
export function applyRosterImportIdentityReviewDecisionsToMatches(
  entries: RosterImportPreviewIdentityMatchEntry[],
  decisions: RosterImportIdentityReviewDecision[]
): AppliedRosterImportIdentityReviewDecisionResult {
  const entryList = Array.isArray(entries) ? entries : [];
  const decisionList = Array.isArray(decisions) ? decisions : [];

  // 1. Append-only supersession: collect every superseded decision id.
  const supersededIds = new Set<string>();
  for (const decision of decisionList) {
    if (isNonEmptyString(decision.audit?.supersedesDecisionId)) {
      supersededIds.add(decision.audit.supersedesDecisionId);
    }
  }

  // 2. Classify decisions; keep applicable ones (with input index for ordering).
  type Ignored = IgnoredRosterImportIdentityReviewDecisionEntry & {
    sourceIndex: number;
  };
  const ignored: Ignored[] = [];
  type Applicable = {
    decision: RosterImportIdentityReviewDecision;
    sourceIndex: number;
    key: string;
  };
  const applicable: Applicable[] = [];

  decisionList.forEach((decision, sourceIndex) => {
    const key = matchKey(decision?.previewSourceRowId, decision?.previewRowIndex);
    if (key === null) {
      ignored.push({
        decision,
        decisionId: decision?.decisionId,
        reason: 'missing-preview-row-key',
        sourceIndex,
      });
      return;
    }
    const validation = validateRosterImportIdentityReviewDecision(decision);
    if (!validation.valid) {
      ignored.push({
        decision,
        decisionId: decision.decisionId,
        reason: 'invalid-decision',
        validationErrors: validation.errors,
        sourceIndex,
      });
      return;
    }
    if (supersededIds.has(decision.decisionId)) {
      ignored.push({
        decision,
        decisionId: decision.decisionId,
        reason: 'superseded-decision',
        sourceIndex,
      });
      return;
    }
    applicable.push({ decision, sourceIndex, key });
  });

  // 3. Group applicable decisions by match key.
  const byKey = new Map<string, Applicable[]>();
  for (const item of applicable) {
    if (!byKey.has(item.key)) byKey.set(item.key, []);
    byKey.get(item.key)!.push(item);
  }
  const entryKeys = new Set<string>();

  // 4. Resolve each entry (in input order).
  const resultEntries: AppliedRosterImportIdentityReviewDecisionEntry[] = [];

  for (const entry of entryList) {
    const key = matchKey(entry.previewSourceRowId, entry.previewRowIndex);
    if (key !== null) entryKeys.add(key);
    const matches = key !== null ? byKey.get(key) ?? [] : [];
    const base = baseVerdict(entry.status);

    const makeEntry = (
      verdict: {
        effectiveOutcome: RosterImportIdentityReviewEffectiveOutcome;
        effectiveConfidence: RosterImportIdentityReviewEffectiveConfidence;
        reason: RosterImportIdentityReviewApplicationReason;
        selectedExistingRecordId?: string | null;
        manualExistingRecordId?: string | null;
        appliedDecisionId?: string | null;
      },
      issues: RosterImportIdentityReviewApplicationIssue[] = []
    ): AppliedRosterImportIdentityReviewDecisionEntry => ({
      previewSourceRowId: entry.previewSourceRowId,
      previewRowIndex: entry.previewRowIndex,
      previewPlayerName: entry.previewPlayerName,
      sourceEntryStatus: entry.status,
      effectiveOutcome: verdict.effectiveOutcome,
      effectiveConfidence: verdict.effectiveConfidence,
      appliedDecisionId: verdict.appliedDecisionId ?? null,
      selectedExistingRecordId: verdict.selectedExistingRecordId ?? null,
      manualExistingRecordId: verdict.manualExistingRecordId ?? null,
      reasons: [verdict.reason],
      issues,
      originalEntry: entry,
    });

    // Skipped rows accept no decisions; they always resolve to their skip outcome.
    if (isSkippedStatus(entry.status)) {
      for (const m of matches) {
        ignored.push({
          decision: m.decision,
          decisionId: m.decision.decisionId,
          reason: 'decision-entry-status-mismatch',
          sourceIndex: m.sourceIndex,
        });
      }
      resultEntries.push(makeEntry(base));
      continue;
    }

    if (matches.length >= 2) {
      // Conflict: multiple current decisions. Apply none; surface for review.
      for (const m of matches) {
        ignored.push({
          decision: m.decision,
          decisionId: m.decision.decisionId,
          reason: 'duplicate-current-decision',
          sourceIndex: m.sourceIndex,
        });
      }
      resultEntries.push(
        makeEntry(
          {
            effectiveOutcome: 'conflict',
            effectiveConfidence: 'low',
            reason: 'duplicate-current-decision',
          },
          [
            {
              code: 'duplicate-current-decision',
              severity: 'warning',
              message:
                'Multiple current decisions match this row; resolve before applying.',
            },
          ]
        )
      );
      continue;
    }

    if (matches.length === 1) {
      const { decision } = matches[0];
      const allowed = ALLOWED_ACTIONS[entry.status];
      if (!allowed || !allowed.has(decision.action)) {
        ignored.push({
          decision,
          decisionId: decision.decisionId,
          reason: 'decision-entry-status-mismatch',
          sourceIndex: matches[0].sourceIndex,
        });
        resultEntries.push(makeEntry(base));
        continue;
      }
      if (decision.action === 'accept-candidate') {
        const target = decision.selectedExistingRecordId;
        const present =
          isNonEmptyString(target) &&
          entry.candidates.some((c) => c.existingRecordId === target);
        if (!present) {
          ignored.push({
            decision,
            decisionId: decision.decisionId,
            reason: 'selected-candidate-not-found',
            sourceIndex: matches[0].sourceIndex,
          });
          resultEntries.push(makeEntry(base));
          continue;
        }
      }
      const verdict = verdictForDecision(decision);
      resultEntries.push(
        makeEntry({ ...verdict, appliedDecisionId: decision.decisionId })
      );
      continue;
    }

    // No applicable decision.
    resultEntries.push(makeEntry(base));
  }

  // 5. Applicable decisions whose key matches no entry are ignored.
  for (const item of applicable) {
    if (!entryKeys.has(item.key)) {
      ignored.push({
        decision: item.decision,
        decisionId: item.decision.decisionId,
        reason: 'no-matching-entry',
        sourceIndex: item.sourceIndex,
      });
    }
  }

  // Emit ignored decisions in deterministic input order, dropping the index.
  ignored.sort((a, b) => a.sourceIndex - b.sourceIndex);
  const ignoredDecisions: IgnoredRosterImportIdentityReviewDecisionEntry[] =
    ignored.map(({ sourceIndex: _sourceIndex, ...rest }) => rest);

  return {
    entries: resultEntries,
    ignoredDecisions,
    summary: summarizeAppliedRosterImportIdentityReviewDecisions({
      entries: resultEntries,
      ignoredDecisions,
    }),
  };
}

/**
 * Counts applied-decision entries by effective outcome and confidence, and ignored
 * decisions by reason. Pure and deterministic. Accepts either a full result or an
 * `{ entries, ignoredDecisions }` pair.
 */
export function summarizeAppliedRosterImportIdentityReviewDecisions(
  input:
    | AppliedRosterImportIdentityReviewDecisionResult
    | {
        entries: AppliedRosterImportIdentityReviewDecisionEntry[];
        ignoredDecisions: IgnoredRosterImportIdentityReviewDecisionEntry[];
      }
): AppliedRosterImportIdentityReviewDecisionSummary {
  const entries = input.entries;
  const ignoredDecisions = input.ignoredDecisions;

  const summary: AppliedRosterImportIdentityReviewDecisionSummary = {
    totalEntries: entries.length,
    unresolved: 0,
    linkToExisting: 0,
    createNew: 0,
    rejected: 0,
    deferred: 0,
    conflict: 0,
    skippedInvalid: 0,
    skippedReview: 0,
    decisionsApplied: 0,
    ignoredDecisions: ignoredDecisions.length,
    invalidDecisions: 0,
    supersededDecisions: 0,
    missingPreviewRowKey: 0,
    noMatchingEntry: 0,
    duplicateCurrentDecision: 0,
    decisionEntryStatusMismatch: 0,
    selectedCandidateNotFound: 0,
    highConfidence: 0,
    mediumConfidence: 0,
    lowConfidence: 0,
    noneConfidence: 0,
  };

  for (const entry of entries) {
    switch (entry.effectiveOutcome) {
      case 'unresolved':
        summary.unresolved += 1;
        break;
      case 'link-to-existing':
        summary.linkToExisting += 1;
        break;
      case 'create-new':
        summary.createNew += 1;
        break;
      case 'rejected':
        summary.rejected += 1;
        break;
      case 'deferred':
        summary.deferred += 1;
        break;
      case 'conflict':
        summary.conflict += 1;
        break;
      case 'skipped-invalid-preview-row':
        summary.skippedInvalid += 1;
        break;
      case 'skipped-review-preview-row':
        summary.skippedReview += 1;
        break;
    }

    if (entry.appliedDecisionId !== null) summary.decisionsApplied += 1;

    switch (entry.effectiveConfidence) {
      case 'high':
        summary.highConfidence += 1;
        break;
      case 'medium':
        summary.mediumConfidence += 1;
        break;
      case 'low':
        summary.lowConfidence += 1;
        break;
      case 'none':
        summary.noneConfidence += 1;
        break;
    }
  }

  for (const ignoredDecision of ignoredDecisions) {
    switch (ignoredDecision.reason) {
      case 'invalid-decision':
        summary.invalidDecisions += 1;
        break;
      case 'superseded-decision':
        summary.supersededDecisions += 1;
        break;
      case 'missing-preview-row-key':
        summary.missingPreviewRowKey += 1;
        break;
      case 'no-matching-entry':
        summary.noMatchingEntry += 1;
        break;
      case 'duplicate-current-decision':
        summary.duplicateCurrentDecision += 1;
        break;
      case 'decision-entry-status-mismatch':
        summary.decisionEntryStatusMismatch += 1;
        break;
      case 'selected-candidate-not-found':
        summary.selectedCandidateNotFound += 1;
        break;
    }
  }

  return summary;
}
