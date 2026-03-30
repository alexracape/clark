import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { WikiLink } from "../gui/src/extensions/WikiLink.ts";
import { SmartPairs } from "../gui/src/extensions/SmartPairs.ts";
import { EmbeddedImage } from "../gui/src/extensions/EmbeddedImage.ts";
import { InlineMath } from "../gui/src/extensions/InlineMath.ts";
import { BlockMath } from "../gui/src/extensions/BlockMath.ts";
import { normalizeMarkdownEditorContent } from "../gui/src/editor-content.ts";
import {
  getWikiLinkSuggestionItems,
  insertWikiLinkSuggestion,
} from "../gui/src/extensions/WikiLinkSuggestion.ts";
import {
  createSlashCommands,
  getSlashCommandItems,
  insertWikiLinkScaffold,
} from "../gui/src/extensions/SlashCommands.ts";
import type { WikilinkTarget } from "../gui/src/note-paths.ts";

function createMarkdownEditor(content = "") {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown,
      WikiLink,
      SmartPairs,
      EmbeddedImage,
    ],
    content,
    contentType: "markdown",
  });
}

function createRichMarkdownEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown,
      WikiLink,
      SmartPairs,
      EmbeddedImage,
      InlineMath,
      BlockMath,
    ],
    content,
    contentType: "markdown",
  });
}

function createRawTextEditor(text: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown,
      WikiLink,
      SmartPairs,
      EmbeddedImage,
    ],
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text }],
        },
      ],
    },
  });
}

function findTextRange(editor: Editor, target: string) {
  let found: { from: number; to: number } | null = null;

  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const index = node.text.indexOf(target);
    if (index === -1) return;

    found = {
      from: pos + index,
      to: pos + index + target.length,
    };
    return false;
  });

  if (!found) {
    throw new Error(`Could not find text range for "${target}" in "${editor.getText()}"`);
  }

  return found;
}

