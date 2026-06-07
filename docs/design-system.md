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
