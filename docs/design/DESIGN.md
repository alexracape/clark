# Clark Design System

## Brand Identity

### Values
Clark embodies four core values that inform every design decision:

- **Supportive** — Clark meets you where you are and scaffolds from there. No leaps of faith required.
- **Responsible** — Honest about what it knows and doesn't. Clark says "I'm not sure" when it isn't.
- **Friendly** — Conversational, not robotic. Clark speaks like a peer who happens to be really good at this stuff.

### Personality
Clark is the best teaching assistant at their school — patient, approachable, and genuinely invested in helping you understand. Not just giving answers, but helping you find them.

---

## Visual Language

### Color Palette: The Library

Inspired by the warm, studious atmosphere of a traditional library — think banker's lamp green, aged leather, and cream parchment.

**Primary Colors:**
- **Lamp Green** `#3D7A5F` — Primary accent. Muted, sophisticated green reminiscent of classic brass desk lamps. Used for CTAs, highlights, and interactive elements.
- **Deep Fern** `#2E6049` — Darker shade for hover states and emphasis.

**Neutrals:**
- **Leather** `#1C1408` — Deep brown, almost black. Terminal backgrounds and heavy text.
- **Walnut** `#6B5E4F` — Warm brown for body text and secondary elements.
- **Parchment** `#FAF6EE` — Cream off-white. Primary background color.
- **Patina** `#7A6B52` — Mid-tone for borders and subtle accents.

**Supporting Colors:**
- **Brass** `#C9A84C` — Warm gold for slash commands and special UI elements.
- **Sky** `#7EB8C9` — Cool blue for selected items and provider names.
- **Sage** `#81C784` — Success states and positive feedback.

**Why This Palette:**
The warm, muted greens and browns create a studious, grounded feeling without being sterile. The palette feels both classic (library, textbook) and approachable (warm tones, no harsh contrast). The green is sophisticated enough to avoid "beginner" associations while remaining inviting.

---

## Typography

### Typefaces

Typography varies by surface. The shared thread is warmth and readability.

**Display (Landing Page, Onboarding Headers): Georgia**
- **Display:** Georgia Bold, 60-64px, tight leading (1.08)
- **Body (Landing Page):** Georgia Regular, 17-19px, generous leading (1.7)

Georgia provides timeless, readable serif typography. On the landing page and marketing materials it carries the primary voice. In the desktop app, it appears sparingly for display headers and empty states to add warmth.

**GUI Primary: IBM Plex Mono**
- **Body:** 13-14px, line-height 1.6
- **Labels/Captions:** 11-12px, uppercase, letter-spacing 0.08-0.12em
- **Code blocks:** 13px, line-height 1.5

IBM Plex Mono gives the desktop app a technical, terminal-adjacent feel while remaining warmer and more readable than system monospace fonts. It serves as the primary font for the GUI — body text, labels, buttons, and all UI chrome.

**UI Accent: DM Mono**
- **Buttons/Tags (Landing Page):** 12-14px, uppercase, letter-spacing 0.12em

DM Mono pairs with Georgia on the landing page and marketing. In the GUI, IBM Plex Mono fills this role.

**Terminal (TUI): IBM Plex Mono**
- **TUI Text:** 13px, line-height 1.7

### Surface-Specific Typography

**Landing Page / Marketing:**
```
H1: Georgia Bold, 64px, -0.02em tracking, color: #1C1408
H2: Georgia Bold, 36px, -0.01em tracking, color: #1C1408
Body: Georgia Regular, 19px, 1.7 leading, color: #6B5E4F
Caption: DM Mono, 12px, uppercase, 0.12em tracking, color: #8B7B5E
```

**Desktop App (GUI):**
```
Display: Georgia Bold, 24-28px, color: #1C1408  (empty states, onboarding)
H3: IBM Plex Mono, 14px, semi-bold, color: #2C2417
Body: IBM Plex Mono, 13-14px, 1.6 leading, color: #6B5E4F
Label: IBM Plex Mono, 11px, uppercase, 0.08em tracking, color: #7A6B52
Code: IBM Plex Mono, 13px, 1.5 leading
```

**Terminal (TUI):**
```
Body: IBM Plex Mono, 13px, 1.7 leading, color: #E8DCCA
Dim: IBM Plex Mono, 13px, color: #5C4E38
```

---

## Terminal UI (TUI) Components

### Visual Structure

The TUI follows this vertical layout:
1. **Status bar** (top)
2. **Divider** (em-dashes)
3. **Chat area** (scrollable center)
4. **Divider**
5. **Input/Modal** (bottom)

### Color Mapping

**Terminal Background:** `#1C1408` (Leather)
**Chrome Bar:** `#251C0F` (Slightly lighter)

**Window Dots:**
- Red: `#C47A5A`
- Yellow: `#C4A85A`
- Green: `#5AA47A`

