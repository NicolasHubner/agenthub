import { useState, useEffect } from "react";
import { buildRoots, toggleNode, type DirNode, type RootNode } from "./tree";
import type { FolderFiles } from "./api";

interface Props {
  folders: FolderFiles[];
  onSelect: (root: string, path: string) => void;
  onRemoveFolder?: (root: string) => void;
  activeRoot?: string;
  activePath?: string;
}

// VS Code-inspired file extension colors
const EXT_COLORS: Record<string, string> = {
  ts: "#3b82f6",
  tsx: "#06b6d4",
  js: "#f59e0b",
  jsx: "#f59e0b",
  md: "#8b5cf6",
  mdx: "#8b5cf6",
  json: "#f97316",
  yaml: "#ef4444",
  yml: "#ef4444",
  toml: "#94a3b8",
  css: "#a78bfa",
  scss: "#ec4899",
  html: "#f97316",
  rs: "#f97316",
  sh: "#22c55e",
  bash: "#22c55e",
  py: "#3b82f6",
  go: "#06b6d4",
  png: "#14b8a6",
  jpg: "#14b8a6",
  jpeg: "#14b8a6",
  gif: "#14b8a6",
  svg: "#10b981",
  lock: "#64748b",
};

function fileColor(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "#6b7280";
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_COLORS[ext] ?? "#6b7280";
}

function fileIcon(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot === -1) return "·";
  const ext = name.slice(dot + 1).toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return "◈";
  if (["md", "mdx"].includes(ext)) return "≡";
  if (["json", "toml", "yaml", "yml"].includes(ext)) return "⊞";
  if (["ts", "tsx", "js", "jsx"].includes(ext)) return "◇";
  if (["rs", "go", "py", "sh", "bash"].includes(ext)) return "◆";
  if (["css", "scss"].includes(ext)) return "◉";
  return "·";
}

function DirNodeView({
  node,
  root,
  depth,
  onToggle,
  onSelect,
  activeRoot,
  activePath,
}: {
  node: DirNode;
  root: string;
  depth: number;
  onToggle: (nodePath: string) => void;
  onSelect: (root: string, path: string) => void;
  activeRoot?: string;
  activePath?: string;
}) {
  const indent = { paddingLeft: depth * 12 + "px" };
  return (
    <>
      {node.children.map((child) => (
        <div key={child.path}>
          <button
            className="dir"
            style={indent}
            onClick={() => onToggle(child.path)}
          >
            <span style={{ opacity: 0.5, fontSize: 10 }}>
              {child.collapsed ? "▸" : "▾"}
            </span>
            <span style={{ color: "#d97706" }}>📁</span>
            {child.name}
          </button>
          {!child.collapsed && (
            <DirNodeView
              node={child}
              root={root}
              depth={depth + 1}
              onToggle={onToggle}
              onSelect={onSelect}
              activeRoot={activeRoot}
              activePath={activePath}
            />
          )}
        </div>
      ))}
      {node.files.map((file) => {
        const fullPath = node.path ? node.path + "/" + file : file;
        const color = fileColor(file);
        const icon = fileIcon(file);
        const isActive = root === activeRoot && fullPath === activePath;
        return (
          <button
            key={fullPath}
            className={isActive ? "file active" : "file"}
            style={{ ...indent, color }}
            onClick={() => onSelect(root, fullPath)}
          >
            <span style={{ opacity: 0.6, fontSize: 10, marginRight: 4 }}>{icon}</span>
            {file}
          </button>
        );
      })}
    </>
  );
}

export function FileTree({ folders, onSelect, onRemoveFolder, activeRoot, activePath }: Props) {
  const [roots, setRoots] = useState<RootNode[]>(() => buildRoots(folders));

  useEffect(() => {
    setRoots(buildRoots(folders));
  }, [folders]);

  const handleToggle = (rootIdx: number, nodePath: string) => {
    setRoots((prev) => {
      const next = [...prev];
      next[rootIdx] = toggleNode(next[rootIdx], nodePath);
      return next;
    });
  };

  if (roots.length === 0) return null;

  return (
    <>
      {roots.map((rootNode, idx) => {
        const isCollapsed = rootNode.tree.collapsed;
        return (
          <div key={rootNode.root} className="tree-folder">
            <div className="tree-folder-row">
              <button
                className="tree-folder-header"
                onClick={() => handleToggle(idx, rootNode.tree.path)}
              >
                <span style={{ opacity: 0.5, fontSize: 10 }}>
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span style={{ color: "#f59e0b" }}>◼</span>
                {rootNode.name}
              </button>
              {onRemoveFolder && (
                <button
                  className="tree-folder-remove"
                  title={`Remove ${rootNode.name}`}
                  onClick={() => onRemoveFolder(rootNode.root)}
                >
                  ✕
                </button>
              )}
            </div>
            {!isCollapsed && (
              <div className="tree">
                <DirNodeView
                  node={rootNode.tree}
                  root={rootNode.root}
                  depth={1}
                  onToggle={(nodePath) => handleToggle(idx, nodePath)}
                  onSelect={onSelect}
                  activeRoot={activeRoot}
                  activePath={activePath}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
