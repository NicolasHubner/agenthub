import { useState } from "react";
import { getFile } from "./api";
import { AgentCanvas } from "./AgentCanvas";
import { Editor } from "./Editor";

interface OpenFile {
  root: string;
  path: string;
  content: string;
}

export function App() {
  const [openFile, setOpenFile] = useState<OpenFile | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  async function handleOpenFile(root: string, path: string) {
    try {
      const fc = await getFile(root, path);
      setOpenFile({ root, path, content: fc.content });
      setOpenError(null);
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : "Failed to open file");
    }
  }

  return (
    <div className="layout">
      <AgentCanvas onOpenFile={handleOpenFile} />
      {openFile && (
        <Editor
          root={openFile.root}
          path={openFile.path}
          content={openFile.content}
          onClose={() => setOpenFile(null)}
        />
      )}
      {openError && (
        <div className="open-error" role="alert" onClick={() => setOpenError(null)}>
          {openError}
        </div>
      )}
    </div>
  );
}
