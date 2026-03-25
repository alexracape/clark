/**
 * Interactive model picker — shown when the user types /model.
 *
 * Lists Clark Cloud models and locally available Ollama models.
 * No API key entry needed — cloud is managed server-side, Ollama is local.
 */

import React, { useState, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { getCloudModelEntries, getProviderCatalogEntry } from "../../core/llm/catalog.ts";
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
  config: unknown;
  onSelect: (provider: string, model: string) => void;
  onCancel: () => void;
}

type OllamaStatus = "loading" | "running" | "not-running" | "no-models";

export function ModelPicker({ currentProvider, currentModel, onSelect, onCancel }: ModelPickerProps) {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>("loading");
  const [ollamaModels, setOllamaModels] = useState<ModelEntry[]>([]);

  useEffect(() => {
    import("../../core/llm/ollama.ts")
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

  useInput((_input, key) => {
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

      onSelect(entry.provider, entry.model);
    }
  });

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

        return (
          <React.Fragment key={`${entry.provider}-${entry.model}`}>
            {isNewGroup && (
              <Box paddingLeft={2} marginTop={i === 0 ? 0 : 1}>
                <Text bold color={hex.baseText}>{entry.providerLabel}</Text>
              </Box>
            )}
            <Box paddingLeft={4}>
              <Text color={isSelected ? hex.sky : hex.dimText}>{isSelected ? "> " : "  "}</Text>
              <Text bold={isSelected} color={isSelected ? hex.messageText : hex.dimText}>{entry.label}</Text>
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
      <Text color={hex.dimText}>{"  "}{"\u2191\u2193"} navigate  enter select  esc cancel</Text>
    </Box>
  );
}
