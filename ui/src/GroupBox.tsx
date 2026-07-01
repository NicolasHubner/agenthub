import { useRef } from "react";
import { useNodeDrag } from "./useNodeDrag";
import { GROUP_COLORS, type GroupBox as GroupBoxModel } from "./sessions";

type Props = {
  group: GroupBoxModel;
  selected: boolean;
  zoom: number;
  spaceHeld: boolean;
  screenToCanvas: (sx: number, sy: number) => { x: number; y: number };
  onDragStart: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Pick<GroupBoxModel, "title" | "color" | "titleScale">>) => void;
  onSelect: (id: string) => void;
};

export function GroupBox({
  group,
  selected,
  zoom,
  spaceHeld,
  screenToCanvas,
  onDragStart,
  onMove,
  onResize,
  onRemove,
  onUpdate,
  onSelect,
}: Props) {
  const { startDrag, startResize } = useNodeDrag({
    id: group.id,
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
    zoom,
    screenToCanvas,
    onMove,
    onResize,
    minWidth: 160,
    minHeight: 120,
  });

  function onHeaderMouseDown(e: React.MouseEvent) {
    if (spaceHeld) return;
    if ((e.target as HTMLElement).closest("button, input")) return;
    onSelect(group.id);
    onDragStart(group.id);
    startDrag(e);
  }

  const titleScale = group.titleScale ?? 1;
  const scaleDrag = useRef<{ startScale: number; startX: number } | null>(null);

  function onTitleResizeMouseDown(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    onSelect(group.id);
    scaleDrag.current = { startScale: titleScale, startX: e.clientX };
    function onMouseMove(ev: MouseEvent) {
      if (!scaleDrag.current) return;
      const dx = (ev.clientX - scaleDrag.current.startX) / zoom;
      const next = Math.min(4, Math.max(0.6, scaleDrag.current.startScale + dx / 100));
      onUpdate(group.id, { titleScale: next });
    }
    function onMouseUp() {
      scaleDrag.current = null;
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  return (
    <div
      className={`canvas-group${selected ? " selected" : ""}`}
      style={{
        left: group.x,
        top: group.y,
        width: group.width,
        height: group.height,
        borderColor: group.color,
        background: `color-mix(in srgb, ${group.color} 8%, transparent)`,
      }}
      onMouseDown={() => onSelect(group.id)}
    >
      <div
        className="group-header"
        onMouseDown={onHeaderMouseDown}
        style={{ borderColor: group.color, fontSize: `${16 * titleScale}px`, padding: `${6 * titleScale}px ${16 * titleScale}px`, gap: `${10 * titleScale}px` }}
      >
        <input
          className="group-title-input"
          value={group.title}
          onChange={(e) => onUpdate(group.id, { title: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="assunto"
          style={{ fontSize: "1em", width: `${180 * titleScale}px` }}
        />
        <div className="group-swatches" onMouseDown={(e) => e.stopPropagation()}>
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`group-swatch${group.color === c ? " active" : ""}`}
              style={{ background: c, width: `${18 * titleScale}px`, height: `${18 * titleScale}px` }}
              onClick={() => onUpdate(group.id, { color: c })}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <button type="button" className="node-close" onClick={() => onRemove(group.id)}>
          ×
        </button>
        <div className="group-title-resize" onMouseDown={onTitleResizeMouseDown} title="Arraste para redimensionar" />
      </div>
      <div className="resize-handle" onMouseDown={startResize} />
    </div>
  );
}
