# Editor Panel — Tabs, Resize, Word Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-width single-file Editor overlay with a resizable, tabbed EditorPanel that preserves unsaved edits per tab and defaults to word wrap.

**Architecture:** `EditorPanel.tsx` (new) owns all tab state, resize logic, and localStorage width persistence — exposed to `App.tsx` via a ref handle. `Editor.tsx` becomes a controlled component receiving `value/onChange/dirty`. `App.tsx` drops its own file state and holds only an `editorPanelRef`.

**Tech Stack:** React + TypeScript, `@uiw/react-codemirror`, `@codemirror/view` (EditorView.lineWrapping), vitest + @testing-library/react.

## Global Constraints

- Run tests with: `cd ui && npm test`
- Run build with: `cd ui && npm run build`
- Left sidebar width is 220px — editor panel max width = `window.innerWidth - 220`
- Editor panel min width = 300px
- localStorage key for width: `"editor-panel-width"`
- Default panel width: 520px
- Colors follow Dracula palette: `#1e1e2e` bg, `#2a2a3d` header, `#3b3b52` border, `#44475a` active tab, `#f59e0b` dirty dot, `#cdd6f4` text
- Word wrap on by default

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `ui/src/Editor.tsx` | Modify | Controlled component: receives value/onChange/dirty/onSaved, adds wrap toggle |
| `ui/src/Editor.test.tsx` | Modify | Update tests for new controlled API |
| `ui/src/EditorPanel.tsx` | Create | Tabs state, resize, localStorage, renders tab bar + Editor |
| `ui/src/EditorPanel.test.tsx` | Create | Tests for openFile, tab switching, tab close, duplicate detection |
| `ui/src/App.tsx` | Modify | Replace openFile state with editorPanelRef + activeFile callback |
| `ui/src/App.css` | Modify | Add EditorPanel CSS, keep .file-drawer for now |

---

### Task 1: Convert Editor.tsx to controlled component + add wrap toggle

**Files:**
- Modify: `ui/src/Editor.tsx`
- Modify: `ui/src/Editor.test.tsx`

**Interfaces:**
- Produces:
  ```typescript
  interface EditorProps {
    root: string;
    path: string;
    value: string;          // controlled — what CodeMirror renders
    dirty: boolean;         // from parent — drives ● indicator and Save button
    onChange: (v: string) => void;
    onSaved: () => void;    // called after successful save to server
    onClose: () => void;    // closes panel entirely
  }
  export function Editor(props: EditorProps): JSX.Element
  ```

- [ ] **Step 1: Update Editor.test.tsx with new API**

Replace the entire content of `ui/src/Editor.test.tsx`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail with current Editor.tsx**

```bash
cd /home/nicolas/agenthub/ui && npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|×|Error" | head -30
```

Expected: several failures (controlled API not yet implemented).

- [ ] **Step 3: Rewrite Editor.tsx with controlled API and wrap toggle**

Replace `ui/src/Editor.tsx` entirely:

```typescript
import { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { loadLanguage } from "@uiw/codemirror-extensions-langs";
import ReactMarkdown from "react-markdown";
import { saveFile } from "./api";

interface EditorProps {
  root: string;
  path: string;
  value: string;
  dirty: boolean;
  onChange: (v: string) => void;
  onSaved: () => void;
  onClose: () => void;
}

function extFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "text";
  return path.slice(dot + 1).toLowerCase();
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function Editor({ root, path, value, dirty, onChange, onSaved, onClose }: EditorProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [wrap, setWrap] = useState(true);

  const isMarkdown = path.endsWith(".md");
  const ext = extFromPath(path);
  const lang = ext !== "text" ? loadLanguage(ext as Parameters<typeof loadLanguage>[0]) : null;
  const extensions = [
    ...(lang ? [lang] : []),
    ...(wrap ? [EditorView.lineWrapping] : []),
  ];

  const handleSave = useCallback(async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      await saveFile(root, path, value);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [root, path, value, dirty, saving, onSaved]);

  useEffect(() => {
    setError(null);
    setPreview(false);
  }, [path]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  return (
    <div className="file-drawer-header-wrapper">
      <div className="file-drawer-header">
        <span className="file-drawer-path">
          {basename(path)}
          {dirty && (
            <span
              aria-label="unsaved changes"
              style={{ color: "#f59e0b", marginLeft: 4 }}
            >
              ●
            </span>
          )}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            className="file-drawer-close"
            onClick={() => setWrap((w) => !w)}
          >
            {wrap ? "No Wrap" : "Wrap"}
          </button>
          {isMarkdown && (
            <button className="file-drawer-close" onClick={() => setPreview((p) => !p)}>
              {preview ? "Edit" : "Preview"}
            </button>
          )}
          <button
            className="file-drawer-close"
            onClick={handleSave}
            disabled={saving || !dirty}
            style={{ opacity: saving || !dirty ? 0.4 : 1 }}
          >
            {saving ? "…" : "Save"}
          </button>
          <button className="file-drawer-close" onClick={onClose}>✕</button>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          style={{ padding: "6px 14px", fontSize: 12, color: "#f87171", background: "#2a1a1a" }}
        >
          {error}
        </div>
      )}
      <div className="file-drawer-body">
        {preview && isMarkdown ? (
          <div className="viewer markdown">
            <ReactMarkdown>{value}</ReactMarkdown>
          </div>
        ) : (
          <CodeMirror
            value={value}
            theme={dracula}
            extensions={extensions}
            onChange={onChange}
            style={{ height: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/nicolas/agenthub/ui && npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|×|Editor" | head -30
```

