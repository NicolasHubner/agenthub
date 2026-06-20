import { describe, it, expect } from "vitest";
import { buildRootNode, buildRoots, toggleNode } from "./tree";
import type { FolderFiles } from "./api";

const folder1: FolderFiles = {
  name: "my-project",
  root: "/home/user/my-project",
  files: [
    "README.md",
    "src/main.rs",
    "src/models/user.rs",
    "docs/guide.md",
  ],
};

describe("buildRootNode", () => {
  it("files at root level end up in root.files", () => {
    const rn = buildRootNode(folder1);
    expect(rn.tree.files).toContain("README.md");
    expect(rn.tree.path).toBe("");
    expect(rn.tree.collapsed).toBe(false);
  });

  it("nested file creates intermediate DirNode", () => {
    const rn = buildRootNode(folder1);
    const src = rn.tree.children.find((c) => c.name === "src");
    expect(src).toBeDefined();
    expect(src!.files).toContain("main.rs");
    const models = src!.children.find((c) => c.name === "models");
    expect(models).toBeDefined();
    expect(models!.files).toContain("user.rs");
  });

  it("child DirNodes are collapsed by default", () => {
    const rn = buildRootNode(folder1);
    const src = rn.tree.children.find((c) => c.name === "src")!;
    expect(src.collapsed).toBe(true);
  });

  it("dirs and files are sorted alphabetically", () => {
    const rn = buildRootNode(folder1);
    const dirNames = rn.tree.children.map((c) => c.name);
    expect(dirNames).toEqual([...dirNames].sort());
  });
});

describe("buildRoots", () => {
  it("builds one RootNode per FolderFiles", () => {
    const folder2: FolderFiles = { name: "other", root: "/tmp/other", files: ["a.ts"] };
    const roots = buildRoots([folder1, folder2]);
    expect(roots).toHaveLength(2);
  });

  it("uses folder.name as the RootNode name", () => {
    const roots = buildRoots([folder1]);
    expect(roots[0].name).toBe("my-project");
  });

  it("sets root path from folder.root", () => {
    const roots = buildRoots([folder1]);
    expect(roots[0].root).toBe("/home/user/my-project");
  });
});

describe("toggleNode", () => {
  it("toggles a node's collapsed state", () => {
    const rn = buildRootNode(folder1);
    const src = rn.tree.children.find((c) => c.name === "src")!;
    expect(src.collapsed).toBe(true);

    const toggled = toggleNode(rn, "src");
    const srcToggled = toggled.tree.children.find((c) => c.name === "src")!;
    expect(srcToggled.collapsed).toBe(false);
  });

  it("does not mutate the original RootNode", () => {
    const rn = buildRootNode(folder1);
    const original = rn.tree.children.find((c) => c.name === "src")!;

    toggleNode(rn, "src");

    const after = rn.tree.children.find((c) => c.name === "src")!;
    expect(after.collapsed).toBe(original.collapsed);
  });

  it("toggles root node when nodePath is empty string", () => {
    const rn = buildRootNode(folder1);
    expect(rn.tree.collapsed).toBe(false);
    const toggled = toggleNode(rn, "");
    expect(toggled.tree.collapsed).toBe(true);
  });
});
