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

  async function handleOpenFile(root: string, path: string) {
    try {
      const { content } = await getFile(root, path);
      setOpenFile({ root, path, content });
    } catch {
      // ignore
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
    </div>
  );
}
