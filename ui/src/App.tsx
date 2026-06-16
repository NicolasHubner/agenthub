import { useEffect, useState } from "react";
import { getFiles, getFile, type FileContent } from "./api";
import { AgentCanvas } from "./AgentCanvas";
import { FileTree } from "./FileTree";
import { Viewer } from "./Viewer";

type Tab = "canvas" | "files";

export function App() {
  const [tab, setTab] = useState<Tab>("canvas");
  const [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState<FileContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getFiles().then(setFiles).catch((e) => setError(String(e)));
  }, []);

  async function open(path: string) {
    try {
      setSelected(await getFile(path));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="layout">
      {tab === "canvas" ? (
        <AgentCanvas />
      ) : (
        <>
          <header className="files-bar">
            <button type="button" onClick={() => setTab("canvas")}>
              ← Canvas
            </button>
            <h1>Files</h1>
          </header>
          <div className="body">
            <aside className="sidebar">
              {error && <p className="error">{error}</p>}
              <FileTree files={files} onSelect={open} />
            </aside>
            <main className="content files-pane">
              <Viewer file={selected} />
            </main>
          </div>
        </>
      )}
      {tab === "canvas" && (
        <button type="button" className="files-fab" onClick={() => setTab("files")} title="Files">
          📄
        </button>
      )}
    </div>
  );
}
