/**
 * Onboarding flow — shown on first run when no API key is configured.
 */

import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { loadConfig, saveConfig, type ClarkConfig } from "../config.ts";
import { scaffoldLibrary } from "../library.ts";
import { useLineEditor } from "./primitives/use-line-editor.ts";
import { useSelectableList } from "./primitives/use-selectable-list.ts";

type Step = "welcome" | "provider" | "api-key" | "done";

interface ProviderOption {
  id: string;
  name: string;
  envVar: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: "anthropic", name: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY" },
  { id: "openai", name: "OpenAI (GPT-4o)", envVar: "OPENAI_API_KEY" },
  { id: "gemini", name: "Google (Gemini)", envVar: "GOOGLE_API_KEY" },
  { id: "ollama", name: "Ollama (Local)", envVar: "" },
];

export interface OnboardingProps {
  onComplete: (config: ClarkConfig) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const providerList = useSelectableList(PROVIDERS.length);
  const apiKey = useLineEditor("");
  const { exit } = useApp();

  async function completeSetup(partialConfig: ClarkConfig): Promise<void> {
    const cwd = process.cwd();
    const currentConfig = await loadConfig();
    await scaffoldLibrary(cwd);

    const updatedConfig: ClarkConfig = {
      ...currentConfig,
      ...partialConfig,
      pdfExportDir: currentConfig.pdfExportDir ?? cwd,
    };

    await saveConfig(updatedConfig);
    setStep("done");
    onComplete(updatedConfig);
  }

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (isSettingUp) return;

    if (step === "welcome") {
      if (key.return) {
        setStep("provider");
      }
      return;
    }

    if (step === "provider") {
      if (key.upArrow) {
        providerList.moveUp();
        return;
      }
      if (key.downArrow) {
        providerList.moveDown();
        return;
      }
      if (key.return) {
        const provider = PROVIDERS[providerList.selected]!;
        if (provider.id === "ollama") {
          setIsSettingUp(true);
          setError(null);
          completeSetup({ provider: "ollama" }).catch((err) => {
            setError(`Failed to finish setup: ${err instanceof Error ? err.message : String(err)}`);
            setIsSettingUp(false);
          });
        } else {
          setStep("api-key");
        }
      }
      return;
    }

    if (step === "api-key") {
      if (key.return) {
        const provider = PROVIDERS[providerList.selected]!;
        const trimmed = apiKey.valueRef.current.trim();

        if (!trimmed) {
          setError("API key cannot be empty.");
          return;
        }

        const keyField = provider.id === "anthropic"
          ? "anthropicApiKey"
          : provider.id === "gemini"
            ? "geminiApiKey"
            : "openaiApiKey";

        setIsSettingUp(true);
        setError(null);
        completeSetup({
          provider: provider.id,
          [keyField]: trimmed,
        }).catch((err) => {
          setError(`Failed to finish setup: ${err instanceof Error ? err.message : String(err)}`);
          setIsSettingUp(false);
        });
        return;
      }

      if (key.escape) {
        setStep("provider");
        apiKey.clear();
        setError(null);
        return;
      }

      if (key.backspace || key.delete) {
        apiKey.backspaceOrDelete();
        setError(null);
        return;
      }

      if (key.leftArrow) {
        apiKey.moveLeft();
        return;
      }

      if (key.rightArrow) {
        apiKey.moveRight();
        return;
      }

      if (key.ctrl && input === "u") {
        apiKey.clear();
        setError(null);
        return;
      }

      if (!key.ctrl && !key.meta && input) {
        apiKey.insert(input);
        setError(null);
      }
    }
  });

  if (step === "welcome") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="blue" bold>
          {`
   _____ _            _
  / ____| |          | |
 | |    | | __ _ _ __| | __
 | |    | |/ _\` | '__| |/ /
 | |____| | (_| | |  |   <
  \\_____|_|\\__,_|_|  |_|\\_\\
`}
        </Text>
        <Text>Welcome to <Text bold>Clark</Text>, your Socratic tutoring assistant.</Text>
        <Text color="gray" dimColor> </Text>
        <Text>Let's get you set up. You'll need an API key from an LLM provider.</Text>
        <Text color="gray" dimColor> </Text>
        <Text color="gray">Press <Text bold color="white">Enter</Text> to continue, <Text bold color="white">Ctrl+C</Text> to exit.</Text>
      </Box>
    );
  }

  if (step === "provider") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Choose your LLM provider:</Text>
        <Text color="gray" dimColor> </Text>
        {PROVIDERS.map((provider, i) => (
          <Box key={provider.id} paddingLeft={2}>
            <Text color={i === providerList.selected ? "blue" : "gray"}>
              {i === providerList.selected ? "> " : "  "}
              <Text bold={i === providerList.selected}>{provider.name}</Text>
            </Text>
          </Box>
        ))}
        {error && (
          <>
            <Text color="gray" dimColor> </Text>
            <Text color="red">{error}</Text>
          </>
        )}
        <Text color="gray" dimColor> </Text>
        <Text color="gray">Use <Text bold color="white">arrow keys</Text> to select, <Text bold color="white">Enter</Text> to confirm.</Text>
      </Box>
    );
  }

  const provider = PROVIDERS[providerList.selected]!;
  const masked = apiKey.value.length > 12
    ? apiKey.value.slice(0, 8) + "*".repeat(apiKey.value.length - 12) + apiKey.value.slice(-4)
    : apiKey.value;
  const before = masked.slice(0, apiKey.cursor);
  const cursorChar = masked[apiKey.cursor] ?? " ";
  const after = masked.slice(apiKey.cursor + 1);

  if (step === "api-key") {
    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Enter your {provider.name} API key:</Text>
        <Text color="gray" dimColor> </Text>
        <Text color="gray" dimColor>
          You can get one from {provider.id === "anthropic" ? "console.anthropic.com" : provider.id === "gemini" ? "aistudio.google.com" : "platform.openai.com"}
        </Text>
        <Text color="gray" dimColor>Saved to ~/.clark/config.json (set {provider.envVar} to override)</Text>
        <Text color="gray" dimColor> </Text>
        <Box paddingLeft={2}>
          <Text color="yellow">{before}</Text>
          <Text inverse>{cursorChar}</Text>
          <Text color="yellow">{after}</Text>
        </Box>
        {error && (
          <>
            <Text color="gray" dimColor> </Text>
            <Text color="red">{error}</Text>
          </>
        )}
        {isSettingUp && (
          <>
            <Text color="gray" dimColor> </Text>
            <Text color="yellow">Setting up workspace...</Text>
          </>
        )}
        <Text color="gray" dimColor> </Text>
        <Text color="gray"><Text bold color="white">Enter</Text> to save, <Text bold color="white">Esc</Text> to go back.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green">Setup complete. Starting Clark...</Text>
    </Box>
  );
}
