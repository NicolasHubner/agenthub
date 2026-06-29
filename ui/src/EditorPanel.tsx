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
          setActiveIdx(tabsRef.current.length); // length before push = index of new tab
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
      setTabs((prev) => prev.filter((_, i) => i !== idx));
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

    const clampedActiveIdx = tabs[activeIdx] ? activeIdx : 0;
    const activeTab = tabs[clampedActiveIdx];

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
          showPath={false}
        />
      </div>
    );
  }
);
