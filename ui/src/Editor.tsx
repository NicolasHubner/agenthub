import { useState, useEffect, useCallback } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { dracula } from "@uiw/codemirror-theme-dracula";
import { loadLanguage } from "@uiw/codemirror-extensions-langs";
import ReactMarkdown from "react-markdown";
import { saveFile } from "./api";

interface EditorProps {
  root: string;
  path: string;
  content: string;
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

export function Editor({ root, path, content, onClose }: EditorProps) {
  const [value, setValue] = useState(content);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  const isMarkdown = path.endsWith(".md");
  const ext = extFromPath(path);
  const lang = ext !== "text" ? loadLanguage(ext as Parameters<typeof loadLanguage>[0]) : null;
  const extensions = lang ? [lang] : [];

  const handleSave = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveFile(root, path, value);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [root, path, value, saving]);

  useEffect(() => {
    setValue(content);
    setDirty(false);
    setError(null);
    setPreview(false);
  }, [content, path]);

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

  const handleChange = useCallback((val: string) => {
    setValue(val);
    setDirty(true);
  }, []);

  return (
    <div className="file-drawer">
      <div className="file-drawer-header">
        <span className="file-drawer-path">
          {basename(path)}
          {dirty && <span style={{ color: "#f59e0b", marginLeft: 4 }}>●</span>}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
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
        <div style={{ padding: "6px 14px", fontSize: 12, color: "#f87171", background: "#2a1a1a" }}>
          {error}
        </div>
      )}
      <div className="file-drawer-body">
        {isMarkdown && preview ? (
          <div className="viewer markdown">
            <ReactMarkdown>{value}</ReactMarkdown>
          </div>
        ) : (
          <CodeMirror
            value={value}
            theme={dracula}
            extensions={extensions}
            onChange={handleChange}
            basicSetup={{ lineNumbers: true }}
            style={{ height: "100%" }}
          />
        )}
      </div>
    </div>
  );
}
