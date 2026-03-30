import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { basename } from "node:path";

export interface EmbeddedImageOptions {
  /** Base URL for the asset endpoint (e.g. "http://localhost:3456") */
  assetBaseUrl: string;
  /** Default directory to prepend when src has no `/` (e.g. "Resources/Images/") */
  imageDir: string;
}

const DEFAULT_ASSET_BASE_URL = "http://localhost:3456";
const DEFAULT_IMAGE_DIR = "Resources/Images/";

function isEmbeddableAssetReference(src: string): boolean {
  return /\.(png|jpe?g|gif|svg|webp|bmp|tiff?|pdf)$/i.test(src);
}

export function normalizeEmbeddedAssetPath(src: string): string {
  const normalized = src.replace(/\\/g, "/");
  const resourcesIndex = normalized.lastIndexOf("/Resources/");
  if (resourcesIndex >= 0) {
    return normalized.slice(resourcesIndex + 1);
  }
  if (normalized.startsWith("/")) {
    return basename(normalized);
  }
  return normalized;
}

function isResolvedAssetUrl(src: string, options: EmbeddedImageOptions): boolean {
  return src.startsWith(`${options.assetBaseUrl}/api/asset?path=`);
}

export function resolveEmbeddedImageAssetUrl(src: string, options: EmbeddedImageOptions): string {
  const normalizedSrc = normalizeEmbeddedAssetPath(src);
  const resolved = normalizedSrc.includes("/") ? normalizedSrc : `${options.imageDir}${normalizedSrc}`;
  return `${options.assetBaseUrl}/api/asset?path=${encodeURIComponent(resolved)}`;
}

/**
 * Extends the official @tiptap/extension-image with:
 * - Auto-detection of ![[filename]] patterns → replaced with <img> nodes
 * - Asset URL resolution via the sidecar /api/asset endpoint
 */
