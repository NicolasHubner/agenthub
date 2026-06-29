import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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
vi.mock("@uiw/codemirror-extensions-langs", () => ({ loadLanguage: () => null }));
vi.mock("./api", () => ({ saveFile: vi.fn() }));

import { Editor } from "./Editor";
import { saveFile } from "./api";

const mockSaveFile = saveFile as ReturnType<typeof vi.fn>;

const baseProps = {
  root: "/repo",
  path: "src/main.ts",
  value: "hello world",
  dirty: false,
  onChange: vi.fn(),
  onSaved: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => {
  mockSaveFile.mockReset();
  vi.clearAllMocks();
});

describe("Editor", () => {
  it("renders value and shows filename", () => {
    render(<Editor {...baseProps} />);
    expect(screen.getByText("main.ts")).toBeInTheDocument();
    expect(screen.getByTestId("codemirror")).toHaveValue("hello world");
  });

  it("shows dirty indicator when dirty=true", () => {
    render(<Editor {...baseProps} dirty={true} />);
    expect(screen.getByLabelText("unsaved changes")).toBeInTheDocument();
  });

  it("does not show dirty indicator when dirty=false", () => {
    render(<Editor {...baseProps} dirty={false} />);
    expect(screen.queryByLabelText("unsaved changes")).not.toBeInTheDocument();
  });

  it("calls onChange when CodeMirror value changes", () => {
    const onChange = vi.fn();
    render(<Editor {...baseProps} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("codemirror"), { target: { value: "new text" } });
    expect(onChange).toHaveBeenCalledWith("new text");
  });

  it("calls saveFile and onSaved on Ctrl+S when dirty", async () => {
    mockSaveFile.mockResolvedValue(undefined);
    const onSaved = vi.fn();
    render(<Editor {...baseProps} dirty={true} onSaved={onSaved} />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(mockSaveFile).toHaveBeenCalledWith("/repo", "src/main.ts", "hello world");
    });
    await waitFor(() => {
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("does not call saveFile on Ctrl+S when not dirty", async () => {
    render(<Editor {...baseProps} dirty={false} />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(mockSaveFile).not.toHaveBeenCalled();
    });
  });

  it("shows error message when saveFile rejects", async () => {
    mockSaveFile.mockRejectedValue(new Error("Save failed: 500"));
    render(<Editor {...baseProps} dirty={true} />);
    fireEvent.keyDown(window, { key: "s", ctrlKey: true });
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Save failed: 500");
    });
  });

  it("shows Preview toggle only for .md files", () => {
    const { rerender } = render(<Editor {...baseProps} path="src/main.ts" />);
    expect(screen.queryByText(/preview/i)).not.toBeInTheDocument();
    rerender(<Editor {...baseProps} path="README.md" />);
    expect(screen.getByText(/preview/i)).toBeInTheDocument();
  });

  it("renders markdown preview when Preview clicked", async () => {
    render(<Editor {...baseProps} path="README.md" value="# Hello" />);
    fireEvent.click(screen.getByText("Preview"));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Hello" })).toBeInTheDocument();
    });
  });

  it("shows Wrap toggle button", () => {
    render(<Editor {...baseProps} />);
    expect(screen.getByText(/wrap/i)).toBeInTheDocument();
  });
});
