# Canvas Group Box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Excalidraw-style "group box" to the AgentHub canvas — a resizable, colorable, titled rectangle that geometrically groups terminals/widgets so dragging the box moves everything inside it.

**Architecture:** The canvas (`ui/src/AgentCanvas.tsx`) is 100% custom (absolute-positioned divs + one SVG for cables, no flow library). `GroupBox` is a new sibling data model to `TerminalSession`/`CanvasWidget`, rendered as its own absolute div layer beneath nodes/widgets (z-index 1). Membership is purely geometric: on drag-start the group snapshots which node/widget ids are fully contained in its rect; on every subsequent mousemove the same positional delta is applied to the box and to every snapshotted member. Persistence follows the existing `SessionSnapshot` → `PUT /sessions` debounced-save pattern (backend: `src/sessions.rs` / `src/routes.rs`).

**Tech Stack:** React 18 + TypeScript (Vite, Vitest, @testing-library/react) on the frontend; Rust (axum, serde) on the backend.

## Global Constraints

- Follow existing code style exactly: no new drag/canvas library, no new UI framework — plain divs, inline styles for position (`left/top/width/height`), CSS classes for everything else, same as `CanvasWidget.tsx` / `TerminalNode.tsx`.
- Frontend verification command: `cd ui && npx vitest run` for unit tests, `cd ui && npm run build` for typecheck + build.
- Backend verification command: `cargo test` and `cargo build` from repo root.
- Group membership is a **snapshot taken at drag-start**, not recalculated continuously during the drag (per design decision — a member that ends up partially outside after the move still moves with the group).
- Group box never gets a `data-node-id` attribute — that attribute is used elsewhere for cable-link target detection and must not treat the group box as a linkable node.

---

### Task 1: Backend — `GroupBox` model, snapshot field, route echo

**Files:**
- Modify: `src/sessions.rs:28-52` (add `GroupBox` struct, add `groups` field to `SessionSnapshot`)
- Modify: `src/routes.rs:196-214` (echo `groups` in the `/sessions` GET response)
- Test: `src/sessions.rs` (append to existing `#[cfg(test)] mod tests` block at line 97)

**Interfaces:**
- Produces: Rust struct `GroupBox { id: String, title: String, x: f64, y: f64, width: f64, height: f64, color: String }`, and `SessionSnapshot.groups: Vec<GroupBox>` (serde default, so old snapshots without the field still deserialize).

- [ ] **Step 1: Write the failing tests**

Append to the `mod tests` block in `src/sessions.rs` (after the existing `new_in_uses_dir_directly` test, before the closing `}` of the module):

```rust
    #[test]
    fn group_box_round_trips_through_json() {
        let g = GroupBox {
            id: "group-1".into(),
            title: "Auth work".into(),
            x: 10.0,
            y: 20.0,
            width: 300.0,
            height: 200.0,
            color: "#7c5cff".into(),
        };
        let json = serde_json::to_string(&g).unwrap();
        let back: GroupBox = serde_json::from_str(&json).unwrap();
        assert_eq!(g, back);
    }

    #[test]
    fn session_snapshot_groups_defaults_empty() {
        let snap: SessionSnapshot = serde_json::from_str("{}").unwrap();
        assert!(snap.groups.is_empty());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --lib sessions::tests`
Expected: FAIL to compile — `GroupBox` not found and `SessionSnapshot` has no field `groups`.

- [ ] **Step 3: Add the `GroupBox` struct and `groups` field**

