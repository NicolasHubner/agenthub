import { useEffect, useState } from "react";
import { getFiles, getFile, type FileContent } from "./api";
import { FileTree } from "./FileTree";
import { Viewer } from "./Viewer";

export function App() {
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
      <aside className="sidebar">
        <h1>AgentHub</h1>
        {error && <p className="error">{error}</p>}
        <FileTree files={files} onSelect={open} />
      </aside>
      <main className="content">
        <Viewer file={selected} />
      </main>
    </div>
  );
}
