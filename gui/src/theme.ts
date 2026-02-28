/**
 * Clark GUI Theme — CSS color constants.
 *
 * Adapted from cli/tui/theme.ts for web use.
 * Source of truth: docs/design/COLOR-PALETTE.md
 */

export const Colors = {
  // Primary
  lampGreen: "#3D7A5F",
  deepFern: "#2E6049",

  // Neutrals
  leather: "#1C1408",
  walnut: "#6B5E4F",
  parchment: "#FAF6EE",
  patina: "#7A6B52",

  // Supporting
  brass: "#C9A84C",
  sky: "#7EB8C9",
  sage: "#81C784",

  // Text
  baseText: "#B8A88A",
  messageText: "#E8DCCA",
  dimText: "#5C4E38",
  userLabel: "#6DBF8B",
  assistantLabel: "#7EB8C9",
  systemLabel: "#5C4E38",
  thinkingLabel: "#5C4E38",

  // Interactive
  slashCommand: "#C9A84C",
  selectedItem: "#7EB8C9",
  selectedText: "#E8DCCA",

  // Status
  thinkingSpinner: "#6DBFB8",
  streamingCursor: "#6DBFB8",
  inputCursor: "#E8DCCA",

  // Chrome
  divider: "#3D3020",
  background: "#1C1408",
  chromeBar: "#251C0F",
  codeBlockBg: "#2E2416",

  // Semantic
  error: "#C47A5A",
  warning: "#C4A85A",

  // Window dots
  dotRed: "#C47A5A",
  dotYellow: "#C4A85A",
  dotGreen: "#5AA47A",
} as const;