Expected: all Editor tests PASS.

- [ ] **Step 5: Verify TypeScript build clean**

```bash
cd /home/nicolas/agenthub/ui && npm run build 2>&1 | tail -10
```

Expected: no TypeScript errors (build may fail on App.tsx import of old Editor API — that's fine, we fix in Task 4).

- [ ] **Step 6: Commit**

```bash
cd /home/nicolas/agenthub && git add ui/src/Editor.tsx ui/src/Editor.test.tsx && git commit -m "refactor(editor): convert to controlled component, add wrap toggle"
```

---

### Task 2: Create EditorPanel.tsx

**Files:**
- Create: `ui/src/EditorPanel.tsx`
- Create: `ui/src/EditorPanel.test.tsx`

**Interfaces:**
- Consumes from Task 1:
  ```typescript
  import { Editor } from "./Editor";
  // Editor({ root, path, value, dirty, onChange, onSaved, onClose })
  ```
- Consumes from api:
  ```typescript
  import { getFile } from "./api";
  // getFile(root, path) → Promise<{ content: string }>
  ```
- Produces:
  ```typescript
  export interface EditorPanelHandle {
    openFile(root: string, path: string): void;
  }
  export const EditorPanel: React.ForwardRefExoticComponent<
    EditorPanelProps & React.RefAttributes<EditorPanelHandle>
  >

  interface EditorPanelProps {
    onActiveChange?: (root: string | null, path: string | null) => void;
  }
  ```

- [ ] **Step 1: Write EditorPanel.test.tsx**

Create `ui/src/EditorPanel.test.tsx`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /home/nicolas/agenthub/ui && npm test -- --reporter=verbose 2>&1 | grep -E "EditorPanel|cannot find|FAIL" | head -20
```

Expected: FAIL — EditorPanel module not found.

- [ ] **Step 3: Create EditorPanel.tsx**

Create `ui/src/EditorPanel.tsx`:

```typescript
import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { getFile } from "./api";
import { Editor } from "./Editor";

interface Tab {
  root: string;
  path: string;
  content: string;
  value: string;
  dirty: boolean;
}

export interface EditorPanelHandle {
  openFile(root: string, path: string): void;
}

interface EditorPanelProps {
  onActiveChange?: (root: string | null, path: string | null) => void;
}

const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 300;
const SIDEBAR_WIDTH = 220;
const STORAGE_KEY = "editor-panel-width";

function tabKey(root: string, path: string) {
  return `${root}:${path}`;
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export const EditorPanel = forwardRef<EditorPanelHandle, EditorPanelProps>(
  function EditorPanel({ onActiveChange }, ref) {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeIdx, setActiveIdx] = useState(0);
    const [width, setWidth] = useState<number>(() => {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? parseInt(stored, 10) : DEFAULT_WIDTH;
    });

    const tabsRef = useRef(tabs);
    tabsRef.current = tabs;

    useImperativeHandle(ref, () => ({
      openFile(root: string, path: string) {
        const existing = tabsRef.current.findIndex(
          (t) => tabKey(t.root, t.path) === tabKey(root, path)
        );
        if (existing !== -1) {
          setActiveIdx(existing);
          return;
        }
        getFile(root, path).then((fc) => {
          setTabs((prev) => {
            const newTab: Tab = { root, path, content: fc.content, value: fc.content, dirty: false };
            return [...prev, newTab];
          });
          setActiveIdx((prev) => {
            // new tab will be at end of current tabs length
            return tabsRef.current.length; // length before push = index of new tab
          });
        });
      },
    }));

    // Notify parent when active tab changes
    useEffect(() => {
      if (tabs.length === 0) {
        onActiveChange?.(null, null);
      } else {
        const tab = tabs[activeIdx] ?? tabs[0];
        onActiveChange?.(tab.root, tab.path);
      }
    }, [activeIdx, tabs, onActiveChange]);

    const handleChange = useCallback((idx: number, val: string) => {
      setTabs((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], value: val, dirty: val !== next[idx].content };
        return next;
      });
    }, []);

    const handleSaved = useCallback((idx: number) => {
      setTabs((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], content: next[idx].value, dirty: false };
        return next;
      });
    }, []);

    const handleCloseTab = useCallback((idx: number) => {
      setTabs((prev) => {
        const next = prev.filter((_, i) => i !== idx);
        return next;
      });
      setActiveIdx((prev) => {
        if (idx < prev) return prev - 1;
        if (idx === prev) return Math.max(0, prev - 1);
        return prev;
      });
    }, []);

    // Resize drag
    const resizing = useRef(false);
    const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      const onMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        const maxWidth = window.innerWidth - SIDEBAR_WIDTH;
        const newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, window.innerWidth - ev.clientX));
        setWidth(newWidth);
      };
      const onUp = (ev: MouseEvent) => {
        resizing.current = false;
        const maxWidth = window.innerWidth - SIDEBAR_WIDTH;
        const newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, window.innerWidth - ev.clientX));
        localStorage.setItem(STORAGE_KEY, String(newWidth));
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }, []);

    if (tabs.length === 0) return null;

    const activeTab = tabs[activeIdx] ?? tabs[0];
    const clampedActiveIdx = tabs[activeIdx] ? activeIdx : 0;

    return (
      <div className="editor-panel" style={{ width }}>
        <div className="editor-resize-handle" onMouseDown={handleResizeMouseDown} />
        <div className="editor-tabs">
          {tabs.map((tab, i) => (
            <button
              key={tabKey(tab.root, tab.path)}
              className={`editor-tab${i === clampedActiveIdx ? " active" : ""}`}
              onClick={() => setActiveIdx(i)}
            >
              <span className="editor-tab-name">{basename(tab.path)}</span>
              {tab.dirty && <span className="editor-tab-dirty">●</span>}
              <span
                className="editor-tab-close"
                role="button"
                aria-label={`close ${basename(tab.path)}`}
                onClick={(e) => { e.stopPropagation(); handleCloseTab(i); }}
              >
                ×
              </span>
            </button>
          ))}
        </div>
        <Editor
          key={tabKey(activeTab.root, activeTab.path)}
          root={activeTab.root}
          path={activeTab.path}
          value={activeTab.value}
          dirty={activeTab.dirty}
          onChange={(val) => handleChange(clampedActiveIdx, val)}
          onSaved={() => handleSaved(clampedActiveIdx)}
          onClose={() => setTabs([])}
        />
      </div>
    );
  }
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /home/nicolas/agenthub/ui && npm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|✓|×|EditorPanel" | head -30
```

Expected: all EditorPanel tests PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/nicolas/agenthub && git add ui/src/EditorPanel.tsx ui/src/EditorPanel.test.tsx && git commit -m "feat(editor): add EditorPanel with tabs, resize, and localStorage width"
```

