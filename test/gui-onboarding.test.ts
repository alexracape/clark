import { describe, expect, test } from "bun:test";
import {
  createInitialAppState,
  startOnboarding,
  onboardingNextStep,
  onboardingPrevStep,
  setOnboardingWorkspace,
  setOnboardingWorkspaceIsNew,
  setOnboardingProvider,
  setOnboardingApiKey,
  setOnboardingError,
  setOnboardingSubmitting,
  setOnboardingOllamaModels,
  setOnboardingOllamaModel,
  setOnboardingStepOllama,
  completeOnboarding,
} from "../gui/src/app-controller.ts";

describe("onboarding state transitions", () => {
  test("createInitialAppState has onboarding null", () => {
    const state = createInitialAppState();
    expect(state.onboarding).toBeNull();
  });

  test("startOnboarding sets initial onboarding state", () => {
    const state = startOnboarding(createInitialAppState());
    expect(state.onboarding).not.toBeNull();
    expect(state.onboarding!.step).toBe("welcome");
    expect(state.onboarding!.workspaceDir).toBe("");
    expect(state.onboarding!.workspaceIsNew).toBe(false);
    expect(state.onboarding!.selectedProvider).toBe("");
    expect(state.onboarding!.apiKey).toBe("");
    expect(state.onboarding!.ollamaModels).toEqual([]);
    expect(state.onboarding!.selectedOllamaModel).toBe("");
    expect(state.onboarding!.error).toBeNull();
    expect(state.onboarding!.isSubmitting).toBe(false);
  });

  test("onboardingNextStep advances through steps", () => {
    let state = startOnboarding(createInitialAppState());
    expect(state.onboarding!.step).toBe("welcome");

    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("workspace");

    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("provider");

    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("api-key");

    // Should not go past last step
    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("api-key");
  });

  test("onboardingPrevStep goes back through steps", () => {
    let state = startOnboarding(createInitialAppState());
    state = onboardingNextStep(state);
    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("provider");

    state = onboardingPrevStep(state);
    expect(state.onboarding!.step).toBe("workspace");

    state = onboardingPrevStep(state);
    expect(state.onboarding!.step).toBe("welcome");

    // Should not go before first step
    state = onboardingPrevStep(state);
    expect(state.onboarding!.step).toBe("welcome");
  });

  test("onboardingNextStep clears error", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingError(state, "some error");
    expect(state.onboarding!.error).toBe("some error");

    state = onboardingNextStep(state);
    expect(state.onboarding!.error).toBeNull();
  });

  test("setOnboardingWorkspace updates workspace dir", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingWorkspace(state, "/home/user/docs");
    expect(state.onboarding!.workspaceDir).toBe("/home/user/docs");
  });

  test("setOnboardingProvider updates provider", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingProvider(state, "anthropic");
    expect(state.onboarding!.selectedProvider).toBe("anthropic");
  });

  test("setOnboardingApiKey updates api key", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingApiKey(state, "sk-test-123");
    expect(state.onboarding!.apiKey).toBe("sk-test-123");
  });

  test("setOnboardingError sets and clears error", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingError(state, "Invalid key");
    expect(state.onboarding!.error).toBe("Invalid key");

    state = setOnboardingError(state, null);
    expect(state.onboarding!.error).toBeNull();
  });

  test("setOnboardingSubmitting toggles submitting flag", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingSubmitting(state, true);
    expect(state.onboarding!.isSubmitting).toBe(true);

    state = setOnboardingSubmitting(state, false);
    expect(state.onboarding!.isSubmitting).toBe(false);
  });

  test("completeOnboarding clears onboarding state", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingProvider(state, "anthropic");
    state = setOnboardingApiKey(state, "sk-test");
    expect(state.onboarding).not.toBeNull();

    state = completeOnboarding(state);
    expect(state.onboarding).toBeNull();
  });

  test("setOnboardingWorkspaceIsNew toggles flag", () => {
    let state = startOnboarding(createInitialAppState());
    expect(state.onboarding!.workspaceIsNew).toBe(false);

    state = setOnboardingWorkspaceIsNew(state, true);
    expect(state.onboarding!.workspaceIsNew).toBe(true);

    state = setOnboardingWorkspaceIsNew(state, false);
    expect(state.onboarding!.workspaceIsNew).toBe(false);
  });

  test("setOnboardingOllamaModels updates model list", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingOllamaModels(state, ["llama3.2:latest", "codellama:7b"]);
    expect(state.onboarding!.ollamaModels).toEqual(["llama3.2:latest", "codellama:7b"]);
  });

  test("setOnboardingOllamaModel selects a model", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingOllamaModel(state, "llama3.2:latest");
    expect(state.onboarding!.selectedOllamaModel).toBe("llama3.2:latest");
  });

  test("setOnboardingStepOllama navigates to ollama-setup", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingStepOllama(state);
    expect(state.onboarding!.step).toBe("ollama-setup");
    expect(state.onboarding!.error).toBeNull();
  });

  test("setOnboardingStepOllama clears error", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingError(state, "some error");
    state = setOnboardingStepOllama(state);
    expect(state.onboarding!.error).toBeNull();
  });

  test("functions are no-ops when onboarding is null", () => {
    const state = createInitialAppState();
    expect(onboardingNextStep(state).onboarding).toBeNull();
    expect(onboardingPrevStep(state).onboarding).toBeNull();
    expect(setOnboardingWorkspace(state, "/foo").onboarding).toBeNull();
    expect(setOnboardingWorkspaceIsNew(state, true).onboarding).toBeNull();
    expect(setOnboardingProvider(state, "openai").onboarding).toBeNull();
    expect(setOnboardingApiKey(state, "key").onboarding).toBeNull();
    expect(setOnboardingError(state, "err").onboarding).toBeNull();
    expect(setOnboardingSubmitting(state, true).onboarding).toBeNull();
    expect(setOnboardingOllamaModels(state, ["m"]).onboarding).toBeNull();
    expect(setOnboardingOllamaModel(state, "m").onboarding).toBeNull();
    expect(setOnboardingStepOllama(state).onboarding).toBeNull();
  });
});
