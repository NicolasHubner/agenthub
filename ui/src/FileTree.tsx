import { useState, useEffect } from "react";
import { buildRoots, toggleNode, type DirNode, type RootNode } from "./tree";
import type { FolderFiles } from "./api";

interface Props {
  folders: FolderFiles[];
  onSelect: (root: string, path: string) => void;
}

function DirNodeView({
  node,
  root,
  depth,
  onToggle,
  onSelect,
}: {
  node: DirNode;
  root: string;
  depth: number;
  onToggle: (nodePath: string) => void;
  onSelect: (root: string, path: string) => void;
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
            {child.collapsed ? "▸" : "▾"} {child.name}/
          </button>
          {!child.collapsed && (
            <DirNodeView
              node={child}
              root={root}
              depth={depth + 1}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          )}
        </div>
      ))}
      {node.files.map((file) => {
        const fullPath = node.path ? node.path + "/" + file : file;
        return (
          <button
            key={fullPath}
            className="file"
            style={indent}
            onClick={() => onSelect(root, fullPath)}
          >
            {file}
          </button>
        );
      })}
    </>
  );
}

export function FileTree({ folders, onSelect }: Props) {
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
            <button
              className="tree-folder-header"
              onClick={() => handleToggle(idx, rootNode.tree.path)}
            >
              {isCollapsed ? "▸" : "▾"} {rootNode.name}
            </button>
            {!isCollapsed && (
              <div className="tree">
                <DirNodeView
                  node={rootNode.tree}
                  root={rootNode.root}
                  depth={1}
                  onToggle={(nodePath) => handleToggle(idx, nodePath)}
                  onSelect={onSelect}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
