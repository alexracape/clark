import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { EmbeddedImage } from "../gui/src/extensions/EmbeddedImage.ts";
import { EmbeddedPDF } from "../gui/src/extensions/EmbeddedPDF.ts";

const extensions = [StarterKit, Markdown, EmbeddedImage, EmbeddedPDF];

describe("EmbeddedPDF", () => {
  test("parses ![[doc.pdf]] into an embeddedPdf node", () => {
    const editor = new Editor({
      extensions,
      content: "![[doc.pdf]]",
      contentType: "markdown",
    });

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "embeddedPdf",
          attrs: {
            assetPath: "doc.pdf",
            src: "http://localhost:3456/api/asset?path=doc.pdf",
          },
        },
      ],
    });
  });

  test("round-trips markdown for PDF embeds", () => {
    const editor = new Editor({
      extensions,
      content: "![[doc.pdf]]",
      contentType: "markdown",
    });

    expect(editor.getMarkdown()).toBe("![[doc.pdf]]");
  });

  test("parses workspace-relative PDF paths", () => {
    const editor = new Editor({
      extensions,
      content: "![[Resources/PDFs/report.pdf]]",
      contentType: "markdown",
    });

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "embeddedPdf",
          attrs: {
            assetPath: "Resources/PDFs/report.pdf",
            src: "http://localhost:3456/api/asset?path=Resources%2FPDFs%2Freport.pdf",
          },
        },
      ],
    });
    expect(editor.getMarkdown()).toBe("![[Resources/PDFs/report.pdf]]");
  });

  test("mixed images and PDFs get correct node types", () => {
    const content = [
      "![[diagram.png]]",
      "",
      "![[report.pdf]]",
    ].join("\n");

    const editor = new Editor({
      extensions,
      content,
      contentType: "markdown",
    });

    const json = editor.getJSON();
    expect(json.content?.[0]?.type).toBe("image");
    expect(json.content?.[1]?.type).toBe("embeddedPdf");
  });

  test("images no longer match .pdf extension", () => {
    const editor = new Editor({
      extensions,
      content: "![[doc.pdf]]",
      contentType: "markdown",
    });

    const json = editor.getJSON();
    const types = json.content?.map((n: { type: string }) => n.type) ?? [];
    expect(types).not.toContain("image");
    expect(types).toContain("embeddedPdf");
  });

  test("existing image tests still work — images render as image nodes", () => {
    const editor = new Editor({
      extensions,
      content: "![[photo.png]]",
      contentType: "markdown",
    });

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            assetPath: "photo.png",
          },
        },
      ],
    });
    expect(editor.getMarkdown()).toBe("![[photo.png]]");
  });
});
