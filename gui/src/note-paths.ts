export type FileListEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};

export interface WikilinkTarget {
  path: string;
  linkText: string;
  subtitle: string | null;
}

function stripMarkdownExtension(path: string): string {
  return path.replace(/\.md$/i, "");
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function defaultLinkText(path: string): string {
  return path.endsWith(".md") ? basename(stripMarkdownExtension(path)) : basename(path);
}

export function collectWikilinkTargets(files: FileListEntry[]): WikilinkTarget[] {
  const fileEntries = files.filter((file) => file.type === "file");
  const counts = new Map<string, number>();

  for (const file of fileEntries) {
    const linkText = defaultLinkText(file.path).toLowerCase();
    counts.set(linkText, (counts.get(linkText) ?? 0) + 1);
  }

  return fileEntries
    .map((file) => {
      const shortLinkText = defaultLinkText(file.path);
      const disambiguatedLinkText =
        (counts.get(shortLinkText.toLowerCase()) ?? 0) > 1
          ? (file.path.endsWith(".md") ? stripMarkdownExtension(file.path) : file.path)
          : shortLinkText;

      return {
        path: file.path,
        linkText: disambiguatedLinkText,
        subtitle: disambiguatedLinkText === shortLinkText ? file.path : null,
      };
    })
    .sort((a, b) => a.linkText.localeCompare(b.linkText));
}