In `src/sessions.rs`, insert after the `CanvasWidget` struct (currently ends at line 38) and before `SessionSnapshot` (currently starts at line 40):

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct GroupBox {
    pub id: String,
    pub title: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub color: String,
}
```

Then edit `SessionSnapshot` (currently `src/sessions.rs:40-52`) to add the field:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionSnapshot {
    #[serde(default)]
    pub terminals: Vec<TerminalSession>,
    #[serde(default)]
    pub widgets: Vec<CanvasWidget>,
    #[serde(default)]
    pub groups: Vec<GroupBox>,
    #[serde(default)]
    pub edges: Vec<[String; 2]>,
    #[serde(default, rename = "widgetEdges")]
    pub widget_edges: Vec<[String; 2]>,
    #[serde(default)]
    pub view: Option<CanvasView>,
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --lib sessions::tests`
Expected: PASS (4 tests: `new_in_uses_dir_directly`, `group_box_round_trips_through_json`, `session_snapshot_groups_defaults_empty`, plus any pre-existing).

- [ ] **Step 5: Echo `groups` in the GET /sessions response**

In `src/routes.rs`, the `get_sessions` handler (currently lines 196-214) builds a `json!({...})` body. Add a `"groups"` key:

```rust
async fn get_sessions(State(state): State<AppState>) -> Json<serde_json::Value> {
    let entry = state
        .registry
        .active_entry();
    let name = entry
        .as_ref()
        .map(|e| e.name.clone())
        .unwrap_or_else(|| "Workspace".into());
    let active = state.active.read().unwrap();
    let snap = active.sessions.get();
    Json(json!({
        "workspaceId": active.id.clone(),
        "workspace": name,
        "terminals": snap.terminals,
        "widgets": snap.widgets,
        "groups": snap.groups,
        "edges": snap.edges,
        "widgetEdges": snap.widget_edges,
        "view": snap.view,
    }))
}
```

`put_sessions` (`src/routes.rs:219+`) already deserializes the whole `SessionSnapshot` via the `Json<SessionSnapshot>` extractor and calls `sessions.save(body)`, so `groups` round-trips through PUT with no further changes.

- [ ] **Step 6: Build and run the full backend test suite**

Run: `cargo build && cargo test`
Expected: builds cleanly, all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sessions.rs src/routes.rs
git commit -m "feat: add GroupBox model and groups field to session snapshot"
```

---

### Task 2: Frontend — `GroupBox` type, colors, and `rectContains` geometry helper

**Files:**
- Modify: `ui/src/sessions.ts:15-34` (add `GroupBox` type, `groups` field on `SessionSnapshot`, `GROUP_COLORS` palette)
- Modify: `ui/src/canvasMath.ts` (add exported `rectContains`)
- Create: `ui/src/canvasMath.test.ts`

**Interfaces:**
- Produces: `GroupBox` type `{ id: string; title: string; x: number; y: number; width: number; height: number; color: string }`; `GROUP_COLORS: string[]`; `rectContains(outer: Rect, inner: Rect): boolean` from `./canvasMath`.

- [ ] **Step 1: Write the failing test**

Create `ui/src/canvasMath.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rectContains } from "./canvasMath";

