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
  buildMultiYearAnalyticsSummary,
  type AnalyticsAttentionSeverity,
  type TrendRecord,
} from '../engine/multiYearAnalyticsSummary';
import { getDistrictBranding } from '../engine/teamBrandingDisplay';
import TeamBrandBadge from './TeamBrandBadge';

/**
 * Phase 9 slice 30: read-only MULTI-YEAR ANALYTICS dashboard.
 *
 * Shows season-over-season trends (team / district / age-division / coach) and an aggregate
 * attention summary derived at runtime by `buildMultiYearAnalyticsSummary`. Filters live in
 * component state only and are not persisted. The view is read-only; rows may navigate to the
 * existing My Team / Coaches tabs but never mutate source data.
 */

const SEVERITY_LABELS: Record<AnalyticsAttentionSeverity, string> = {
  info: 'Info',
  warning: 'Review',
  blocker: 'Blocker',
};

function wlt(record: { wins: number; losses: number; ties: number }): string {
  return `${record.wins}–${record.losses}–${record.ties}`;
}

function diff(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function num(value: number | null): string {
  return value === null ? '—' : String(value);
}

function rate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

function recordWithPct(record: TrendRecord): string {
  const base = `${record.wins}–${record.losses}–${record.ties}`;
  return record.gamesPlayed === 0 ? base : `${base} (${record.winPercentage.toFixed(3)})`;
}

export default function AnalyticsView({
  teams,
  districts,
  ageDivisions,
  games,
  coaches,
  coachAssignments,
  onOpenTeam,
  onOpenCoach,
}: {
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
  games: Game[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
  onOpenTeam?: (teamId: string) => void;
  /** Opens a specific coach in the Coaches tab. Display-only; never mutates data. */
  onOpenCoach?: (coachId: string) => void;
}) {
  const [seasonFilter, setSeasonFilter] = useState<string>(''); // '' = all
  const [districtFilter, setDistrictFilter] = useState<string>('');
  const [ageDivisionFilter, setAgeDivisionFilter] = useState<string>('');
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [coachFilter, setCoachFilter] = useState<string>('');

  const summary = useMemo(
    () =>
      buildMultiYearAnalyticsSummary({
        teams,
        games,
        districts,
        ageDivisions,
        coaches,
        coachAssignments,
        filters: {
          seasons: seasonFilter ? [seasonFilter] : null,
          districtId: districtFilter || null,
          ageDivisionId: ageDivisionFilter || null,
          teamId: teamFilter || null,
          coachId: coachFilter || null,
        },
      }),
    [
      teams,
      games,
      districts,
      ageDivisions,
      coaches,
      coachAssignments,
      seasonFilter,
      districtFilter,
      ageDivisionFilter,
      teamFilter,
      coachFilter,
    ]
  );

  const { coverage, filterOptions } = summary;
  // Team selector is limited to teams that match the active season/district/age-division filters.
  const teamSelectOptions = filterOptions.teams.filter((t) => {
    const team = teams.find((x) => x.teamId === t.id);
    if (!team) return false;
    if (seasonFilter && team.seasonId !== seasonFilter) return false;
    if (districtFilter && team.districtId !== districtFilter) return false;
    if (ageDivisionFilter && team.ageDivisionId !== ageDivisionFilter) return false;
    return true;
  });

  return (
    <div className="import-preview analytics">
      <div className="import-preview-header">
        <h2 className="import-title">Multi-year analytics</h2>
        <span className="import-tag">Read-only</span>
      </div>
      <p className="import-note">
        Season-over-season trends across rosters, teams, games, standings, and coaches — derived at
        runtime from the current workspace. Nothing is duplicated or persisted; filters are not
        saved. Values that cannot be derived (no prior-season team, no final games) show as
        unavailable rather than fabricated zeros.
      </p>

      {/* Dashboard header */}
      <div className="roster-status-summary analytics-coverage">
        <span className="roster-status-count">
          <strong>
            {coverage.firstSeason ?? '—'}
            {coverage.latestSeason && coverage.latestSeason !== coverage.firstSeason
              ? `–${coverage.latestSeason}`
              : ''}
          </strong>{' '}
          Seasons
        </span>
        <span className="roster-status-count"><strong>{coverage.seasonCount}</strong> Season count</span>
        <span className="roster-status-count"><strong>{coverage.districtCount}</strong> Districts</span>
        <span className="roster-status-count"><strong>{coverage.teamCount}</strong> Teams</span>
        <span className="roster-status-count"><strong>{coverage.playerCount}</strong> Players</span>
        <span className="roster-status-count"><strong>{coverage.gameCount}</strong> Games</span>
        <span className="roster-status-count"><strong>{coverage.finalGameCount}</strong> Final games</span>
        <span className="roster-status-count"><strong>{coverage.coachCount}</strong> Coaches</span>
      </div>

      {/* Filters */}
      <div className="analytics-filters">
        <label>
          Season
          <select value={seasonFilter} onChange={(e) => setSeasonFilter(e.target.value)}>
            <option value="">All seasons</option>
            {filterOptions.seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          District
          <select value={districtFilter} onChange={(e) => setDistrictFilter(e.target.value)}>
            <option value="">All districts</option>
            {filterOptions.districts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label>
          Age division
          <select value={ageDivisionFilter} onChange={(e) => setAgeDivisionFilter(e.target.value)}>
            <option value="">All age divisions</option>
            {filterOptions.ageDivisions.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <label>
          Team
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All teams</option>
            {teamSelectOptions.map((t) => (
              <option key={t.id} value={t.id}>{t.seasonId} · {t.name}</option>
            ))}
          </select>
        </label>
        <label>
          Coach
          <select value={coachFilter} onChange={(e) => setCoachFilter(e.target.value)}>
            <option value="">All coaches</option>
            {filterOptions.coaches.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Team Trends */}
      <section className="import-section">
        <h3>Team trends</h3>
        {summary.teamTrends.length === 0 ? (
          <p className="import-empty">No teams match the current filters.</p>
        ) : (
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Team</th>
                <th>Season</th>
                <th>Code</th>
                <th>Players</th>
                <th>Ret / New / Unk</th>
                <th>Retention</th>
                <th>Y↑ / Z↓</th>
                <th>Record</th>
                <th>Rank</th>
                <th>Coach cont.</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {summary.teamTrends.map((row) => (
                <tr key={row.teamId}>
                  <td>
                    <span className="team-cell">
                      <TeamBrandBadge
                        branding={getDistrictBranding(row.districtId, districts)}
                        title={row.districtName}
                        size="sm"
                      />
                      {onOpenTeam ? (
                        <button
                          type="button"
                          className="link-button-inline"
                          onClick={() => onOpenTeam(row.teamId)}
                          title="Open in My Team"
                        >
                          {row.displayName}
                        </button>
                      ) : (
                        row.displayName
                      )}
                    </span>
                  </td>
                  <td>{row.seasonId}</td>
                  <td>{row.teamCode}</td>
                  <td>{row.playerCount}</td>
                  <td>
                    {row.priorComparisonAvailable
                      ? `${num(row.returningCount)} / ${num(row.newCount)} / ${num(row.unknownMovementCount)}`
                      : '— (no prior)'}
                  </td>
                  <td>
                    {row.rosterRetentionRate === null ? (
                      '—'
                    ) : (
                      <span className="metric-chip">{rate(row.rosterRetentionRate)}</span>
                    )}
                  </td>
                  <td>
                    {row.yUpCount === null
                      ? '—'
                      : `${row.yUpCount} / ${row.zDownCount}`}
                  </td>
                  <td>
                    <span className="metric-chip">{wlt(row.record)}</span>
                    <span
                      className={`diff-chip ${row.pointDifferential >= 0 ? 'diff-pos' : 'diff-neg'}`}
                    >
                      {diff(row.pointDifferential)}
                    </span>
                  </td>
                  <td>
                    {row.standingsRank !== null ? (
                      <span className="rank-badge">#{row.standingsRank}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {row.coachContinuityAvailable ? num(row.coachContinuityReturning) : '—'}
                  </td>
                  <td>
                    {onOpenTeam && (
                      <button
                        type="button"
                        className="import-link-button"
                        onClick={() => onOpenTeam(row.teamId)}
                      >
                        Open →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* District Trends */}
      <section className="import-section">
        <h3>District trends</h3>
        {summary.districtTrends.length === 0 ? (
          <p className="import-empty">No districts match the current filters.</p>
        ) : (
          <table className="schedule-table">
            <thead>
              <tr>
                <th>District</th>
                <th>Seasons</th>
                <th>Teams</th>
                <th>Players</th>
                <th>Aggregate record</th>
                <th>Differential</th>
              </tr>
            </thead>
            <tbody>
              {summary.districtTrends.map((row) => (
                <tr key={row.districtId}>
                  <td>
                    <span className="team-cell">
                      <TeamBrandBadge
                        branding={getDistrictBranding(row.districtId, districts)}
                        title={row.districtName}
                        size="sm"
                      />
                      {row.districtName}
                    </span>
                  </td>
                  <td>{row.seasonsRepresented.join(', ')}</td>
                  <td>{row.teamCount}</td>
                  <td>{row.playerCount}</td>
                  <td><span className="metric-chip">{recordWithPct(row.aggregateRecord)}</span></td>
                  <td>
                    <span
                      className={`diff-chip ${row.aggregatePointDifferential >= 0 ? 'diff-pos' : 'diff-neg'}`}
                    >
                      {diff(row.aggregatePointDifferential)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Age Division Trends */}
      <section className="import-section">
        <h3>Age division trends</h3>
        {summary.ageDivisionTrends.length === 0 ? (
          <p className="import-empty">No age divisions match the current filters.</p>
        ) : (
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Age division</th>
                <th>Seasons</th>
                <th>Teams</th>
                <th>Players</th>
                <th>Avg roster</th>
                <th>Aggregate record</th>
              </tr>
            </thead>
            <tbody>
              {summary.ageDivisionTrends.map((row) => (
                <tr key={row.ageDivisionId}>
                  <td>{row.ageDivisionName}</td>
                  <td>{row.seasonsRepresented.join(', ')}</td>
                  <td>{row.teamCount}</td>
                  <td>{row.playerCount}</td>
                  <td>
                    {row.averagePlayersPerTeam === null
                      ? '—'
                      : row.averagePlayersPerTeam.toFixed(1)}
                  </td>
                  <td>{recordWithPct(row.aggregateRecord)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Coach Trends */}
      <section className="import-section">
        <h3>Coach trends</h3>
        {summary.coachTrends.length === 0 ? (
          <p className="import-empty">No coaches match the current filters.</p>
        ) : (
          <table className="schedule-table">
            <thead>
              <tr>
                <th>Coach</th>
                <th>Seasons</th>
                <th>Assignments</th>
                <th>Career record</th>
                <th>Playoff</th>
                <th>Championship</th>
                <th>Latest assignment</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {summary.coachTrends.map((row) => (
                <tr key={row.coachId}>
                  <td>
                    {onOpenCoach ? (
                      <button
                        type="button"
                        className="link-button-inline"
                        onClick={() => onOpenCoach(row.coachId)}
                        title="Open in Coaches"
                      >
                        {row.displayName}
                      </button>
                    ) : (
                      row.displayName
                    )}
                  </td>
                  <td>{row.seasonsActive.length}</td>
                  <td>{row.totalAssignments}</td>
                  <td><span className="metric-chip">{recordWithPct(row.careerRecord)}</span></td>
                  <td>{wlt(row.careerPlayoffRecord)}</td>
                  <td>{wlt(row.careerChampionshipRecord)}</td>
                  <td>
                    {row.latestAssignment
                      ? `${row.latestAssignment.teamDisplayName} (${row.latestAssignment.seasonId})`
                      : '—'}
                  </td>
                  <td>
                    {onOpenCoach && (
                      <button
                        type="button"
                        className="import-link-button"
                        onClick={() => onOpenCoach(row.coachId)}
                      >
                        Coaches →
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Attention Summary */}
      <section className="import-section">
        <h3>Attention summary</h3>
        {summary.attention.length === 0 ? (
          <p className="empty-state">No analytics attention items in scope.</p>
        ) : (
          <ul className="my-team-attention-list">
            {summary.attention.map((item) => (
              <li
                key={item.code}
                className={`my-team-attention-item my-team-attention-${item.severity}`}
              >
                <span className={`my-team-severity my-team-severity-${item.severity}`}>
                  {SEVERITY_LABELS[item.severity]}
                </span>
                <span className="analytics-attention-count">{item.count}</span>
                <span className="my-team-attention-message">{item.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
