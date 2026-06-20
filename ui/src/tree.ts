import { FolderFiles } from "./api";

// ---------------------------------------------------------------------------
// Multi-root API
// ---------------------------------------------------------------------------

export interface DirNode {
  name: string;
  path: string;        // full relative path from folder root (empty string for root)
  children: DirNode[];
  files: string[];     // leaf file basenames at this level
  collapsed: boolean;  // default true for dirs, false for root
}

export interface RootNode {
  name: string;        // folder display name (basename of root path)
  root: string;        // absolute root path (from FolderFiles.root)
  tree: DirNode;       // root DirNode (collapsed: false)
}

interface DirAcc {
  name: string;
  path: string;
  dirs: Map<string, DirAcc>;
  files: string[];
}

function emptyAcc(name: string, path: string): DirAcc {
  return { name, path, dirs: new Map(), files: [] };
}

function accToNode(acc: DirAcc, isRoot: boolean): DirNode {
  const children = [...acc.dirs.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => accToNode(d, false));
  const files = [...acc.files].sort((a, b) => a.localeCompare(b));
  return {
    name: acc.name,
    path: acc.path,
    children,
    files,
    collapsed: !isRoot,
  };
}

export function buildRootNode(folder: FolderFiles): RootNode {
  const acc = emptyAcc("", "");
  for (const p of folder.files) {
    const parts = p.split("/");
    let cur = acc;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const path = cur.path ? `${cur.path}/${part}` : part;
      if (!cur.dirs.has(part)) cur.dirs.set(part, emptyAcc(part, path));
      cur = cur.dirs.get(part)!;
    }
    cur.files.push(parts[parts.length - 1]);
  }
  const name = folder.name || folder.root.split("/").filter(Boolean).pop() || folder.root;
  return {
    name,
    root: folder.root,
    tree: accToNode(acc, true),
  };
}

export function buildRoots(folders: FolderFiles[]): RootNode[] {
  return folders.map(buildRootNode);
}

function toggleInNode(node: DirNode, nodePath: string): DirNode {
  if (node.path === nodePath) {
    return { ...node, collapsed: !node.collapsed };
  }
  const children = node.children.map((c) => toggleInNode(c, nodePath));
  return { ...node, children };
}

export function toggleNode(root: RootNode, nodePath: string): RootNode {
  return { ...root, tree: toggleInNode(root.tree, nodePath) };
}
