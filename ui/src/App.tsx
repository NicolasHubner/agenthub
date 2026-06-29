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
