import { resolve } from "node:path";

/**
 * Resolve Clark's active workspace directory.
 * In tests, CLARK_WORKSPACE_DIR can pin workspace operations to a fixture vault.
 */
export function getWorkspaceDir(): string {
  const override = process.env.CLARK_WORKSPACE_DIR?.trim();
  if (override) return resolve(override);
  return process.cwd();
}
