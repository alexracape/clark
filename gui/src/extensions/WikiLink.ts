import { Mark, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export interface WikiLinkOptions {
  onOpen: (noteName: string) => void;
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    wikiLink: {
      setWikiLink: (attrs: { noteName: string }) => ReturnType;
    };
  }
}

export const WikiLink = Mark.create<WikiLinkOptions>({
  name: "wikiLink",

  addOptions() {
    return {
      onOpen: () => {},
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      noteName: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-note-name"),
        renderHTML: (attrs) => ({ "data-note-name": attrs.noteName }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-wiki-link]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-wiki-link": "", class: "wiki-link" }, this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setWikiLink:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
    };
  },

  // @tiptap/markdown integration: teach the markdown serializer about [[...]] syntax
  // @ts-ignore - tiptap/markdown fields not in core type declarations
  markdownTokenName: "wikiLink",

  // @ts-ignore
  markdownTokenizer: {
    name: "wikiLink",
    level: "inline",
    start: "[[",
    tokenize(src: string) {
      const match = src.match(/^\[\[([^\]]+)\]\]/);
      if (match) {
        return {
          type: "wikiLink",
          raw: match[0],
          noteName: match[1],
          tokens: [],
        };
      }
    },
  },

  // @ts-ignore
  parseMarkdown(token: { noteName: string }, helpers: { applyMark: (name: string, content: unknown[], attrs?: unknown) => unknown }) {
    return helpers.applyMark("wikiLink", [{ type: "text", text: token.noteName }], {
      noteName: token.noteName,
    });
  },

  // @ts-ignore
  renderMarkdown(_node: unknown, h: { renderChildren: (node: unknown) => string }) {
    return `[[${h.renderChildren(_node)}]]`;
  },

  addProseMirrorPlugins() {
    const wikiLinkType = this.type;
    const onOpen = this.options.onOpen;

    return [
      // Scan for unlinked [[...]] patterns and convert to wikiLink marks
      new Plugin({
        key: new PluginKey("wikiLinkDetector"),
        appendTransaction(_transactions, _oldState, newState) {
          const { doc, schema } = newState;

          // Collect matches in reverse order to avoid position drift
          const matches: { from: number; to: number; noteName: string }[] = [];

          doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return;

            const re = /\[\[([^\]]+)\]\]/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(node.text)) !== null) {
              const matchFrom = pos + m.index;

              // Skip ![[...]] patterns — those are embedded images, not wiki links.
              // Check at document level (not text node) in case ! is in a separate node.
              if (matchFrom > 0) {
                const prevChar = doc.textBetween(matchFrom - 1, matchFrom);
                if (prevChar === "!") continue;
              }
              const matchTo = matchFrom + m[0].length;

              // Skip if already marked as wikiLink
              const existingMarks = doc.resolve(matchFrom + 1).marks();
              if (existingMarks.some((mark) => mark.type === wikiLinkType)) continue;

              // Skip if the cursor is currently inside this match (user is still typing)
              const cursorPos = newState.selection.from;
              if (cursorPos > matchFrom && cursorPos < matchTo) continue;

              matches.push({ from: matchFrom, to: matchTo, noteName: m[1] });
            }
          });

          if (matches.length === 0) return null;

          const tr = newState.tr;
          // Process in reverse document order
          matches.sort((a, b) => b.from - a.from);

          for (const { from, to, noteName } of matches) {
            const mark = wikiLinkType.create({ noteName });
            const noteText = schema.text(noteName, [mark]);
            const space = schema.text(" ");
            tr.replaceWith(from, to, [noteText, space]);
          }

          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),

      // Click handler to open wiki links.
      // Uses handleDOMEvents.click instead of handleClick so we fire
      // *before* the browser sets the cursor position, allowing preventDefault().
      new Plugin({
        key: new PluginKey("wikiLinkClick"),
        props: {
          handleDOMEvents: {
            click: (view, event) => {
              const target = (event.target as HTMLElement).closest?.("[data-wiki-link]");
              if (target) {
                const noteName = target.getAttribute("data-note-name");
                if (noteName) {
                  event.preventDefault();
                  onOpen(noteName);
                  return true;
                }
              }
              return false;
            },
          },
        },
      }),
    ];
  },
});
