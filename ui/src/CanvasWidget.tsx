import { useNodeDrag } from "./useNodeDrag";
import type { CanvasWidget as WidgetModel } from "./sessions";

const KIND_META: Record<WidgetModel["kind"], { icon: string; label: string; className: string }> = {
  notepad: { icon: "📓", label: "Notepad", className: "widget-notepad" },
  text: { icon: "T", label: "Text", className: "widget-text" },
  sticky: { icon: "📌", label: "Sticky", className: "widget-sticky" },
};

type Props = {
  widget: WidgetModel;
  selected: boolean;
  zoom: number;
  spaceHeld: boolean;
  linking?: boolean;
  screenToCanvas: (sx: number, sy: number) => { x: number; y: number };
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<WidgetModel, "title" | "content">>) => void;
  onSelect: (id: string) => void;
};

export function CanvasWidget({
  widget,
  selected,
  zoom,
  spaceHeld,
  linking,
  screenToCanvas,
  onMove,
  onResize,
  onRemove,
  onUpdate,
  onSelect,
}: Props) {
  const meta = KIND_META[widget.kind];
  const { startDrag, startResize } = useNodeDrag({
    id: widget.id,
    x: widget.x,
    y: widget.y,
    width: widget.width,
    height: widget.height,
    zoom,
    screenToCanvas,
    onMove,
    onResize,
    minWidth: widget.kind === "sticky" ? 140 : 180,
    minHeight: widget.kind === "text" ? 72 : 120,
  });

  function onHeaderMouseDown(e: React.MouseEvent) {
    if (spaceHeld) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    onSelect(widget.id);
    startDrag(e);
  }

  return (
    <div
      className={`canvas-widget ${meta.className}${selected ? " selected" : ""}${linking ? " link-target" : ""}`}
      style={{ left: widget.x, top: widget.y, width: widget.width, height: widget.height }}
      data-node-id={widget.id}
      onMouseDown={() => onSelect(widget.id)}
    >
      <div className="widget-header" onMouseDown={onHeaderMouseDown}>
        <span className="widget-icon">{meta.icon}</span>
        <input
          className="widget-title-input"
          value={widget.title}
          onChange={(e) => onUpdate(widget.id, { title: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder={meta.label}
        />
        <button type="button" className="node-close" onClick={() => onRemove(widget.id)}>
          ×
        </button>
      </div>
      <div className="widget-body">
        {widget.kind === "text" ? (
          <input
            className="widget-text-field"
            value={widget.content}
            onChange={(e) => onUpdate(widget.id, { content: e.target.value })}
            placeholder="Type here…"
          />
        ) : (
          <textarea
            className="widget-editor"
            value={widget.content}
            onChange={(e) => onUpdate(widget.id, { content: e.target.value })}
            placeholder={widget.kind === "sticky" ? "Quick note…" : "Write notes…"}
          />
        )}
      </div>
      <div className="resize-handle" onMouseDown={startResize} />
      {linking && <div className="widget-port" />}
    </div>
  );
}
