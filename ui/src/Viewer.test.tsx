import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Viewer } from "./Viewer";

describe("Viewer", () => {
  it("renders markdown headings as html", () => {
    render(
      <Viewer file={{ path: "a.md", content: "# Title", kind: "markdown", ext: "md" }} />,
    );
    expect(screen.getByRole("heading", { name: "Title" })).toBeInTheDocument();
  });

  it("renders code content verbatim", () => {
    render(
      <Viewer file={{ path: "m.rs", content: "fn main() {}", kind: "code", ext: "rs" }} />,
    );
    expect(screen.getByText(/fn main/)).toBeInTheDocument();
  });

  it("shows a placeholder when no file is selected", () => {
    render(<Viewer file={null} />);
    expect(screen.getByText(/select a file/i)).toBeInTheDocument();
  });
});
