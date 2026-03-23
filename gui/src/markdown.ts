/** Shared markdown rendering utilities */
import katex from "katex";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Simple markdown rendering with KaTeX math support */
export function renderMarkdown(text: string): string {
  // Stash pre-rendered regions so they survive HTML escaping and markdown transforms.
  // We use NUL-delimited placeholders (\x00Sn\x00) which are never produced by
  // escapeHtml (it only touches &, <, >) and are extremely unlikely in user text.
  const stash: string[] = [];
  const ph = (i: number) => `\x00S${i}\x00`;

  let out = text;

  // Block math $$...$$ (must come before inline $...$)
  out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    const html = katex.renderToString(latex.trim(), {
      displayMode: true,
      throwOnError: false,
    });
    stash.push(`<div class="math-block">${html}</div>`);
    return ph(stash.length - 1);
  });

  // Inline math $...$
  out = out.replace(/\$([^\$\n]+)\$/g, (_, latex) => {
    const html = katex.renderToString(latex.trim(), {
      displayMode: false,
      throwOnError: false,
    });
    stash.push(`<span class="math-inline">${html}</span>`);
    return ph(stash.length - 1);
  });

  // Code blocks (stash to prevent inner processing)
  out = out.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    stash.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    return ph(stash.length - 1);
  });

  // Inline code
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    stash.push(`<code>${escapeHtml(code)}</code>`);
    return ph(stash.length - 1);
  });

  // HTML-escape everything that remains
  let html = escapeHtml(out);

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");

  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  // Single newlines → <br>
  html = html.replace(/\n/g, "<br>");

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, "");

  // Restore stashed regions
  html = html.replace(/\x00S(\d+)\x00/g, (_, i) => stash[parseInt(i)]);

  return html;
}
