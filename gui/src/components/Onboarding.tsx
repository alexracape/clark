import React, { useState, useCallback } from "react";
import type { OnboardingState, OnboardingStep } from "../app-controller.ts";
import { ParticleGraph } from "./ParticleGraph.tsx";

const MAIN_STEPS: OnboardingStep[] = [
  "welcome",
  "workspace",
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
  const displayStep = currentStep === "ollama-setup" ? "workspace" : currentStep;
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
          Clark helps you read, annotate, and reason about documents with
          AI-powered tutoring. No setup required.
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
  onComplete,
  onPrev,
}: {
  workspaceDir: string;
  workspaceIsNew: boolean;
  isTauri: boolean;
  onSetWorkspace: (dir: string) => void;
  onSetWorkspaceIsNew: (isNew: boolean) => void;
  onPickFolder: () => Promise<string | null>;
  onComplete: () => void;
  onPrev: () => void;
}) {
  const [parentDir, setParentDir] = useState("");
  const [folderName, setFolderName] = useState("");

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
          onClick={onComplete}
          disabled={!workspaceDir}
        >
          Complete Setup
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

  // Provider and API key steps are skipped — default to clark-cloud.
  // If the flow somehow lands on these steps, auto-advance to workspace.
  if (state.step === "provider" || state.step === "api-key" || state.step === "ollama-setup") {
    onSetProvider("clark-cloud");
    onNext();
    return null;
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
          onComplete={onComplete}
          onPrev={onPrev}
        />
      )}
    </div>
  );
}
