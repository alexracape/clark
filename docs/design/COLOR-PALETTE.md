# Clark Color Palette

Single source of truth for all colors used across the Clark project.

**Implementation reference:** `src/tui/theme.ts` (TUI), `docs/index.html` CSS variables (website).

---

## Primary Colors

| Name        | Hex       | Usage                                        |
|-------------|-----------|----------------------------------------------|
| Lamp Green  | `#3D7A5F` | Primary accent, CTAs, interactive highlights  |
| Deep Fern   | `#2E6049` | Hover states, emphasis                        |

## Neutrals

| Name      | Hex       | Usage                                          |
|-----------|-----------|-------------------------------------------------|
| Leather   | `#1C1408` | Terminal background, deep brown/black            |
| Walnut    | `#6B5E4F` | Body text on light backgrounds                   |
| Parchment | `#FAF6EE` | Primary light background (website)               |
| Patina    | `#7A6B52` | Borders, subtle accents, secondary body text     |

## Supporting Colors

| Name  | Hex       | Usage                                            |
|-------|-----------|--------------------------------------------------|
| Brass | `#C9A84C` | Slash commands, special UI elements, tips/warnings |
| Sky   | `#7EB8C9` | Selected items, provider names, step indicators    |
| Sage  | `#81C784` | Success states, checkmarks, positive feedback      |

## Terminal UI (TUI) Text Colors

| Role              | Hex       | Style             |
|-------------------|-----------|-------------------|
| Base text         | `#B8A88A` |                   |
| Message text      | `#E8DCCA` | warm white         |
| Dim text          | `#5C4E38` |                   |
| `you` label       | `#6DBF8B` | bold               |
| `clark` label     | `#7EB8C9` | bold               |
| Thinking label    | `#5C4E38` | dim, italic        |
| Slash commands    | `#C9A84C` |                   |
| Selected item     | `#7EB8C9` | bold               |
| Selected text     | `#E8DCCA` | bold               |
| Thinking spinner  | `#6DBFB8` | cyan               |
| Streaming cursor  | `#6DBFB8` | cyan underscore    |
| Input cursor      | `#E8DCCA` | inverted block     |

## TUI Chrome

| Element          | Hex       |
|------------------|-----------|
| Background       | `#1C1408` |
| Chrome bar       | `#251C0F` |
| Dividers         | `#3D3020` |
| Code block bg    | `#2E2416` |

## Semantic Colors

| Role    | Hex       | Usage                               |
|---------|-----------|-------------------------------------|
| Error   | `#C47A5A` | Errors, failures (muted red)         |
| Warning | `#C4A85A` | Warnings, setup required (muted yellow) |

## Window Dots

| Dot    | Hex       |
|--------|-----------|
| Red    | `#C47A5A` |
| Yellow | `#C4A85A` |
| Green  | `#5AA47A` |

---

## Where Colors Are Defined

| Location                  | Format              | Role                    |
|---------------------------|---------------------|-------------------------|
| `src/tui/theme.ts`        | TypeScript constants | TUI implementation       |
| `docs/index.html`         | CSS custom properties | Website                  |
| `docs/getting-started.html` | CSS custom properties | Website (docs page)     |
| `design/DESIGN.md`        | Documentation        | Design system spec       |
| `design/COLOR-PALETTE.md` | Documentation        | This file (source of truth) |

## CSS Variable Mapping (Website)

```css
:root {
  --lamp-green: #3d7a5f;
  --deep-fern: #2e6049;
  --leather: #1c1408;
  --walnut: #6b5e4f;
  --parchment: #faf6ee;
  --patina: #7a6b52;
  --brass: #c9a84c;
  --sky: #7eb8c9;
  --sage: #81c784;
  --chrome: #251c0f;
  --divider: #3d3020;
  --text-base: #b8a88a;
  --text-white: #e8dcca;
  --text-dim: #5c4e38;
  --text-green: #6dbf8b;
  --text-blue: #7eb8c9;
  --text-cyan: #6dbfb8;
}
```
