import React, { useState, useCallback } from "react";
import type { OnboardingState } from "../app-controller.ts";
import { ParticleGraph } from "./ParticleGraph.tsx";

interface OnboardingProps {
  state: OnboardingState;
  isTauri: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSetBetaCode: (code: string) => void;
  onSetUsageTrackingEnabled: (enabled: boolean) => void;
  onSetWorkspace: (dir: string) => void;
  onSetWorkspaceIsNew: (isNew: boolean) => void;
  onPickFolder: () => Promise<string | null>;
  onComplete: () => void;
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  const [settled, setSettled] = useState(false);
  const handleSettled = useCallback(() => setSettled(true), []);

  return (
    <div className="welcome-step">
      <ParticleGraph onSettled={handleSettled} textYRatio={0.35} />
      <div
        className={`welcome-step__ui ${settled ? "welcome-step__ui--visible" : ""}`}
      >
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

function BetaCodeStep({
  betaCode,
  error,
  isSubmitting,
  onSetBetaCode,
  onNext,
  onPrev,
}: {
  betaCode: string;
  error: string | null;
  isSubmitting: boolean;
  onSetBetaCode: (code: string) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  return (
    <div className="onboarding-content">
      <h2 className="onboarding-heading">Beta Access</h2>
      <p className="onboarding-body">
        Enter your beta code to unlock full cloud access, or skip to continue
        with basic features.
      </p>

      <input
        className="onboarding-input"
        type="text"
        placeholder="Enter beta code"
        value={betaCode}
        onChange={(e) => onSetBetaCode(e.target.value)}
        disabled={isSubmitting}
      />

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
          className="onboarding-btn onboarding-btn--secondary"
          onClick={onNext}
          disabled={isSubmitting}
        >
          Skip
        </button>
        <button
          className="onboarding-btn onboarding-btn--primary"
          onClick={onNext}
          disabled={isSubmitting}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function TrackingStep({
  usageTrackingEnabled,
  onSetUsageTrackingEnabled,
  onNext,
  onPrev,
}: {
  usageTrackingEnabled: boolean;
  onSetUsageTrackingEnabled: (enabled: boolean) => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  return (
    <div className="onboarding-content">
      <h2 className="onboarding-heading">Help Us Improve Clark</h2>
      <p className="onboarding-body">
        Clark can share anonymous usage data. This includes things like which
        features you use and how often, to help us understand what's working and
        what isn't. None of your files, personal information, or conversation
        details are ever collected. It's purely for improving the app.
      </p>

      <div className="onboarding-tracking-options">
        <label className="onboarding-tracking-option">
          <input
            type="radio"
            name="tracking"
            checked={usageTrackingEnabled}
            onChange={() => onSetUsageTrackingEnabled(true)}
          />
          <div>
            <span className="onboarding-tracking-option__title">
              Yes, share anonymous usage data
            </span>
            <span className="onboarding-tracking-option__desc">
              Help us improve Clark.
            </span>
          </div>
        </label>
        <label className="onboarding-tracking-option">
          <input
            type="radio"
            name="tracking"
            checked={!usageTrackingEnabled}
            onChange={() => onSetUsageTrackingEnabled(false)}
          />
          <div>
            <span className="onboarding-tracking-option__title">No thanks</span>
            <span className="onboarding-tracking-option__desc">
              You can change this later in Settings.
            </span>
          </div>
        </label>
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
          onClick={onNext}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function WorkspaceStep({
  workspaceDir,
  workspaceIsNew,
  isTauri,
  error,
  isSubmitting,
  onSetWorkspace,
  onSetWorkspaceIsNew,
  onPickFolder,
  onComplete,
  onPrev,
}: {
  workspaceDir: string;
  workspaceIsNew: boolean;
  isTauri: boolean;
  error: string | null;
  isSubmitting: boolean;
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
          disabled={!workspaceDir || isSubmitting}
        >
          {isSubmitting ? "Setting up…" : "Complete Setup"}
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
  onSetBetaCode,
  onSetUsageTrackingEnabled,
  onSetWorkspace,
  onSetWorkspaceIsNew,
  onPickFolder,
  onComplete,
}: OnboardingProps) {
  if (state.step === "welcome") {
    return (
      <div className="onboarding onboarding--welcome">
        <WelcomeStep onNext={onNext} />
      </div>
    );
  }

  return (
    <div className="onboarding">
      {state.step === "beta-code" && (
        <BetaCodeStep
          betaCode={state.betaCode}
          error={state.error}
          isSubmitting={state.isSubmitting}
          onSetBetaCode={onSetBetaCode}
          onNext={onNext}
          onPrev={onPrev}
        />
      )}
      {state.step === "tracking" && (
        <TrackingStep
          usageTrackingEnabled={state.usageTrackingEnabled}
          onSetUsageTrackingEnabled={onSetUsageTrackingEnabled}
          onNext={onNext}
          onPrev={onPrev}
        />
      )}
      {state.step === "workspace" && (
        <WorkspaceStep
          workspaceDir={state.workspaceDir}
          workspaceIsNew={state.workspaceIsNew}
          isTauri={isTauri}
          error={state.error}
          isSubmitting={state.isSubmitting}
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
