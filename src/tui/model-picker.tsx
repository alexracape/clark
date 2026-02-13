/**
 * Interactive model picker — shown when the user types /model.
 *
 * Displays available models grouped by provider with arrow-key navigation.
 * If a provider isn't configured, offers inline API key entry.
 * Ollama models are fetched dynamically from the local server.
 */

import React, { useState, useRef, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import {
  resolveApiKey,
  saveConfig,
  type ClarkConfig,
} from "../config.ts";

// --- Model catalog ---

interface ModelEntry {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
}

/** Cloud provider models (static) */
const CLOUD_MODELS: ModelEntry[] = [
  {
    provider: "anthropic",
    providerLabel: "Anthropic (Claude)",
    model: "claude-sonnet-4-5-20250929",
    label: "Claude Sonnet 4.5",
  },
  {
    provider: "anthropic",
    providerLabel: "Anthropic (Claude)",
    model: "claude-haiku-3-5-20241022",
    label: "Claude Haiku 3.5",
  },
  {
    provider: "openai",
    providerLabel: "OpenAI",
    model: "gpt-4o",
    label: "GPT-4o",
  },
  {
    provider: "openai",
    providerLabel: "OpenAI",
    model: "gpt-4o-mini",
    label: "GPT-4o Mini",
  },
  {
    provider: "gemini",
    providerLabel: "Google (Gemini)",
    model: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
  },
];

/** Provider info for API key entry */
const PROVIDER_INFO: Record<
  string,
  { envVar: string; site: string; configKey: keyof ClarkConfig }
> = {
  anthropic: {
    envVar: "ANTHROPIC_API_KEY",
    site: "console.anthropic.com",
    configKey: "anthropicApiKey",
  },
  openai: {
    envVar: "OPENAI_API_KEY",
    site: "platform.openai.com",
    configKey: "openaiApiKey",
  },
  gemini: {
    envVar: "GOOGLE_API_KEY",
    site: "aistudio.google.com",
    configKey: "geminiApiKey",
  },
};

// --- Component ---

export interface ModelPickerProps {
  currentProvider: string;
  currentModel: string;
  config: ClarkConfig;
  onSelect: (provider: string, model: string) => void;
  onCancel: () => void;
}

type Step = "selecting" | "entering-key";
type OllamaStatus = "loading" | "running" | "not-running" | "no-models";

export function ModelPicker({
  currentProvider,
  currentModel,
  config,
  onSelect,
  onCancel,
}: ModelPickerProps) {
  const [step, setStep] = useState<Step>("selecting");
  const [apiKey, setApiKey] = useState("");
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Ollama dynamic model discovery
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("loading");
  const [ollamaModels, setOllamaModels] = useState<ModelEntry[]>([]);

  useEffect(() => {
    import("../llm/ollama.ts")
      .then(({ listLocalModels }) => listLocalModels())
      .then((models) => {
        if (models.length === 0) {
          setOllamaStatus("no-models");
        } else {
          setOllamaStatus("running");
          setOllamaModels(
            models.map((m) => ({
              provider: "ollama",
              providerLabel: "Ollama (Local)",
              model: m.name,
              label: m.name,
            })),
          );
        }
      })
      .catch(() => {
        setOllamaStatus("not-running");
      });
  }, []);

  // Build full model list: cloud + dynamic ollama
  const allModels = useMemo(
    () => [...CLOUD_MODELS, ...ollamaModels],
    [ollamaModels],
  );

  // Find current selection index
  const currentIndex = allModels.findIndex(
    (m) => m.provider === currentProvider && m.model === currentModel,
  );
  const [selected, setSelected] = useState(
    currentIndex >= 0 ? currentIndex : 0,
  );

  // Keep selection in bounds when models change (Ollama loads async)
  useEffect(() => {
    if (selected >= allModels.length && allModels.length > 0) {
      setSelected(allModels.length - 1);
    }
    // If current model just appeared in the list, snap to it
    const idx = allModels.findIndex(
      (m) => m.provider === currentProvider && m.model === currentModel,
    );
    if (idx >= 0 && currentIndex < 0) {
      setSelected(idx);
    }
  }, [allModels.length]);

  // Refs for synchronous access in useInput
  const apiKeyRef = useRef("");
  const cursorRef = useRef(0);

  const setApiKeySync = (v: string) => {
    apiKeyRef.current = v;
    setApiKey(v);
  };

  const setCursorSync = (c: number) => {
    cursorRef.current = c;
    setCursor(c);
  };

  /** Check if a provider has credentials configured */
  function isProviderAvailable(provider: string): boolean {
    if (provider === "ollama") return true;
    const key = resolveApiKey(provider, config);
    return !!key;
  }

  useInput((input, key) => {
    if (step === "selecting") {
      if (key.upArrow) {
        setSelected((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setSelected((i) => Math.min(allModels.length - 1, i + 1));
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        if (allModels.length === 0) return;
        const entry = allModels[selected];
        if (!entry) return;

        // Already the current model — just cancel
        if (
          entry.provider === currentProvider &&
          entry.model === currentModel
        ) {
          onCancel();
          return;
        }

        if (isProviderAvailable(entry.provider)) {
          onSelect(entry.provider, entry.model);
        } else {
          // Need API key — transition to key entry
          setStep("entering-key");
          setApiKeySync("");
          setCursorSync(0);
          setError(null);
        }
        return;
      }
      return;
    }

    // step === "entering-key"
    if (key.escape) {
      setStep("selecting");
      setApiKeySync("");
      setCursorSync(0);
      setError(null);
      return;
    }

    if (key.return) {
      const trimmed = apiKeyRef.current.trim();
      if (!trimmed) {
        setError("API key cannot be empty.");
        return;
      }

      const entry = allModels[selected]!;
      const info = PROVIDER_INFO[entry.provider];
      if (!info) return;

      // Save key to config
      const updatedConfig: ClarkConfig = {
        ...config,
        [info.configKey]: trimmed,
      };

      // Set the env var directly so the provider SDK picks it up
      process.env[info.envVar] = trimmed;

      saveConfig(updatedConfig).then(() => {
        onSelect(entry.provider, entry.model);
      });
      return;
    }

    const val = apiKeyRef.current;
    const cur = cursorRef.current;

    if (key.backspace || key.delete) {
      if (cur > 0) {
        setApiKeySync(val.slice(0, cur - 1) + val.slice(cur));
        setCursorSync(cur - 1);
      } else if (cur < val.length) {
        setApiKeySync(val.slice(0, cur) + val.slice(cur + 1));
      }
      setError(null);
      return;
    }

    if (key.leftArrow) {
      setCursorSync(Math.max(0, cur - 1));
      return;
    }
    if (key.rightArrow) {
      setCursorSync(Math.min(val.length, cur + 1));
      return;
    }

    if (key.ctrl && input === "u") {
      setApiKeySync("");
      setCursorSync(0);
      setError(null);
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setApiKeySync(val.slice(0, cur) + input + val.slice(cur));
      setCursorSync(cur + input.length);
      setError(null);
    }
  });

  if (step === "entering-key") {
    const entry = allModels[selected]!;
    const info = PROVIDER_INFO[entry.provider]!;

    // Mask the key, showing first 8 and last 4 chars
    const masked =
      apiKey.length > 12
        ? apiKey.slice(0, 8) + "*".repeat(apiKey.length - 12) + apiKey.slice(-4)
        : apiKey;
    const before = masked.slice(0, cursor);
    const cursorChar = masked[cursor] ?? " ";
    const after = masked.slice(cursor + 1);

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Enter your {entry.providerLabel} API key:</Text>
        <Text color="gray" dimColor>
          {" "}
        </Text>
        <Text color="gray" dimColor>
          Get one from {info.site}
        </Text>
        <Text color="gray" dimColor>
          Saved to ~/.clark/config.json (set {info.envVar} to override)
        </Text>
        <Text color="gray" dimColor>
          {" "}
        </Text>
        <Box paddingLeft={2}>
          <Text color="yellow">{before}</Text>
          <Text inverse>{cursorChar}</Text>
          <Text color="yellow">{after}</Text>
        </Box>
        {error && (
          <>
            <Text color="gray" dimColor>
              {" "}
            </Text>
            <Text color="red">{error}</Text>
          </>
        )}
        <Text color="gray" dimColor>
          {" "}
        </Text>
        <Text color="gray">
          <Text bold color="white">
            Enter
          </Text>{" "}
          to save{" "}
          <Text bold color="white">
            Esc
          </Text>{" "}
          to go back
        </Text>
      </Box>
    );
  }

  // step === "selecting"
  // Group models by provider for visual grouping
  let lastProvider = "";

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Switch model:</Text>
      <Text> </Text>
      {allModels.map((entry, i) => {
        const isNewGroup = entry.provider !== lastProvider;
        lastProvider = entry.provider;
        const isCurrent =
          entry.provider === currentProvider && entry.model === currentModel;
        const isSelected = i === selected;
        const available = isProviderAvailable(entry.provider);

        return (
          <React.Fragment key={`${entry.provider}-${entry.model}`}>
            {isNewGroup && (
              <Box paddingLeft={2} marginTop={i === 0 ? 0 : 1}>
                <Text bold color="gray">
                  {entry.providerLabel}
                </Text>
                {!available && (
                  <Text color="yellow" dimColor>
                    {"  "}[setup required]
                  </Text>
                )}
              </Box>
            )}
            <Box paddingLeft={4}>
              <Text color={isSelected ? "blue" : "gray"}>
                {isSelected ? "> " : "  "}
              </Text>
              <Text
                bold={isSelected}
                color={isSelected ? "white" : "gray"}
                dimColor={!available && !isSelected}
              >
                {entry.label}
              </Text>
              {isCurrent && (
                <Text color="green" dimColor>
                  {"  "}(current)
                </Text>
              )}
            </Box>
          </React.Fragment>
        );
      })}

      {/* Ollama section when no selectable models */}
      {ollamaModels.length === 0 && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          <Box>
            <Text bold color="gray">Ollama (Local)</Text>
            {ollamaStatus === "loading" && (
              <Text color="gray" dimColor>{"  "}checking...</Text>
            )}
            {ollamaStatus === "not-running" && (
              <Text color="red" dimColor>{"  "}[not running]</Text>
            )}
            {ollamaStatus === "no-models" && (
              <Text color="yellow" dimColor>{"  "}[no models]</Text>
            )}
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
      <Text color="gray">
        {"  "}<Text color="gray">↑↓</Text> navigate{" "}
        <Text color="gray">enter</Text> select{" "}
        <Text color="gray">esc</Text> cancel
      </Text>
    </Box>
  );
}
