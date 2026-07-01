import { useState } from "react";
import { FileTree } from "./FileTree";
import type { CanvasWidget, TerminalSession } from "./sessions";
import { presetById } from "./sessions";
import type { SubagentSnapshot } from "./hub";
import type { FolderFiles } from "./api";
import type { WorkspaceEntry } from "./workspaces";

export type CanvasItem =
  | { type: "terminal"; id: string; label: string; icon: string; color: string }
  | { type: "widget"; id: string; label: string; icon: string; kind: CanvasWidget["kind"] };

type Props = {
  workspaceName: string;
  cwd: string;
  items: CanvasItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddWidget: (kind: CanvasWidget["kind"]) => void;
  onAddTerminal: () => void;
  folders: FolderFiles[];
  onOpenFile: (root: string, path: string) => void;
  activeRoot?: string;
  activePath?: string;
  onAddFolder: () => void;
  onRemoveFolder: (root: string) => void;
  subagents?: SubagentSnapshot[];
  workspaces: WorkspaceEntry[];
  activeId: string;
  onSwitchWorkspace: (id: string) => void;
  onDeleteWorkspace: (id: string) => void;
  onRenameWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
};

const WIDGET_TOOLS: { kind: CanvasWidget["kind"]; icon: string; label: string }[] = [
  { kind: "notepad", icon: "📓", label: "Notepad" },
  { kind: "text", icon: "T", label: "Text" },
  { kind: "sticky", icon: "📌", label: "Sticky" },
];

export function WorkspaceSidebar({
  workspaceName,
  cwd,
  items,
  selectedId,
  onSelect,
  onAddWidget,
  onAddTerminal,
  folders,
  onOpenFile,
  activeRoot,
  activePath,
  onAddFolder,
  onRemoveFolder,
  subagents = [],
  workspaces,
  activeId,
  onSwitchWorkspace,
  onDeleteWorkspace,
  onRenameWorkspace,
  onNewWorkspace,
}: Props) {
  const [filesOpen, setFilesOpen] = useState(false);
  const terminals = items.filter((i) => i.type === "terminal");
  const widgets = items.filter((i) => i.type === "widget");

  return (
    <aside className="ws-sidebar">
      <div className="ws-sidebar-head">
        <span className="ws-sidebar-label">Workspaces</span>
      </div>

      <div className="ws-list">
        {workspaces.map((w) => {
          const lastDir = w.folders[w.folders.length - 1];
          const shortName = lastDir ? lastDir.split('/').filter(Boolean).pop() || '/' : '';
          return (
            <button
              key={w.id}
              type="button"
              className={`ws-active${w.id === activeId ? " current" : ""}`}
              onClick={() => onSwitchWorkspace(w.id)}
              title={w.folders.join("\n")}
            >
              <span className="ws-dot" />
              <div className="ws-active-info">
                <strong>{w.name}</strong>
                <span className="ws-cwd">{shortName}</span>
              </div>
              {w.id === activeId && <span className="ws-count">{items.length}</span>}
              <span
                className="ws-rename"
                role="button"
                tabIndex={0}
                title="Rename workspace"
                onClick={(e) => { e.stopPropagation(); onRenameWorkspace(w.id); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onRenameWorkspace(w.id); } }}
              >
                Aa
              </span>
              {workspaces.length > 1 && (
                <span
                  className="ws-delete"
                  role="button"
                  tabIndex={0}
                  title="Delete workspace"
                  onClick={(e) => { e.stopPropagation(); onDeleteWorkspace(w.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDeleteWorkspace(w.id); } }}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
        <button type="button" className="ws-new" onClick={onNewWorkspace}>+ New workspace</button>
      </div>

      <div className="ws-section">
        <div className="ws-section-title">Add to canvas</div>
        <div className="ws-tool-grid">
          {WIDGET_TOOLS.map((t) => (
            <button
              key={t.kind}
              type="button"
              className="ws-tool-btn"
              onClick={() => onAddWidget(t.kind)}
              title={`Add ${t.label}`}
            >
              <span className="ws-tool-icon">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          ))}
          <button type="button" className="ws-tool-btn" onClick={onAddTerminal} title="Add Shell">
            <span className="ws-tool-icon">▸</span>
            <span>Shell</span>
          </button>
        </div>
      </div>

      {terminals.length > 0 && (
        <div className="ws-section">
          <div className="ws-section-title">Agents</div>
          <ul className="ws-item-list">
            {terminals.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`ws-item${selectedId === item.id ? " active" : ""}`}
                  onClick={() => onSelect(item.id)}
                  style={{ '--agent-color': item.color } as React.CSSProperties}
                >
                  <span className="ws-item-icon" style={{ color: item.color }}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {widgets.length > 0 && (
        <div className="ws-section">
          <div className="ws-section-title">Notes</div>
          <ul className="ws-item-list">
            {widgets.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`ws-item${selectedId === item.id ? " active" : ""}`}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="ws-item-icon">{item.icon}</span>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {subagents.length > 0 && (
        <div className="ws-section">
          <div className="ws-section-title">Running</div>
          <ul className="ws-item-list">
            {subagents.map((sa) => (
              <li key={sa.id}>
                <div className="ws-subagent">
                  <span className={`ws-subagent-dot ws-subagent-dot--${sa.status}`} />
                  <span className="ws-subagent-label">{sa.label || "Subagent"}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {items.length === 0 && (
        <p className="ws-empty">Add a note or agent from above</p>
      )}

      <div className="ws-section ws-files-section">
        <div className="ws-files-head">
          <button
            type="button"
            className="ws-section-title ws-files-toggle"
            onClick={() => setFilesOpen((o) => !o)}
          >
            <span>Files</span>
            <span className="ws-files-chevron">{filesOpen ? "▾" : "▸"}</span>
          </button>
          <button
            type="button"
            className="ws-files-add"
            onClick={onAddFolder}
            title="Add a folder to Files"
          >
            +
          </button>
        </div>
        {filesOpen && (
          <div className="ws-file-tree">
            {folders.length > 0 ? (
              <FileTree folders={folders} onSelect={onOpenFile} onRemoveFolder={onRemoveFolder} activeRoot={activeRoot} activePath={activePath} />
            ) : (
              <p className="ws-empty">No folders — click + to add one</p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

export function buildCanvasItems(
  terminals: TerminalSession[],
  widgets: CanvasWidget[],
): CanvasItem[] {
  const items: CanvasItem[] = terminals.map((t) => {
    const p = presetById(t.preset);
    return {
      type: "terminal" as const,
      id: t.id,
      label: p.label,
      icon: p.icon,
      color: p.color,
    };
  });
  for (const w of widgets) {
    const icons = { notepad: "📓", text: "T", sticky: "📌" };
    items.push({
      type: "widget",
      id: w.id,
      label: w.title || (w.kind === "notepad" ? "Notepad" : w.kind === "text" ? "Text" : "Sticky"),
      icon: icons[w.kind],
      kind: w.kind,
    });
  }
  return items;
}
