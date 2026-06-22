# Design System

This document defines the initial visual language for UC Roster Sniffer.

## System color palette

These colors are application-level design tokens. They are separate from district-specific branding colors.

| Token | Hex | Name | Intended Use |
| --- | --- | --- | --- |
| `alabasterGrey` | `#EBE9E9` | Alabaster Grey | App background, neutral panels, quiet surfaces |
| `mintCream` | `#F3F8F2` | Mint Cream | Secondary background, soft cards, calm contrast surfaces |
| `steelBlue` | `#3581B8` | Steel Blue | Primary action, links, selected state, informational badges |
| `bronzeSpice` | `#C75005` | Bronze Spice | Emphasis, alerts, rivalry/game context, important highlights |
| `carbonBlack` | `#202419` | Carbon Black | Primary text, dark headers, high-contrast surfaces |

## Palette roles

### Neutral foundation

- `alabasterGrey`
- `mintCream`

These should be used for the main app surface and card backgrounds.

### Primary interaction

- `steelBlue`

Use for selected filters, navigation highlights, links, and primary actions.

### Emphasis

- `bronzeSpice`

Use sparingly for high-importance items, warnings, key status markers, or postseason/championship accents.

### Text and contrast

- `carbonBlack`

Use for primary text, strong labels, and dark UI surfaces.

## Relationship to district branding

District branding is separate from the system palette.

Districts may define:

- primary brand color
- secondary brand color
- logo
- helmet artwork
- mascot

When a district is selected, district branding may influence cards, headers, or panels. System colors should still preserve readability and consistent app structure.

## Early implementation guidance

Expose these as named design tokens rather than hard-coding hex values throughout the app.

Example token shape:

```ts
export const systemColors = {
  alabasterGrey: '#EBE9E9',
  mintCream: '#F3F8F2',
  steelBlue: '#3581B8',
  bronzeSpice: '#C75005',
  carbonBlack: '#202419',
};
```

## Accessibility note

Before final UI implementation, contrast should be checked for text, badges, and card accents. Some color combinations may be better suited for borders or backgrounds than text.

## Visual intelligence components (Phase 9 slice 31)

Slice 31 adds lightweight, display-only visual components built entirely from the existing
tokens (no charting library, no new design language):

- **District/team brand badge** — a compact colored initials badge produced by the pure
  `teamBrandingDisplay` helper from the existing district fields (mascot, primary/secondary
  color, name). Because the workspace ships no logo/helmet image files, the badge always uses a
  text/initials fallback colored with the district's brand colors (when both are present),
  rather than an `<img>` — so there is never a broken logo. When a district has no brand colors,
  the badge falls back to neutral tokens. Branding is display-only and never mutates data.
- **Scanning chips/badges** — `metric-chip` (records), `diff-chip` (point differential, green for
  non-negative / bronze for negative), and `rank-badge` (steel-blue rank pill). These improve
  scanning in Analytics, Standings, My Team, and the coach views.
- **Inline link buttons** (`link-button-inline`) — steel-blue underlined buttons used for
  cross-tab navigation (open a team in My Team, a coach in Coaches, or an opponent team). They
  change selection/view state only.

District branding influences badges and accents while the system palette continues to own the
overall app structure and readability.
