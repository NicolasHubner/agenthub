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
    <div className="editor-wrapper">
      <div className="editor-header">
        <span className="editor-filename">
          {basename(path)}
          {dirty && <span className="editor-dirty" aria-label="unsaved changes"> •</span>}
        </span>
        <div className="editor-actions">
          {isMarkdown && (
            <button onClick={() => setPreview((p) => !p)}>
              {preview ? "Edit" : "Preview"}
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
      {error && <div className="editor-error" role="alert">{error}</div>}
      {isMarkdown && preview ? (
        <div className="editor-preview">
          <ReactMarkdown>{value}</ReactMarkdown>
        </div>
      ) : (
        <CodeMirror
          value={value}
          theme={dracula}
          extensions={extensions}
          onChange={handleChange}
          basicSetup={{ lineNumbers: true }}
        />
      )}
    </div>
  );
}
