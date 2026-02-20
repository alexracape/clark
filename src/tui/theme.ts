/**
 * Clark TUI Theme
 *
 * Color palette based on design/DESIGN.md "The Library" theme.
 * Uses chalk.hex() for exact terminal color rendering.
 */

import chalk from "chalk";

/**
 * Raw color values from DESIGN.md
 */
export const Colors = {
  // Text colors
  baseText: "#B8A88A",
  messageText: "#E8DCCA",      // Regular message text (warm white)
  dimText: "#5C4E38",          // Dim/secondary text

  // Role labels
  userLabel: "#6DBF8B",        // 'you' label (bright green, bold)
  assistantLabel: "#7EB8C9",   // 'clark' label (sky blue, bold)
  systemLabel: "#5C4E38",      // 'system' label (dim)
  thinkingLabel: "#5C4E38",    // 'thinking' label (dim, italic)

  // Interactive elements
  slashCommand: "#C9A84C",     // Brass color for slash commands
  selectedItem: "#7EB8C9",     // Sky blue for selected items (bold)
  selectedText: "#E8DCCA",     // Warm white for selected text (bold)

  // Status indicators
  thinkingSpinner: "#6DBFB8",  // Cyan for thinking animation
  streamingCursor: "#6DBFB8",  // Cyan underscore for streaming
  inputCursor: "#E8DCCA",      // Inverted block cursor

  // Chrome
  divider: "#3D3020",          // Very dim dividers (25% opacity)
  background: "#1C1408",       // Leather (terminal background)
  chromeBar: "#251C0F",        // Slightly lighter than background

  // Semantic colors (from palette)
  lampGreen: "#3D7A5F",        // Primary accent
  sage: "#81C784",             // Success states
  brass: "#C9A84C",            // Special UI elements
  sky: "#7EB8C9",              // Cool blue
} as const;

/**
 * Styled text helpers using chalk.hex() for exact colors.
 * These return styled strings that can be used directly in Ink <Text> components.
 */
export const theme = {
  // Role labels
  user: (text: string) => chalk.hex(Colors.userLabel).bold(text),
  assistant: (text: string) => chalk.hex(Colors.assistantLabel).bold(text),
  system: (text: string) => chalk.hex(Colors.systemLabel).dim(text),
  thinking: (text: string) => chalk.hex(Colors.thinkingLabel).dim.italic(text),

  // Message content
  message: (text: string) => chalk.hex(Colors.messageText)(text),
  dim: (text: string) => chalk.hex(Colors.dimText)(text),
  base: (text: string) => chalk.hex(Colors.baseText)(text),

  // Interactive elements
  slashCommand: (text: string) => chalk.hex(Colors.slashCommand)(text),
  selected: (text: string) => chalk.hex(Colors.selectedItem).bold(text),
  selectedText: (text: string) => chalk.hex(Colors.selectedText).bold(text),

  // Status
  spinner: (text: string) => chalk.hex(Colors.thinkingSpinner)(text),
  cursor: (text: string) => chalk.hex(Colors.streamingCursor)(text),

  // Dividers
  divider: (text: string) => chalk.hex(Colors.divider)(text),

  // Semantic colors
  success: (text: string) => chalk.hex(Colors.sage)(text),
  accent: (text: string) => chalk.hex(Colors.lampGreen)(text),
  highlight: (text: string) => chalk.hex(Colors.brass)(text),
} as const;

/**
 * Component-specific theme helpers
 */
export const componentTheme = {
  statusBar: {
    provider: (text: string) => chalk.hex(Colors.assistantLabel).bold(text),
    model: (text: string) => chalk.hex(Colors.dimText).dim(text),
    separator: (text: string) => chalk.hex(Colors.dimText).dim(text),
  },

  input: {
    prompt: (text: string) => chalk.hex(Colors.userLabel).bold(text),
    text: (text: string) => chalk.hex(Colors.messageText)(text),
    slashCommand: (text: string) => chalk.hex(Colors.slashCommand)(text),
    cursor: (text: string) => chalk.hex(Colors.inputCursor).inverse(text),
    hint: (text: string) => chalk.hex(Colors.dimText).dim(text),
  },

  hints: {
    selected: (text: string) => chalk.hex(Colors.selectedItem).bold(text),
    unselected: (text: string) => chalk.hex(Colors.dimText)(text),
    label: (text: string) => chalk.hex(Colors.slashCommand)(text),
    description: (text: string) => chalk.hex(Colors.dimText).dim(text),
  },
} as const;

/**
 * Utility: Get raw hex color (for Ink's color prop if needed)
 */
export const hex = Colors;
