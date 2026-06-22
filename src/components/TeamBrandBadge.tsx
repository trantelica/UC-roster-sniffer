/**
 * Phase 9 slice 31: display-only district/team branding badge.
 *
 * Renders a compact colored initials badge from existing district branding. There are no image
 * assets in the workspace, so this deliberately uses a text/initials badge (colored with the
 * district's brand colors when available, with a neutral token fallback) rather than an <img>,
 * so there is never a broken logo. Purely presentational — no data is read or mutated here.
 */

export type BrandBadgeData = {
  initials: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  hasBrandColors: boolean;
};

export default function TeamBrandBadge({
  branding,
  title,
  size = 'md',
}: {
  branding: BrandBadgeData;
  /** Accessible label / tooltip (e.g. the district or team name). */
  title?: string;
  size?: 'sm' | 'md';
}) {
  const style = branding.hasBrandColors
    ? {
        backgroundColor: branding.primaryColor ?? undefined,
        color: branding.secondaryColor ?? undefined,
        borderColor: branding.secondaryColor ?? undefined,
      }
    : undefined;
  return (
    <span
      className={`brand-badge brand-badge-${size} ${branding.hasBrandColors ? '' : 'brand-badge-fallback'}`}
      style={style}
      title={title}
      aria-hidden="true"
    >
      {branding.initials}
    </span>
  );
}
