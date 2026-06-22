import { useMemo, useState } from 'react';
import type {
  AgeDivision,
  District,
  Game,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import {
  buildWorkspaceDataQualitySummary,
  type ReviewCategory,
  type ReviewItem,
  type ReviewSeverity,
  type WorkspaceImportState,
} from '../engine/workspaceDataQualitySummary';
import { getDistinctSeasons } from '../engine/filters';
import { formatTeamDisplayName } from '../engine/teamScheduleSummary';

/**
 * Phase 10 slice 32: read-only DATA QUALITY / REVIEW CENTER.
 *
 * One operational place to see data-quality issues already detected across rosters, imports,
 * schedules, coaches, standings, and analytics — grouped by severity/category, filterable, and
 * with navigation back to the relevant tab. Derived at runtime by `buildWorkspaceDataQualitySummary`;
 * read-only — it never mutates source data and persists nothing (including its filters).
 */

const SEVERITY_LABELS: Record<ReviewSeverity, string> = {
  info: 'Info',
  warning: 'Review',
  blocker: 'Blocker',
};

const CATEGORY_LABELS: Record<ReviewCategory, string> = {
  roster: 'Roster',
  import: 'Import',
  schedule: 'Schedule',
  coach: 'Coach',
  standings: 'Standings',
  analytics: 'Analytics',
  workspace: 'Workspace',
};

const STATUS_MESSAGES: Record<string, string> = {
  clean: 'No major issues found.',
  'review-recommended': 'Review recommended.',
  blocking: 'Blocking issues need attention before a future durable import.',
};

const CATEGORY_CARD_ORDER: ReviewCategory[] = ['roster', 'schedule', 'coach', 'workspace'];

export default function ReviewCenterView({
  teams,
  districts,
  ageDivisions,
  games,
  coaches,
  coachAssignments,
  importState,
  onOpenTeam,
  onOpenCoach,
  onNavigate,
}: {
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
  games: Game[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  importState?: WorkspaceImportState;
  onOpenTeam?: (teamId: string) => void;
  onOpenCoach?: (coachId: string) => void;
  onNavigate?: (view: 'standings' | 'analytics' | 'coaches') => void;
}) {
  const summary = useMemo(
    () =>
      buildWorkspaceDataQualitySummary({
        teams,
        games,
        districts,
        ageDivisions,
        coaches,
        coachAssignments,
        importState,
      }),
    [teams, games, districts, ageDivisions, coaches, coachAssignments, importState]
  );

  const [severityFilter, setSeverityFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [seasonFilter, setSeasonFilter] = useState<string>('');
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const seasons = useMemo(() => getDistinctSeasons(teams).slice().reverse(), [teams]);
  const teamOptions = useMemo(
    () =>
      teams
        .map((t) => ({ id: t.teamId, name: formatTeamDisplayName(t, districts, ageDivisions), seasonId: t.seasonId }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    [teams, districts, ageDivisions]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return summary.items.filter((item) => {
      if (severityFilter && item.severity !== severityFilter) return false;
      if (categoryFilter && item.category !== categoryFilter) return false;
      if (seasonFilter && item.seasonId !== seasonFilter) return false;
      if (teamFilter && item.teamId !== teamFilter) return false;
      if (q) {
        const hay = `${item.title} ${item.message} ${item.code} ${item.detail ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [summary.items, severityFilter, categoryFilter, seasonFilter, teamFilter, search]);

  const navigate = (item: ReviewItem): void => {
    const t = item.navigationTarget;
    if (!t) return;
    if (t.kind === 'team') onOpenTeam?.(t.teamId);
    else if (t.kind === 'coach') onOpenCoach?.(t.coachId);
    else onNavigate?.(t.view);
  };

  const canNavigate = (item: ReviewItem): boolean => {
    const t = item.navigationTarget;
    if (!t) return false;
    if (t.kind === 'team') return !!onOpenTeam;
    if (t.kind === 'coach') return !!onOpenCoach;
    return !!onNavigate;
  };

  return (
    <div className="import-preview review-center">
      <div className="import-preview-header">
        <h2 className="import-title">Review Center</h2>
        <span className="import-tag">Read-only</span>
      </div>
      <p className="import-note">
        A consolidated, read-only view of data-quality issues already detected across rosters,
        schedules, coaches, standings, and analytics. Everything is derived at runtime from the
        current workspace — nothing is mutated or persisted. Each item links to the relevant tab.
      </p>

      {/* Header summary */}
      <div className="roster-status-summary review-summary">
        <span className="roster-status-count"><strong>{summary.counts.total}</strong> Total</span>
        <span className="roster-status-count"><strong>{summary.counts.blocker}</strong> Blockers</span>
        <span className="roster-status-count"><strong>{summary.counts.warning}</strong> Reviews</span>
        <span className="roster-status-count"><strong>{summary.counts.info}</strong> Info</span>
        <span className={`review-status review-status-${summary.status}`}>
          {STATUS_MESSAGES[summary.status]}
        </span>
      </div>

      {/* Category summary cards */}
      <div className="review-category-cards">
        {CATEGORY_CARD_ORDER.map((cat) => (
          <button
            key={cat}
            type="button"
            className={`review-category-card ${categoryFilter === cat ? 'review-category-card-active' : ''}`}
            onClick={() => setCategoryFilter(categoryFilter === cat ? '' : cat)}
            title={`Filter to ${CATEGORY_LABELS[cat]} issues`}
          >
            <span className="review-category-card-count">{summary.byCategory[cat]}</span>
            <span className="review-category-card-label">{CATEGORY_LABELS[cat]}</span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="analytics-filters">
        <label>
          Severity
          <select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)}>
            <option value="">All severities</option>
            <option value="blocker">Blocker</option>
            <option value="warning">Review</option>
            <option value="info">Info</option>
          </select>
        </label>
        <label>
          Category
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">All categories</option>
            {(Object.keys(CATEGORY_LABELS) as ReviewCategory[]).map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
        </label>
        <label>
          Season
          <select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}>
            <option value="">All seasons</option>
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All teams</option>
            {teamOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.seasonId} · {t.name}</option>
            ))}
          </select>
        </label>
        <label>
          Search
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter text…"
          />
        </label>
      </div>

      {/* Issue list */}
      {summary.counts.total === 0 ? (
        <p className="empty-state">No data-quality issues detected in the current workspace.</p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">No review items found for the current filters.</p>
      ) : (
        <ul className="review-list">
          {filtered.map((item) => (
            <li key={item.issueId} className={`review-item review-item-${item.severity}`}>
              <div className="review-item-head">
                <span className={`my-team-severity my-team-severity-${item.severity}`}>
                  {SEVERITY_LABELS[item.severity]}
                </span>
                <span className="review-category-chip">{CATEGORY_LABELS[item.category]}</span>
                <span className="review-item-title">{item.title}</span>
                {canNavigate(item) ? (
                  <button
                    type="button"
                    className="import-link-button review-item-open"
                    onClick={() => navigate(item)}
                  >
                    Open →
                  </button>
                ) : (
                  item.navigationTarget && (
                    <span className="review-item-open review-item-open-disabled">
                      Unavailable
                    </span>
                  )
                )}
              </div>
              <p className="review-item-message">{item.message}</p>
              {item.detail && <p className="review-item-detail">{item.detail}</p>}
              {item.recommendedAction && (
                <p className="review-item-action">
                  <strong>Recommended:</strong> {item.recommendedAction}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