**Text Colors:**
- Base text: `#B8A88A`
- `you` label: `#6DBF8B` (bright green, bold)
- `clark` label: `#7EB8C9` (sky blue, bold)
- `thinking` label: `#5C4E38` (dim, italic)
- Regular message text: `#E8DCCA` (warm white)
- Dim/secondary text: `#5C4E38`
- Slash commands: `#C9A84C` (brass)
- Selected items: `#7EB8C9` (sky blue, bold)
- Selected text: `#E8DCCA` (warm white, bold)
- Thinking spinner: `#6DBFB8` (cyan)
- Streaming cursor: `#6DBFB8` (cyan underscore)
- Input cursor: `#E8DCCA` (inverted block)

**Dividers:** `#3D3020` (very dim, 25% opacity)

### Component Patterns

**Status Bar:**
```
[provider]/[model]     [canvas status]     [thinking indicator]
```
- Provider in bold blue, model in dim
- Canvas: green when connected, yellow when disconnected, gray when none
- Thinking: cyan, animated dots

**Selection Indicators:**
- Selected: `"> "` in blue + content in bold
- Unselected: `"  "` in dim + content in dim

**Help Text:**
- Small (11px), dim (35% opacity), bottom of pickers
- Format: `tab complete  ↑↓ navigate  esc dismiss`

---

## UI Components

### Buttons

**Primary (Lamp Green):**
```css
background: #3D7A5F
color: #FAF6EE
padding: 13px 32px
border-radius: 8px
font: DM Mono 14px medium
hover: #2E6049
```

**Secondary (Outline):**
```css
background: transparent
color: #5C4E38
border: 1.5px solid #C4B694
padding: 12px 28px
border-radius: 8px
font: DM Mono 14px medium
hover: border-color #3D7A5F, color #3D7A5F
```

### Tags/Labels
```css
font: DM Mono 12px
text-transform: uppercase
letter-spacing: 0.12em
color: #3D7A5F
border: 1.5px solid #3D7A5F
padding: 5px 14px
border-radius: 4px
```

### Feature Cards
- Border-top: 2px solid `#3D7A5F`
- Padding-top: 20px
- No background, no box shadow
- Clean, minimal, content-focused

### Voice Blocks
```css
background: #F2ECDF
border-left: 3px solid #3D7A5F
border-radius: 0 8px 8px 0
padding: 20px 24px
font: Georgia 16px
line-height: 1.7
color: #5C4E38
```

---

## Brand Voice

### Tone Guidelines

**Encouraging, not evaluative:**
- ✅ "Nice work getting that loop right!"
- ❌ "Correct."

**Asks before telling:**
- ✅ "What does your base case look like so far?"
- ❌ "Your base case should be..."

**Normalizes struggle:**
- ✅ "Recursion trips everyone up at first."
- ❌ "This is a common beginner mistake."

**Honest about uncertainty:**
- ✅ "I'm not certain, but I think..."
- ❌ Never bluff or state uncertainty as fact.

### Example Rewrites

**Instead of:** "Error: invalid syntax at line 12"
**Clark says:** "Looks like there's a small syntax issue on line 12—you might be missing a closing parenthesis. Want me to walk through it?"

**Instead of:** "This approach is inefficient."
**Clark says:** "This works! If you're curious, there's a way to make it faster using a hash map. Want to explore that?"

**Instead of:** "You need to add a return statement."
**Clark asks:** "What do you want this function to give back when it's done?"

---

## Design Principles

### 1. No Emojis
Emojis can feel patronizing or overly casual in a learning context. Clark's warmth comes from word choice and tone, not visual decoration.

### 2. Serif for Authority, Not Stiffness
Georgia strikes the balance between approachable and credible. It's readable, familiar, and carries enough weight to be taken seriously without feeling academic or cold.

### 3. Warm Neutrals Over Cool Grays
The brown-toned neutrals (walnut, patina, leather) create a warmer, more inviting feel than typical developer tools. This reinforces the "supportive peer" positioning.

### 4. Minimal UI, Maximum Content
Cards and containers use subtle borders and spacing rather than heavy shadows or backgrounds. Let the content breathe. The interface should feel calm and uncluttered.

### 5. Terminal as First-Class Citizen
The TUI isn't an afterthought—it's the primary interface. Colors, typography, and spacing are optimized for terminal rendering. The design doesn't try to make the terminal look like a web app; it embraces its terminal nature with warmth.

### 6. Inline Over Modal
Prefer dropdowns, popovers, and inline expansion over modal dialogs. Modals interrupt flow and feel heavy. Use them only for destructive actions or multi-step forms (e.g., API key entry). For selections (model, canvas), use compact dropdowns or popover panels.

### 7. Integrated Chrome
UI chrome (status bars, toolbars) should feel like part of the window, not bolted on. Use the native titlebar area where possible. Avoid heavy colored bars. Status information should be present but not loud — subtle text alongside window controls, not a competing visual element.

---

## Implementation Notes

### Typography Fallbacks
```css
font-family: Georgia, 'Times New Roman', serif;
font-family: 'IBM Plex Mono', 'Menlo', 'Consolas', monospace;
font-family: 'DM Mono', 'Menlo', monospace;
```

### Accessibility
- Maintain 4.5:1 contrast ratio minimum for body text
- Lamp green (`#3D7A5F`) on parchment (`#FAF6EE`) = 5.2:1 ✓
- Walnut (`#6B5E4F`) on parchment = 4.8:1 ✓
- Terminal colors optimized for dark background readability

