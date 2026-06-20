import { buildTree, type TreeNode } from "./tree";
import type { FolderFiles } from "./api";

interface Props {
  folders: FolderFiles[];
  onSelect: (root: string, path: string) => void;
}

function Node({
  node,
  root,
  onSelect,
}: {
  node: TreeNode;
  root: string;
  onSelect: (root: string, path: string) => void;
}) {
  if (node.children === null) {
    return (
      <li>
        <button className="file" onClick={() => onSelect(root, node.path)}>
          {node.name}
        </button>
      </li>
    );
  }
  return (
    <li>
      <span className="dir">{node.name}/</span>
      <ul>
        {node.children.map((c) => (
          <Node key={c.path} node={c} root={root} onSelect={onSelect} />
        ))}
      </ul>
    </li>
  );
}

export function FileTree({ folders, onSelect }: Props) {
  return (
    <>
      {folders.map((folder) => {
        const tree = buildTree(folder.files);
        return (
          <div key={folder.root} className="tree-folder">
            <div className="tree-folder-name">{folder.name}</div>
            <ul className="tree">
              {tree.map((n) => (
                <Node key={n.path} node={n} root={folder.root} onSelect={onSelect} />
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
