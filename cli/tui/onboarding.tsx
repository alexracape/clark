/**
 * Onboarding flow — shown on first run when no API key is configured.
 */

import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { loadConfig, saveConfig, setProviderApiKey, type ClarkConfig } from "../../core/config.ts";
import { isApiKeyProvider, PROVIDER_CATALOG } from "../../core/llm/catalog.ts";
import { scaffoldLibrary } from "../../core/library.ts";
import { getWorkspaceDir } from "../../core/workspace.ts";
import { useLineEditor } from "./primitives/use-line-editor.ts";
import { useSelectableList } from "./primitives/use-selectable-list.ts";
import { hex } from "./theme.ts";

type Step = "welcome" | "provider" | "api-key" | "done";

const STEP_INFO: Record<Step, { index: number; title: string }> = {
  welcome: { index: 1, title: "Welcome" },
  provider: { index: 2, title: "Choose Provider" },
  "api-key": { index: 3, title: "API Key Setup" },
  done: { index: 3, title: "Complete" },
};

const TOTAL_STEPS = 3;

function StepIndicator({ current, total, label }: {
  current: number;
  total: number;
  label: string;
}) {
  return <Text color={hex.sky}>[{current}/{total}] {label}</Text>;
}

interface ProviderOption {
  id: string;
  name: string;
  envVar: string;
  site?: string;
}

const PROVIDERS: ProviderOption[] = PROVIDER_CATALOG.map((provider) => ({
  id: provider.id,
  name: provider.label,
  envVar: provider.envVar ?? "",
  site: provider.site,
}));

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
    const workspaceDir = getWorkspaceDir();
    const currentConfig = await loadConfig();
    await scaffoldLibrary(workspaceDir);

    const updatedConfig: ClarkConfig = {
      ...currentConfig,
      ...partialConfig,
      pdfExportDir: currentConfig.pdfExportDir ?? workspaceDir,
      hasCompletedOnboarding: true,
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

        setIsSettingUp(true);
        setError(null);
        loadConfig()
          .then((current) => {
            if (!isApiKeyProvider(provider.id)) {
              throw new Error(`Unsupported provider: ${provider.id}`);
            }
            return setProviderApiKey(provider.id, trimmed, current);
          })
          .then((updated) => completeSetup({
            ...updated,
            provider: provider.id,
          }))
          .catch((err) => {
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
        <Text color={hex.sky} bold>
          {`
   _____ _            _
  / ____| |          | |
 | |    | | __ _ _ __| | __
 | |    | |/ _\` | '__| |/ /
 | |____| | (_| | |  |   <
  \\_____|_|\\__,_|_|  |_|\\_\\
`}
        </Text>
        <StepIndicator current={1} total={TOTAL_STEPS} label="Welcome" />
        <Text color={hex.dimText}> </Text>
        <Text>Welcome to <Text bold>Clark</Text>, your Socratic tutoring assistant.</Text>
        <Text color={hex.dimText}> </Text>
        <Text>Clark helps you work through problems by asking guiding questions,</Text>
        <Text>not giving answers. You can write on your iPad while Clark responds</Text>
        <Text>to your progress.</Text>
        <Text color={hex.dimText}> </Text>
        <Text bold>What you'll need:</Text>
        <Text>  • An API key from an LLM provider (Anthropic, OpenAI, or Google)</Text>
        <Text>  • Optional: An iPad for handwritten work</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Press <Text bold color={hex.messageText}>Enter</Text> to continue, <Text bold color={hex.messageText}>Ctrl+C</Text> to exit.</Text>
      </Box>
    );
  }

  if (step === "provider") {
    return (
      <Box flexDirection="column" padding={1}>
        <StepIndicator current={2} total={TOTAL_STEPS} label="Choose Provider" />
        <Text color={hex.dimText}> </Text>
        <Text color={hex.sage}>✓ Welcome</Text>
        <Text color={hex.dimText}> </Text>
        <Text bold>Choose your LLM provider:</Text>
        <Text color={hex.dimText}> </Text>
        {PROVIDERS.map((provider, i) => (
          <Box key={provider.id} paddingLeft={2}>
            <Text color={i === providerList.selected ? hex.sky : hex.dimText}>
              {i === providerList.selected ? "> " : "  "}
              <Text bold={i === providerList.selected}>{provider.name}</Text>
            </Text>
          </Box>
        ))}
        {error && (
          <>
            <Text color={hex.dimText}> </Text>
            <Text color={hex.error}>{error}</Text>
          </>
        )}
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>Use <Text bold color={hex.messageText}>arrow keys</Text> to select, <Text bold color={hex.messageText}>Enter</Text> to confirm.</Text>
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
        <StepIndicator current={3} total={TOTAL_STEPS} label="API Key Setup" />
        <Text color={hex.dimText}> </Text>
        <Text color={hex.sage}>✓ Welcome</Text>
        <Text color={hex.sage}>✓ Provider selected: {provider.name}</Text>
        <Text color={hex.dimText}> </Text>
        <Text bold>Enter your {provider.name} API key:</Text>
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}>
          You can get one from {provider.site ?? "your provider dashboard"}
        </Text>
        <Text color={hex.dimText}>Saved to macOS Keychain (set {provider.envVar} to override)</Text>
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
        {isSettingUp && (
          <>
            <Text color={hex.dimText}> </Text>
            <Text color={hex.brass}>Setting up workspace...</Text>
          </>
        )}
        <Text color={hex.dimText}> </Text>
        <Text color={hex.dimText}><Text bold color={hex.messageText}>Enter</Text> to save, <Text bold color={hex.messageText}>Esc</Text> to go back.</Text>
      </Box>
    );
  }

  const selectedProvider = PROVIDERS[providerList.selected]!;
  const workspaceDir = getWorkspaceDir();

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={hex.sage}>✓ Setup complete!</Text>
      <Text color={hex.dimText}> </Text>
      <Text>Provider: <Text bold>{selectedProvider.name}</Text></Text>
      <Text>Workspace: <Text bold>{workspaceDir}</Text></Text>
      <Text color={hex.dimText}> </Text>
      <Text bold>Next steps:</Text>
      <Text>  • Type <Text bold color={hex.messageText}>/help</Text> to see available commands</Text>
      <Text>  • Type <Text bold color={hex.messageText}>/tutorial</Text> to learn the basics</Text>
      <Text>  • Type <Text bold color={hex.messageText}>/canvas</Text> to start drawing</Text>
      <Text color={hex.dimText}> </Text>
      <Text color={hex.brass}>Starting Clark...</Text>
    </Box>
  );
}
