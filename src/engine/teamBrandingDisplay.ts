import type { AgeDivision, District, Team } from '../domain/types';
import { formatTeamDisplayName } from './teamScheduleSummary';

/**
 * Phase 9 slice 31: PURE, deterministic DISPLAY-ONLY branding helper — ENGINE ONLY.
 *
 * Produces display-ready branding for a district or team (name, mascot, colors, classification
 * label, and a deterministic initials badge) from the EXISTING district fields. It never mutates
 * inputs, never invents logo/helmet assets (it only surfaces the asset paths already in the
 * data), and falls back deterministically (district id, then a generic badge) when fields are
 * missing. Names are preserved exactly.
 *
 * This is presentation metadata only: it does not change rosters, games, coaches, or any
 * authoritative data, and nothing here is persisted.
 */

export const TEAM_BRANDING_DISPLAY_LOGIC_VERSION = 'phase9-slice31-team-branding-display-v1';

export type DistrictBrandingDisplay = {
  districtId: string;
  districtName: string;
  mascot: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  /** True only when BOTH brand colors are present and non-empty. */
  hasBrandColors: boolean;
  logoAssetPath: string | null;
  helmetAssetPath: string | null;
  /** 1–2 character fallback badge text, always non-empty and deterministic. */
  initials: string;
};

export type TeamBrandingDisplay = DistrictBrandingDisplay & {
  teamId: string;
  seasonId: string;
  teamDisplayName: string;
  ageDivisionId: string;
  ageDivisionName: string;
  teamCode: string;
  /** Readable classification label derived from the team code, e.g. "Class B1". */
  classificationLabel: string;
};

function cleaned(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Deterministic 1–2 char initials from a name, falling back to a secondary string then "?". */
function deriveInitials(name: string | null, fallback: string): string {
  const source = cleaned(name);
  if (source === null) {
    const fb = cleaned(fallback);
    return fb ? fb.slice(0, 2).toUpperCase() : '?';
  }
  const words = source.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/**
 * Display-ready branding for a district. Pure; never mutates inputs. When the district is not
 * found, falls back to the district id for the name and a deterministic initials badge.
 */
export function getDistrictBranding(
  districtId: string,
  districts: District[],
  options?: { fallbackName?: string }
): DistrictBrandingDisplay {
  const district = districts.find((d) => d.districtId === districtId) ?? null;
  const districtName = district ? district.name : options?.fallbackName ?? districtId;
  const primaryColor = district ? cleaned(district.primaryColor) : null;
  const secondaryColor = district ? cleaned(district.secondaryColor) : null;
  return {
    districtId,
    districtName,
    mascot: district ? cleaned(district.mascot) : null,
    primaryColor,
    secondaryColor,
    hasBrandColors: primaryColor !== null && secondaryColor !== null,
    logoAssetPath: district ? cleaned(district.logoAssetPath) : null,
    helmetAssetPath: district ? cleaned(district.helmetAssetPath) : null,
    initials: deriveInitials(district ? district.name : null, districtId),
  };
}

/**
 * Display-ready branding for a team, combining district branding with the team's age division
 * and classification. Pure; never mutates inputs. Reuses `formatTeamDisplayName` so the team's
 * display name stays consistent with the rest of the app.
 */
export function getTeamBranding(
  team: Team,
  districts: District[],
  ageDivisions: AgeDivision[]
): TeamBrandingDisplay {
  const district = getDistrictBranding(team.districtId, districts);
  const ageDivision = ageDivisions.find((a) => a.ageDivisionId === team.ageDivisionId) ?? null;
  return {
    ...district,
    teamId: team.teamId,
    seasonId: team.seasonId,
    teamDisplayName: formatTeamDisplayName(team, districts, ageDivisions),
    ageDivisionId: team.ageDivisionId,
    ageDivisionName: ageDivision ? ageDivision.name : team.ageDivisionId,
    teamCode: team.teamCode,
    classificationLabel: team.teamCode.trim() === '' ? 'Unclassified' : `Class ${team.teamCode}`,
  };
}
