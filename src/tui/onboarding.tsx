/**
 * Onboarding flow — shown on first run when no API key is configured.
 *
 * Walks the user through selecting a provider, entering their API key,
 * and choosing a library directory for notes and resources.
 */

import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, type ClarkConfig } from "../config.ts";
import {
  expandPath,
  isExistingLibrary,
  scaffoldLibrary,
  validateLibraryPath,
} from "../library.ts";

type Step = "welcome" | "provider" | "api-key" | "library-path" | "done";

interface ProviderOption {
  id: string;
  name: string;
  envVar: string;
  keyPrefix: string;
}

const PROVIDERS: ProviderOption[] = [
  { id: "anthropic", name: "Anthropic (Claude)", envVar: "ANTHROPIC_API_KEY", keyPrefix: "sk-ant-" },
  { id: "openai", name: "OpenAI (GPT-4o)", envVar: "OPENAI_API_KEY", keyPrefix: "sk-" },
  { id: "gemini", name: "Google (Gemini)", envVar: "GOOGLE_API_KEY", keyPrefix: "AI" },
  { id: "ollama", name: "Ollama (Local)", envVar: "", keyPrefix: "" },
];

const DEFAULT_LIBRARY_PATH = join("~", "Clark");

export interface OnboardingProps {
  onComplete: (config: ClarkConfig) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [selectedProvider, setSelectedProvider] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Library path state
  const [libraryPath, setLibraryPath] = useState(DEFAULT_LIBRARY_PATH);
  const [libCursor, setLibCursor] = useState(DEFAULT_LIBRARY_PATH.length);
  const [libError, setLibError] = useState<string | null>(null);
  const [isScaffolding, setIsScaffolding] = useState(false);

  // Pending config built during provider/api-key steps
  const [pendingConfig, setPendingConfig] = useState<ClarkConfig>({});

