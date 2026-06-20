import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Mock CodeMirror (jsdom cannot run it)
vi.mock("@uiw/react-codemirror", () => ({
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea
      data-testid="codemirror"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock("@uiw/codemirror-theme-dracula", () => ({ dracula: {} }));
vi.mock("@uiw/codemirror-extensions-langs", () => ({
  loadLanguage: () => null,
}));

// Mock saveFile
vi.mock("./api", () => ({
  saveFile: vi.fn(),
}));

import { Editor } from "./Editor";
import { saveFile } from "./api";

const mockSaveFile = saveFile as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSaveFile.mockReset();
});

describe("Editor", () => {
  it("renders with content and shows filename", () => {
    render(
      <Editor root="/repo" path="src/main.ts" content="hello world" onClose={() => {}} />
    );
    expect(screen.getByText("main.ts")).toBeInTheDocument();
    expect(screen.getByTestId("codemirror")).toHaveValue("hello world");
  });

  it("sets dirty state when content changes", async () => {
    render(
      <Editor root="/repo" path="src/main.ts" content="hello" onClose={() => {}} />
    );
    expect(screen.queryByLabelText("unsaved changes")).not.toBeInTheDocument();
    const cm = screen.getByTestId("codemirror");
    fireEvent.change(cm, { target: { value: "hello world" } });
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();
  });

  it("calls saveFile and clears dirty on Ctrl+S", async () => {
    mockSaveFile.mockResolvedValue(undefined);
    render(
      <Editor root="/repo" path="src/main.ts" content="hello" onClose={() => {}} />
    );
    // Make it dirty first
    fireEvent.change(screen.getByTestId("codemirror"), { target: { value: "changed" } });
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(mockSaveFile).toHaveBeenCalledWith("/repo", "src/main.ts", "changed");
    });
    await waitFor(() => {
      expect(screen.queryByLabelText("unsaved changes")).not.toBeInTheDocument();
    });
  });

  it("shows error message when saveFile rejects", async () => {
    mockSaveFile.mockRejectedValue(new Error("Save failed: 500"));
    render(
      <Editor root="/repo" path="src/main.ts" content="hello" onClose={() => {}} />
    );
    fireEvent.change(screen.getByTestId("codemirror"), { target: { value: "changed" } });
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Save failed: 500");
    });
  });

  it("shows Edit/Preview toggle only for .md files", () => {
    const { rerender } = render(
      <Editor root="/repo" path="src/main.ts" content="hello" onClose={() => {}} />
    );
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();

    rerender(
      <Editor root="/repo" path="README.md" content="# Hello" onClose={() => {}} />
    );
    expect(screen.getByText(/preview/i)).toBeInTheDocument();
  });

  it("renders markdown preview when toggle clicked", async () => {
    render(
      <Editor root="/repo" path="README.md" content="# Hello" onClose={() => {}} />
    );
    fireEvent.click(screen.getByText("Preview"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    });
  });
});
