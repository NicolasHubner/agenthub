import { describe, it, expect } from "vitest";
import { buildTree } from "./tree";

describe("buildTree", () => {
  it("nests files under directories", () => {
    const tree = buildTree(["docs/a.md", "docs/sub/b.md", "main.rs"]);
    expect(tree).toEqual([
      {
        name: "docs",
        path: "docs",
        children: [
          {
            name: "sub",
            path: "docs/sub",
            children: [{ name: "b.md", path: "docs/sub/b.md", children: null }],
          },
          { name: "a.md", path: "docs/a.md", children: null },
        ],
      },
      { name: "main.rs", path: "main.rs", children: null },
    ]);
  });
});