describe("wikilink autocomplete helpers", () => {
  test("normalizes blank markdown into an empty paragraph for editor placeholders", () => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        Markdown,
      ],
      content: normalizeMarkdownEditorContent(""),
      contentType: "markdown",
    });

    expect(editor.getJSON()).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(editor.getMarkdown()).toBe("");
  });

  test("reloading transcript-style markdown does not crash the editor parser", () => {
    const content = [
      "# Attention Is All You Need",
      "",
      "![[Attention-Is-All-You-Need-img-0.jpeg]]",
      "Figure 1: The Transformer - model architecture.",
      "",
      "#### 3.2.3 Applications of Attention in our Model",
      "",
      "$$",
      "\\operatorname {A t t e n t i o n} (Q, K, V) = \\operatorname {s o f t m a x} \\left(\\frac {Q K ^ {T}}{\\sqrt {d _ {k}}}\\right) V \\tag {1}",
      "$$",
      "",
      "| Layer Type | Complexity per Layer | Sequential Operations | Maximum Path Length |",
      "| --- | --- | --- | --- |",
      "| Self-Attention | O(n2·d) | O(1) | O(1) |",
      "",
      "- [6] Francois Chollet. Xception: Deep learning with depthwise separable convolutions.",
    ].join("\n");

    const editor = createRichMarkdownEditor(content);

    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toContain("Attention Is All You Need");
    editor.commands.setContent(content, { contentType: "markdown" });
    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toContain("Attention Is All You Need");
  });

  test("reloading markdown with two distinct embedded images does not crash", () => {
    const content = [
      "# Figures",
      "",
      "![[figure-a.png]]",
      "",
      "![[figure-b.png]]",
    ].join("\n");

    const editor = createRichMarkdownEditor(content);

    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toBe(content);
    editor.commands.setContent(content, { contentType: "markdown" });
    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toBe(content);
  });

  test("reloading markdown with repeated copies of the same embedded image does not crash", () => {
    const content = [
      "# Figures",
      "",
      "![[figure-a.png]]",
      "",
      "![[figure-a.png]]",
    ].join("\n");

    const editor = createRichMarkdownEditor(content);

    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toBe(content);
    editor.commands.setContent(content, { contentType: "markdown" });
    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toBe(content);
  });

  test("reloading transcript-style captions around two embedded images keeps a valid document", () => {
    const content = [
      "# Figures",
      "",
      "![[figure-a.png]]",
      "Scaled Dot-Product Attention",
      "",
      "![[figure-b.png]]",
      "Multi-Head Attention",
    ].join("\n");

    const editor = createRichMarkdownEditor(content);

    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.state.doc.toString()).toContain('image, paragraph("Scaled Dot-Product Attention"), image');

    editor.commands.setContent(content, { contentType: "markdown" });

    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.state.doc.toString()).toContain('image, paragraph("Scaled Dot-Product Attention"), image');
  });

  test("filters note names by query", () => {
    const items = getWikiLinkSuggestionItems(
      [
        { path: "Notes/Reinforcement Learning.md", linkText: "Reinforcement Learning", subtitle: "Notes/Reinforcement Learning.md" },
        { path: "Notes/GRPO.md", linkText: "GRPO", subtitle: "Notes/GRPO.md" },
        { path: "Classes/Algorithms Class.md", linkText: "Algorithms Class", subtitle: "Classes/Algorithms Class.md" },
      ] satisfies WikilinkTarget[],
      "rein",
    );

    expect(items.map((item) => item.noteName)).toEqual(["Reinforcement Learning"]);
  });

  test("matches asset suggestions by basename and full path", () => {
    const items = getWikiLinkSuggestionItems(
      [
        { path: "Resources/Images/diagram.png", linkText: "diagram.png", subtitle: "Resources/Images/diagram.png" },
        { path: "Resources/PDFs/lecture_1.pdf", linkText: "lecture_1.pdf", subtitle: "Resources/PDFs/lecture_1.pdf" },
      ],
      "resources/images",
    );

    expect(items.map((item) => item.noteName)).toEqual(["diagram.png"]);
  });

  test("inserts a wikilink mark plus trailing space", () => {
    const editor = createRawTextEditor("[[Rein]]");
    const range = findTextRange(editor, "[[Rein");

    insertWikiLinkSuggestion(editor, range, "Reinforcement Learning");

    expect(editor.getMarkdown()).toBe("[[Reinforcement Learning]] ");
  });

  test("removes the trailing auto-closed bracket when completing a wikilink", () => {
    const editor = createRawTextEditor("[[GRP]]");
    const range = findTextRange(editor, "[[GRP");

    insertWikiLinkSuggestion(editor, range, "GRPO");

    expect(editor.getMarkdown()).toBe("[[GRPO]] ");
  });

  test("supports autocomplete for embeds after ![[", () => {
    const editor = createRawTextEditor("![[Ful]]");
    const range = findTextRange(editor, "[[Ful");

    insertWikiLinkSuggestion(editor, range, "FullSizeRender.jpg");

    expect(editor.getMarkdown()).toBe("![[FullSizeRender.jpg]] ");
  });

  test("converts standalone embedded-image markdown into a valid block image node", () => {
    const editor = createMarkdownEditor("![[diagram.png]]");

    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.state.doc.toString()).toBe("doc(image)");
    expect(editor.getMarkdown()).toBe("![[diagram.png]]");
  });

  test("keeps embed wikilinks as embeds rather than converting them to wiki-link marks", () => {
    const editor = createMarkdownEditor("![[diagram.png]]");
    const firstNode = editor.getJSON().content?.[0];

    expect(firstNode?.type).toBe("image");
    expect(() => editor.state.doc.check()).not.toThrow();
    expect(editor.getMarkdown()).toBe("![[diagram.png]]");
  });
});

describe("slash commands", () => {
  test("includes /link in filtered slash command results", () => {
    const items = getSlashCommandItems(createSlashCommands([]), "link");

    expect(items.map((item) => item.label)).toContain("Link");
  });

  test("/link replaces the trigger text with wikilink scaffolding and positions the cursor inside", () => {
    const editor = createRawTextEditor("/link");
    const range = findTextRange(editor, "/link");

    insertWikiLinkScaffold(editor, range);

    expect(editor.getMarkdown()).toBe("[[]]");
    expect(editor.state.selection.from).toBe(editor.state.selection.to);
  });

  test("/link can flow into wikilink insertion using the same completion logic", () => {
    const editor = createRawTextEditor("/link");
    const slashRange = findTextRange(editor, "/link");

    insertWikiLinkScaffold(editor, slashRange);
    editor.view.dispatch(editor.state.tr.insertText("Rein"));

    const wikiRange = findTextRange(editor, "[[Rein");
    insertWikiLinkSuggestion(editor, wikiRange, "Reinforcement Learning");

    expect(editor.getMarkdown()).toBe("[[Reinforcement Learning]] ");
  });

  test("existing slash commands still remain available", () => {
    const commands = createSlashCommands([]);
    const heading = getSlashCommandItems(commands, "heading").find(
      (item) => item.label === "Heading 1",
    );

    expect(heading).toBeDefined();

    const editor = createRawTextEditor("/h1");
    const range = findTextRange(editor, "/h1");

    heading!.command(editor, range);

    expect(editor.getJSON()).toMatchObject({
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 } }],
    });
  });
});
