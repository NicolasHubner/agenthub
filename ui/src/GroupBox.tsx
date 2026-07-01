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
  onUpdate: (id: string, patch: Partial<Pick<GroupBoxModel, "title" | "color">>) => void;
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
      <div className="group-header" onMouseDown={onHeaderMouseDown} style={{ borderColor: group.color }}>
        <input
          className="group-title-input"
          value={group.title}
          onChange={(e) => onUpdate(group.id, { title: e.target.value })}
          onMouseDown={(e) => e.stopPropagation()}
          placeholder="assunto"
        />
        <div className="group-swatches" onMouseDown={(e) => e.stopPropagation()}>
          {GROUP_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`group-swatch${group.color === c ? " active" : ""}`}
              style={{ background: c }}
              onClick={() => onUpdate(group.id, { color: c })}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <button type="button" className="node-close" onClick={() => onRemove(group.id)}>
          ×
        </button>
      </div>
      <div className="resize-handle" onMouseDown={startResize} />
    </div>
  );
}
