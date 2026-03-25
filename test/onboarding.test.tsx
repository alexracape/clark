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

		test("shows what's included", () => {
			const onComplete = mock(() => {});
			const { lastFrame } = render(<Onboarding onComplete={onComplete} />);

			expect(lastFrame()).toContain("What's included:");
			expect(lastFrame()).toContain("Claude Sonnet 4.6");
			expect(lastFrame()).toContain("PDF and image processing");
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

	// Note: Full navigation tests (welcome → done) would require
	// either:
	// 1. Integration tests that actually run the TUI
	// 2. Direct testing of component logic extracted from Ink hooks
	// 3. Manual testing
	//
	// ink-testing-library's stdin doesn't reliably trigger useInput, so we focus on
	// rendering tests here.
});
