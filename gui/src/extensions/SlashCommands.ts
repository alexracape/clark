import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { PluginKey, TextSelection } from "@tiptap/pm/state";
import type { Editor, Range } from "@tiptap/core";
import { createSuggestionMenuRenderer } from "./SuggestionMenu.ts";
import type { WikilinkTarget } from "../note-paths.ts";

const slashCommandsKey = new PluginKey("slashCommands");

export interface SlashCommandItem {
  label: string;
  icon: string;
  description: string;
  command: (editor: Editor, range: Range) => void;
}

export interface SlashCommandsOptions {
  noteNames: WikilinkTarget[];
}

export function insertWikiLinkScaffold(editor: Editor, range: Range) {
  const tr = editor.state.tr.insertText("[[]]", range.from, range.to);
  tr.setSelection(TextSelection.create(tr.doc, range.from + 2));
  editor.view.dispatch(tr);
}

export function createSlashCommands(_noteNames: WikilinkTarget[]): SlashCommandItem[] {
  return [
  {
    label: "Heading 1",
    icon: "H1",
    description: "Large heading",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run();
    },
  },
  {
    label: "Heading 2",
    icon: "H2",
    description: "Medium heading",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run();
    },
  },
  {
    label: "Heading 3",
    icon: "H3",
    description: "Small heading",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run();
    },
  },
  {
    label: "Bullet List",
    icon: "•",
    description: "Unordered list",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    label: "Ordered List",
    icon: "1.",
    description: "Numbered list",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    label: "Blockquote",
    icon: ">",
    description: "Quote block",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setBlockquote().run();
    },
  },
  {
    label: "Code Block",
    icon: "</>",
    description: "Fenced code",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setCodeBlock().run();
    },
  },
  {
    label: "Divider",
    icon: "—",
    description: "Horizontal rule",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    label: "Bold",
    icon: "B",
    description: "Bold text",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBold().run();
    },
  },
  {
    label: "Italic",
    icon: "I",
    description: "Italic text",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleItalic().run();
    },
  },
  {
    label: "Code",
    icon: "`",
    description: "Inline code",
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCode().run();
    },
  },
  {
    label: "Link",
    icon: "[[",
    description: "Wiki link",
    command: (editor, range) => {
      insertWikiLinkScaffold(editor, range);
    },
  },
];
}

export function getSlashCommandItems(commands: SlashCommandItem[], query: string) {
  const q = query.toLowerCase();
  return commands.filter(
    (item) =>
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q),
  );
}

export const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: "slashCommands",

  addOptions() {
    return { noteNames: [] };
  },

  addProseMirrorPlugins() {
    const commands = createSlashCommands(this.options.noteNames);

    return [
      Suggestion({
        pluginKey: slashCommandsKey,
        editor: this.editor,
        char: "/",
        startOfLine: false,
        items: ({ query }) => {
          return getSlashCommandItems(commands, query);
        },
        command: ({ editor, range, props }) => {
          const item = props as SlashCommandItem;
          item.command(editor, range);
        },
        render: () => {
          const menu = createSuggestionMenuRenderer<SlashCommandItem>({
            emptyText: "No matching commands",
            renderItem: (item) => {
              const btn = document.createElement("button");

              const icon = document.createElement("span");
              icon.className = "slash-menu__item-icon";
              icon.textContent = item.icon;
              btn.appendChild(icon);

              const label = document.createElement("span");
              label.className = "slash-menu__item-label";
              label.textContent = item.label;
              btn.appendChild(label);

              const desc = document.createElement("span");
              desc.className = "slash-menu__item-desc";
              desc.textContent = item.description;
              btn.appendChild(desc);

              return btn;
            },
          });

          return {
            onStart: (props) => {
              menu.onStart({
                items: props.items as SlashCommandItem[],
                clientRect: props.clientRect ?? null,
                command: (item) => props.command(item),
              });
            },
            onUpdate: (props) => {
              menu.onUpdate({
                items: props.items as SlashCommandItem[],
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
