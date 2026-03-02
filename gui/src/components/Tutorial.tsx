import React from "react";
import type { TutorialStep } from "../app-controller.ts";

interface TutorialProps {
  step: TutorialStep;
  onNext: () => void;
  onSkip: () => void;
}

const STEP_NUMBERS: Record<TutorialStep, number> = {
  intro: 0,
  "asking-questions": 1,
  "slash-commands": 2,
  "file-context": 3,
  "canvas-intro": 4,
  completion: 5,
};

function StepContent({ step }: { step: TutorialStep }) {
  switch (step) {
    case "intro":
      return (
        <>
          <h2 className="onboarding-heading">Clark Tutorial</h2>
          <p className="onboarding-body">
            Welcome! Let's learn the basics in 5 quick steps.
          </p>
          <p className="tutorial-text">
            Clark is designed to help you learn by asking guiding questions
            rather than giving direct answers. Think of it as your Socratic tutor.
          </p>
        </>
      );

    case "asking-questions":
      return (
        <>
          <h2 className="onboarding-heading">Asking Questions</h2>
          <p className="tutorial-text">
            Simply type your question in the composer and press Enter.
          </p>
          <div className="tutorial-example">
            "What is recursion?"
          </div>
          <p className="tutorial-text">
            Clark will respond with guiding questions to help you think through
            the concept, rather than giving you the answer directly.
          </p>
          <p className="tutorial-tip">
            Tip: The more specific your question, the better Clark can help!
          </p>
        </>
      );

    case "slash-commands":
      return (
        <>
          <h2 className="onboarding-heading">Slash Commands</h2>
          <p className="tutorial-text" style={{ fontWeight: 500 }}>
            Useful commands to know:
          </p>
          <div className="tutorial-commands">
            <div className="tutorial-command">
              <span className="tutorial-command__name">/help</span>
              <span className="tutorial-command__desc">See all available commands</span>
            </div>
            <div className="tutorial-command">
              <span className="tutorial-command__name">/model</span>
              <span className="tutorial-command__desc">Switch between LLM models</span>
            </div>
            <div className="tutorial-command">
              <span className="tutorial-command__name">/canvas</span>
              <span className="tutorial-command__desc">Open a drawing board</span>
            </div>
            <div className="tutorial-command">
              <span className="tutorial-command__name">/export</span>
              <span className="tutorial-command__desc">Save your canvas as a PDF</span>
            </div>
            <div className="tutorial-command">
              <span className="tutorial-command__name">/context</span>
              <span className="tutorial-command__desc">Check context usage</span>
            </div>
            <div className="tutorial-command">
              <span className="tutorial-command__name">/clear</span>
              <span className="tutorial-command__desc">Start a fresh conversation</span>
            </div>
          </div>
          <p className="tutorial-tip">
            Tip: Type <strong>/</strong> to see command suggestions!
          </p>
        </>
      );

    case "file-context":
      return (
        <>
          <h2 className="onboarding-heading">Adding Context</h2>
          <p className="tutorial-text" style={{ fontWeight: 500 }}>
            How to share files with Clark:
          </p>
          <p className="tutorial-text">
            Use the sidebar file browser to browse your workspace, or drag and
            drop files directly into the app window.
          </p>
          <p className="tutorial-text">
            Clark can read and understand:
          </p>
          <ul className="tutorial-list">
            <li>Code files (.py, .js, .java, etc.)</li>
            <li>PDFs and documents</li>
            <li>Images and screenshots</li>
          </ul>
          <p className="tutorial-tip">
            Tip: Drag and drop files from Finder into Clark to add them as context!
          </p>
        </>
      );

    case "canvas-intro":
      return (
        <>
          <h2 className="onboarding-heading">Canvas &amp; Handwriting</h2>
          <p className="tutorial-text" style={{ fontWeight: 500 }}>
            Using the canvas with your iPad:
          </p>
          <ol className="tutorial-list tutorial-list--ordered">
            <li>Type <strong className="tutorial-inline-cmd">/canvas</strong> to start a new canvas session</li>
            <li>Open the URL on your iPad's browser</li>
            <li>Start drawing, writing, or diagramming</li>
            <li>Clark can see your canvas and respond to your work</li>
          </ol>
          <p className="tutorial-text">The canvas is perfect for:</p>
          <ul className="tutorial-list">
            <li>Working through math problems</li>
            <li>Sketching diagrams and flowcharts</li>
            <li>Handwritten notes and brainstorming</li>
          </ul>
          <p className="tutorial-tip">
            Tip: Use <strong className="tutorial-inline-cmd">/export</strong> to save your canvas as a PDF!
          </p>
        </>
      );

    case "completion":
      return (
        <>
          <h2 className="onboarding-heading">You're Ready!</h2>
          <p className="tutorial-text" style={{ fontWeight: 500, color: "var(--sage)" }}>
            Tutorial complete!
          </p>
          <div className="tutorial-checklist">
            <div className="tutorial-check">Ask questions and get Socratic guidance</div>
            <div className="tutorial-check">Use slash commands like /help and /canvas</div>
            <div className="tutorial-check">Share files and code with Clark</div>
            <div className="tutorial-check">Use the canvas for handwritten work</div>
          </div>
          <p className="tutorial-text">
            Remember: Type <strong>/help</strong> anytime to see all commands.
          </p>
          <p className="tutorial-tip">Happy learning!</p>
        </>
      );
  }
}

export function Tutorial({ step, onNext, onSkip }: TutorialProps) {
  const stepNum = STEP_NUMBERS[step];
  const isCompletion = step === "completion";
  const isIntro = step === "intro";

  return (
    <div className="tutorial-overlay" onClick={onSkip}>
      <div className="tutorial-card" onClick={(e) => e.stopPropagation()}>
        {/* Progress dots */}
        {!isIntro && (
          <div className="tutorial-progress">
            {[1, 2, 3, 4, 5].map((n) => (
              <span
                key={n}
                className={`tutorial-progress__dot${
                  n < stepNum ? " tutorial-progress__dot--done" :
                  n === stepNum ? " tutorial-progress__dot--active" : ""
                }`}
              />
            ))}
          </div>
        )}

        {/* Step label */}
        {!isIntro && !isCompletion && (
          <div className="tutorial-step-label">Step {stepNum} of 5</div>
        )}

        <div className="tutorial-body">
          <StepContent step={step} />
        </div>

        <div className="tutorial-nav">
          <button
            className="onboarding-btn onboarding-btn--ghost"
            onClick={onSkip}
          >
            {isCompletion ? "Close" : "Skip"}
          </button>
          <button
            className="onboarding-btn onboarding-btn--primary"
            onClick={onNext}
          >
            {isCompletion ? "Get Started" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
