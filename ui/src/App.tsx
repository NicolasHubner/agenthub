import { useEffect, useState } from "react";
import { getFiles, getFile, type FileContent } from "./api";
import { AgentCanvas } from "./AgentCanvas";
import { Viewer } from "./Viewer";

export function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<FileContent | null>(null);

  useEffect(() => {
    getFiles().then(setFiles).catch(() => {});
  }, []);

  async function openFile(path: string) {
    try {
      setSelected(await getFile(path));
    } catch {
      // ignore
    }
  }

  return (
    <div className="layout">
      <AgentCanvas files={files} onOpenFile={openFile} />
      {selected && (
        <div className="file-drawer">
          <div className="file-drawer-header">
            <span className="file-drawer-path" title={selected.path}>
              {selected.path}
            </span>
            <button
              type="button"
              className="file-drawer-close"
              onClick={() => setSelected(null)}
              aria-label="Close file viewer"
            >
              ✕
            </button>
          </div>
          <div className="file-drawer-body">
            <Viewer file={selected} />
          </div>
        </div>
      )}
    </div>
  );
}
