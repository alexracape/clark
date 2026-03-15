import React, { useState, useEffect, useCallback } from "react";

interface SidebarProps {
  open: boolean;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  onFileSelect?: (path: string) => void;
}

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
  expanded?: boolean;
  loading?: boolean;
}

function splitExtension(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return { base: name, ext: "" };
  return { base: name.slice(0, dot), ext: name.slice(dot) };
}

function TreeNodeRow({
  node,
  depth,
  selectedPath,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onToggle: (node: TreeNode) => void;
}) {
  const isDir = node.type === "directory";
  const isSelected = node.path === selectedPath;
  const { base, ext } = isDir ? { base: node.name, ext: "" } : splitExtension(node.name);

  return (
    <>
      <div
        className={`sidebar__node${isDir ? " sidebar__node--dir" : ""}${isSelected ? " sidebar__node--selected" : ""}`}
        style={{ paddingLeft: depth * 16 + 12 }}
        onClick={() => {
          if (isDir) {
            onToggle(node);
          }
          onSelect(node.path);
        }}
      >
        <span
          className={`sidebar__chevron${node.expanded ? " sidebar__chevron--expanded" : ""}${!isDir ? " sidebar__chevron--hidden" : ""}`}
        >
          ▶
        </span>
        <span className="sidebar__name">{base}</span>
        {ext && <span className="sidebar__ext">{ext}</span>}
        {node.loading && <span className="sidebar__spinner" />}
      </div>
      {isDir && node.expanded && node.children?.map((child) => (
        <TreeNodeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

export function Sidebar({ open, invoke, onFileSelect }: SidebarProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      invoke("list_files", {})
        .then((res) => {
          const result = res as { files?: FileEntry[] };
          setNodes(
            (result.files ?? []).map((f) => ({
              name: f.name,
              path: f.path ?? f.name,
              type: f.type,
              children: f.type === "directory" ? undefined : undefined,
              expanded: false,
              loading: false,
            })),
          );
        })
        .catch(() => setNodes([]));
    }
  }, [open, invoke]);

  const updateNode = useCallback(
    (nodes: TreeNode[], path: string, updater: (n: TreeNode) => TreeNode): TreeNode[] => {
      return nodes.map((n) => {
        if (n.path === path) return updater(n);
        if (n.children) return { ...n, children: updateNode(n.children, path, updater) };
        return n;
      });
    },
    [],
  );

  const handleToggle = useCallback(
    (node: TreeNode) => {
      if (node.type !== "directory") return;

      if (node.expanded) {
        // Collapse
        setNodes((prev) => updateNode(prev, node.path, (n) => ({ ...n, expanded: false })));
        return;
      }

      if (node.children) {
        // Already loaded, just expand
        setNodes((prev) => updateNode(prev, node.path, (n) => ({ ...n, expanded: true })));
        return;
      }

      // First expand: fetch children
      setNodes((prev) => updateNode(prev, node.path, (n) => ({ ...n, loading: true, expanded: true })));

      invoke("list_files_at", { path: node.path })
        .then((res) => {
          const result = res as { files?: FileEntry[] };
          const children: TreeNode[] = (result.files ?? []).map((f) => ({
            name: f.name,
            path: f.path ?? `${node.path}/${f.name}`,
            type: f.type,
            expanded: false,
            loading: false,
          }));
          setNodes((prev) =>
            updateNode(prev, node.path, (n) => ({ ...n, children, loading: false })),
          );
        })
        .catch(() => {
          setNodes((prev) =>
            updateNode(prev, node.path, (n) => ({ ...n, children: [], loading: false })),
          );
        });
    },
    [invoke, updateNode],
  );

  return (
    <div className={`sidebar ${!open ? "sidebar--collapsed" : ""}`}>
      <div className="sidebar__header">
        <span>Workspace</span>
      </div>
      <div className="sidebar__tree">
        {nodes.map((node) => (
          <TreeNodeRow
            key={node.path}
            node={node}
            depth={0}
            selectedPath={selectedPath}
            onSelect={(path) => {
              setSelectedPath(path);
              // Find the node to check if it's a file
              const findNode = (nodes: TreeNode[], p: string): TreeNode | undefined => {
                for (const n of nodes) {
                  if (n.path === p) return n;
                  if (n.children) {
                    const found = findNode(n.children, p);
                    if (found) return found;
                  }
                }
                return undefined;
              };
              const target = findNode(nodes, path);
              if (target && target.type === "file" && onFileSelect) {
                onFileSelect(path);
              }
            }}
            onToggle={handleToggle}
          />
        ))}
        {nodes.length === 0 && (
          <div className="sidebar__node" style={{ paddingLeft: 12, color: "var(--patina)", fontStyle: "italic" }}>
            No files yet
          </div>
        )}
      </div>
    </div>
  );
}
