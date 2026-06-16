import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileTree } from "./FileTree";

describe("FileTree", () => {
  it("renders file names and fires onSelect with the path", () => {
    const onSelect = vi.fn();
    render(<FileTree files={["docs/a.md", "main.rs"]} onSelect={onSelect} />);
    expect(screen.getByText("main.rs")).toBeInTheDocument();
    fireEvent.click(screen.getByText("main.rs"));
    expect(onSelect).toHaveBeenCalledWith("main.rs");
  });
});
