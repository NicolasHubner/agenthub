# Editor Panel — Tabs, Resize, Word Wrap

Date: 2026-06-29  
Status: Approved

## Context

The existing `Editor.tsx` is a `position: fixed` right-side overlay with fixed width (`min(520px, 46vw)`), no tabs, no resize, and single-file state managed in `App.tsx`. The goal is to make it a resizable, tabbed panel — closer to an IDE editor.

## Decisions

- **Layout**: overlay (not push) — canvas stays behind the panel
- **Duplicate tabs**: activates existing tab, never duplicates
- **Last tab closed**: panel closes automatically
- **Width**: persists in `localStorage("editor-panel-width")`, default 520px
- **Word wrap**: on by default, togglable per-session via button in header

## Architecture

Three files change:

| File | Role |
|------|------|
| `EditorPanel.tsx` (new) | Owns tabs state, resize logic, localStorage, renders tab bar + Editor |
| `Editor.tsx` (modified) | Becomes controlled (value/onChange/dirty/onSaved); no tab awareness |
| `App.tsx` (modified) | Drops `openFile` state; holds `editorPanelRef` and calls `openFile()` on it |

### Tab state

```typescript
interface Tab {
  root: string;
  path: string;
  content: string;  // original from server (used to compute dirty)
  value: string;    // current edited value
  dirty: boolean;   // value !== content
}
```

### EditorPanel public API (via useImperativeHandle)

```typescript
export interface EditorPanelHandle {
  openFile(root: string, path: string): void;
}
```

`openFile` fetches content via `getFile(root, path)`. If a tab for that `root+path` already exists, it activates that tab (no fetch). Otherwise it pushes a new tab and activates it.

### App.tsx usage

```typescript
const editorPanelRef = useRef<EditorPanelHandle>(null);
// ...
<AgentCanvas onOpenFile={(r, p) => editorPanelRef.current?.openFile(r, p)} ... />
<EditorPanel ref={editorPanelRef} />
```

## Resize

- 6px `div.editor-resize-handle` on the left edge of the panel, `cursor: ew-resize`
- `mousedown` → attaches `mousemove` + `mouseup` to `document`
- `width = clamp(300, window.innerWidth - e.clientX, window.innerWidth - 220)` (220 = left sidebar width)
- `mouseup` → detaches listeners, saves width to `localStorage`
- Width restored from localStorage on mount; falls back to 520

## Tab Bar

Horizontal scrollable row at the top of the panel (above the editor header):

```
[icon] App.tsx ●  [×]    [icon] README.md  [×]    [icon] pty.rs  [×]
```

- Active tab: `background: #44475a` (Dracula selection)
- `●` yellow = dirty (unsaved changes)
- `×` closes tab; closing last tab hides the panel
- Overflow: `overflow-x: auto`, `flex-shrink: 0` on each tab
- File icon color from extension (reuse FileTree extension color map)

## Editor Header (action bar)

Buttons in order: `[Wrap ↕]` `[Preview]` `[Save]` `[✕ close panel]`

- **Wrap**: toggles `EditorView.lineWrapping` CodeMirror extension; on by default; label toggles between `Wrap` / `No Wrap`
- **Preview**: only shown for `.md` files; toggles markdown preview
- **Save**: saves current tab; disabled when not dirty; Ctrl+S shortcut
- **✕**: closes the entire panel (clears all tabs)

## Editor.tsx changes

Convert from uncontrolled to controlled:

```typescript
interface EditorProps {
  root: string;
  path: string;
  value: string;          // controlled value (was: content)
  dirty: boolean;         // from parent (was: internal state)
  onChange: (v: string) => void;
  onSaved: () => void;    // called after successful save; parent sets content=value to clear dirty
  onClose: () => void;    // closes panel
}
```

Internal state retained: `saving`, `error`, `preview`, `wrap`.  
Remove: internal `value` useState, internal `dirty` useState.

On save success → call `onSaved()` → EditorPanel sets `tab.content = tab.value` → dirty becomes false.

## CSS additions

```
.editor-panel          — replaces .file-drawer; position: fixed; right: 0; top: 0; bottom: 0
.editor-resize-handle  — 6px left strip; cursor: ew-resize
.editor-tabs           — horizontal scrollable tab bar; height: 36px
.editor-tab            — individual tab; flex-shrink: 0; padding: 0 10px
.editor-tab.active     — background: #44475a
.editor-tab-name       — filename text
.editor-tab-dirty      — yellow ● dot
.editor-tab-close      — × button; hover: visible
```

`.file-drawer` CSS kept for backward compat (no other consumers, can be removed after).

## Out of scope

- Split panes (two editors side by side)
- Drag-to-reorder tabs
- Tab persistence across page reload
