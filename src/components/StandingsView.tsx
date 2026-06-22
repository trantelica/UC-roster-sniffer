import { useMemo, useState } from 'react';
import type { AgeDivision, District, Game, Team } from '../domain/types';
import { getDistinctSeasons } from '../engine/filters';
import { buildStandings, type StandingsRow } from '../engine/standingsSummary';
import { getDistrictBranding, type DistrictBrandingDisplay } from '../engine/teamBrandingDisplay';
import TeamBrandBadge from './TeamBrandBadge';

/**
 * Phase 6 slice 26: read-only STANDINGS dashboard.
 *
 * Thin renderer over the pure standings engine. The user picks a season + age division and
 * sees standings derived from FINAL games only (opponents resolved through existing teams).
 * No editing here.
 */

export default function StandingsView({
  teams,
  games,
  districts,
  ageDivisions,
  defaultSeasonId,
  onOpenTeam,
}: {
  teams: Team[];
  games: Game[];
  districts: District[];
  ageDivisions: AgeDivision[];
  defaultSeasonId: string | null;
  /** Opens a team elsewhere (My Team). Display-only navigation; never mutates data. */
  onOpenTeam?: (teamId: string) => void;
}) {
  const seasons = useMemo(() => getDistinctSeasons(teams), [teams]);
  const districtIdByTeamId = useMemo(
    () => new Map(teams.map((t) => [t.teamId, t.districtId])),
    [teams]
  );
  const [season, setSeason] = useState<string | null>(
    defaultSeasonId && seasons.includes(defaultSeasonId)
      ? defaultSeasonId
      : seasons[seasons.length - 1] ?? null
  );

  // Age divisions that actually have teams in the selected season, ordered by ordinal.
  const divisionsInSeason = useMemo(() => {
    if (!season) return [];
    const ids = new Set(
      teams.filter((t) => t.seasonId === season).map((t) => t.ageDivisionId)
    );
    return ageDivisions
      .filter((a) => ids.has(a.ageDivisionId))
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal);
  }, [teams, ageDivisions, season]);

  const [ageDivisionId, setAgeDivisionId] = useState<string | null>(null);
  const effectiveAgeDivisionId =
    ageDivisionId && divisionsInSeason.some((a) => a.ageDivisionId === ageDivisionId)
      ? ageDivisionId
      : divisionsInSeason[0]?.ageDivisionId ?? null;

  const standings = useMemo(() => {
    if (!season || !effectiveAgeDivisionId) return null;
    return buildStandings({
      teams,
      games,
      districts,
      ageDivisions,
      seasonId: season,
      ageDivisionId: effectiveAgeDivisionId,
    });
  }, [teams, games, districts, ageDivisions, season, effectiveAgeDivisionId]);

  return (
    <div className="import-preview">
      <div className="import-preview-header">
        <h2 className="import-title">Standings</h2>
        <span className="import-tag">Read-only · final games only</span>
      </div>
      <p className="import-note">
        Standings are derived from final games only between existing teams (no opponent
        objects). Schedule/results are separate from roster import; in-memory schedule imports
        and result edits are reflected here and preserved only through a workspace snapshot
        export. No browser storage or cloud sync is used.
      </p>

      <div className="filter-bar">
        <div className="filter-group">
          <label htmlFor="standings-season">Season</label>
          <select
            id="standings-season"
            value={season ?? ''}
            onChange={(e) => {
              setSeason(e.target.value || null);
              setAgeDivisionId(null);
            }}
          >
            {seasons.length === 0 && <option value="">No seasons</option>}
            {seasons.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label htmlFor="standings-age-division">Age division</label>
          <select
            id="standings-age-division"
            value={effectiveAgeDivisionId ?? ''}
            onChange={(e) => setAgeDivisionId(e.target.value || null)}
            disabled={divisionsInSeason.length === 0}
          >
            {divisionsInSeason.length === 0 && <option value="">No age divisions</option>}
            {divisionsInSeason.map((a) => (
              <option key={a.ageDivisionId} value={a.ageDivisionId}>
                {a.name} ({a.ageDivisionId})
              </option>
            ))}
          </select>
        </div>
      </div>

      {!standings || standings.rows.length === 0 ? (
        <p className="import-empty">No teams for the selected season and age division.</p>
      ) : !standings.hasFinalGames ? (
        <p className="import-empty">No final games available for these standings.</p>
      ) : (
        <>
          {standings.unresolvedGameReferenceCount > 0 && (
            <p className="schedule-unresolved">
              {standings.unresolvedGameReferenceCount} final game reference(s) could not be
              resolved to an existing team and are shown as-is.
            </p>
          )}
          <table className="schedule-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>Class</th>
                <th>W–L–T</th>
                <th>Win%</th>
                <th>PF</th>
                <th>PA</th>
                <th>DIFF</th>
                <th>Playoff</th>
                <th>Championship</th>
              </tr>
            </thead>
            <tbody>
              {standings.rows.map((row) => (
                <StandingsRowView
                  key={row.teamId}
                  row={row}
                  branding={getDistrictBranding(
                    districtIdByTeamId.get(row.teamId) ?? '',
                    districts
                  )}
                  onOpenTeam={onOpenTeam}
                />
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function record(r: { wins: number; losses: number; ties: number }): string {
  return `${r.wins}–${r.losses}–${r.ties}`;
}

function StandingsRowView({
  row,
  branding,
  onOpenTeam,
}: {
  row: StandingsRow;
  branding: DistrictBrandingDisplay;
  onOpenTeam?: (teamId: string) => void;
}) {
  return (
    <tr>
      <td>
        <span className="rank-badge">{row.rank}</span>
      </td>
      <td>
        <span className="team-cell">
          <TeamBrandBadge branding={branding} title={branding.districtName} size="sm" />
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
      <td>{row.teamCode}</td>
      <td><span className="metric-chip">{record(row)}</span></td>
      <td>{row.gamesPlayed === 0 ? '—' : row.winPercentage.toFixed(3)}</td>
      <td>{row.pointsFor}</td>
      <td>{row.pointsAgainst}</td>
      <td>
        <span className={`diff-chip ${row.pointDifferential >= 0 ? 'diff-pos' : 'diff-neg'}`}>
          {row.pointDifferential >= 0 ? '+' : ''}
          {row.pointDifferential}
        </span>
      </td>
      <td>{record(row.playoffRecord)}</td>
      <td>{record(row.championshipRecord)}</td>
    </tr>
  );
}