  const { exit } = useApp();

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }

    if (step === "welcome") {
      if (key.return) setStep("provider");
      return;
    }

    if (step === "provider") {
      if (key.upArrow) {
        setSelectedProvider((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setSelectedProvider((i) => Math.min(PROVIDERS.length - 1, i + 1));
      } else if (key.return) {
        const provider = PROVIDERS[selectedProvider]!;
        if (provider.id === "ollama") {
          // Ollama needs no API key — go straight to library setup
          const config: ClarkConfig = { provider: "ollama" };
          setPendingConfig(config);
          saveConfig(config).then(() => {
            setStep("library-path");
          });
        } else {
          setStep("api-key");
        }
      }
      return;
    }

    if (step === "api-key") {
      if (key.return) {
        const provider = PROVIDERS[selectedProvider]!;
        const trimmed = apiKey.trim();

        if (!trimmed) {
          setError("API key cannot be empty.");
          return;
        }

        // Save config and advance to library setup
        const keyField =
          provider.id === "anthropic" ? "anthropicApiKey"
          : provider.id === "gemini" ? "geminiApiKey"
          : "openaiApiKey";
        const config: ClarkConfig = {
          provider: provider.id,
          [keyField]: trimmed,
        };

        setPendingConfig(config);
        saveConfig(config).then(() => {
          setStep("library-path");
        });
        return;
      }

      if (key.escape) {
        setStep("provider");
        setApiKey("");
        setCursor(0);
        setError(null);
        return;
      }

      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setApiKey((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
        } else if (cursor < apiKey.length) {
          setApiKey((v) => v.slice(0, cursor) + v.slice(cursor + 1));
        }
        setError(null);
        return;
      }

      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setCursor((c) => Math.min(apiKey.length, c + 1));
        return;
      }

      if (key.ctrl && input === "u") {
        setApiKey("");
        setCursor(0);
        setError(null);
        return;
      }

      if (!key.ctrl && !key.meta && input) {
        setApiKey((v) => v.slice(0, cursor) + input + v.slice(cursor));
        setCursor((c) => c + input.length);
        setError(null);
      }
      return;
    }

    if (step === "library-path") {
      if (isScaffolding) return; // ignore input while scaffolding

      if (key.return) {
        const trimmed = libraryPath.trim();
        if (!trimmed) {
          setLibError("Path cannot be empty.");
          return;
        }

        const expanded = expandPath(trimmed);
        setIsScaffolding(true);

        (async () => {
          try {
            // Validate the path is writable
            const validation = await validateLibraryPath(expanded);
            if (!validation.valid) {
              setLibError(validation.error ?? "Invalid path");
              setIsScaffolding(false);
              return;
            }

            // Scaffold if it's not an existing library
            const exists = await isExistingLibrary(expanded);
            if (!exists) {
              await scaffoldLibrary(expanded);
            }

            // Save resourcePath to config
            const currentConfig = await loadConfig();
            const updatedConfig = { ...currentConfig, ...pendingConfig, resourcePath: expanded };
            await saveConfig(updatedConfig);

            setStep("done");
            onComplete(updatedConfig);
          } catch (err) {
            setLibError(
              `Failed to set up library: ${err instanceof Error ? err.message : String(err)}`,
            );
            setIsScaffolding(false);
          }
        })();
        return;
      }

      if (key.escape) {
        // Go back to api-key (or provider for Ollama)
        const provider = PROVIDERS[selectedProvider]!;
        if (provider.id === "ollama") {
          setStep("provider");
        } else {
          setStep("api-key");
        }
        setLibraryPath(DEFAULT_LIBRARY_PATH);
        setLibCursor(DEFAULT_LIBRARY_PATH.length);
        setLibError(null);
        return;
      }

      if (key.backspace || key.delete) {
        if (libCursor > 0) {
          setLibraryPath((v) => v.slice(0, libCursor - 1) + v.slice(libCursor));
          setLibCursor((c) => c - 1);
        } else if (libCursor < libraryPath.length) {
          setLibraryPath((v) => v.slice(0, libCursor) + v.slice(libCursor + 1));
        }
        setLibError(null);
        return;
      }

      if (key.leftArrow) {
        setLibCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.rightArrow) {
        setLibCursor((c) => Math.min(libraryPath.length, c + 1));
        return;
      }

      if (key.ctrl && input === "u") {
        setLibraryPath("");
        setLibCursor(0);
        setLibError(null);
        return;
      }

      if (!key.ctrl && !key.meta && input) {
        setLibraryPath((v) => v.slice(0, libCursor) + input + v.slice(libCursor));
        setLibCursor((c) => c + input.length);
        setLibError(null);
      }
      return;
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
        {PROVIDERS.map((p, i) => (
          <Box key={p.id} paddingLeft={2}>
            <Text color={i === selectedProvider ? "blue" : "gray"}>
              {i === selectedProvider ? "> " : "  "}
              <Text bold={i === selectedProvider}>{p.name}</Text>
            </Text>
          </Box>
        ))}
        <Text color="gray" dimColor> </Text>
        <Text color="gray">Use <Text bold color="white">arrow keys</Text> to select, <Text bold color="white">Enter</Text> to confirm.</Text>
      </Box>
    );
  }

  if (step === "api-key") {
    const provider = PROVIDERS[selectedProvider]!;

    // Mask the key, showing first 8 and last 4 chars
    const masked = apiKey.length > 12
      ? apiKey.slice(0, 8) + "*".repeat(apiKey.length - 12) + apiKey.slice(-4)
      : apiKey;
    const before = masked.slice(0, cursor);
    const cursorChar = masked[cursor] ?? " ";
    const after = masked.slice(cursor + 1);

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Enter your {provider.name} API key:</Text>
        <Text color="gray" dimColor> </Text>
        <Text color="gray" dimColor>You can get one from {provider.id === "anthropic" ? "console.anthropic.com" : provider.id === "gemini" ? "aistudio.google.com" : "platform.openai.com"}</Text>
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
        <Text color="gray" dimColor> </Text>
        <Text color="gray"><Text bold color="white">Enter</Text> to save, <Text bold color="white">Esc</Text> to go back.</Text>
      </Box>
    );
  }

  if (step === "library-path") {
    const before = libraryPath.slice(0, libCursor);
    const cursorChar = libraryPath[libCursor] ?? " ";
    const after = libraryPath.slice(libCursor + 1);

    return (
      <Box flexDirection="column" padding={1}>
        <Text bold>Where should Clark store your notes?</Text>
        <Text color="gray" dimColor> </Text>
        <Text color="gray" dimColor>Enter a path to an existing library or vault, or press Enter to create a new one.</Text>
        <Text color="gray" dimColor>Supports ~ for home directory (e.g., ~/Documents/Notes)</Text>
        <Text color="gray" dimColor> </Text>
        <Box paddingLeft={2}>
          <Text color="cyan">{before}</Text>
          <Text inverse>{cursorChar}</Text>
          <Text color="cyan">{after}</Text>
        </Box>
        {libError && (
          <>
            <Text color="gray" dimColor> </Text>
            <Text color="red">{libError}</Text>
          </>
        )}
        {isScaffolding && (
          <>
            <Text color="gray" dimColor> </Text>
            <Text color="yellow">Setting up library...</Text>
          </>
        )}
        <Text color="gray" dimColor> </Text>
        <Text color="gray"><Text bold color="white">Enter</Text> to confirm, <Text bold color="white">Esc</Text> to go back.</Text>
      </Box>
    );
  }

  // step === "done"
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green">Setup complete. Starting Clark...</Text>
    </Box>
  );
}
