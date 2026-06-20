import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "./FileTree";

describe("FileTree", () => {
  it("renders file names and fires onSelect with root and path", () => {
    const onSelect = vi.fn();
    const folders = [
      { name: "project", root: "/home/user/project", files: ["docs/a.md", "main.rs"] },
    ];
    render(<FileTree folders={folders} onSelect={onSelect} />);
    expect(screen.getByText("main.rs")).toBeInTheDocument();
    fireEvent.click(screen.getByText("main.rs"));
    expect(onSelect).toHaveBeenCalledWith("/home/user/project", "main.rs");
  });
});