---

### Task 3: Add CSS for EditorPanel

**Files:**
- Modify: `ui/src/App.css`

**Interfaces:**
- Consumes: class names used in `EditorPanel.tsx` and `Editor.tsx`
  - `.editor-panel`, `.editor-resize-handle`, `.editor-tabs`, `.editor-tab`, `.editor-tab.active`, `.editor-tab-name`, `.editor-tab-dirty`, `.editor-tab-close`, `.file-drawer-header-wrapper`

- [ ] **Step 1: Add EditorPanel CSS to App.css**

Append to end of `ui/src/App.css`:

```css
/* ── EditorPanel ── */
.editor-panel {
  position: fixed; right: 0; top: 0; bottom: 0; z-index: 30;
  display: flex; flex-direction: column;
  background: #1e1e2e;
  border-left: 1px solid #3b3b52;
  box-shadow: -8px 0 32px rgba(0,0,0,.28);
}
.editor-resize-handle {
  position: absolute; left: 0; top: 0; bottom: 0; width: 6px;
  cursor: ew-resize; z-index: 1;
}
.editor-resize-handle:hover { background: rgba(99,102,241,0.3); }
.editor-tabs {
  display: flex; flex-direction: row;
  overflow-x: auto; flex-shrink: 0;
  height: 36px; min-height: 36px;
  background: #2a2a3d;
  border-bottom: 1px solid #3b3b52;
  scrollbar-width: none;
}
.editor-tabs::-webkit-scrollbar { display: none; }
.editor-tab {
  display: flex; align-items: center; gap: 5px;
  padding: 0 10px 0 12px; flex-shrink: 0;
  background: none; border: none; border-right: 1px solid #3b3b52;
  color: #6b7280; cursor: pointer; font: inherit; font-size: 12px;
  white-space: nowrap;
}
.editor-tab:hover { background: #323245; color: #a8afc4; }
.editor-tab.active { background: #44475a; color: #cdd6f4; }
.editor-tab-name { max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
.editor-tab-dirty { color: #f59e0b; font-size: 10px; }
.editor-tab-close {
  color: #6b7280; font-size: 14px; line-height: 1;
  padding: 0 2px; border-radius: 3px;
  cursor: pointer;
}
.editor-tab-close:hover { background: #3b3b52; color: #e5e7eb; }
/* Editor content wrapper (replaces .file-drawer structural role) */
.file-drawer-header-wrapper {
  display: flex; flex-direction: column; flex: 1; min-height: 0;
}
.file-drawer-header-wrapper .file-drawer-body { flex: 1; min-height: 0; overflow: auto; }
```

