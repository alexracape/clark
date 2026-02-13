/**
 * TUI module — re-exports app components.
 */

export { App } from "./app.tsx";
export type { AppProps } from "./app.tsx";
export { Chat } from "./chat.tsx";
export type { ChatMessage, ChatProps } from "./chat.tsx";
export { Input, parseSlashCommand, COMMANDS } from "./input.tsx";
export type { InputProps, SlashCommand } from "./input.tsx";
export { StatusBar } from "./status.tsx";
export type { StatusBarProps } from "./status.tsx";
export { Onboarding } from "./onboarding.tsx";
export type { OnboardingProps } from "./onboarding.tsx";
export { LibraryPicker } from "./library-picker.tsx";
export type { LibraryPickerProps } from "./library-picker.tsx";
