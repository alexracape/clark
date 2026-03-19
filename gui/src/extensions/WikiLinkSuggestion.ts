import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import type { Editor, Range } from "@tiptap/core";
import { createSuggestionMenuRenderer } from "./SuggestionMenu.ts";
import type { WikilinkTarget } from "../note-paths.ts";

const wikiLinkSuggestionKey = new PluginKey("wikiLinkSuggestion");

export interface WikiLinkSuggestionOptions {
  noteNames: WikilinkTarget[];
}

export function getWikiLinkSuggestionItems(noteNames: WikilinkTarget[], query: string) {
  const q = query.toLowerCase();
  return noteNames
    .filter((target) =>
      target.linkText.toLowerCase().includes(q) ||
      target.path.toLowerCase().includes(q),
    )
    .slice(0, 8)
    .map((target) => ({
      title: target.linkText,
      subtitle: target.subtitle ?? "Insert wiki link",
      icon: "[[",
      noteName: target.linkText,
    }));
}

export function insertWikiLinkSuggestion(editor: Editor, range: Range, noteName: string) {
  const { state } = editor;

  let deleteTo = range.to;
  while (deleteTo < state.doc.content.size) {
    const nextChar = state.doc.textBetween(deleteTo, deleteTo + 1);
    if (nextChar !== "]") break;
    deleteTo += 1;
  }
  const deleteRange = { from: range.from, to: deleteTo };
  const charBefore =
    range.from > 0 ? state.doc.textBetween(range.from - 1, range.from) : "";

  if (charBefore === "!") {
    const tr = editor.state.tr.deleteRange(deleteRange.from, deleteRange.to);
    tr.insertText(`[[${noteName}]] `, range.from);
    editor.view.dispatch(tr);
    return;
  }

  editor
    .chain()
    .deleteRange(deleteRange)
    .insertContentAt(range.from, [
      {
        type: "text",
        marks: [{ type: "wikiLink", attrs: { noteName } }],
        text: noteName,
      },
      // Add a trailing space so the cursor exits the mark
      { type: "text", text: " " },
    ])
    .run();
}

export const WikiLinkSuggestion = Extension.create<WikiLinkSuggestionOptions>({
  name: "wikiLinkSuggestion",

  addOptions() {
    return { noteNames: [] };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        pluginKey: wikiLinkSuggestionKey,
        editor: this.editor,
        char: "[[",
        allowedPrefixes: null,
        allowSpaces: true,
        items: ({ query }) => {
          return getWikiLinkSuggestionItems(this.options.noteNames, query);
        },
        command: ({ editor, range, props }) => {
          const item = props as ReturnType<typeof getWikiLinkSuggestionItems>[number];
          insertWikiLinkSuggestion(editor, range, item.noteName);
        },
        render: () => {
          const menu = createSuggestionMenuRenderer<
            ReturnType<typeof getWikiLinkSuggestionItems>[number]
          >({
            emptyText: "No matching notes",
            renderItem: (item) => {
              const btn = document.createElement("button");

              const icon = document.createElement("span");
              icon.className = "slash-menu__item-icon";
              icon.textContent = item.icon;
              btn.appendChild(icon);

              const label = document.createElement("span");
              label.className = "slash-menu__item-label";
              label.textContent = item.title;
              btn.appendChild(label);

              const desc = document.createElement("span");
              desc.className = "slash-menu__item-desc";
              desc.textContent = item.subtitle;
              btn.appendChild(desc);

              return btn;
            },
          });

          return {
            onStart: (props) => {
              menu.onStart({
                items: props.items as ReturnType<typeof getWikiLinkSuggestionItems>,
                clientRect: props.clientRect ?? null,
                command: (item) => props.command(item),
              });
            },
            onUpdate: (props) => {
              menu.onUpdate({
                items: props.items as ReturnType<typeof getWikiLinkSuggestionItems>,
                clientRect: props.clientRect ?? null,
                command: (item) => props.command(item),
              });
            },
            onKeyDown: (props) => menu.onKeyDown(props.event),
            onExit: menu.onExit,
          };
        },
      }),
    ];
  },
});
