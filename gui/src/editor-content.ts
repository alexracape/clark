import type { Content } from "@tiptap/core";

const EMPTY_MARKDOWN_DOCUMENT: Content = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

export function normalizeMarkdownEditorContent(content: string): Content {
  return content.trim().length === 0 ? EMPTY_MARKDOWN_DOCUMENT : content;
}
