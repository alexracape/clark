import { Node, mergeAttributes } from "@tiptap/core";
import katex from "katex";

export const InlineMath = Node.create({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-math-inline]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-math-inline": "" }, HTMLAttributes)];
  },

  // @ts-ignore - @tiptap/markdown fields
  markdownTokenName: "inlineMath",

  // @ts-ignore
  markdownTokenizer: {
    name: "inlineMath",
    level: "inline",
    start: "$",
    tokenize(src: string) {
      const match = src.match(/^\$([^\$\n]+)\$/);
      if (!match) return;
      return {
        type: "inlineMath",
        raw: match[0],
        latex: match[1],
        tokens: [],
      };
    },
  },

  // @ts-ignore
  parseMarkdown(
    token: { latex: string },
    helpers: { createNode: (type: string, attrs?: Record<string, unknown>) => unknown },
  ) {
    return helpers.createNode("inlineMath", { latex: token.latex });
  },

  // @ts-ignore
  renderMarkdown(node: { attrs?: { latex?: string } }) {
    return `$${node.attrs?.latex ?? ""}$`;
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("span");
      dom.setAttribute("data-math-inline", "");
      dom.classList.add("math-inline");
      dom.contentEditable = "false";

      const render = (latex: string) => {
        try {
          dom.innerHTML = katex.renderToString(latex, {
            displayMode: false,
            throwOnError: false,
          });
        } catch {
          dom.textContent = `$${latex}$`;
        }
      };

      render(node.attrs.latex ?? "");

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type !== node.type) return false;
          render(updatedNode.attrs.latex ?? "");
          return true;
        },
      };
    };
  },
});
