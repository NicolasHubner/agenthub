import { useState, useRef, useCallback } from "react";
import { AgentCanvas } from "./AgentCanvas";
import { EditorPanel, EditorPanelHandle } from "./EditorPanel";

export function App() {
  const editorPanelRef = useRef<EditorPanelHandle>(null);
  const [activeFile, setActiveFile] = useState<{ root: string; path: string } | null>(null);

  const handleActiveChange = useCallback((root: string | null, path: string | null) => {
    setActiveFile(prev => {
      if (!root || !path) return null;
      if (prev?.root === root && prev?.path === path) return prev;
      return { root, path };
    });
  }, []);

  return (
    <div className="layout">
      <AgentCanvas
        onOpenFile={(root, path) => editorPanelRef.current?.openFile(root, path)}
        activeRoot={activeFile?.root}
        activePath={activeFile?.path}
      />
      <EditorPanel
        ref={editorPanelRef}
        onActiveChange={handleActiveChange}
      />
    </div>
  );
}
