import type { CanvasWidget } from "./sessions";
import { AGENT_PRESETS } from "./sessions";

export type CanvasTool = "select" | CanvasWidget["kind"];

type Props = {
  activeTool: CanvasTool;
  onToolChange: (tool: CanvasTool) => void;
  onAddTerminal: (presetId: string) => void;
};

const TOOLS: { id: CanvasTool; icon: string; label: string }[] = [
  { id: "select", icon: "↖", label: "Select" },
  { id: "notepad", icon: "📓", label: "Notepad" },
  { id: "text", icon: "T", label: "Text" },
  { id: "sticky", icon: "📌", label: "Sticky" },
];

export function CanvasToolbar({ activeTool, onToolChange, onAddTerminal }: Props) {
  return (
    <div className="canvas-dock">
      <div className="canvas-dock-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dock-btn${activeTool === t.id ? " active" : ""}`}
            onClick={() => onToolChange(t.id)}
            title={t.label}
          >
            <span className="dock-icon">{t.icon}</span>
          </button>
        ))}
      </div>
      <div className="dock-sep" />
      <div className="canvas-dock-group agents">
        {AGENT_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="dock-btn agent"
            style={{ "--chip": p.color } as React.CSSProperties}
            onClick={() => onAddTerminal(p.id)}
            title={`Add ${p.label}`}
          >
            <span className="dock-icon" style={{ color: p.color }}>
              {p.icon}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
