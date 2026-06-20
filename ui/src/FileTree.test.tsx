import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "./FileTree";
import type { FolderFiles } from "./api";

const mkFolders = (...defs: FolderFiles[]) => defs;

describe("FileTree", () => {
  it("renders folder names as section headers", () => {
    const folders = mkFolders(
      { name: "alpha", root: "/a", files: ["foo.ts"] },
      { name: "beta", root: "/b", files: ["bar.ts"] },
    );
    render(<FileTree folders={folders} onSelect={vi.fn()} />);
    expect(screen.getByText(/alpha/)).toBeInTheDocument();
    expect(screen.getByText(/beta/)).toBeInTheDocument();
  });

  it("clicking folder header toggles its files visibility", () => {
    const folders = mkFolders({ name: "project", root: "/p", files: ["main.ts"] });
    render(<FileTree folders={folders} onSelect={vi.fn()} />);
    // files visible initially (root not collapsed)
    expect(screen.getByText("main.ts")).toBeInTheDocument();
    // collapse
    fireEvent.click(screen.getByText(/project/));
    expect(screen.queryByText("main.ts")).not.toBeInTheDocument();
    // expand again
    fireEvent.click(screen.getByText(/project/));
    expect(screen.getByText("main.ts")).toBeInTheDocument();
  });

  it("clicking a file calls onSelect with (root, fullPath)", () => {
    const onSelect = vi.fn();
    const folders = mkFolders({
      name: "project",
      root: "/home/user/project",
      files: ["docs/a.md", "main.rs"],
    });
    render(<FileTree folders={folders} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("main.rs"));
    expect(onSelect).toHaveBeenCalledWith("/home/user/project", "main.rs");
  });

  it("clicking a nested file calls onSelect with full relative path", () => {
    const onSelect = vi.fn();
    const folders = mkFolders({
      name: "project",
      root: "/home/user/project",
      files: ["docs/a.md"],
    });
    render(<FileTree folders={folders} onSelect={onSelect} />);
    // docs/ dir starts collapsed — expand it first
    fireEvent.click(screen.getByText(/docs\//));
    fireEvent.click(screen.getByText("a.md"));
    expect(onSelect).toHaveBeenCalledWith("/home/user/project", "docs/a.md");
  });

  it("clicking a subdirectory toggles it", () => {
    const folders = mkFolders({
      name: "project",
      root: "/p",
      files: ["src/index.ts"],
    });
    render(<FileTree folders={folders} onSelect={vi.fn()} />);
    // src/ collapsed by default — file not visible
    expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/src\//));
    expect(screen.getByText("index.ts")).toBeInTheDocument();
    // collapse again
    fireEvent.click(screen.getByText(/src\//));
    expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
  });

  it("empty folders renders nothing", () => {
    const { container } = render(<FileTree folders={[]} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
