import React, { useState, useCallback } from "react";
import type { OnboardingState, OnboardingStep } from "../app-controller.ts";
import { ParticleGraph } from "./ParticleGraph.tsx";

const PROVIDER_CATALOG = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    site: "console.anthropic.com",
    requiresApiKey: true,
  },
  {
    id: "openai",
    label: "OpenAI",
    site: "platform.openai.com",
    requiresApiKey: true,
  },
  {
    id: "gemini",
    label: "Google (Gemini)",
    site: "aistudio.google.com",
    requiresApiKey: true,
  },
  { id: "ollama", label: "Ollama (Local)", requiresApiKey: false },
] as const;

const MAIN_STEPS: OnboardingStep[] = [
  "welcome",
  "workspace",
  "provider",
  "api-key",
];

interface OnboardingProps {
  state: OnboardingState;
  isTauri: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSetWorkspace: (dir: string) => void;
  onSetWorkspaceIsNew: (isNew: boolean) => void;
  onPickFolder: () => Promise<string | null>;
  onSetProvider: (provider: string) => void;
  onSetApiKey: (key: string) => void;
  onOllamaNext: () => void;
  onRefreshOllamaModels: () => void;
  onSelectOllamaModel: (model: string) => void;
  onComplete: () => void;
}

function StepIndicator({ currentStep }: { currentStep: OnboardingStep }) {
  // Map ollama-setup to provider position for the indicator
  const displayStep = currentStep === "ollama-setup" ? "provider" : currentStep;
  const currentIdx = MAIN_STEPS.indexOf(displayStep);
  return (
    <div className="onboarding-steps">
      {MAIN_STEPS.map((step, i) => (
        <React.Fragment key={step}>
          {i > 0 && (
            <div
              className={`onboarding-steps__line ${i <= currentIdx ? "onboarding-steps__line--done" : ""}`}
            />
          )}
          <div
            className={[
              "onboarding-steps__dot",
              i < currentIdx ? "onboarding-steps__dot--done" : "",
              i === currentIdx ? "onboarding-steps__dot--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {i < currentIdx ? "\u2713" : i + 1}
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [settled, setSettled] = useState(false);
  const handleSettled = useCallback(() => setSettled(true), []);

  return (
    <div className="welcome-step">
      <ParticleGraph onSettled={handleSettled} textYRatio={0.35} />
      <div className={`welcome-step__ui ${settled ? "welcome-step__ui--visible" : ""}`}>
        <p className="onboarding-subtitle">Your Socratic study partner.</p>
        <p className="onboarding-body">
          Clark helps you read, annotate, and reason about documents using the LLM
          provider of your choice.
        </p>
        <button
          className="onboarding-btn onboarding-btn--primary"
          onClick={onNext}
        >
          Get Started
        </button>
      </div>
    </div>
  );
}

function WorkspaceStep({
  workspaceDir,
  workspaceIsNew,
  isTauri,
  onSetWorkspace,
  onSetWorkspaceIsNew,
  onPickFolder,
  onNext,
  onPrev,
}: {
  workspaceDir: string;
  workspaceIsNew: boolean;
  isTauri: boolean;
  onSetWorkspace: (dir: string) => void;
  onSetWorkspaceIsNew: (isNew: boolean) => void;
  onPickFolder: () => Promise<string | null>;
  onNext: () => void;
  onPrev: () => void;
}) {
  // For "create new" mode in Tauri: track parent dir and folder name separately
  const [parentDir, setParentDir] = useState("");
  const [folderName, setFolderName] = useState("");

  // When parent or name changes, compose the full workspace path
  const updateNewWorkspacePath = (parent: string, name: string) => {
    if (parent && name.trim()) {
      onSetWorkspace(
        parent.endsWith("/")
          ? `${parent}${name.trim()}`
          : `${parent}/${name.trim()}`,
      );
    } else {
      onSetWorkspace("");
    }
  };

  const handlePickExisting = async () => {
    const result = await onPickFolder();
    if (result) onSetWorkspace(result);
  };

  const handlePickParent = async () => {
    const result = await onPickFolder();
    if (result) {
      setParentDir(result);
      updateNewWorkspacePath(result, folderName);
    }
  };

  return (
    <div className="onboarding-content">
      <h2 className="onboarding-heading">Choose Your Workspace</h2>
      <p className="onboarding-body">
        Clark stores your documents and notes in a workspace folder.
      </p>

      <div className="onboarding-mode-toggle">
        <button
          className={`onboarding-mode-toggle__btn ${!workspaceIsNew ? "onboarding-mode-toggle__btn--active" : ""}`}
          onClick={() => {
            onSetWorkspaceIsNew(false);
            onSetWorkspace("");
            setParentDir("");
            setFolderName("");
          }}
        >
          Use existing folder
        </button>
        <button
          className={`onboarding-mode-toggle__btn ${workspaceIsNew ? "onboarding-mode-toggle__btn--active" : ""}`}
          onClick={() => {
            onSetWorkspaceIsNew(true);
            onSetWorkspace("");
            setParentDir("");
            setFolderName("");
          }}
        >
          Create new folder
        </button>
      </div>

      {workspaceIsNew ? (
        <>
          <p className="onboarding-mode-description">
            Clark will create this folder and set up a workspace with default
            folders for Notes, Resources, and Templates.
          </p>
          {isTauri ? (
            <>
              <button
                className="onboarding-btn onboarding-btn--secondary"
                onClick={handlePickParent}
              >
                Choose Location
              </button>
              {parentDir && <div className="onboarding-path">{parentDir}</div>}
              <input
                className="onboarding-input"
                type="text"
                placeholder="Folder name (e.g. Vault)"
                value={folderName}
                onChange={(e) => {
                  setFolderName(e.target.value);
                  updateNewWorkspacePath(parentDir, e.target.value);
                }}
                style={{ marginTop: "12px" }}
              />
            </>
          ) : (
            <input
              className="onboarding-input"
              type="text"
              placeholder="/path/to/new-workspace"
              value={workspaceDir}
              onChange={(e) => onSetWorkspace(e.target.value)}
            />
          )}
          {workspaceDir && isTauri && (
            <div className="onboarding-path" style={{ marginTop: "8px" }}>
              Will create: {workspaceDir}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="onboarding-mode-description">
            Clark will add a Clark/ subfolder to organize canvases and
            transcripts. Your existing files won't be modified.
          </p>
          {isTauri ? (
            <button
              className="onboarding-btn onboarding-btn--secondary"
              onClick={handlePickExisting}
            >
              Choose Folder
            </button>
          ) : (
            <input
              className="onboarding-input"
              type="text"
              placeholder="/path/to/existing-notes"
              value={workspaceDir}
              onChange={(e) => onSetWorkspace(e.target.value)}
            />
          )}
          {workspaceDir && (
            <div className="onboarding-path">{workspaceDir}</div>
          )}
        </>
      )}

      <div className="onboarding-nav">
        <button
          className="onboarding-btn onboarding-btn--ghost"
          onClick={onPrev}
        >
          Back
        </button>
        <button
          className="onboarding-btn onboarding-btn--primary"
          onClick={onNext}
          disabled={!workspaceDir}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function ProviderStep({
  selectedProvider,
  onSetProvider,
  onNext,
  onPrev,
  onOllamaNext,
}: {
  selectedProvider: string;
  onSetProvider: (p: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onOllamaNext: () => void;
}) {
  return (
    <div className="onboarding-content">
      <h2 className="onboarding-heading">Choose a Provider</h2>
      <p className="onboarding-body">
        Select which LLM provider you'd like to use.
      </p>
      <div className="onboarding-providers">
        {PROVIDER_CATALOG.map((p) => (
          <button
            key={p.id}
            className={`onboarding-provider-card ${selectedProvider === p.id ? "onboarding-provider-card--selected" : ""}`}
            onClick={() => onSetProvider(p.id)}
          >
            <span className="onboarding-provider-card__label">{p.label}</span>
            {!p.requiresApiKey && (
              <span className="onboarding-provider-card__badge">
                No API key
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="onboarding-nav">
        <button
          className="onboarding-btn onboarding-btn--ghost"
          onClick={onPrev}
        >
          Back
        </button>
        <button
          className="onboarding-btn onboarding-btn--primary"
          onClick={() => {
            if (!selectedProvider) return;
            const entry = PROVIDER_CATALOG.find(
              (p) => p.id === selectedProvider,
            );
            if (entry && !entry.requiresApiKey) {
              onOllamaNext();
            } else {
              onNext();
            }
          }}
          disabled={!selectedProvider}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function OllamaSetupStep({
  ollamaModels,
  selectedOllamaModel,
  isSubmitting,
  error,
  onSelectOllamaModel,
  onRefreshOllamaModels,
  onComplete,
  onPrev,
}: {
  ollamaModels: string[];
  selectedOllamaModel: string;
  isSubmitting: boolean;
  error: string | null;
  onSelectOllamaModel: (model: string) => void;
  onRefreshOllamaModels: () => void;
  onComplete: () => void;
  onPrev: () => void;
}) {
  // Determine status based on ollamaModels state
  // Empty array with no error = still loading or not-running/no-models
  const hasModels = ollamaModels.length > 0;

  return (
    <div className="onboarding-content">
      <h2 className="onboarding-heading">Set Up Ollama</h2>

      {hasModels ? (
        <>
          <p className="onboarding-body">Select a model to use with Clark.</p>
          <div className="onboarding-model-list">
            {ollamaModels.map((model) => (
              <button
                key={model}
                className={`onboarding-model-item ${selectedOllamaModel === model ? "onboarding-model-item--selected" : ""}`}
                onClick={() => onSelectOllamaModel(model)}
              >
                {model}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="onboarding-body">
            Ollama lets you run LLMs locally on your machine. Follow these steps
            to get started:
          </p>
          <div className="onboarding-instructions">
            <div className="onboarding-instruction">
              <span className="onboarding-instruction__num">1</span>
              <div>
                <div className="onboarding-instruction__title">
                  Install Ollama
                </div>
                <code className="onboarding-code">brew install ollama</code>
              </div>
            </div>
            <div className="onboarding-instruction">
              <span className="onboarding-instruction__num">2</span>
              <div>
                <div className="onboarding-instruction__title">
                  Start the server
                </div>
                <code className="onboarding-code">ollama serve</code>
              </div>
            </div>
            <div className="onboarding-instruction">
              <span className="onboarding-instruction__num">3</span>
              <div>
                <div className="onboarding-instruction__title">
                  Pull a model
                </div>
                <code className="onboarding-code">ollama pull llama3.2</code>
                <div className="onboarding-instruction__hint">
                  Browse more models at ollama.com/library
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      <button
        className="onboarding-btn onboarding-btn--secondary"
        onClick={onRefreshOllamaModels}
        style={{ marginTop: "12px" }}
      >
        {hasModels ? "Refresh Models" : "Check for Models"}
      </button>

      {error && <p className="onboarding-error">{error}</p>}

      <div className="onboarding-nav">
        <button
          className="onboarding-btn onboarding-btn--ghost"
          onClick={onPrev}
          disabled={isSubmitting}
        >
          Back
        </button>
        <button
          className="onboarding-btn onboarding-btn--primary"
          onClick={onComplete}
          disabled={!selectedOllamaModel || isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Complete Setup"}
        </button>
      </div>
    </div>
  );
}

function ApiKeyStep({
  selectedProvider,
  apiKey,
  isSubmitting,
  error,
  onSetApiKey,
  onComplete,
  onPrev,
}: {
  selectedProvider: string;
  apiKey: string;
  isSubmitting: boolean;
  error: string | null;
  onSetApiKey: (key: string) => void;
  onComplete: () => void;
  onPrev: () => void;
}) {
  const entry = PROVIDER_CATALOG.find((p) => p.id === selectedProvider);
  return (
    <div className="onboarding-content">
      <h2 className="onboarding-heading">Enter API Key</h2>
      <p className="onboarding-body">
        Provide your API key for {entry?.label ?? selectedProvider}.
        {"site" in (entry ?? {}) && (
          <>
            {" "}
            Get one at{" "}
            <span className="onboarding-link">
              {(entry as { site: string }).site}
            </span>
          </>
        )}
      </p>
      <input
        className="onboarding-input"
        type="password"
        placeholder="sk-..."
        value={apiKey}
        onChange={(e) => onSetApiKey(e.target.value)}
        autoFocus
      />
      <p className="onboarding-note">
        Your key is stored securely in the system keychain.
      </p>
      {error && <p className="onboarding-error">{error}</p>}
      <div className="onboarding-nav">
        <button
          className="onboarding-btn onboarding-btn--ghost"
          onClick={onPrev}
          disabled={isSubmitting}
        >
          Back
        </button>
        <button
          className="onboarding-btn onboarding-btn--primary"
          onClick={onComplete}
          disabled={!apiKey.trim() || isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Complete Setup"}
        </button>
      </div>
    </div>
  );
}

export function Onboarding({
  state,
  isTauri,
  onNext,
  onPrev,
  onSetWorkspace,
  onSetWorkspaceIsNew,
  onPickFolder,
  onSetProvider,
  onSetApiKey,
  onOllamaNext,
  onRefreshOllamaModels,
  onSelectOllamaModel,
  onComplete,
}: OnboardingProps) {
  // Welcome step uses full-bleed particle animation — no step indicator
  if (state.step === "welcome") {
    return (
      <div className="onboarding onboarding--welcome">
        <WelcomeStep onNext={onNext} />
      </div>
    );
  }

  return (
    <div className="onboarding">
      <StepIndicator currentStep={state.step} />
      {state.step === "workspace" && (
        <WorkspaceStep
          workspaceDir={state.workspaceDir}
          workspaceIsNew={state.workspaceIsNew}
          isTauri={isTauri}
          onSetWorkspace={onSetWorkspace}
          onSetWorkspaceIsNew={onSetWorkspaceIsNew}
          onPickFolder={onPickFolder}
          onNext={onNext}
          onPrev={onPrev}
        />
      )}
      {state.step === "provider" && (
        <ProviderStep
          selectedProvider={state.selectedProvider}
          onSetProvider={onSetProvider}
          onNext={onNext}
          onPrev={onPrev}
          onOllamaNext={onOllamaNext}
        />
      )}
      {state.step === "ollama-setup" && (
        <OllamaSetupStep
          ollamaModels={state.ollamaModels}
          selectedOllamaModel={state.selectedOllamaModel}
          isSubmitting={state.isSubmitting}
          error={state.error}
          onSelectOllamaModel={onSelectOllamaModel}
          onRefreshOllamaModels={onRefreshOllamaModels}
          onComplete={onComplete}
          onPrev={onPrev}
        />
      )}
      {state.step === "api-key" && (
        <ApiKeyStep
          selectedProvider={state.selectedProvider}
          apiKey={state.apiKey}
          isSubmitting={state.isSubmitting}
          error={state.error}
          onSetApiKey={onSetApiKey}
          onComplete={onComplete}
          onPrev={onPrev}
        />
      )}
    </div>
  );
}
