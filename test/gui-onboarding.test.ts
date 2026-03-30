import { describe, expect, test } from "bun:test";
import {
  createInitialAppState,
  startOnboarding,
  onboardingNextStep,
  onboardingPrevStep,
  setOnboardingBetaCode,
  setOnboardingUsageTracking,
  setOnboardingWorkspace,
  setOnboardingWorkspaceIsNew,
  setOnboardingError,
  setOnboardingSubmitting,
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
    expect(state.onboarding!.betaCode).toBe("");
    expect(state.onboarding!.usageTrackingEnabled).toBe(true);
    expect(state.onboarding!.workspaceDir).toBe("");
    expect(state.onboarding!.workspaceIsNew).toBe(true);
    expect(state.onboarding!.error).toBeNull();
    expect(state.onboarding!.isSubmitting).toBe(false);
  });

  test("onboardingNextStep advances welcome → beta-code → tracking → workspace", () => {
    let state = startOnboarding(createInitialAppState());
    expect(state.onboarding!.step).toBe("welcome");

    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("beta-code");

    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("tracking");

    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("workspace");

    // Should not go past last step
    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("workspace");
  });

  test("onboardingPrevStep goes back workspace → tracking → beta-code → welcome", () => {
    let state = startOnboarding(createInitialAppState());
    state = onboardingNextStep(state);
    state = onboardingNextStep(state);
    state = onboardingNextStep(state);
    expect(state.onboarding!.step).toBe("workspace");

    state = onboardingPrevStep(state);
    expect(state.onboarding!.step).toBe("tracking");

    state = onboardingPrevStep(state);
    expect(state.onboarding!.step).toBe("beta-code");

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

  test("setOnboardingBetaCode updates beta code", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingBetaCode(state, "BETA-123");
    expect(state.onboarding!.betaCode).toBe("BETA-123");
  });

  test("setOnboardingError sets and clears error", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingError(state, "Invalid code");
    expect(state.onboarding!.error).toBe("Invalid code");

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

  test("setOnboardingUsageTracking updates preference", () => {
    let state = startOnboarding(createInitialAppState());
    expect(state.onboarding!.usageTrackingEnabled).toBe(true);
    state = setOnboardingUsageTracking(state, false);
    expect(state.onboarding!.usageTrackingEnabled).toBe(false);
    state = setOnboardingUsageTracking(state, true);
    expect(state.onboarding!.usageTrackingEnabled).toBe(true);
  });

  test("setOnboardingWorkspace updates workspace dir", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingWorkspace(state, "/home/user/docs");
    expect(state.onboarding!.workspaceDir).toBe("/home/user/docs");
  });

  test("setOnboardingWorkspaceIsNew toggles flag", () => {
    let state = startOnboarding(createInitialAppState());
    expect(state.onboarding!.workspaceIsNew).toBe(true);
    state = setOnboardingWorkspaceIsNew(state, false);
    expect(state.onboarding!.workspaceIsNew).toBe(false);
  });

  test("completeOnboarding clears onboarding state", () => {
    let state = startOnboarding(createInitialAppState());
    state = setOnboardingBetaCode(state, "BETA-123");
    state = setOnboardingWorkspace(state, "/home/user/vault");
    expect(state.onboarding).not.toBeNull();

    state = completeOnboarding(state);
    expect(state.onboarding).toBeNull();
  });

  test("functions are no-ops when onboarding is null", () => {
    const state = createInitialAppState();
    expect(onboardingNextStep(state).onboarding).toBeNull();
    expect(onboardingPrevStep(state).onboarding).toBeNull();
    expect(setOnboardingBetaCode(state, "code").onboarding).toBeNull();
    expect(setOnboardingUsageTracking(state, false).onboarding).toBeNull();
    expect(setOnboardingWorkspace(state, "/foo").onboarding).toBeNull();
    expect(setOnboardingWorkspaceIsNew(state, true).onboarding).toBeNull();
    expect(setOnboardingError(state, "err").onboarding).toBeNull();
    expect(setOnboardingSubmitting(state, true).onboarding).toBeNull();
  });
});