describe("rectContains", () => {
  it("returns true when inner rect is fully inside outer rect", () => {
    const outer = { x: 0, y: 0, width: 400, height: 300 };
    const inner = { x: 50, y: 50, width: 100, height: 80 };
    expect(rectContains(outer, inner)).toBe(true);
  });

  it("returns false when inner rect extends past the right edge", () => {
    const outer = { x: 0, y: 0, width: 400, height: 300 };
    const inner = { x: 350, y: 50, width: 100, height: 80 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it("returns false when inner rect extends past the top edge", () => {
    const outer = { x: 100, y: 100, width: 400, height: 300 };
    const inner = { x: 150, y: 50, width: 50, height: 50 };
    expect(rectContains(outer, inner)).toBe(false);
  });

  it("treats an inner rect exactly matching outer bounds as contained", () => {
    const outer = { x: 0, y: 0, width: 200, height: 200 };
    expect(rectContains(outer, outer)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ui && npx vitest run src/canvasMath.test.ts`
Expected: FAIL — `rectContains` is not exported from `./canvasMath`.

- [ ] **Step 3: Implement `rectContains`**

In `ui/src/canvasMath.ts`, add after the `Rect` type (currently line 36):

```ts
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ui && npx vitest run src/canvasMath.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add `GroupBox` type, `groups` field, and color palette**

In `ui/src/sessions.ts`, add after the `CanvasWidget` type (currently lines 15-24, before `CanvasView` at line 26):

```ts
export type GroupBox = {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

export const GROUP_COLORS = ["#7c5cff", "#3b82f6", "#0d9488", "#f59e0b", "#ef4444", "#64748b"];
```

Then edit `SessionSnapshot` (currently lines 28-34) to add the field:

```ts
export type SessionSnapshot = {
  terminals: TerminalSession[];
  widgets?: CanvasWidget[];
  groups?: GroupBox[];
  edges: [string, string][];
  widgetEdges?: [string, string][];
  view?: CanvasView;
};
```

- [ ] **Step 6: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: no new errors (nothing consumes the new type/field yet, so this just confirms syntax is valid).

- [ ] **Step 7: Commit**

```bash
git add ui/src/sessions.ts ui/src/canvasMath.ts ui/src/canvasMath.test.ts
git commit -m "feat: add GroupBox type and rectContains geometry helper"
```

---

### Task 3: Frontend — `GroupBox` component (render, title, color, resize, delete) + CSS

**Files:**
- Create: `ui/src/GroupBox.tsx`
- Modify: `ui/src/App.css` (append group-box styles near the widget styles, after the `.widget-sticky .widget-editor` rule around line 429)

**Interfaces:**
- Consumes: `useNodeDrag` from `./useNodeDrag` (existing hook, signature: `{ id, x, y, width, height, zoom, screenToCanvas, onMove, onResize, minWidth?, minHeight? } → { startDrag, startResize }`); `GroupBox` type and `GROUP_COLORS` from `./sessions` (Task 2).
- Produces: `GroupBox` React component with props `{ group: GroupBoxModel; selected: boolean; zoom: number; spaceHeld: boolean; screenToCanvas: (sx: number, sy: number) => { x: number; y: number }; onDragStart: (id: string) => void; onMove: (id: string, x: number, y: number) => void; onResize: (id: string, width: number, height: number) => void; onRemove: (id: string) => void; onUpdate: (id: string, patch: Partial<Pick<GroupBoxModel, "title" | "color">>) => void; onSelect: (id: string) => void; }`. Note the `onDragStart` prop — called before `startDrag(e)` on header mousedown, so the parent can snapshot membership before any position changes.

- [ ] **Step 1: Create the component**

Create `ui/src/GroupBox.tsx`:

```tsx
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
```

- [ ] **Step 2: Add CSS**

Append to `ui/src/App.css`, after the `.widget-sticky .widget-editor { font-size: 14px; }` rule (currently line 429):

```css
/* ── Group box (Excalidraw-style frame) ── */
.canvas-group {
  position: absolute; z-index: 1;
  border: 2px solid #7c5cff; border-radius: 10px;
  display: flex; flex-direction: column;
}
.canvas-group.selected { outline: 2px solid #3b82f6; outline-offset: 2px; }
.group-header {
  position: absolute; top: -14px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 6px;
  background: var(--canvas-bg); border: 1px solid;
  border-radius: 999px; padding: 2px 8px;
  cursor: grab; user-select: none; max-width: 80%;
}
.group-header:active { cursor: grabbing; }
.group-title-input {
  border: none; background: transparent; outline: none;
  font: inherit; font-size: 12px; font-weight: 600; color: var(--text-primary);
  width: 120px;
}
.group-swatches { display: flex; gap: 3px; }
.group-swatch {
  width: 12px; height: 12px; border-radius: 50%; border: 1px solid rgba(0,0,0,.15);
  cursor: pointer; padding: 0;
}
.group-swatch.active { outline: 2px solid #111; outline-offset: 1px; }
.canvas-group-preview {
  position: absolute; z-index: 1;
  border: 2px dashed #7c5cff; border-radius: 10px;
  background: color-mix(in srgb, #7c5cff 8%, transparent);
  pointer-events: none;
}
```

(`.canvas-group-preview` is used by Task 5's draw-to-create preview — included here since it lives in the same visual family and this task owns `App.css` group styling.)

- [ ] **Step 3: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors (component isn't wired into `AgentCanvas.tsx` yet, so it's dead code but must compile standalone).

- [ ] **Step 4: Commit**

```bash
git add ui/src/GroupBox.tsx ui/src/App.css
git commit -m "feat: add GroupBox component with title, color, resize, and delete"
```

---

### Task 4: Frontend — add "group" tool to the canvas toolbar

**Files:**
- Modify: `ui/src/CanvasToolbar.tsx:4` (widen `CanvasTool` union), `ui/src/CanvasToolbar.tsx:12-17` (add toolbar entry)

**Interfaces:**
- Produces: `CanvasTool = "select" | "group" | CanvasWidget["kind"]` — later tasks switch on `activeTool === "group"`.

- [ ] **Step 1: Widen the `CanvasTool` type**

In `ui/src/CanvasToolbar.tsx`, change line 4:

```ts
export type CanvasTool = "select" | "group" | CanvasWidget["kind"];
```

- [ ] **Step 2: Add the toolbar button**

Change the `TOOLS` array (currently lines 12-17):

```ts
const TOOLS: { id: CanvasTool; icon: string; label: string }[] = [
  { id: "select", icon: "↖", label: "Select" },
  { id: "group", icon: "▭", label: "Group" },
  { id: "notepad", icon: "📓", label: "Notepad" },
  { id: "text", icon: "T", label: "Text" },
  { id: "sticky", icon: "📌", label: "Sticky" },
];
```

- [ ] **Step 3: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add ui/src/CanvasToolbar.tsx
git commit -m "feat: add group tool to canvas toolbar"
```

---

### Task 5: Frontend — draw-to-create flow in `AgentCanvas`

**Files:**
- Modify: `ui/src/AgentCanvas.tsx` (imports, state, `makeGroup`, `onViewportMouseDown`/`onViewportMouseMove`/`onViewportMouseUp`, preview render)

**Interfaces:**
- Consumes: `GroupBox` type (aliased `GroupBoxModel`) and `GROUP_COLORS` from `./sessions` (Task 2); `GroupBox` component from `./GroupBox` (Task 3); `"group"` tool from `CanvasTool` (Task 4); `.canvas-group-preview` CSS class (Task 3).
- Produces: `groups` state (consumed by Task 6's render/persistence wiring); `makeGroup(x, y, width, height): GroupBoxModel` helper.

- [ ] **Step 1: Add imports**

In `ui/src/AgentCanvas.tsx`, extend the `./sessions` import block (currently lines 31-43) to include `GROUP_COLORS` and the `GroupBox` type alias:

```ts
import {
  DEFAULT_TERM_HEIGHT,
  DEFAULT_TERM_WIDTH,
  DEFAULT_VIEW,
  fetchSessions,
  GROUP_COLORS,
  listTmuxSessions,
  presetById,
  saveSessions,
  WIDGET_DEFAULTS,
  type AgentPreset,
  type CanvasWidget as WidgetModel,
  type GroupBox as GroupBoxModel,
  type WidgetKind,
} from "./sessions";
```

Add a new import for the component, after the `CanvasWidget` import (currently line 12):

```ts
import { GroupBox } from "./GroupBox";
```

Also widen the `canvasMath` import (currently lines 2-10) to bring in `rectContains`:

```ts
import {
  cablePath,
  clamp,
  nextCanvasPosition,
  portPosition,
  rectContains,
  screenToCanvas,
  type CanvasView,
  type Rect,
} from "./canvasMath";
```

- [ ] **Step 2: Add a module-level id counter and `makeGroup` helper**

Next to `let nextWidgetId = 1;` (currently line 60), add:

```ts
let nextGroupId = 1;
```

After the `makeWidget` function (currently lines 95-108), add:

```ts
function makeGroup(x: number, y: number, width: number, height: number): GroupBoxModel {
  const n = nextGroupId++;
  return {
    id: `group-${n}`,
    title: "",
    x,
    y,
    width,
    height,
    color: GROUP_COLORS[0],
  };
}
```

- [ ] **Step 3: Add `groups` state and a draw-in-progress ref**

Next to `const [widgets, setWidgets] = useState<WidgetModel[]>([]);` (currently line 127), add:

```ts
  const [groups, setGroups] = useState<GroupBoxModel[]>([]);
```

Next to `const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);` (currently line 162), add:

```ts
  const drawRef = useRef<{ sx: number; sy: number } | null>(null);
  const [drawRect, setDrawRect] = useState<Rect | null>(null);
```

- [ ] **Step 4: Wire draw-to-create into the viewport mouse handlers**

Replace `onViewportMouseDown` (currently lines 702-721):

```ts
  function onViewportMouseDown(e: React.MouseEvent) {
    const spacePan = spaceHeld && e.button === 0;
    const middlePan = e.button === 1;
    if (spacePan || middlePan) {
      e.preventDefault();
      panRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        vx: viewRef.current.x,
        vy: viewRef.current.y,
      };
      setPanning(true);
      return;
    }

    if (e.button !== 0 || activeTool === "select") return;
    if ((e.target as HTMLElement).closest(".terminal-node, .canvas-widget, .canvas-group")) return;
    const pos = toCanvas(e.clientX, e.clientY);
    if (activeTool === "group") {
      drawRef.current = { sx: pos.x, sy: pos.y };
      setDrawRect({ x: pos.x, y: pos.y, width: 0, height: 0 });
      return;
    }
    addWidget(activeTool as WidgetKind, pos);
  }
```

Replace `onViewportMouseMove` (currently lines 723-731):

```ts
  function onViewportMouseMove(e: React.MouseEvent) {
    const pan = panRef.current;
    if (pan) {
      setView((v) => ({
        ...v,
        x: pan.vx + (e.clientX - pan.sx),
        y: pan.vy + (e.clientY - pan.sy),
      }));
      return;
    }
    if (drawRef.current) {
      const pos = toCanvas(e.clientX, e.clientY);
      const { sx, sy } = drawRef.current;
      setDrawRect({
        x: Math.min(sx, pos.x),
        y: Math.min(sy, pos.y),
        width: Math.abs(pos.x - sx),
        height: Math.abs(pos.y - sy),
      });
    }
  }
```

Replace `onViewportMouseUp` (currently lines 733-736):

```ts
  function onViewportMouseUp() {
    panRef.current = null;
    setPanning(false);
    if (drawRef.current) {
      drawRef.current = null;
      if (drawRect && drawRect.width > 24 && drawRect.height > 24) {
        const group = makeGroup(drawRect.x, drawRect.y, drawRect.width, drawRect.height);
        setGroups((gs) => [...gs, group]);
        setSelectedId(group.id);
      }
      setDrawRect(null);
      setActiveTool("select");
    }
  }
```

- [ ] **Step 5: Render the draw preview**

In the JSX, inside `.canvas-world`, immediately before the `<svg className="edge-layer" ...>` element (currently line 870), add:

```tsx
              {drawRect && (
                <div
                  className="canvas-group-preview"
                  style={{ left: drawRect.x, top: drawRect.y, width: drawRect.width, height: drawRect.height }}
                />
              )}
```

- [ ] **Step 6: Typecheck**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors. (`rectContains`, `GroupBox` component, and `groups` state are imported/declared but not fully consumed until Task 6 — if `tsc` flags unused imports, verify `tsconfig.json`'s `noUnusedLocals` setting; if it's on, this step will fail until Task 6 lands, so check `ui/tsconfig.json` before running — if `noUnusedLocals` is true, do Task 6 immediately after this step before committing.)

- [ ] **Step 7: Build and manually verify**

Run: `cd ui && npm run build`
Then start the dev server (`npm run dev` from `ui/`, or use the repo's own run/dev script) and in the browser: click the "Group" toolbar button, drag a rectangle on the canvas, release — a dashed preview should track the drag and a solid group box (with empty title placeholder "assunto") should remain after release, and the tool should revert to "Select".

- [ ] **Step 8: Commit**

```bash
git add ui/src/AgentCanvas.tsx
git commit -m "feat: draw-to-create group boxes on the canvas"
```

---

### Task 6: Frontend — move-with-children, resize/update/remove, render, persistence

**Files:**
- Modify: `ui/src/AgentCanvas.tsx` (membership snapshot ref, `moveGroup`/`resizeGroup`/`updateGroup`/`removeGroup`, JSX render of `<GroupBox>`, `allRects`, `reload`, save effect)

**Interfaces:**
- Consumes: `rectContains` (Task 2), `groups`/`setGroups`/`drawRect`/`makeGroup` (Task 5), `GroupBox` component (Task 3).
- Produces: fully working, persisted group boxes.

- [ ] **Step 1: Extend `allRects` to include group bounds**

Replace `allRects` (currently lines 110-115):

```ts
function allRects(nodes: NodeModel[], widgets: WidgetModel[], groups: GroupBoxModel[] = []): Rect[] {
  return [
    ...nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
    ...widgets.map((w) => ({ x: w.x, y: w.y, width: w.width, height: w.height })),
    ...groups.map((g) => ({ x: g.x, y: g.y, width: g.width, height: g.height })),
  ];
}
```

Update the three call sites to pass `groups`:
- `reconcileTmux` (currently line 241): `nextCanvasPosition(allRects(acc, widgets, groups), DEFAULT_TERM_WIDTH, DEFAULT_TERM_HEIGHT)` — and add `groups` to its `useCallback` dependency array (currently `[widgets]` at line 257 → `[widgets, groups]`).
- `addTerminal` (currently line 431): `nextCanvasPosition(allRects(ns, widgets, groups), DEFAULT_TERM_WIDTH, DEFAULT_TERM_HEIGHT)`.
- `addWidget` (currently line 442): `nextCanvasPosition(allRects(nodes, ws, groups), d.width, d.height)`.

- [ ] **Step 2: Add the membership-snapshot ref and group mutation callbacks**

After `resizeWidget` (currently lines 414-416, before `updateWidget`), add:

```ts
  const groupMembersRef = useRef<Record<string, { nodeIds: string[]; widgetIds: string[] }>>({});

  const onGroupDragStart = useCallback(
    (id: string) => {
      const group = groups.find((g) => g.id === id);
      if (!group) return;
      const box: Rect = { x: group.x, y: group.y, width: group.width, height: group.height };
      const nodeIds = nodes
        .filter((n) => rectContains(box, { x: n.x, y: n.y, width: n.width, height: n.height }))
        .map((n) => n.id);
      const widgetIds = widgets
        .filter((w) => rectContains(box, { x: w.x, y: w.y, width: w.width, height: w.height }))
        .map((w) => w.id);
      groupMembersRef.current[id] = { nodeIds, widgetIds };
    },
    [groups, nodes, widgets],
  );

  const moveGroup = useCallback((id: string, x: number, y: number) => {
    setGroups((gs) => {
      const g = gs.find((g) => g.id === id);
      if (!g) return gs;
      const dx = x - g.x;
      const dy = y - g.y;
      const members = groupMembersRef.current[id];
      if (members) {
        if (members.nodeIds.length > 0) {
          setNodes((ns) =>
            ns.map((n) => (members.nodeIds.includes(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)),
          );
        }
        if (members.widgetIds.length > 0) {
          setWidgets((ws) =>
            ws.map((w) => (members.widgetIds.includes(w.id) ? { ...w, x: w.x + dx, y: w.y + dy } : w)),
          );
        }
      }
      return gs.map((g2) => (g2.id === id ? { ...g2, x, y } : g2));
    });
  }, []);

  const resizeGroup = useCallback((id: string, width: number, height: number) => {
    setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, width, height } : g)));
  }, []);

  const updateGroup = useCallback(
    (id: string, patch: Partial<Pick<GroupBoxModel, "title" | "color">>) => {
      setGroups((gs) => gs.map((g) => (g.id === id ? { ...g, ...patch } : g)));
    },
    [],
  );

  function removeGroup(id: string) {
    setGroups((gs) => gs.filter((g) => g.id !== id));
    delete groupMembersRef.current[id];
    if (selectedId === id) setSelectedId(null);
  }
```

- [ ] **Step 3: Render `GroupBox` in the canvas**

In the JSX, inside `.canvas-world`, immediately after the closing `</svg>` tag (currently line 922) and before `{widgets.map((widget) => (` (currently line 924), add:

```tsx
              {groups.map((group) => (
                <GroupBox
                  key={group.id}
                  group={group}
                  selected={selectedId === group.id}
                  zoom={view.zoom}
                  spaceHeld={spaceHeld}
                  screenToCanvas={toCanvas}
                  onDragStart={onGroupDragStart}
                  onMove={moveGroup}
                  onResize={resizeGroup}
                  onRemove={removeGroup}
                  onUpdate={updateGroup}
                  onSelect={setSelectedId}
                />
              ))}

```

- [ ] **Step 4: Load `groups` in `reload()`**

In `reload` (currently lines 183-221), after the `widgets` block (currently lines 203-212, ending `} else { setWidgets([]); }`), add:

```ts
      if (data.groups?.length) {
        setGroups(data.groups);
        const maxG = data.groups.reduce((m, g) => {
          const n = parseInt(g.id.replace(/\D/g, ""), 10);
          return Number.isFinite(n) ? Math.max(m, n) : m;
        }, 0);
        nextGroupId = maxG + 1;
      } else {
        setGroups([]);
      }
```

- [ ] **Step 5: Save `groups` in the debounced persistence effect**

In the save effect (currently lines 394-400), add `groups` to the payload and the dependency array:

```ts
  useEffect(() => {
    if (!loaded || !workspaceId || workspaceId !== activeId) return;
    const t = setTimeout(() => {
      saveSessions({ terminals: nodes, widgets, groups, edges, widgetEdges, view }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, widgets, groups, edges, widgetEdges, view, loaded, workspaceId, activeId]);
```

- [ ] **Step 6: Typecheck and build**

Run: `cd ui && npx tsc --noEmit && npm run build`
Expected: no errors, build succeeds.

- [ ] **Step 7: Run the full frontend test suite**

Run: `cd ui && npx vitest run`
Expected: all existing tests plus `canvasMath.test.ts` PASS.

- [ ] **Step 8: Manual verification**

Start the dev server and, on the canvas:
1. Draw a group box around one or more existing terminal nodes/widgets (or add nodes inside an existing box) → confirm the box renders behind them.
2. Drag the group by its title header → confirm every node/widget that was fully inside the box moves with it.
3. Drag a node that is only partially inside a box, so it straddles the boundary, then drag the box → confirm that node does NOT move (not fully contained at drag-start).
4. Edit the title (type text into the header input) → confirm it persists after reloading the page.
5. Click a color swatch → confirm the border/background color changes and persists after reload.
6. Resize the box via the corner handle → confirm only the box resizes, member nodes/widgets stay in place.
7. Click the delete (×) button → confirm the box disappears and all member nodes/widgets remain on the canvas.

- [ ] **Step 9: Commit**

```bash
git add ui/src/AgentCanvas.tsx
git commit -m "feat: move-with-children drag, resize/color/delete, and persistence for group boxes"
```

---

## Post-plan check

After Task 6, re-run the full verification sweep from repo root:

```bash
cargo test && cargo build
cd ui && npx vitest run && npx tsc --noEmit && npm run build
```

All four commands must pass before considering the feature done.
