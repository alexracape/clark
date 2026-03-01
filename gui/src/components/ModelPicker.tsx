import React, { useState, useEffect, useCallback, useMemo } from "react";

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

export function ModelPicker({ invoke, onSelect, onClose }: ModelPickerProps) {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [apiKeyEntry, setApiKeyEntry] = useState<ModelEntry | null>(null);
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadModels = useCallback(() => {
    setLoading(true);
    invoke("list_models", {})
      .then((res) => {
        const d = res as ModelsResponse;
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [invoke]);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  // Build flat list of models + group structure for rendering
  const { flatModels, groups } = useMemo(() => {
    if (!data) return { flatModels: [] as ModelEntry[], groups: [] as { label: string; available: boolean; models: ModelEntry[] }[] };

    const groupMap = new Map<string, ModelEntry[]>();
    for (const model of data.models) {
      const existing = groupMap.get(model.provider);
      if (existing) {
        existing.push(model);
      } else {
        groupMap.set(model.provider, [model]);
      }
    }

    const groups: { label: string; available: boolean; models: ModelEntry[] }[] = [];
    const flatModels: ModelEntry[] = [];

    for (const [provider, models] of groupMap) {
      groups.push({
        label: models[0]?.providerLabel ?? provider,
        available: !!data.providerAvailability[provider],
        models,
      });
      flatModels.push(...models);
    }

    return { flatModels, groups };
  }, [data]);

  // Initialize selectedIndex to current model
  useEffect(() => {
    if (!data || flatModels.length === 0) return;
    const idx = flatModels.findIndex(
      (m) => m.provider === data.current.provider && m.model === data.current.model,
    );
    if (idx >= 0) setSelectedIndex(idx);
  }, [data, flatModels]);

  const handleSelect = useCallback(
    async (entry: ModelEntry) => {
      if (!data) return;

      // If current, just close
      if (entry.provider === data.current.provider && entry.model === data.current.model) {
        onClose();
        return;
      }

      // If provider not configured, show API key entry
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
      });
      onSelect(apiKeyEntry.provider, apiKeyEntry.model);
    } catch (err) {
      setError(String(err));
    }
  }, [apiKeyEntry, apiKeyValue, invoke, onSelect]);

  // Keyboard navigation
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

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % flatModels.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + flatModels.length) % flatModels.length);
      } else if (e.key === "Enter") {
        const entry = flatModels[selectedIndex];
        if (entry) handleSelect(entry);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flatModels, selectedIndex, apiKeyEntry, handleSelect, handleApiKeySubmit, onClose]);

  const isCurrent = (entry: ModelEntry) =>
    data !== null && entry.provider === data.current.provider && entry.model === data.current.model;

  if (loading) {
    return (
      <div className="model-popover-backdrop" onClick={onClose}>
        <div className="model-popover" onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: "16px", color: "var(--patina)", fontSize: "13px" }}>
            Loading models...
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="model-popover-backdrop" onClick={onClose}>
        <div className="model-popover" onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: "16px", display: "grid", gap: "12px" }}>
            <div className="modal__error">Failed to load models.</div>
            <div className="modal__actions">
              <button className="modal__button modal__button--ghost" onClick={onClose}>Close</button>
              <button className="modal__button modal__button--primary" onClick={loadModels}>Retry</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Flat index counter for mapping group items to flat indices
  let flatIndex = 0;

  return (
    <div className="model-popover-backdrop" onClick={onClose}>
      <div className="model-popover" onClick={(e) => e.stopPropagation()}>
        {apiKeyEntry ? (
          <div style={{ padding: "16px" }}>
            <div style={{ marginBottom: "12px", fontWeight: 500, color: "var(--walnut)" }}>
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
          <div className="picker-list">
            {groups.map((group) => (
              <div key={group.label}>
                <div className="picker-group">
                  <span>{group.label}</span>
                  {!group.available && (
                    <span className="picker-group__badge">(setup required)</span>
                  )}
                </div>
                {group.models.map((entry) => {
                  const idx = flatIndex++;
                  const current = isCurrent(entry);
                  return (
                    <div
                      key={`${entry.provider}::${entry.model}`}
                      className={`picker-item ${idx === selectedIndex ? "picker-item--selected" : ""}`}
                      onClick={() => handleSelect(entry)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <span className="picker-item__label">
                        {current && <span className="picker-item__dot" />}
                        {entry.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}

            {data.ollamaStatus !== "running" && (
              <div className="picker-note" style={{ padding: "8px 16px" }}>
                Ollama: {data.ollamaStatus === "not-running" ? "not running" : "no models installed"}
              </div>
            )}

            {error && <div className="modal__error" style={{ margin: "4px 16px" }}>{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
