/**
 * Interactive model picker — shown when the user types /model.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { resolveApiKey, saveConfig, setProviderApiKey, type ClarkConfig } from "../config.ts";
import { getCloudModelEntries, getProviderCatalogEntry, isApiKeyProvider } from "../llm/catalog.ts";
import { useLineEditor } from "./primitives/use-line-editor.ts";
import { useSelectableList } from "./primitives/use-selectable-list.ts";
import { hex } from "./theme.ts";

interface ModelEntry {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
}

const CLOUD_MODELS: ModelEntry[] = getCloudModelEntries();

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
  const [availableProviders, setAvailableProviders] = useState<Record<string, boolean>>({});

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
          providerLabel: getProviderCatalogEntry("ollama")?.label ?? "Ollama (Local)",
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
    return availableProviders[provider] === true;
  };

  useEffect(() => {
    let cancelled = false;
    const providers = [...new Set(allModels.map((m) => m.provider).filter((p) => p !== "ollama"))];

    Promise.all(providers.map(async (provider) => ({
      provider,
      hasKey: !!(await resolveApiKey(provider, config)),
    })))
      .then((rows) => {
        if (cancelled) return;
        setAvailableProviders(Object.fromEntries(rows.map((r) => [r.provider, r.hasKey])));
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableProviders({});
      });

    return () => {
      cancelled = true;
    };
  }, [allModels, config]);

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
      if (!isApiKeyProvider(entry.provider)) return;

      setError(null);
      setProviderApiKey(entry.provider, trimmed, config)
        .then((nextConfig) => saveConfig(nextConfig))
        .then(() => {
          setAvailableProviders((prev) => ({ ...prev, [entry.provider]: true }));
          onSelect(entry.provider, entry.model);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
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
    if (!isApiKeyProvider(entry.provider)) return null;
    const providerInfo = getProviderCatalogEntry(entry.provider);
    if (!providerInfo?.envVar || !providerInfo.site) return null;

    const masked = apiKey.value.length > 12
      ? apiKey.value.slice(0, 8) + "*".repeat(apiKey.value.length - 12) + apiKey.value.slice(-4)
      : apiKey.value;

    const before = masked.slice(0, apiKey.cursor);
    const cursorChar = masked[apiKey.cursor] ?? " ";
    const after = masked.slice(apiKey.cursor + 1);

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Enter your {entry.providerLabel} API key:</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Get one from {providerInfo.site}</Text>
        <Text color={hex.dimText}>Saved to macOS Keychain (set {providerInfo.envVar} to override)</Text>
        <Text color={hex.dimText}> </Text>
        <Box paddingLeft={2}>
          <Text color={hex.brass}>{before}</Text>
          <Text inverse>{cursorChar}</Text>
          <Text color={hex.brass}>{after}</Text>
        </Box>
        {error && (
          <>
            <Text color={hex.dimText}> </Text>
            <Text color={hex.error}>{error}</Text>
          </>
        )}
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}><Text bold color={hex.messageText}>Enter</Text> to save <Text bold color={hex.messageText}>Esc</Text> to go back</Text>
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
                <Text bold color={hex.baseText}>{entry.providerLabel}</Text>
                {!available && <Text color={hex.brass}>{"  "}[setup required]</Text>}
              </Box>
            )}
            <Box paddingLeft={4}>
              <Text color={isSelected ? hex.sky : hex.dimText}>{isSelected ? "> " : "  "}</Text>
              <Text bold={isSelected} color={isSelected ? hex.messageText : hex.dimText} dimColor={!available && !isSelected}>{entry.label}</Text>
              {isCurrent && <Text color={hex.sage}>{"  "}(current)</Text>}
            </Box>
          </React.Fragment>
        );
      })}

      {ollamaModels.length === 0 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          <Box>
            <Text bold color={hex.baseText}>Ollama (Local)</Text>
            {ollamaStatus === "loading" && <Text color={hex.dimText}>{"  "}checking...</Text>}
            {ollamaStatus === "not-running" && <Text color={hex.error}>{"  "}[not running]</Text>}
            {ollamaStatus === "no-models" && <Text color={hex.brass}>{"  "}[no models]</Text>}
          </Box>
          {ollamaStatus === "not-running" && (
            <Box flexDirection="column" paddingLeft={2}>
              <Text color={hex.dimText}>Start the server:   <Text color={hex.messageText}>ollama serve</Text></Text>
              <Text color={hex.dimText}>Install (macOS):    <Text color={hex.messageText}>brew install ollama</Text></Text>
            </Box>
          )}
          {ollamaStatus === "no-models" && (
            <Box flexDirection="column" paddingLeft={2}>
              <Text color={hex.dimText}>Download a model:   <Text color={hex.messageText}>ollama pull llama3.2</Text></Text>
              <Text color={hex.dimText}>Browse models:      <Text color={hex.messageText}>ollama list</Text></Text>
            </Box>
          )}
        </Box>
      )}

      <Text> </Text>
      <Text color={hex.dimText}>{"  "}↑↓ navigate  enter select  esc cancel</Text>
    </Box>
  );
}
