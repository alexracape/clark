/**
 * Interactive model picker — shown when the user types /model.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { resolveApiKey, saveConfig, type ClarkConfig } from "../config.ts";
import { useLineEditor } from "./primitives/use-line-editor.ts";
import { useSelectableList } from "./primitives/use-selectable-list.ts";

interface ModelEntry {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
}

const CLOUD_MODELS: ModelEntry[] = [
  { provider: "anthropic", providerLabel: "Anthropic (Claude)", model: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { provider: "anthropic", providerLabel: "Anthropic (Claude)", model: "claude-haiku-3-5-20241022", label: "Claude Haiku 3.5" },
  { provider: "openai", providerLabel: "OpenAI", model: "gpt-4o", label: "GPT-4o" },
  { provider: "openai", providerLabel: "OpenAI", model: "gpt-4o-mini", label: "GPT-4o Mini" },
  { provider: "gemini", providerLabel: "Google (Gemini)", model: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
];

const PROVIDER_INFO: Record<string, { envVar: string; site: string; configKey: keyof ClarkConfig }> = {
  anthropic: { envVar: "ANTHROPIC_API_KEY", site: "console.anthropic.com", configKey: "anthropicApiKey" },
  openai: { envVar: "OPENAI_API_KEY", site: "platform.openai.com", configKey: "openaiApiKey" },
  gemini: { envVar: "GOOGLE_API_KEY", site: "aistudio.google.com", configKey: "geminiApiKey" },
};

export interface ModelPickerProps {
  currentProvider: string;
  currentModel: string;
  config: ClarkConfig;
  onSelect: (provider: string, model: string) => void;
  onCancel: () => void;
}

type Step = "selecting" | "entering-key";
type OllamaStatus = "loading" | "running" | "not-running" | "no-models";

export function ModelPicker({ currentProvider, currentModel, config, onSelect, onCancel }: ModelPickerProps) {
  const [step, setStep] = useState<Step>("selecting");
  const [error, setError] = useState<string | null>(null);
  const apiKey = useLineEditor("");

  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("loading");
  const [ollamaModels, setOllamaModels] = useState<ModelEntry[]>([]);

  useEffect(() => {
    import("../llm/ollama.ts")
      .then(({ listLocalModels }) => listLocalModels())
      .then((models) => {
        if (models.length === 0) {
          setOllamaStatus("no-models");
          return;
        }
        setOllamaStatus("running");
        setOllamaModels(models.map((m) => ({
          provider: "ollama",
          providerLabel: "Ollama (Local)",
          model: m.name,
          label: m.name,
        })));
      })
      .catch(() => {
        setOllamaStatus("not-running");
      });
  }, []);

  const allModels = useMemo(() => [...CLOUD_MODELS, ...ollamaModels], [ollamaModels]);
  const list = useSelectableList(allModels.length);

  useEffect(() => {
    const currentIndex = allModels.findIndex((entry) => entry.provider === currentProvider && entry.model === currentModel);
    if (currentIndex >= 0) {
      list.setSelected(currentIndex);
    }
  }, [allModels, currentProvider, currentModel]);

  const isProviderAvailable = (provider: string): boolean => {
    if (provider === "ollama") return true;
    return !!resolveApiKey(provider, config);
  };

  useInput((input, key) => {
    if (step === "selecting") {
      if (key.upArrow) {
        list.moveUp();
        return;
      }
      if (key.downArrow) {
        list.moveDown();
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        if (allModels.length === 0) return;
        const entry = allModels[list.selected];
        if (!entry) return;

        if (entry.provider === currentProvider && entry.model === currentModel) {
          onCancel();
          return;
        }

        if (isProviderAvailable(entry.provider)) {
          onSelect(entry.provider, entry.model);
        } else {
          setStep("entering-key");
          apiKey.clear();
          setError(null);
        }
      }
      return;
    }

    if (key.escape) {
      setStep("selecting");
      apiKey.clear();
      setError(null);
      return;
    }

    if (key.return) {
      const trimmed = apiKey.valueRef.current.trim();
      if (!trimmed) {
        setError("API key cannot be empty.");
        return;
      }

      const entry = allModels[list.selected];
      if (!entry) return;
      const info = PROVIDER_INFO[entry.provider];
      if (!info) return;

      process.env[info.envVar] = trimmed;
      const nextConfig: ClarkConfig = {
        ...config,
        [info.configKey]: trimmed,
      };

      saveConfig(nextConfig).then(() => {
        onSelect(entry.provider, entry.model);
      });
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
  });

  if (step === "entering-key") {
    const entry = allModels[list.selected]!;
    const info = PROVIDER_INFO[entry.provider]!;

    const masked = apiKey.value.length > 12
      ? apiKey.value.slice(0, 8) + "*".repeat(apiKey.value.length - 12) + apiKey.value.slice(-4)
      : apiKey.value;

    const before = masked.slice(0, apiKey.cursor);
    const cursorChar = masked[apiKey.cursor] ?? " ";
    const after = masked.slice(apiKey.cursor + 1);

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Enter your {entry.providerLabel} API key:</Text>
        <Text color="gray" dimColor> </Text>
        <Text color="gray" dimColor>Get one from {info.site}</Text>
        <Text color="gray" dimColor>Saved to ~/.clark/config.json (set {info.envVar} to override)</Text>
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
        <Text color="gray" dimColor> </Text>
        <Text color="gray"><Text bold color="white">Enter</Text> to save <Text bold color="white">Esc</Text> to go back</Text>
      </Box>
    );
  }

  let lastProvider = "";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Switch model:</Text>
      <Text> </Text>
      {allModels.map((entry, i) => {
        const isNewGroup = entry.provider !== lastProvider;
        lastProvider = entry.provider;
        const isCurrent = entry.provider === currentProvider && entry.model === currentModel;
        const isSelected = i === list.selected;
        const available = isProviderAvailable(entry.provider);

        return (
          <React.Fragment key={`${entry.provider}-${entry.model}`}>
            {isNewGroup && (
              <Box paddingLeft={2} marginTop={i === 0 ? 0 : 1}>
                <Text bold color="gray">{entry.providerLabel}</Text>
                {!available && <Text color="yellow" dimColor>{"  "}[setup required]</Text>}
              </Box>
            )}
            <Box paddingLeft={4}>
              <Text color={isSelected ? "blue" : "gray"}>{isSelected ? "> " : "  "}</Text>
              <Text bold={isSelected} color={isSelected ? "white" : "gray"} dimColor={!available && !isSelected}>{entry.label}</Text>
              {isCurrent && <Text color="green" dimColor>{"  "}(current)</Text>}
            </Box>
          </React.Fragment>
        );
      })}

      {ollamaModels.length === 0 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          <Box>
            <Text bold color="gray">Ollama (Local)</Text>
            {ollamaStatus === "loading" && <Text color="gray" dimColor>{"  "}checking...</Text>}
            {ollamaStatus === "not-running" && <Text color="red" dimColor>{"  "}[not running]</Text>}
            {ollamaStatus === "no-models" && <Text color="yellow" dimColor>{"  "}[no models]</Text>}
          </Box>
          {ollamaStatus === "not-running" && (
            <Box flexDirection="column" paddingLeft={2}>
              <Text color="gray" dimColor>Start the server:   <Text color="white">ollama serve</Text></Text>
              <Text color="gray" dimColor>Install (macOS):    <Text color="white">brew install ollama</Text></Text>
            </Box>
          )}
          {ollamaStatus === "no-models" && (
            <Box flexDirection="column" paddingLeft={2}>
              <Text color="gray" dimColor>Download a model:   <Text color="white">ollama pull llama3.2</Text></Text>
              <Text color="gray" dimColor>Browse models:      <Text color="white">ollama list</Text></Text>
            </Box>
          )}
        </Box>
      )}

      <Text> </Text>
      <Text color="gray">{"  "}<Text color="gray">↑↓</Text> navigate <Text color="gray">enter</Text> select <Text color="gray">esc</Text> cancel</Text>
    </Box>
  );
}