### Spacing Scale
```
xs:  8px
sm:  12px
md:  16px
lg:  24px
xl:  32px
2xl: 48px
3xl: 72px
```

### Border Radius Scale
```
sm: 4px   (tags)
md: 6px   (buttons, small cards)
lg: 8px   (voice blocks, feature cards)
xl: 12px  (terminal windows)
```

---

## Desktop App (GUI) Components

The GUI is a Tauri desktop app with a React frontend. It shares the Library palette and brand values with the TUI but adapts them for a graphical context.

### Window Structure

```
┌─ Custom Titlebar ──────────────────────────────────────────┐
│  [●●●]  model: claude-sonnet   ○ Canvas: Problem Set 3    │
├────────────────────────────────────────────────────────────┤
│  ┌── Sidebar ──┐  ┌── Chat ────────────────────────────┐  │
│  │  File tree   │  │                                    │  │
│  │  (collaps.)  │  │  Messages + inline tool cards      │  │
│  │             │  │                                    │  │
│  └─────────────┘  │                                    │  │
│                    ├────────────────────────────────────┤  │
│                    │  Composer (textarea + send)        │  │
│                    └────────────────────────────────────┘  │
├────────────────────────────────────────────────────────────┤
│  [thinking...]                          context: 42%      │
└────────────────────────────────────────────────────────────┘
```

- **Custom titlebar:** `decorations: false` in Tauri, custom drag region. Embeds model name and canvas status alongside traffic lights. Parchment background, subtle bottom border.
- **Sidebar:** Collapsible file tree. No emojis — disclosure triangles for folders, file extensions for type. Warm neutral background (`#F5F0E6`).
- **Chat area:** Parchment background. Messages flow top-to-bottom with clear role distinction.
- **Composer:** Fixed bottom of chat area. Clean input with subtle border, lamp-green send button.
- **Bottom bar:** Slim (24-28px), shows thinking indicator and context usage. Blends with window chrome.

### Chat Messages

**User messages:**
- Subtle lamp-green left border (3px) or very light green tint background
- Right-aligned is optional; left-aligned with role distinction works well too

**Assistant messages:**
- White or parchment background, walnut text
- "clark" label in sky blue, IBM Plex Mono 11px uppercase

**Tool call cards (inline):**
- Compact summary: icon + tool name + brief result (e.g., "Read notes.md — 42 lines")
- Expandable on click to show full input/output
- Subtle background (`#F5F0E6`), 1px patina border, 6px border-radius
- No drop shadows

**Thinking indicator (inline):**
- Shows in the chat flow as a message-like block
- Animated dots or subtle spinner + "Thinking..." in dim patina text
- Expandable to show thinking content if available

### Model Picker

- **Trigger:** Clickable model name in titlebar or status area
- **Presentation:** Dropdown/popover, not a modal
- **Content:** Grouped by provider, current model highlighted with lamp-green dot
- **API key flow:** Inline password input within the dropdown for unconfigured providers
- **Interaction:** Click or arrow keys to select, Escape to dismiss

### Canvas Picker

- **Trigger:** Canvas status indicator in titlebar (always visible, even when no session)
- **Presentation:** Popover panel below the trigger
- **Content:** List of existing canvases + "New canvas" input
- **Copy URL:** Prominent copy button next to the active canvas name (primary action)
- **Status:** Colored dot (sage=connected, brass=connecting, patina=none)

### File Sidebar

- **Toggle:** Small icon button in titlebar or keyboard shortcut
- **Structure:** Nested tree with disclosure triangles (not emoji folders)
- **File type:** Indicated by extension text (`.md`, `.pdf`) or minimal monochrome SVG icon
- **Interaction:** Click to expand folders; click file for future preview/action
- **Active item:** Lamp-green left border accent
- **Background:** Warm neutral (#F5F0E6), 1px right border in patina

---

## Future Considerations

### Landing Page
- Hero section with parchment background
- Feature grid using minimal card pattern
- Terminal preview showcasing actual TUI
- CTA buttons using primary/secondary pattern

### Documentation Site
- Sidebar: Lamp green highlight for active item
- Code blocks: Terminal color scheme
- Pull quotes: Voice block styling
- Section dividers: 1px solid patina

### Marketing Materials
- Maintain warm, studious feel
- Photography: warm lighting, natural materials (wood, paper, soft fabrics)
- Avoid: harsh fluorescents, sterile environments, stock "tech" imagery
- Tone: Personal stories, student testimonials, "office hours" metaphor

---

## Rationale Summary

**Why "The Library" theme works for Clark:**

1. **Universally understood** — Everyone has positive associations with a helpful librarian or quiet study space.
2. **Studious without being stuffy** — The warm palette keeps it approachable.
3. **Timeless** — Green lamp + wood + cream won't feel dated in 5 years.
4. **Differentiating** — Most dev tools use blue/purple/neon. This stands out.
5. **Aligns with values** — The physicality of a library (warm, patient, resourceful) maps directly to Clark's personality.

The design doesn't try to be flashy or trendy. It's confident, warm, and built for the long haul—just like a good TA.
