export interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[] | null; // null = file, array = directory
}

interface DirAcc {
  name: string;
  path: string;
  dirs: Map<string, DirAcc>;
  files: string[];
}

function emptyDir(name: string, path: string): DirAcc {
  return { name, path, dirs: new Map(), files: [] };
}

export function buildTree(paths: string[]): TreeNode[] {
  const root = emptyDir("", "");
  for (const p of paths) {
    const parts = p.split("/");
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i];
      const path = cur.path ? `${cur.path}/${name}` : name;
      if (!cur.dirs.has(name)) cur.dirs.set(name, emptyDir(name, path));
      cur = cur.dirs.get(name)!;
    }
    cur.files.push(parts[parts.length - 1]);
  }
  return toNodes(root);
}

function toNodes(dir: DirAcc): TreeNode[] {
  const dirNodes = [...dir.dirs.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d) => ({ name: d.name, path: d.path, children: toNodes(d) }));
  const fileNodes = dir.files
    .sort((a, b) => a.localeCompare(b))
    .map((f) => ({
      name: f,
      path: dir.path ? `${dir.path}/${f}` : f,
      children: null as TreeNode[] | null,
    }));
  return [...dirNodes, ...fileNodes];
}
