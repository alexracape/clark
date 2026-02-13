/**
 * Clark — Socratic Tutoring Assistant
 *
 * Composition root: parse args, load config, run onboarding if needed,
 * then delegate app startup to bootstrap modules.
 */

import React from "react";
import { render } from "ink";
import { Onboarding } from "./src/tui/onboarding.tsx";
import { applyConfigToEnv, loadConfig, needsOnboarding, type ClarkConfig } from "./src/config.ts";
import { parseCliArgs } from "./src/bootstrap/args.ts";
import { startClarkApp } from "./src/bootstrap/start-app.ts";

const args = await parseCliArgs();
const config = await loadConfig();
applyConfigToEnv(config);

if (needsOnboarding(config)) {
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
