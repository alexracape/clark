/**
 * Clark — Socratic Tutoring Assistant
 *
 * Composition root: parse args, load config, run onboarding if needed,
 * then delegate app startup to bootstrap modules.
 */

import React from "react";
import { render } from "ink";
import { Onboarding } from "./cli/tui/onboarding.tsx";
import {
  applyConfigToEnv,
  loadConfig,
  needsOnboarding,
  type ClarkConfig,
} from "./core/config.ts";
import { parseCliArgs, version } from "./cli/bootstrap/args.ts";
import { startClarkApp } from "./cli/bootstrap/start-app.ts";
import { runUpgrade } from "./cli/bootstrap/upgrade.ts";

const args = await parseCliArgs();

if (args.upgrade) {
  await runUpgrade(version);
  process.exit(0);
}

const config = await loadConfig();
applyConfigToEnv(config);

if (!config.hasCompletedOnboarding || await needsOnboarding(config)) {
  render(
    React.createElement(Onboarding, {
      onComplete: (newConfig: ClarkConfig) => {
        applyConfigToEnv(newConfig);
        setTimeout(() => {
          void startClarkApp(newConfig, args);
        }, 100);
      },
    }),
  );
} else {
  await startClarkApp(config, args);
}
