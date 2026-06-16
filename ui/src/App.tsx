import { useEffect, useState } from "react";
import { getFiles, getFile, type FileContent } from "./api";
import { AgentPanel } from "./AgentPanel";
import { FileTree } from "./FileTree";
import { Viewer } from "./Viewer";

type Tab = "agents" | "files";

export function App() {
  const [tab, setTab] = useState<Tab>("agents");
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
      <header className="topbar">
        <h1>AgentHub</h1>
        <nav>
          <button
            type="button"
            className={tab === "agents" ? "active" : ""}
            onClick={() => setTab("agents")}
          >
            Agents
          </button>
          <button
            type="button"
            className={tab === "files" ? "active" : ""}
            onClick={() => setTab("files")}
          >
            Files
          </button>
        </nav>
      </header>
      <div className="body">
        {tab === "agents" ? (
          <main className="content full">
            <AgentPanel />
          </main>
        ) : (
          <>
            <aside className="sidebar">
              {error && <p className="error">{error}</p>}
              <FileTree files={files} onSelect={open} />
            </aside>
            <main className="content">
              <Viewer file={selected} />
            </main>
          </>
        )}
      </div>
    </div>
  );
}
