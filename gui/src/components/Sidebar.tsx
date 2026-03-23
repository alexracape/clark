import React, { useState, useEffect, useCallback } from "react";

interface SidebarProps {
  open: boolean;
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  onFileSelect?: (path: string) => void;
  onNewNote?: () => void;
  /** Increment to force a tree refresh (e.g. after creating/renaming a note). */
  refreshKey?: number;
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

export function Sidebar({ open, invoke, onFileSelect, onNewNote, refreshKey = 0 }: SidebarProps) {
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  /** Collect which directories are currently expanded so we can preserve them across refreshes. */
  const getExpandedPaths = useCallback((treeNodes: TreeNode[]): Set<string> => {
    const paths = new Set<string>();
    function walk(ns: TreeNode[]) {
      for (const n of ns) {
        if (n.expanded) paths.add(n.path);
        if (n.children) walk(n.children);
      }
    }
    walk(treeNodes);
    return paths;
  }, []);

  const refreshTree = useCallback(async (expandedPaths?: Set<string>) => {
    try {
      const res = await invoke("list_files", {});
      const result = res as { files?: FileEntry[] };
      const rootNodes: TreeNode[] = (result.files ?? []).map((f) => ({
        name: f.name,
        path: f.path ?? f.name,
        type: f.type,
        expanded: false,
        loading: false,
      }));

      if (!expandedPaths || expandedPaths.size === 0) {
        setNodes(rootNodes);
        return;
      }

      // Re-expand directories that were open before the refresh
      async function reexpand(treeNodes: TreeNode[]): Promise<TreeNode[]> {
        const result: TreeNode[] = [];
        for (const node of treeNodes) {
          if (node.type === "directory" && expandedPaths!.has(node.path)) {
            try {
              const childRes = await invoke("list_files_at", { path: node.path });
              const childResult = childRes as { files?: FileEntry[] };
              let children: TreeNode[] = (childResult.files ?? []).map((f) => ({
                name: f.name,
                path: f.path ?? `${node.path}/${f.name}`,
                type: f.type,
                expanded: false,
                loading: false,
              }));
              children = await reexpand(children);
              result.push({ ...node, expanded: true, children });
            } catch {
              result.push(node);
            }
          } else {
            result.push(node);
          }
        }
        return result;
      }

      const expanded = await reexpand(rootNodes);
      setNodes(expanded);
    } catch {
      setNodes([]);
    }
  }, [invoke]);

  // Refresh on open and when refreshKey changes
  useEffect(() => {
    if (open) {
      setNodes((prev) => {
        const expanded = getExpandedPaths(prev);
        refreshTree(expanded);
        return prev;
      });
    }
  }, [open, refreshKey, refreshTree, getExpandedPaths]);

  // Periodic refresh every 5 seconds while open
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      setNodes((prev) => {
        const expanded = getExpandedPaths(prev);
        refreshTree(expanded);
        return prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [open, refreshTree, getExpandedPaths]);

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
        {onNewNote && (
          <button className="sidebar__new-note" onClick={onNewNote} title="New note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="11" x2="12" y2="17" />
              <line x1="9" y1="14" x2="15" y2="14" />
            </svg>
          </button>
        )}
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
