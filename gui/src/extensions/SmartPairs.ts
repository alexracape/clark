import { Extension } from "@tiptap/core";
import type { Editor } from "@tiptap/core";

/**
 * After a `]` overtype, check whether the text ending at cursor matches
 * [[NoteName]] and convert it to a wikiLink mark.
 *
 * Note: WikiLink.ts also has an appendTransaction that detects [[...]] patterns.
 * The two detectors serve different triggers:
 *   - SmartPairs: fires immediately when the user overtypes the final `]`
 *   - WikiLink appendTransaction: catches paste, file load, and undo (cursor not inside brackets)
 */
function convertWikiLinkAtCursor(editor: Editor, cursorPos: number) {
  const { state } = editor;
  const $pos = state.doc.resolve(cursorPos);
  const textNode = $pos.nodeBefore;
  if (!textNode?.isText || !textNode.text) return;

  const text = textNode.text;
  const match = text.match(/\[\[([^\]]+)\]\]$/);
  if (!match) return;

  // Skip ![[...]] patterns — those are embedded images, not wiki links
  const matchStartInText = text.length - match[0].length;
  if (matchStartInText > 0 && text[matchStartInText - 1] === "!") return;

  const noteName = match[1];
  const matchStart = $pos.pos - match[0].length;
  const matchEnd = $pos.pos;

  const wikiLinkType = state.schema.marks.wikiLink;
  if (!wikiLinkType) return;

  const tr = state.tr;
  const mark = wikiLinkType.create({ noteName });
  const noteText = state.schema.text(noteName, [mark]);
  const space = state.schema.text(" ");

  tr.replaceWith(matchStart, matchEnd, [noteText, space]);
  tr.setSelection(
    state.selection.constructor.near(tr.doc.resolve(matchStart + noteName.length + 1)),
  );

  editor.view.dispatch(tr);
}

/**
 * SmartPairs — auto-close, overtype, and selection-wrapping for bracket
 * and symmetric pairs.  Also converts manually-typed [[NoteName]] into
 * a wikiLink mark on the final `]` overtype.
 */
export const SmartPairs = Extension.create({
  name: "smartPairs",

  addKeyboardShortcuts() {
    const bracketPairs: [string, string][] = [
      ["[", "]"],
      ["(", ")"],
      ["{", "}"],
    ];
    const symmetricChars = ["*", "_", "`"];

    const shortcuts: Record<string, () => boolean> = {};

    // --- Opening bracket handlers ---
    for (const [open, close] of bracketPairs) {
      shortcuts[open] = () => {
        const { state } = this.editor;
        const { from, to, empty } = state.selection;

        // 1. Selection wrap
        if (!empty) {
          const selected = state.doc.textBetween(from, to);
          this.editor
            .chain()
            .deleteSelection()
            .insertContentAt(from, open + selected + close)
            .setTextSelection({ from: from + 1, to: from + 1 + selected.length })
            .run();
          return true;
        }

        // 2. Special double-bracket for `[`
        if (open === "[") {
          const charBefore =
            from > 0 ? state.doc.textBetween(from - 1, from) : "";
          const charAfter =
            from < state.doc.content.size
              ? state.doc.textBetween(from, Math.min(from + 1, state.doc.content.size))
              : "";

          if (charBefore === "[" && charAfter === "]") {
            // Transform [|] → [[|]]
            this.editor
              .chain()
              .insertContentAt(from, "[]")
              .setTextSelection(from + 1)
              .run();
            return true;
          }
        }

        // 3. Auto-close
        this.editor
          .chain()
          .insertContentAt(from, open + close)
          .setTextSelection(from + 1)
          .run();
        return true;
      };
    }

    // --- Closing bracket handlers (overtype) ---
    for (const [, close] of bracketPairs) {
      shortcuts[close] = () => {
        const { state } = this.editor;
        const { from, empty } = state.selection;
        if (!empty) return false;

        const charAfter =
          from < state.doc.content.size
            ? state.doc.textBetween(from, Math.min(from + 1, state.doc.content.size))
            : "";

        if (charAfter === close) {
          // Overtype: move cursor past the closing char
          this.editor.commands.setTextSelection(from + 1);

          // Wiki link conversion on `]` overtype
          if (close === "]") {
            convertWikiLinkAtCursor(this.editor, from + 1);
          }
          return true;
        }

        return false;
      };
    }

    // --- Symmetric char handlers ---
    for (const ch of symmetricChars) {
      shortcuts[ch] = () => {
        const { state } = this.editor;
        const { from, to, empty } = state.selection;

        // 1. Selection wrap
        if (!empty) {
          const selected = state.doc.textBetween(from, to);
          this.editor
            .chain()
            .deleteSelection()
            .insertContentAt(from, ch + selected + ch)
            .setTextSelection({ from: from + 1, to: from + 1 + selected.length })
            .run();
          return true;
        }

        // 2. Overtype
        const charAfter =
          from < state.doc.content.size
            ? state.doc.textBetween(from, Math.min(from + 1, state.doc.content.size))
            : "";
        if (charAfter === ch) {
          this.editor.commands.setTextSelection(from + 1);
          return true;
        }

        // 3. Auto-close
        this.editor
          .chain()
          .insertContentAt(from, ch + ch)
          .setTextSelection(from + 1)
          .run();
        return true;
      };
    }

    return shortcuts;
  },
});
