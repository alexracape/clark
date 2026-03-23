import { Node, mergeAttributes } from "@tiptap/core";
import katex from "katex";

export const BlockMath = Node.create({
  name: "blockMath",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      latex: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-math-block]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-math-block": "" }, HTMLAttributes)];
  },

  // @ts-ignore - @tiptap/markdown fields
  markdownTokenName: "blockMath",

  // @ts-ignore
  markdownTokenizer: {
    name: "blockMath",
    level: "block",
    start: "$$",
    tokenize(src: string) {
      const match = src.match(/^\$\$([\s\S]+?)\$\$/);
      if (!match) return;
      return {
        type: "blockMath",
        raw: match[0],
        latex: match[1].trim(),
        tokens: [],
      };
    },
  },

  // @ts-ignore
  parseMarkdown(
    token: { latex: string },
    helpers: { createNode: (type: string, attrs?: Record<string, unknown>) => unknown },
  ) {
    return helpers.createNode("blockMath", { latex: token.latex });
  },

  // @ts-ignore
  renderMarkdown(node: { attrs?: { latex?: string } }) {
    return `$$\n${node.attrs?.latex ?? ""}\n$$`;
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-math-block", "");
      dom.classList.add("math-block");
      dom.contentEditable = "false";

      const render = (latex: string) => {
        try {
          dom.innerHTML = katex.renderToString(latex, {
            displayMode: true,
            throwOnError: false,
          });
        } catch {
          dom.textContent = `$$${latex}$$`;
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
