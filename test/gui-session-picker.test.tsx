import React from "react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionPicker } from "../gui/src/components/SessionPicker.tsx";

describe("GUI SessionPicker", () => {
  test("prefers the generated title over the raw date label", () => {
    const html = renderToStaticMarkup(
      <SessionPicker
        sessions={[{
          path: "/tmp/session.md",
          filename: "2026-03-31 Matrix-Basics.md",
          date: "2026-03-31",
          sessionId: "abc123",
          provider: "mock",
          model: "test-model",
          title: "Matrix Basics",
          firstUserMessage: "What is a matrix?",
        }]}
        onSelect={() => {}}
        onClose={() => {}}
      />,
    );

    expect(html).toContain("Matrix Basics");
    expect(html).toContain("2026-03-31");
    expect(html).toContain("What is a matrix?");
    expect(html).not.toContain("mock/test-model");
  });
});