export const EmbeddedImage = Image.extend<EmbeddedImageOptions>({
  addAttributes() {
    return {
      ...this.parent?.(),
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
      ...this.parent?.(),
      assetBaseUrl: DEFAULT_ASSET_BASE_URL,
      imageDir: DEFAULT_IMAGE_DIR,
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, { class: "embedded-image" }, HTMLAttributes),
    ];
  },

  // @ts-ignore - tiptap/markdown fields not in core type declarations
  markdownTokenName: "embeddedImage",

  // @ts-ignore
  markdownTokenizer: {
    name: "embeddedImage",
    level: "inline",
    start: "![[",
    tokenize(src: string) {
      const match = src.match(/^!\[\[([^\]]+)\]\]/);
      if (!match) return;

      return {
        type: "embeddedImage",
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
    if (!isEmbeddableAssetReference(token.assetPath)) {
      return helpers.createTextNode(`![[${token.assetPath}]]`);
    }

    const fallbackOptions: EmbeddedImageOptions = {
      assetBaseUrl: DEFAULT_ASSET_BASE_URL,
      imageDir: DEFAULT_IMAGE_DIR,
    };
    const assetPath = normalizeEmbeddedAssetPath(token.assetPath);
    return helpers.createNode("image", {
      src: resolveEmbeddedImageAssetUrl(assetPath, fallbackOptions),
      alt: assetPath,
      assetPath,
    });
  },

  // @ts-ignore
  renderMarkdown(node: { attrs?: { assetPath?: string; alt?: string; src?: string } }) {
    const assetPath = node.attrs?.assetPath ?? node.attrs?.alt ?? node.attrs?.src ?? "";
    return `![[${assetPath}]]`;
  },

  addNodeView() {
    const options = this.options;

    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement("div");
      const img = document.createElement("img");
      const warning = document.createElement("div");
      let currentSource = "";
      let destroyed = false;
      let currentAssetPath = typeof node.attrs.assetPath === "string" && node.attrs.assetPath.length > 0
        ? node.attrs.assetPath
        : (typeof node.attrs.alt === "string" ? node.attrs.alt : "");

      dom.className = "embedded-image-wrapper";
      dom.style.maxWidth = "100%";
      warning.className = "embedded-image-warning";
      warning.hidden = true;
      img.style.display = "block";
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.width = "100%";
      img.style.objectFit = "contain";
      img.loading = "lazy";
      img.decoding = "async";
      dom.append(img, warning);

      const setWarning = (message: string | null) => {
        warning.hidden = !message;
        warning.textContent = message ?? "";
        img.style.display = message ? "none" : "";
      };

      const applyAttributes = (attrs: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(attrs)) {
          if (key === "src") continue;
          if (value == null) {
            img.removeAttribute(key);
            continue;
          }

          img.setAttribute(key, String(value));
        }
      };

      const resolvedSourceFor = (attrs: Record<string, unknown>) => {
        const assetPath = typeof attrs.assetPath === "string" && attrs.assetPath.length > 0
          ? attrs.assetPath
          : (typeof attrs.alt === "string" && attrs.alt.length > 0 ? attrs.alt : null);

        if (assetPath) {
          return resolveEmbeddedImageAssetUrl(assetPath, options);
        }

        return typeof attrs.src === "string" ? attrs.src : "";
      };

      img.onload = () => {
        if (destroyed || !currentSource) return;
        img.title = currentAssetPath;
        setWarning(null);
      };

      img.onerror = () => {
        if (destroyed || !currentSource) return;
        img.removeAttribute("src");
        img.title = currentAssetPath;
        setWarning(`"${currentAssetPath}" could not be loaded.`);
      };

      const loadSource = (src: string) => {
        currentSource = src;

        if (!src) {
          img.removeAttribute("src");
          setWarning(`"${currentAssetPath}" could not be found.`);
          return;
        }

        img.title = currentAssetPath;
        setWarning(null);
        img.src = src;
      };

      applyAttributes(HTMLAttributes);
      loadSource(resolvedSourceFor(node.attrs));

      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type !== node.type) return false;

          currentAssetPath = typeof updatedNode.attrs.assetPath === "string" && updatedNode.attrs.assetPath.length > 0
            ? updatedNode.attrs.assetPath
            : (typeof updatedNode.attrs.alt === "string" ? updatedNode.attrs.alt : "");

          applyAttributes({
            ...HTMLAttributes,
            ...updatedNode.attrs,
          });

          const nextSrc = resolvedSourceFor(updatedNode.attrs);
          if (nextSrc !== currentSource) {
            loadSource(nextSrc);
          } else {
            img.title = currentAssetPath;
            setWarning(null);
          }

          return true;
        },
        destroy: () => {
          destroyed = true;
          img.onload = null;
          img.onerror = null;
        },
      };
    };
  },

  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() ?? [];
    const imageType = this.type;
    const options = this.options;

    return [
      ...parentPlugins,
      // Detect ![[...]] text patterns and replace with image nodes.
      new Plugin({
        key: new PluginKey("embeddedImageDetector"),
        appendTransaction(_transactions, _oldState, newState) {
          const { doc } = newState;

          const replacements: { from: number; to: number; src: string }[] = [];
          const normalizations: Array<{ pos: number; src: string; assetPath: string }> = [];

          doc.descendants((node, pos) => {
            if (node.type === imageType) {
              const src = typeof node.attrs.src === "string" ? node.attrs.src : "";
              const assetPath = typeof node.attrs.assetPath === "string" && node.attrs.assetPath.length > 0
                ? node.attrs.assetPath
                : (typeof node.attrs.alt === "string" ? node.attrs.alt : src);

              if (!assetPath) return;
              if (src === assetPath || !isResolvedAssetUrl(src, options) || node.attrs.assetPath !== assetPath) {
                normalizations.push({ pos, src, assetPath });
              }
              return;
            }

            if (!node.isText || !node.text) return;

            const re = /!\[\[([^\]]+)\]\]/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(node.text)) !== null) {
              if (!isEmbeddableAssetReference(m[1])) continue;
              const matchFrom = pos + m.index;
              const matchTo = matchFrom + m[0].length;

              // Skip if cursor is inside the match (user is still typing)
              const cursorPos = newState.selection.from;
              if (cursorPos > matchFrom && cursorPos < matchTo) continue;

              replacements.push({ from: matchFrom, to: matchTo, src: m[1] });
            }
          });

          if (replacements.length === 0 && normalizations.length === 0) return null;

          const tr = newState.tr;
          // Process in reverse to avoid position drift
          replacements.sort((a, b) => b.from - a.from);

          for (const { from, to, src } of replacements) {
            const assetPath = normalizeEmbeddedAssetPath(src);
            const assetUrl = resolveEmbeddedImageAssetUrl(assetPath, options);
            const imageNode = imageType.create({ src: assetUrl, alt: assetPath, assetPath });
            tr.replaceWith(from, to, imageNode);
          }

          for (const { pos, src, assetPath } of normalizations) {
            const resolvedSrc = resolveEmbeddedImageAssetUrl(assetPath, options);
            if (src === resolvedSrc) continue;
            tr.setNodeMarkup(pos, undefined, {
              ...doc.nodeAt(pos)?.attrs,
              src: resolvedSrc,
              alt: assetPath,
              assetPath,
            });
          }

          tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
    ];
  },
});
