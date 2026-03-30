/**
 * Onboarding flow — shown on first run.
 *
 * Defaults to Clark Cloud with Sonnet 4.6. No provider selection,
 * no API key. Just welcome → done.
 */

import React, { useState } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { loadConfig, saveConfig, resolveCloudConfig, type ClarkConfig } from "../../core/config.ts";
import { scaffoldLibrary } from "../../core/library.ts";
import { getWorkspaceDir } from "../../core/workspace.ts";
import { hex } from "./theme.ts";

type Step = "welcome" | "done";

export interface OnboardingProps {
  onComplete: (config: ClarkConfig) => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>("welcome");
  const [error, setError] = useState<string | null>(null);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const { exit } = useApp();

  async function completeSetup(): Promise<void> {
    const workspaceDir = getWorkspaceDir();
    const currentConfig = await loadConfig();
    await scaffoldLibrary(workspaceDir);

    // Generate cloud clientId
    const cloud = resolveCloudConfig(currentConfig);

    const updatedConfig: ClarkConfig = {
      ...currentConfig,
      provider: "clark-cloud",
      model: "claude-sonnet-4-6",
      cloud: { ...currentConfig.cloud, clientId: cloud.clientId },
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

    if (step === "welcome" && key.return) {
      setIsSettingUp(true);
      setError(null);
      completeSetup().catch((err) => {
        setError(`Setup failed: ${err instanceof Error ? err.message : String(err)}`);
        setIsSettingUp(false);
      });
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
        <Text>Welcome to <Text bold>Clark</Text>, your Socratic tutoring assistant.</Text>
        <Text color={hex.dimText}> </Text>
        <Text>Clark helps you work through problems by asking guiding questions,</Text>
        <Text>not giving answers. You can write on your iPad while Clark responds</Text>
        <Text>to your progress.</Text>
        <Text color={hex.dimText}> </Text>
        <Text bold>What's included:</Text>
        <Text>  • AI-powered tutoring with Claude Sonnet 4.6</Text>
        <Text>  • PDF and image processing for your course materials</Text>
        <Text>  • Semantic search across your notes</Text>
        <Text>  • iPad canvas for handwritten work</Text>
        <Text color={hex.dimText}> </Text>
        {error && (
          <>
            <Text color={hex.error}>{error}</Text>
            <Text color={hex.dimText}> </Text>
          </>
        )}
        {isSettingUp ? (
          <Text color={hex.brass}>Setting up workspace...</Text>
        ) : (
          <Text color={hex.dimText}>Press <Text bold color={hex.messageText}>Enter</Text> to get started, <Text bold color={hex.messageText}>Ctrl+C</Text> to exit.</Text>
        )}
      </Box>
    );
  }

  const workspaceDir = getWorkspaceDir();

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={hex.sage}>✓ Setup complete!</Text>
      <Text color={hex.dimText}> </Text>
      <Text>Provider: <Text bold>Clark Cloud (Claude Sonnet 4.6)</Text></Text>
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
