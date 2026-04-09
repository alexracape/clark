import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import {
  normalizeEmbeddedAssetPath,
  resolveEmbeddedImageAssetUrl,
} from "./EmbeddedImage.ts";

export interface EmbeddedPDFOptions {
  assetBaseUrl: string;
}

const DEFAULT_ASSET_BASE_URL = "http://localhost:3456";

function isPDFReference(src: string): boolean {
  return /\.pdf$/i.test(src);
}

function extractStandalonePDFPath(text: string): string | null {
  const match = text.trim().match(/^!\[\[([^\]]+\.pdf)\]\]$/i);
  return match?.[1] ?? null;
}

function resolveAssetUrl(assetPath: string, options: EmbeddedPDFOptions): string {
  return resolveEmbeddedImageAssetUrl(assetPath, {
    assetBaseUrl: options.assetBaseUrl,
    imageDir: "",
  });
}

export const EmbeddedPDF = Node.create<EmbeddedPDFOptions>({
  name: "embeddedPdf",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      assetPath: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-asset-path"),
        renderHTML: (attrs) => {
          if (!attrs.assetPath) return {};
          return { "data-asset-path": attrs.assetPath };
        },
      },
    };
  },

  addOptions() {
    return {
      assetBaseUrl: DEFAULT_ASSET_BASE_URL,
    };
  },

  parseHTML() {
    return [{ tag: 'iframe[data-asset-path$=".pdf"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "iframe",
      mergeAttributes({ class: "pdf-viewer-inline" }, HTMLAttributes),
    ];
  },

  // @ts-ignore - tiptap/markdown fields not in core type declarations
  markdownTokenName: "embeddedPdf",

  // @ts-ignore
  markdownTokenizer: {
    name: "embeddedPdf",
    level: "block",
    start: "![[",
    tokenize(src: string) {
      const match = src.match(/^!\[\[([^\]]+)\]\]/);
      if (!match || !match[1] || !isPDFReference(match[1])) return;

      return {
        type: "embeddedPdf",
        raw: match[0],
        assetPath: match[1],
        tokens: [],
      };
    },
  },

  // @ts-ignore
  parseMarkdown(
    token: { assetPath: string },
    helpers: {
      createNode: (type: string, attrs?: Record<string, unknown>) => unknown;
      createTextNode: (text: string) => unknown;
    },
  ) {
    if (!isPDFReference(token.assetPath)) {
      return helpers.createTextNode(`![[${token.assetPath}]]`);
    }

    const assetPath = normalizeEmbeddedAssetPath(token.assetPath);
    const fallbackOptions: EmbeddedPDFOptions = {
      assetBaseUrl: DEFAULT_ASSET_BASE_URL,
    };
    return helpers.createNode("embeddedPdf", {
      src: resolveAssetUrl(assetPath, fallbackOptions),
      assetPath,
    });
  },

  // @ts-ignore
  renderMarkdown(node: { attrs?: { assetPath?: string; src?: string } }) {
    const assetPath = node.attrs?.assetPath ?? node.attrs?.src ?? "";
    return `![[${assetPath}]]`;
  },

  addNodeView() {
    const options = this.options;

    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "pdf-viewer-wrapper";

      const iframe = document.createElement("iframe");
      iframe.className = "pdf-viewer-inline";

      const assetPath =
        typeof node.attrs.assetPath === "string" && node.attrs.assetPath.length > 0
          ? node.attrs.assetPath
          : "";

      const src = assetPath
        ? resolveAssetUrl(normalizeEmbeddedAssetPath(assetPath), options)
        : (typeof node.attrs.src === "string" ? node.attrs.src : "");

      iframe.src = src;
      iframe.title = assetPath || "Embedded PDF";
      dom.appendChild(iframe);

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "embeddedPdf") return false;

          const newAssetPath =
            typeof updatedNode.attrs.assetPath === "string" && updatedNode.attrs.assetPath.length > 0
              ? updatedNode.attrs.assetPath
              : "";

          const newSrc = newAssetPath
            ? resolveAssetUrl(normalizeEmbeddedAssetPath(newAssetPath), options)
            : (typeof updatedNode.attrs.src === "string" ? updatedNode.attrs.src : "");

          if (iframe.src !== newSrc) {
            iframe.src = newSrc;
          }
          iframe.title = newAssetPath || "Embedded PDF";
          return true;
        },
      };
    };
  },

  addProseMirrorPlugins() {
    const pdfType = this.type;
    const options = this.options;

    return [
      new Plugin({
        key: new PluginKey("embeddedPdfDetector"),
        appendTransaction(_transactions, _oldState, newState) {
          const { doc } = newState;
          const replacements: { from: number; to: number; src: string }[] = [];

          doc.descendants((node, pos) => {
            if (node.type.name !== "paragraph" || node.childCount !== 1 || !node.firstChild?.isText) return;

            const assetPath = extractStandalonePDFPath(node.textContent);
            if (!assetPath) return;

            const cursorPos = newState.selection.from;
            if (cursorPos > pos && cursorPos < pos + node.nodeSize - 1) return;

            replacements.push({ from: pos, to: pos + node.nodeSize, src: assetPath });
          });

          if (replacements.length === 0) return null;

          const tr = newState.tr;
          replacements.sort((a, b) => b.from - a.from);

          for (const { from, to, src } of replacements) {
            const assetPath = normalizeEmbeddedAssetPath(src);
            const assetUrl = resolveAssetUrl(assetPath, options);
            const pdfNode = pdfType.create({ src: assetUrl, assetPath });
            tr.replaceWith(from, to, pdfNode);
          }

          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
