import React, { useState, useEffect, useCallback } from "react";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

interface SettingsData {
  workspaceDir: string;
  pdfExportDir: string;
  fileRouting: { pdf?: string; image?: string; other?: string; notes?: string };
  embedding: { provider?: string; model?: string };
}

interface SettingsProps {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
  onSaved: () => void;
}

// --- PathRow: absolute path with native folder picker ---

function PathRow({
  label,
  value,
  placeholder,
  onChange,
  invoke,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (val: string) => void;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}) {
  const handlePick = useCallback(async () => {
    try {
      const picked = (await invoke("pick_folder", {})) as string | null;
      if (picked) onChange(picked);
    } catch {
      // User cancelled
    }
  }, [invoke, onChange]);

  if (!isTauri) {
    return (
      <div className="settings-row">
        <span className="settings-row__label">{label}</span>
        <input
          className="modal__input"
          style={{ flex: 1 }}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="settings-row">
      <span className="settings-row__label">{label}</span>
      <span className="settings-path" title={value}>{value || placeholder || "(not set)"}</span>
      <button className="settings-pick-btn" onClick={handlePick}>Change</button>
    </div>
  );
}

// --- RelativePathRow: folder picker that yields a path relative to workspaceDir ---

function RelativePathRow({
  label,
  value,
  placeholder,
  workspaceDir,
  onChange,
  invoke,
}: {
  label: string;
  value: string;
  placeholder?: string;
  workspaceDir: string;
  onChange: (val: string) => void;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}) {
  const handlePick = useCallback(async () => {
    try {
      const picked = (await invoke("pick_folder", {})) as string | null;
      if (!picked) return;
      // Strip workspace prefix to get a relative path
      const sep = picked.includes("\\") ? "\\" : "/";
      const base = workspaceDir.endsWith(sep) ? workspaceDir : workspaceDir + sep;
      if (picked.startsWith(base)) {
        onChange(picked.slice(base.length));
      } else {
        onChange(picked);
      }
    } catch {
      // User cancelled
    }
  }, [invoke, onChange, workspaceDir]);

  if (!isTauri) {
    return (
      <div className="settings-row">
        <span className="settings-row__label">{label}</span>
        <input
          className="modal__input"
          style={{ flex: 1 }}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="settings-row">
      <span className="settings-row__label">{label}</span>
      <span className="settings-path" title={value}>{value || placeholder || "(default)"}</span>
      <button className="settings-pick-btn" onClick={handlePick}>Change</button>
    </div>
  );
}

// --- Main Settings modal ---

export function Settings({ invoke, onClose, onSaved }: SettingsProps) {
  const [data, setData] = useState<SettingsData | null>(null);
  const [draft, setDraft] = useState<SettingsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    invoke("get_settings", {})
      .then((res) => {
        const d = res as SettingsData;
        setData(d);
        setDraft(structuredClone(d));
        // Pre-fetch Ollama models if embedding provider is already set to ollama
        if (d.embedding?.provider === "ollama") fetchOllamaModels();
      })
      .catch((err) => setError(String(err)));
  }, [invoke]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const fetchOllamaModels = useCallback(() => {
    setOllamaStatus("loading");
    invoke("list_ollama_models", {})
      .then((res) => {
        const d = res as { models: string[]; status: string };
        setOllamaModels(d.models);
        setOllamaStatus(d.models.length > 0 ? "ready" : "error");
      })
      .catch(() => setOllamaStatus("error"));
  }, [invoke]);

  const isDirty = data && draft && JSON.stringify(data) !== JSON.stringify(draft);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await invoke("update_settings", draft as unknown as Record<string, unknown>);
      onSaved();
      onClose();
    } catch (err) {
      setError(String(err));
      setSaving(false);
    }
  }

  if (!draft) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <span>Settings</span>
            <button className="modal__close" onClick={onClose}>Esc</button>
          </div>
          <div className="modal__body" style={{ padding: "24px", textAlign: "center", color: "var(--patina)" }}>
            {error ? error : "Loading..."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: "480px" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span>Settings</span>
          <button className="modal__close" onClick={onClose}>Esc</button>
        </div>

        <div className="modal__body" style={{ padding: "16px" }}>
          {/* Workspace */}
          <div className="settings-section">
            <div className="settings-section__title">Workspace</div>
            <PathRow
              label="Directory"
              value={draft.workspaceDir}
              placeholder="(not set)"
              onChange={(val) => setDraft({ ...draft, workspaceDir: val })}
              invoke={invoke}
            />
          </div>

          {/* File Routing */}
          <div className="settings-section">
            <div className="settings-section__title">File Routing</div>
            <RelativePathRow
              label="PDFs"
              value={draft.fileRouting.pdf ?? ""}
              placeholder="Resources/PDFs"
              workspaceDir={draft.workspaceDir}
              onChange={(val) => setDraft({ ...draft, fileRouting: { ...draft.fileRouting, pdf: val } })}
              invoke={invoke}
            />
            <RelativePathRow
              label="Images"
              value={draft.fileRouting.image ?? ""}
              placeholder="Resources/Images"
              workspaceDir={draft.workspaceDir}
              onChange={(val) => setDraft({ ...draft, fileRouting: { ...draft.fileRouting, image: val } })}
              invoke={invoke}
            />
            <RelativePathRow
              label="Other"
              value={draft.fileRouting.other ?? ""}
              placeholder="Resources"
              workspaceDir={draft.workspaceDir}
              onChange={(val) => setDraft({ ...draft, fileRouting: { ...draft.fileRouting, other: val } })}
              invoke={invoke}
            />
          </div>

          {/* Semantic Search */}
          <div className="settings-section">
            <div className="settings-section__title">Semantic Search</div>
            <div className="settings-row">
              <label className="settings-row__label" htmlFor="settings-embed-provider">Provider</label>
              <select
                id="settings-embed-provider"
                className="modal__select"
                style={{ flex: 1 }}
                value={draft.embedding.provider ?? ""}
                onChange={(e) => {
                  const val = e.target.value || undefined;
                  setDraft({
                    ...draft,
                    embedding: {
                      provider: val as "ollama" | undefined,
                      model: val ? (draft.embedding.model || "") : undefined,
                    },
                  });
                  if (val === "ollama" && ollamaStatus === "idle") fetchOllamaModels();
                }}
              >
                <option value="">Off</option>
                <option value="ollama">Ollama</option>
              </select>
            </div>

            {draft.embedding.provider === "ollama" && (
              <div className="settings-row">
                <label className="settings-row__label" htmlFor="settings-embed-model">Model</label>
                {ollamaStatus === "loading" ? (
                  <span style={{ flex: 1, fontSize: "13px", color: "var(--patina)" }}>Loading models...</span>
                ) : ollamaStatus === "ready" && ollamaModels.length > 0 ? (
                  <select
                    id="settings-embed-model"
                    className="modal__select"
                    style={{ flex: 1 }}
                    value={draft.embedding.model ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, embedding: { ...draft.embedding, model: e.target.value } })
                    }
                  >
                    <option value="">— select a model —</option>
                    {ollamaModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <div style={{ flex: 1, display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      id="settings-embed-model"
                      className="modal__input"
                      style={{ flex: 1 }}
                      value={draft.embedding.model ?? ""}
                      placeholder="nomic-embed-text"
                      onChange={(e) =>
                        setDraft({ ...draft, embedding: { ...draft.embedding, model: e.target.value } })
                      }
                    />
                    <button
                      className="settings-pick-btn"
                      onClick={fetchOllamaModels}
                      title="Retry loading Ollama models"
                    >
                      Retry
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PDF Export */}
          <div className="settings-section" style={{ borderBottom: "none" }}>
            <div className="settings-section__title">PDF Export</div>
            <PathRow
              label="Directory"
              value={draft.pdfExportDir}
              placeholder={draft.workspaceDir || "/path/to/export"}
              onChange={(val) => setDraft({ ...draft, pdfExportDir: val })}
              invoke={invoke}
            />
          </div>

          {error && <div className="modal__error">{error}</div>}

          {/* Actions */}
          <div className="modal__actions" style={{ marginTop: "16px" }}>
            <button className="modal__button modal__button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="modal__button modal__button--primary"
              disabled={!isDirty || saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