- [ ] **Step 2: Verify build (CSS loaded correctly)**

```bash
cd /home/nicolas/agenthub/ui && npm run build 2>&1 | tail -5
```

Expected: build succeeds (TypeScript still has App.tsx issues from old API — OK for now).

- [ ] **Step 3: Commit**

```bash
cd /home/nicolas/agenthub && git add ui/src/App.css && git commit -m "feat(editor): add EditorPanel CSS — tabs, resize handle, panel layout"
```

---

### Task 4: Wire App.tsx to use EditorPanel

**Files:**
- Modify: `ui/src/App.tsx`

**Interfaces:**
- Consumes from Task 2:
  ```typescript
  import { EditorPanel, EditorPanelHandle } from "./EditorPanel";
  // EditorPanel: forwardRef component
  // EditorPanelHandle: { openFile(root: string, path: string): void }
  // EditorPanelProps: { onActiveChange?: (root: string | null, path: string | null) => void }
  ```

- [ ] **Step 1: Rewrite App.tsx**

Replace `ui/src/App.tsx` entirely:

```typescript
import { useState, useRef } from "react";
import { AgentCanvas } from "./AgentCanvas";
import { EditorPanel, EditorPanelHandle } from "./EditorPanel";

export function App() {
  const editorPanelRef = useRef<EditorPanelHandle>(null);
  const [activeFile, setActiveFile] = useState<{ root: string; path: string } | null>(null);

  return (
    <div className="layout">
      <AgentCanvas
        onOpenFile={(root, path) => editorPanelRef.current?.openFile(root, path)}
        activeRoot={activeFile?.root}
        activePath={activeFile?.path}
      />
      <EditorPanel
        ref={editorPanelRef}
        onActiveChange={(root, path) =>
          setActiveFile(root && path ? { root, path } : null)
        }
      />
    </div>
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
cd /home/nicolas/agenthub/ui && npm test -- --reporter=verbose 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 3: Build to check TypeScript**

```bash
cd /home/nicolas/agenthub/ui && npm run build 2>&1 | tail -10
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd /home/nicolas/agenthub && git add ui/src/App.tsx && git commit -m "feat(editor): wire App.tsx to EditorPanel via ref — drop single-file state"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Overlay (not push) — `position: fixed` in `.editor-panel`
- ✅ Activate existing tab — `findIndex` check in `openFile`
- ✅ Panel closes on last tab — `tabs.length === 0` → return null
- ✅ Width persists localStorage — `STORAGE_KEY` on mouseup
- ✅ Word wrap default on — `wrap` state defaults to `true`
- ✅ Wrap toggle button — `[No Wrap / Wrap]` in Editor action bar
- ✅ Drag resize — `handleResizeMouseDown` + document listeners
- ✅ Min width 300, max = `window.innerWidth - 220`
- ✅ Tab bar scrollable — `overflow-x: auto` on `.editor-tabs`
- ✅ Dirty indicator ● — in tab + in Editor header
- ✅ `onActiveChange` callback drives FileTree highlight in App.tsx
- ✅ Save Ctrl+S — `handleSave` in Editor
- ✅ onSaved updates tab.content = tab.value → clears dirty

**Placeholder scan:** No TBDs. All steps have complete code.

**Type consistency check:**
- Task 1 produces `Editor({ value, dirty, onChange, onSaved, onClose })`
- Task 2 consumes exactly those props ✅
- Task 2 produces `EditorPanel` + `EditorPanelHandle`
- Task 4 consumes exactly `EditorPanelHandle.openFile` and `EditorPanelProps.onActiveChange` ✅
- `tabKey(root, path)` used consistently in Task 2 ✅
- `basename(path)` defined in both Editor.tsx and EditorPanel.tsx (intentional — each file self-contained) ✅
