import { buildTree, type TreeNode } from "./tree";

interface Props {
  files: string[];
  onSelect: (path: string) => void;
}

function Node({ node, onSelect }: { node: TreeNode; onSelect: (p: string) => void }) {
  if (node.children === null) {
    return (
      <li>
        <button className="file" onClick={() => onSelect(node.path)}>
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
          <Node key={c.path} node={c} onSelect={onSelect} />
        ))}
      </ul>
    </li>
  );
}

export function FileTree({ files, onSelect }: Props) {
  const tree = buildTree(files);
  return (
    <ul className="tree">
      {tree.map((n) => (
        <Node key={n.path} node={n} onSelect={onSelect} />
      ))}
    </ul>
  );
}
