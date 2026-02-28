import React, { useState, useEffect, useCallback } from "react";

interface ModelEntry {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
}

interface ModelsResponse {
  models: ModelEntry[];
  providerAvailability: Record<string, boolean>;
  ollamaStatus: string;
  current: { provider: string; model: string };
}

interface ModelPickerProps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  onSelect: (provider: string, model: string) => void;
  onClose: () => void;
}

function keyForEntry(entry: Pick<ModelEntry, "provider" | "model">): string {
  return `${entry.provider}::${entry.model}`;
}

function parseEntryKey(value: string): { provider: string; model: string } | null {
  const splitAt = value.indexOf("::");
  if (splitAt < 0) return null;
  return {
    provider: value.slice(0, splitAt),
    model: value.slice(splitAt + 2),
  };
}

export function ModelPicker({ invoke, onSelect, onClose }: ModelPickerProps) {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [apiKeyEntry, setApiKeyEntry] = useState<ModelEntry | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadModels = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    invoke("list_models", {})
      .then((res) => {
        const d = res as ModelsResponse;
        setData(d);
        const current = d.models.find(
          (m) => m.provider === d.current.provider && m.model === d.current.model,
        );
        if (current) {
          setSelectedKey(keyForEntry(current));
        } else if (d.models[0]) {
          setSelectedKey(keyForEntry(d.models[0]));
        }
        setLoading(false);
      })
      .catch((err) => {
        setLoading(false);
        setLoadError(String(err));
      });
  }, [invoke]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleSelect = useCallback(
    async (entry: ModelEntry) => {
      if (!data) return;

      // If current, just close
      if (entry.provider === data.current.provider && entry.model === data.current.model) {
        onClose();
        return;
      }

      // Check if provider has API key
      if (!data.providerAvailability[entry.provider]) {
        setApiKeyEntry(entry);
        setApiKeyValue("");
        setError(null);
        return;
      }

      // Switch provider
      try {
        await invoke("switch_provider", {
          provider: entry.provider,
          model: entry.model,
        });
        onSelect(entry.provider, entry.model);
      } catch (err) {
        setError(String(err));
      }
    },
    [data, invoke, onSelect, onClose],
  );

  const handleApiKeySubmit = useCallback(async () => {
    if (!apiKeyEntry || !apiKeyValue.trim()) return;

    try {
      await invoke("switch_provider", {
        provider: apiKeyEntry.provider,
        model: apiKeyEntry.model,
        apiKey: apiKeyValue.trim(),
        api_key: apiKeyValue.trim(),
      });
      onSelect(apiKeyEntry.provider, apiKeyEntry.model);
    } catch (err) {
      setError(String(err));
    }
  }, [apiKeyEntry, apiKeyValue, invoke, onSelect]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (apiKeyEntry) {
        if (e.key === "Escape") {
          setApiKeyEntry(null);
          setApiKeyValue("");
          setError(null);
        } else if (e.key === "Enter") {
          handleApiKeySubmit();
        }
        return;
      }

      if (!data) return;

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter") {
        const selected = parseEntryKey(selectedKey);
        const entry = selected
          ? data.models.find((m) => m.provider === selected.provider && m.model === selected.model)
          : undefined;
        if (entry) handleSelect(entry);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [data, selectedKey, apiKeyEntry, handleSelect, handleApiKeySubmit, onClose]);

  if (loading) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">Switch Model</div>
          <div className="modal__body" style={{ padding: "24px", color: "var(--patina)" }}>
            Loading models...
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <span>Switch Model</span>
            <button className="modal__close" onClick={onClose}>Esc</button>
          </div>
          <div className="modal__body" style={{ padding: "16px", display: "grid", gap: "12px" }}>
            <div className="modal__error">
              Failed to load models{loadError ? `: ${loadError}` : "."}
            </div>
            <div className="modal__actions">
              <button className="modal__button modal__button--ghost" onClick={onClose}>Close</button>
              <button className="modal__button modal__button--primary" onClick={() => loadModels()}>Retry</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const modelsByProvider = data.models.reduce<Map<string, ModelEntry[]>>((acc, model) => {
    const existing = acc.get(model.provider);
    if (existing) {
      existing.push(model);
    } else {
      acc.set(model.provider, [model]);
    }
    return acc;
  }, new Map());

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span>Switch Model</span>
          <button className="modal__close" onClick={onClose}>Esc</button>
        </div>

        {apiKeyEntry ? (
          <div className="modal__body" style={{ padding: "16px" }}>
            <div style={{ marginBottom: "12px", fontWeight: 500 }}>
              Enter API key for {apiKeyEntry.providerLabel}
            </div>
            <input
              type="password"
              className="modal__input"
              placeholder="Paste API key..."
              value={apiKeyValue}
              onChange={(e) => { setApiKeyValue(e.target.value); setError(null); }}
              autoFocus
            />
            {error && <div className="modal__error">{error}</div>}
            <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--patina)" }}>
              Press Enter to save, Esc to go back
            </div>
          </div>
        ) : (
          <div className="modal__body" style={{ padding: "16px", display: "grid", gap: "12px" }}>
            <label className="picker-label" htmlFor="model-select">Provider / Model</label>
            <select
              id="model-select"
              className="modal__select"
              value={selectedKey}
              onChange={(e) => {
                setSelectedKey(e.target.value);
                setError(null);
              }}
              autoFocus
            >
              {[...modelsByProvider.entries()].map(([provider, entries]) => (
                <optgroup key={provider} label={entries[0]?.providerLabel ?? provider}>
                  {entries.map((entry) => {
                    const available = data.providerAvailability[entry.provider];
                    const isCurrent = entry.provider === data.current.provider && entry.model === data.current.model;
                    const suffix = !available ? " (setup required)" : isCurrent ? " (current)" : "";
                    return (
                      <option key={keyForEntry(entry)} value={keyForEntry(entry)}>
                        {entry.label}{suffix}
                      </option>
                    );
                  })}
                </optgroup>
              ))}
            </select>

            {data.ollamaStatus !== "running" && (
              <div className="picker-note">
                Ollama status: {data.ollamaStatus === "not-running" ? "not running" : "no models installed"}
              </div>
            )}

            {error && <div className="modal__error">{error}</div>}

            <div className="modal__actions">
              <button className="modal__button modal__button--ghost" onClick={onClose}>Cancel</button>
              <button
                className="modal__button modal__button--primary"
                onClick={() => {
                  const parsed = parseEntryKey(selectedKey);
                  if (!parsed) return;
                  const entry = data.models.find(
                    (m) => m.provider === parsed.provider && m.model === parsed.model,
                  );
                  if (entry) {
                    void handleSelect(entry);
                  }
                }}
                disabled={!selectedKey}
              >
                Switch
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
