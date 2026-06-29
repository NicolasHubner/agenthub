import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { useRef } from "react";

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
vi.mock("./api", () => ({
  getFile: vi.fn(),
  saveFile: vi.fn(),
}));

import { EditorPanel, EditorPanelHandle } from "./EditorPanel";
import { getFile } from "./api";

const mockGetFile = getFile as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetFile.mockReset();
  localStorage.clear();
});

function renderWithRef() {
  let ref!: React.RefObject<EditorPanelHandle | null>;
  function Wrapper() {
    ref = useRef<EditorPanelHandle>(null);
    return <EditorPanel ref={ref} />;
  }
  const result = render(<Wrapper />);
  return { ...result, ref };
}

describe("EditorPanel", () => {
  it("renders nothing when no tabs open", () => {
    const { container } = renderWithRef();
    expect(container.firstChild).toBeNull();
  });

  it("opens a file and shows tab with filename", async () => {
    mockGetFile.mockResolvedValue({ content: "file content" });
    const { ref } = renderWithRef();
    await act(async () => {
      ref.current?.openFile("/repo", "src/App.tsx");
    });
    await waitFor(() => {
      expect(screen.getByText("App.tsx")).toBeInTheDocument();
    });
    expect(screen.getByTestId("codemirror")).toHaveValue("file content");
  });

  it("does not duplicate tab when same file opened twice", async () => {
    mockGetFile.mockResolvedValue({ content: "hello" });
    const { ref } = renderWithRef();
    await act(async () => {
      ref.current?.openFile("/repo", "src/App.tsx");
    });
    await waitFor(() => screen.getByText("App.tsx"));
    await act(async () => {
      ref.current?.openFile("/repo", "src/App.tsx");
    });
    expect(mockGetFile).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("App.tsx")).toHaveLength(1);
  });

  it("opens multiple tabs and switches between them", async () => {
    mockGetFile
      .mockResolvedValueOnce({ content: "content A" })
      .mockResolvedValueOnce({ content: "content B" });
    const { ref } = renderWithRef();
    await act(async () => { ref.current?.openFile("/repo", "A.ts"); });
    await waitFor(() => screen.getByText("A.ts"));
    await act(async () => { ref.current?.openFile("/repo", "B.ts"); });
    await waitFor(() => screen.getByText("B.ts"));

    // B is active (last opened)
    expect(screen.getByTestId("codemirror")).toHaveValue("content B");

    // Click A tab
    fireEvent.click(screen.getByText("A.ts"));
    expect(screen.getByTestId("codemirror")).toHaveValue("content A");
  });

  it("preserves unsaved edits when switching tabs", async () => {
    mockGetFile
      .mockResolvedValueOnce({ content: "original A" })
      .mockResolvedValueOnce({ content: "original B" });
    const { ref } = renderWithRef();
    await act(async () => { ref.current?.openFile("/repo", "A.ts"); });
    await waitFor(() => screen.getByText("A.ts"));
    await act(async () => { ref.current?.openFile("/repo", "B.ts"); });
    await waitFor(() => screen.getByText("B.ts"));

    // Switch to A, type something
    fireEvent.click(screen.getByText("A.ts"));
    fireEvent.change(screen.getByTestId("codemirror"), { target: { value: "edited A" } });

    // Switch to B
    fireEvent.click(screen.getByText("B.ts"));
    expect(screen.getByTestId("codemirror")).toHaveValue("original B");

    // Switch back to A — edits preserved
    fireEvent.click(screen.getByText("A.ts"));
    expect(screen.getByTestId("codemirror")).toHaveValue("edited A");
  });

  it("closes tab with × button; panel hides when last tab closed", async () => {
    mockGetFile.mockResolvedValue({ content: "hello" });
    const { ref, container } = renderWithRef();
    await act(async () => { ref.current?.openFile("/repo", "A.ts"); });
    await waitFor(() => screen.getByText("A.ts"));

    fireEvent.click(screen.getByRole("button", { name: "close A.ts" }));
    expect(container.firstChild).toBeNull();
  });

  it("calls onActiveChange when active tab changes", async () => {
    mockGetFile
      .mockResolvedValueOnce({ content: "a" })
      .mockResolvedValueOnce({ content: "b" });
    const onActiveChange = vi.fn();
    let ref!: React.RefObject<EditorPanelHandle | null>;
    function Wrapper() {
      ref = useRef<EditorPanelHandle>(null);
      return <EditorPanel ref={ref} onActiveChange={onActiveChange} />;
    }
    render(<Wrapper />);
    await act(async () => { ref.current?.openFile("/repo", "A.ts"); });
    await waitFor(() => {
      expect(onActiveChange).toHaveBeenCalledWith("/repo", "A.ts");
    });
    await act(async () => { ref.current?.openFile("/repo", "B.ts"); });
    await waitFor(() => {
      expect(onActiveChange).toHaveBeenCalledWith("/repo", "B.ts");
    });
  });
});
