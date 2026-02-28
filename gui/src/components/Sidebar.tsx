import React, { useState, useEffect } from "react";

interface SidebarProps {
  open: boolean;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

interface FileEntry {
  name: string;
  type: "file" | "directory";
}

const FILE_ICONS: Record<string, string> = {
  directory: "\u{1F4C1}",
  md: "\u{1F4C4}",
  pdf: "\u{1F4D1}",
  png: "\u{1F5BC}",
  jpg: "\u{1F5BC}",
  jpeg: "\u{1F5BC}",
  default: "\u{1F4C4}",
};

function getFileIcon(entry: FileEntry): string {
  if (entry.type === "directory") return FILE_ICONS.directory;
  const ext = entry.name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? FILE_ICONS.default;
}

export function Sidebar({ open, invoke }: SidebarProps) {
  const [files, setFiles] = useState<FileEntry[]>([]);

  useEffect(() => {
    if (open) {
      invoke("list_files", {})
        .then((res) => {
          const result = res as { files?: FileEntry[] };
          setFiles(result.files ?? []);
        })
        .catch(() => setFiles([]));
    }
  }, [open, invoke]);

  return (
    <div className={`sidebar ${!open ? "sidebar--collapsed" : ""}`}>
      <div className="sidebar__header">
        <span>Workspace</span>
      </div>
      <div className="sidebar__files">
        {files.map((f) => (
          <div
            key={f.name}
            className={`sidebar__file ${f.type === "directory" ? "sidebar__file--dir" : ""}`}
          >
            <span className="sidebar__file-icon">{getFileIcon(f)}</span>
            <span>{f.name}</span>
          </div>
        ))}
        {files.length === 0 && (
          <div className="sidebar__file" style={{ color: "var(--patina)", fontStyle: "italic" }}>
            No files yet
          </div>
        )}
      </div>
    </div>
  );
}
