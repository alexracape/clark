/**
 * Test utilities for Clark test suite.
 */

/**
 * Temporarily suppress console.error output during test execution.
 * Useful for tests that intentionally trigger expected errors.
 *
 * @example
 * ```typescript
 * await suppressConsoleError(async () => {
 *   ws.send("malformed message"); // Expected to cause error
 *   await new Promise(r => setTimeout(r, 100));
 * });
 * ```
 */
export async function suppressConsoleError<T>(fn: () => T | Promise<T>): Promise<T> {
	const original = console.error;
	console.error = () => {};
	try {
		return await fn();
	} finally {
		console.error = original;
	}
}

/**
 * Capture all console output (log, error, warn) during test execution.
 * Returns both the function result and captured output.
 *
 * @example
 * ```typescript
 * const { result, logs, errors } = await captureConsoleOutput(async () => {
 *   console.log("test");
 *   console.error("error");
 *   return 42;
 * });
 * expect(logs).toEqual(["test"]);
 * expect(errors).toEqual(["error"]);
 * expect(result).toBe(42);
 * ```
 */
export async function captureConsoleOutput<T>(
	fn: () => T | Promise<T>,
): Promise<{ result: T; logs: string[]; errors: string[]; warns: string[] }> {
	const logs: string[] = [];
	const errors: string[] = [];
	const warns: string[] = [];

	const originalLog = console.log;
	const originalError = console.error;
	const originalWarn = console.warn;

	console.log = (...args) => logs.push(args.join(" "));
	console.error = (...args) => errors.push(args.join(" "));
	console.warn = (...args) => warns.push(args.join(" "));

	try {
		const result = await fn();
		return { result, logs, errors, warns };
	} finally {
		console.log = originalLog;
		console.error = originalError;
		console.warn = originalWarn;
	}
}

/**
 * Helper to wait for a specified duration.
 * Improves readability over Promise + setTimeout inline.
 *
 * @example
 * ```typescript
 * await tick(100); // Wait 100ms
 * ```
 */
export function tick(ms = 50): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
