import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import {
  EmbeddedImage,
  normalizeEmbeddedAssetPath,
  resolveEmbeddedImageAssetUrl,
} from "../gui/src/extensions/EmbeddedImage.ts";

describe("EmbeddedImage", () => {
  test("resolves bare filenames into the default image directory", () => {
    const url = resolveEmbeddedImageAssetUrl("diagram.png", {
      assetBaseUrl: "http://localhost:3456",
      imageDir: "Resources/Images/",
    });

    expect(url).toBe("http://localhost:3456/api/asset?path=Resources%2FImages%2Fdiagram.png");
  });

  test("preserves workspace-relative paths when rendering asset URLs", () => {
    const url = resolveEmbeddedImageAssetUrl("Assets/Diagrams/diagram.png", {
      assetBaseUrl: "http://localhost:3456",
      imageDir: "Resources/Images/",
    });

    expect(url).toBe("http://localhost:3456/api/asset?path=Assets%2FDiagrams%2Fdiagram.png");
  });

  test("normalizes absolute resource paths before rendering asset URLs", () => {
    expect(
      normalizeEmbeddedAssetPath("/Users/alexracape/test_vault/Resources/Images/FullSizeRender.jpg"),
    ).toBe("Resources/Images/FullSizeRender.jpg");

    const url = resolveEmbeddedImageAssetUrl(
      "/Users/alexracape/test_vault/Resources/Images/FullSizeRender.jpg",
      {
        assetBaseUrl: "http://localhost:3456",
        imageDir: "Resources/Images/",
      },
    );

    expect(url).toBe(
      "http://localhost:3456/api/asset?path=Resources%2FImages%2FFullSizeRender.jpg",
    );
  });

  test("parses embedded wikilinks into image nodes and round-trips markdown", () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown, EmbeddedImage],
      content: "![[diagram.png]]",
      contentType: "markdown",
    });

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                assetPath: "diagram.png",
                alt: "diagram.png",
                src: "http://localhost:3456/api/asset?path=Resources%2FImages%2Fdiagram.png",
              },
            },
          ],
        },
      ],
    });
    expect(editor.getMarkdown()).toBe("![[diagram.png]]");
  });

  test("leaves incomplete embeds as raw text while editing", () => {
    const editor = new Editor({
      extensions: [StarterKit, Markdown, EmbeddedImage],
      content: "![[Ful]]",
      contentType: "markdown",
    });

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "![[Ful]]" }],
        },
      ],
    });
    expect(editor.getMarkdown()).toBe("![[Ful]]");
  });

  test("handles mixed absolute, relative, and incomplete embeds in one document", () => {
    const content = [
      "# Reinforcement Learning from Human Feedback",
      "",
      "![[/Users/alexracape/test_vault/Resources/Images/FullSizeRender.jpg]]",
      "![[Ful]]",
      "![[Resources/Images/FullSizeRender.jpg]]",
      "![[FullSizeRender.jpg]]",
    ].join("\n");

    const editor = new Editor({
      extensions: [StarterKit, Markdown, EmbeddedImage],
      content,
      contentType: "markdown",
    });

    const json = editor.getJSON();
    const serialized = JSON.stringify(json);

    expect(serialized).toContain("\"assetPath\":\"Resources/Images/FullSizeRender.jpg\"");
    expect(serialized).toContain("\"assetPath\":\"FullSizeRender.jpg\"");
    expect(serialized).toContain("\"text\":\"![[Ful]]\"");
    expect(editor.getMarkdown()).toContain("![[Resources/Images/FullSizeRender.jpg]]");
    expect(editor.getMarkdown()).toContain("![[Ful]]");
  });
});
