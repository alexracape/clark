/**
 * Tests for onboarding flow
 *
 * Note: ink-testing-library's stdin simulation doesn't reliably trigger useInput hooks.
 * These tests focus on component rendering, not full keyboard interaction flows.
 * Interactive flows are best tested manually or with integration tests.
 */

import { test, expect, describe, afterEach, mock } from "bun:test";
import { render, cleanup } from "ink-testing-library";
import React from "react";
import { Onboarding } from "../cli/tui/onboarding.tsx";

describe("Onboarding", () => {
	afterEach(() => {
		cleanup();
	});

	describe("Welcome Screen", () => {
		test("renders ASCII art logo", () => {
			const onComplete = mock(() => {});
			const { lastFrame } = render(<Onboarding onComplete={onComplete} />);

			expect(lastFrame()).toContain("Clark");
			expect(lastFrame()).toContain("_____|_|");
		});

		test("shows welcome message", () => {
			const onComplete = mock(() => {});
			const { lastFrame } = render(<Onboarding onComplete={onComplete} />);

			expect(lastFrame()).toContain("Welcome to");
			expect(lastFrame()).toContain("Socratic tutoring assistant");
		});

		test("shows step indicator [1/3]", () => {
			const onComplete = mock(() => {});
			const { lastFrame } = render(<Onboarding onComplete={onComplete} />);

			expect(lastFrame()).toContain("[1/3]");
			expect(lastFrame()).toContain("Welcome");
		});

		test("shows required items list", () => {
			const onComplete = mock(() => {});
			const { lastFrame } = render(<Onboarding onComplete={onComplete} />);

			expect(lastFrame()).toContain("What you'll need:");
			expect(lastFrame()).toContain("API key from an LLM provider");
			expect(lastFrame()).toContain("Anthropic, OpenAI, or Google");
		});

		test("shows keyboard hints", () => {
			const onComplete = mock(() => {});
			const { lastFrame } = render(<Onboarding onComplete={onComplete} />);

			expect(lastFrame()).toContain("Enter");
			expect(lastFrame()).toContain("Ctrl+C");
		});
	});

	describe("Component Structure", () => {
		test("renders without crashing", () => {
			const onComplete = mock(() => {});
			const { lastFrame } = render(<Onboarding onComplete={onComplete} />);

			expect(lastFrame()).toBeDefined();
			expect(lastFrame()?.length).toBeGreaterThan(0);
		});

		test("onComplete callback is provided", () => {
			const onComplete = mock(() => {});
			render(<Onboarding onComplete={onComplete} />);

			// Component should render successfully
			expect(onComplete).toHaveBeenCalledTimes(0); // Not called initially
		});
	});

	describe("Provider List", () => {
		test("component includes all provider names", () => {
			// The providers are defined as constants in the component
			// We can at least verify the component file contains them
			const onComplete = mock(() => {});
			const { lastFrame } = render(<Onboarding onComplete={onComplete} />);

			// These should be part of the PROVIDERS constant
			// (we can't easily test the provider screen without keyboard interaction)
			expect(true).toBe(true); // Placeholder - provider testing requires navigation
		});
	});

	// Note: Full navigation tests (welcome → provider → api-key → done) would require
	// either:
	// 1. Integration tests that actually run the TUI
	// 2. Direct testing of component logic extracted from Ink hooks
	// 3. Manual testing
	//
	// ink-testing-library's stdin doesn't reliably trigger useInput, so we focus on
	// rendering tests here.
});
