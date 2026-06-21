import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cablePath,
  clamp,
  nextCanvasPosition,
  portPosition,
  screenToCanvas,
  type CanvasView,
  type Rect,
} from "./canvasMath";
import { CanvasToolbar, type CanvasTool } from "./CanvasToolbar";
import { CanvasWidget } from "./CanvasWidget";
import {
  cycleSelection,
  isModifierKey,
  isPrefixChord,
  jumpSelection,
  resolvePrefixCommand,
  spatialNavigate,
  type Box,
} from "./keymap";
import {
  connectHub,
  hubConnect,
  hubDisconnect,
  type SubagentSnapshot,
  type HubConnection,
  type HubEvent,
} from "./hub";
import { TerminalNode, type NodeModel } from "./TerminalNode";
import {
  DEFAULT_TERM_HEIGHT,
  DEFAULT_TERM_WIDTH,
  DEFAULT_VIEW,
  fetchSessions,
  presetById,
  saveSessions,
  WIDGET_DEFAULTS,
  type AgentPreset,
  type CanvasWidget as WidgetModel,
  type WidgetKind,
} from "./sessions";
import { buildCanvasItems, WorkspaceSidebar } from "./WorkspaceSidebar";
import { getFolders, type FolderFiles } from "./api";
import {
  listWorkspaces,
  switchWorkspace,
  createWorkspace,
  removeWorkspace,
  connectFolder,
  disconnectFolder,
  type WorkspaceEntry,
} from "./workspaces";
import { DirectoryPicker } from "./DirectoryPicker";

let nextId = 1;
let nextWidgetId = 1;

const AGENT_NAMES = [
  "alpha", "bravo", "tango", "delta", "echo", "foxtrot", "golf", "hotel",
  "juliet", "kilo", "lima", "mike", "oscar", "papa", "romeo", "sierra",
  "victor", "whiskey", "zulu", "nova", "vega", "orion", "lyra", "atlas",
  "phoenix", "cygnus", "hydra", "draco", "aquila", "corvus", "lupus",
];

function pickName(existing: string[]): string {
  const used = new Set(existing);
  const available = AGENT_NAMES.filter((n) => !used.has(n));
  const pool = available.length > 0 ? available : AGENT_NAMES;
  return pool[Math.floor(Math.random() * pool.length)];
}

function makeNode(preset: AgentPreset, cwd: string, x: number, y: number, existingNames: string[]): NodeModel {
  const n = nextId++;
  return {
    id: `node-${n}`,
    name: pickName(existingNames),
    command: preset.command,
    preset: preset.id,
    cwd,
    x,
    y,
    width: DEFAULT_TERM_WIDTH,
    height: DEFAULT_TERM_HEIGHT,
  };
}

function makeWidget(kind: WidgetKind, x: number, y: number): WidgetModel {
  const n = nextWidgetId++;
  const d = WIDGET_DEFAULTS[kind];
  return {
    id: `widget-${n}`,
    kind,
    title: d.title,
    content: "",
    x,
    y,
    width: d.width,
    height: d.height,
  };
}

function allRects(nodes: NodeModel[], widgets: WidgetModel[]): Rect[] {
  return [
    ...nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
    ...widgets.map((w) => ({ x: w.x, y: w.y, width: w.width, height: w.height })),
  ];
}

interface AgentCanvasProps {
  onOpenFile: (root: string, path: string) => void;
}

export function AgentCanvas({ onOpenFile }: AgentCanvasProps) {
  const hubRef = useRef<HubConnection | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<NodeModel[]>([]);
  const [widgets, setWidgets] = useState<WidgetModel[]>([]);
  const [edges, setEdges] = useState<[string, string][]>([]);
  const [widgetEdges, setWidgetEdges] = useState<[string, string][]>([]);
  const nodesRef = useRef<NodeModel[]>([]);
  nodesRef.current = nodes;
  const widgetsRef = useRef<WidgetModel[]>([]);
  widgetsRef.current = widgets;
  const widgetEdgesRef = useRef<[string, string][]>([]);
  widgetEdgesRef.current = widgetEdges;
  const [subagents, setSubagents] = useState<SubagentSnapshot[]>([]);
  const [pendingEdges, setPendingEdges] = useState<[string, string][]>([]);
  const savedEdgesRef = useRef<[string, string][]>([]);
  const [status, setStatus] = useState<"open" | "closed" | "error">("closed");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const linkFromRef = useRef<string | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [picker, setPicker] = useState<null | "new" | "folder" | "spawn">(null);
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null);
  const [view, setView] = useState<CanvasView>(DEFAULT_VIEW);
  const [loaded, setLoaded] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [folders, setFolders] = useState<FolderFiles[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [prefixActive, setPrefixActive] = useState(false);
  const prefixActiveRef = useRef(false);
  const prefixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const toCanvas = useCallback(
    (sx: number, sy: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return screenToCanvas(sx, sy, rect, view);
    },
    [view],
  );

  const loadWorkspaces = useCallback(async () => {
    try {
      const { active, workspaces: list } = await listWorkspaces();
      setActiveId(active);
      setWorkspaces(list);
    } catch { /* ignore */ }
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await fetchSessions();
      const parts = data.workspace.split("/").filter(Boolean);
      setWorkspaceName(parts[parts.length - 1] || "Workspace");
      if (data.terminals.length > 0) {
        setNodes(
          data.terminals.map((t) => ({
            ...t,
            preset: t.preset || presetById("bash").id,
          })),
        );
        const max = data.terminals.reduce((m, t) => {
          const n = parseInt(t.id.replace(/\D/g, ""), 10);
          return Number.isFinite(n) ? Math.max(m, n) : m;
        }, 0);
        nextId = max + 1;
      } else {
        setNodes([]);
      }
      if (data.widgets?.length) {
        setWidgets(data.widgets);
        const maxW = data.widgets.reduce((m, w) => {
          const n = parseInt(w.id.replace(/\D/g, ""), 10);
          return Number.isFinite(n) ? Math.max(m, n) : m;
        }, 0);
        nextWidgetId = maxW + 1;
      } else {
        setWidgets([]);
      }
      if (data.edges) { setPendingEdges(data.edges); savedEdgesRef.current = data.edges; }
      else { setPendingEdges([]); savedEdgesRef.current = []; }
      if (data.widgetEdges?.length) setWidgetEdges(data.widgetEdges);
      else setWidgetEdges([]);
      if (data.view) setView(data.view);
    } catch { /* ignore */ }
    finally { setLoaded(true); }
    getFolders().then(setFolders).catch(() => {});
  }, []);

  useEffect(() => { void reload(); void loadWorkspaces(); }, [reload, loadWorkspaces]);

  async function handleSwitch(id: string) {
    if (id === activeId) return;
    await switchWorkspace(id);
    setActiveId(id);
    await reload();
    await loadWorkspaces();
  }

  const activeFolders = workspaces.find((w) => w.id === activeId)?.folders ?? [];

  async function handleNewWorkspace(dir: string) {
    await createWorkspace(dir);
    setPicker(null);
    await reload();
    await loadWorkspaces();
  }

  async function handleDeleteWorkspace(id: string) {
    if (workspaces.length <= 1) return;
    if (!window.confirm("Delete this workspace?")) return;
    await removeWorkspace(id);
    if (id === activeId) {
      const next = workspaces.find((w) => w.id !== id);
      if (next) {
        await switchWorkspace(next.id);
        setActiveId(next.id);
        await reload();
      }
    }
    await loadWorkspaces();
  }

  const ensureFolder = useCallback(async (dir: string) => {
    if (!activeFolders.includes(dir)) {
      await connectFolder(activeId, dir);
      await loadWorkspaces();
      await reload();
    }
  }, [activeFolders, activeId, loadWorkspaces, reload]);

  const handleAddFolder = useCallback(async (dir: string) => {
    setPicker(null);
    await connectFolder(activeId, dir);
    await loadWorkspaces();
    await reload();
  }, [activeId, loadWorkspaces, reload]);

  const handleRemoveFolder = useCallback(async (root: string) => {
    await disconnectFolder(activeId, root);
    await loadWorkspaces();
    await reload();
  }, [activeId, loadWorkspaces, reload]);

  useEffect(() => {
    const hub = connectHub(
      (ev: HubEvent) => {
        if (ev.type === "state") {
          setEdges(ev.edges);
          setSubagents(ev.subagents ?? []);
          setConnectError(null);
          // Retry any saved edges not yet established (agents may not have registered yet)
          const ws = hubRef.current?.ws;
          if (ws && ws.readyState === WebSocket.OPEN && savedEdgesRef.current.length > 0) {
            const missing = savedEdgesRef.current.filter(
              ([a, b]) => !ev.edges.some(([ea, eb]) => (ea === a && eb === b) || (ea === b && eb === a)),
            );
            if (missing.length > 0) missing.forEach(([a, b]) => hubConnect(ws, a, b));
            else savedEdgesRef.current = [];
          }
        } else if (ev.type === "error") {
          setConnectError(ev.reason);
        } else if (ev.type === "widget_update") {
          const currentNodes = nodesRef.current;
          const currentWidgetEdges = widgetEdgesRef.current;
          let targetId: string | undefined;
          if (ev.to) {
            targetId = widgetsRef.current.find((w) => w.title === ev.to)?.id;
          } else {
            const fromNode = currentNodes.find((n) => n.name === ev.from);
            if (fromNode) {
              targetId = currentWidgetEdges.find(([nid]) => nid === fromNode.id)?.[1];
            }
          }
          if (targetId) {
            const wid = targetId;
            const { content, mode } = ev;
            setWidgets((ws) =>
              ws.map((w) => {
                if (w.id !== wid) return w;
                const next = mode === "replace" ? content : w.content ? w.content + "\n" + content : content;
                return { ...w, content: next };
              }),
            );
          }
        }
      },
      setStatus,
    );
    hubRef.current = hub;
    return () => hub.close();
  }, []);

  useEffect(() => {
    if (status !== "open" || pendingEdges.length === 0) return;
    const ws = hubRef.current?.ws;
    if (!ws) return;
    for (const [a, b] of pendingEdges) hubConnect(ws, a, b);
    setPendingEdges([]);
  }, [status, pendingEdges]);

  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      saveSessions({ terminals: nodes, widgets, edges, widgetEdges, view }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, widgets, edges, widgetEdges, view, loaded]);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, x, y } : n)));
  }, []);

  const resizeNode = useCallback((id: string, width: number, height: number) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, width, height } : n)));
  }, []);

  const moveWidget = useCallback((id: string, x: number, y: number) => {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, x, y } : w)));
  }, []);

  const resizeWidget = useCallback((id: string, width: number, height: number) => {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, width, height } : w)));
  }, []);

  const updateWidget = useCallback(
    (id: string, patch: Partial<Pick<WidgetModel, "title" | "content">>) => {
      setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    },
    [],
  );

  const spawnCwd = activeFolders[0] ?? ".";

  function addTerminal(preset: AgentPreset, cwd?: string) {
    const dir = cwd ?? spawnCwd;
    void ensureFolder(dir);
    setNodes((ns) => {
      const { x, y } = nextCanvasPosition(allRects(ns, widgets), DEFAULT_TERM_WIDTH, DEFAULT_TERM_HEIGHT);
      const node = makeNode(preset, dir, x, y, ns.map((n) => n.name));
      setSelectedId(node.id);
      return [...ns, node];
    });
    setActiveTool("select");
  }

  function addWidget(kind: WidgetKind, at?: { x: number; y: number }) {
    const d = WIDGET_DEFAULTS[kind];
    setWidgets((ws) => {
      const pos = at ?? nextCanvasPosition(allRects(nodes, ws), d.width, d.height);
      const w = makeWidget(kind, pos.x, pos.y);
      setSelectedId(w.id);
      return [...ws, w];
    });
    setActiveTool("select");
  }

  function removeNode(id: string) {
    const node = nodes.find((n) => n.id === id);
    const ws = hubRef.current?.ws;
    if (node && ws) {
      for (const [a, b] of edges) {
        if (a === node.name || b === node.name) hubDisconnect(ws, a, b);
      }
    }
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setWidgetEdges((we) => we.filter(([nid]) => nid !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function removeWidget(id: string) {
    setWidgets((ws) => ws.filter((w) => w.id !== id));
    setWidgetEdges((we) => we.filter(([, wid]) => wid !== id));
    if (selectedId === id) setSelectedId(null);
  }

  const focusItem = useCallback((id: string) => {
    setSelectedId(id);
    const node = nodes.find((n) => n.id === id);
    const widget = widgets.find((w) => w.id === id);
    const item = node ?? widget;
    if (!item || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const cx = item.x + item.width / 2;
    const cy = item.y + item.height / 2;
    setView((v) => ({
      ...v,
      x: rect.width / 2 - cx * v.zoom,
      y: rect.height / 2 - cy * v.zoom,
    }));
  }, [nodes, widgets]);

  // Center a node and zoom so it fills most of the viewport (tmux "zoom pane").
  const zoomToNode = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node || !viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const pad = 80;
    const zoom = clamp(
      Math.min(rect.width / (node.width + pad), rect.height / (node.height + pad)),
      0.35,
      1.75,
    );
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    setSelectedId(id);
    setView({ zoom, x: rect.width / 2 - cx * zoom, y: rect.height / 2 - cy * zoom });
  }, []);

  // Dispatch a resolved tmux-prefix command against the current panes.
  function runPaneCommand(cmd: ReturnType<typeof resolvePrefixCommand>) {
    if (!cmd) return;
    const ns = nodesRef.current;
    const ids = ns.map((n) => n.id);
    const cur = selectedIdRef.current;
    switch (cmd.kind) {
      case "new":
        addTerminal(presetById("bash"));
        return;
      case "close":
        if (cur && ns.some((n) => n.id === cur)) removeNode(cur);
        return;
      case "cycle": {
        const next = cycleSelection(ids, cur, cmd.dir);
        if (next) focusItem(next);
        return;
      }
      case "nav": {
        const boxes: Box[] = ns.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));
        const next = spatialNavigate(boxes, cur, cmd.dx, cmd.dy);
        if (next) focusItem(next);
        return;
      }
      case "jump": {
        const next = jumpSelection(ids, cmd.index);
        if (next) focusItem(next);
        return;
      }
      case "zoom":
        if (cur && ns.some((n) => n.id === cur)) zoomToNode(cur);
        return;
      case "cancel":
        return;
    }
  }
  const actionsRef = useRef(runPaneCommand);
  actionsRef.current = runPaneCommand;

  const completeLink = useCallback(
    (targetId: string) => {
      const fromId = linkFromRef.current;
      if (!fromId || fromId === targetId) return;
      const fromNode = nodes.find((n) => n.id === fromId);

      const targetWidget = widgets.find((w) => w.id === targetId);
      if (targetWidget) {
        if (fromNode) {
          setWidgetEdges((prev) => {
            const exists = prev.some(([nid, wid]) => nid === fromId && wid === targetId);
            return exists ? prev : [...prev, [fromId, targetId]];
          });
        }
        linkFromRef.current = null;
        setLinkFrom(null);
        setLinkCursor(null);
        return;
      }

      const b = nodes.find((n) => n.id === targetId);
      const ws = hubRef.current?.ws;
      if (!fromNode || !b) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setConnectError("hub not connected");
        return;
      }
      hubConnect(ws, fromNode.name, b.name);
      linkFromRef.current = null;
      setLinkFrom(null);
      setLinkCursor(null);
    },
    [nodes, widgets],
  );

  function startLink(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    linkFromRef.current = id;
    setLinkFrom(id);
    setLinkCursor(toCanvas(e.clientX, e.clientY));
    setConnectError(null);
  }

  function finishLink(targetId: string) {
    completeLink(targetId);
  }

  useEffect(() => {
    if (!linkFrom) return;
    function onMove(e: MouseEvent) {
      setLinkCursor(toCanvas(e.clientX, e.clientY));
    }
    function onUp(e: MouseEvent) {
      const nodeEl = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]");
      const targetId = nodeEl?.getAttribute("data-node-id");
      if (targetId) completeLink(targetId);
      else {
        linkFromRef.current = null;
        setLinkFrom(null);
        setLinkCursor(null);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [linkFrom, toCanvas, completeLink]);

  useEffect(() => {
    function isTypingTarget(el: EventTarget | null) {
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== "Space" || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault();
      setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
      panRef.current = null;
      setPanning(false);
    }
    function onBlur() {
      setSpaceHeld(false);
      panRef.current = null;
      setPanning(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // tmux-style prefix keymap: Ctrl-b then a command key.
  // Capture phase so the chord is swallowed before xterm forwards it to the PTY.
  useEffect(() => {
    function clearPrefix() {
      prefixActiveRef.current = false;
      setPrefixActive(false);
      if (prefixTimer.current) clearTimeout(prefixTimer.current);
      prefixTimer.current = null;
    }
    function armPrefix() {
      prefixActiveRef.current = true;
      setPrefixActive(true);
      if (prefixTimer.current) clearTimeout(prefixTimer.current);
      prefixTimer.current = setTimeout(clearPrefix, 2500);
    }
    function onKeyDownCapture(e: KeyboardEvent) {
      if (prefixActiveRef.current) {
        if (isModifierKey(e.key)) return; // wait for a real command key
        e.preventDefault();
        e.stopPropagation();
        actionsRef.current(resolvePrefixCommand(e.key));
        clearPrefix();
        return;
      }
      if (isPrefixChord(e)) {
        e.preventDefault();
        e.stopPropagation();
        armPrefix();
      }
    }
    window.addEventListener("keydown", onKeyDownCapture, true);
    return () => {
      window.removeEventListener("keydown", onKeyDownCapture, true);
      if (prefixTimer.current) clearTimeout(prefixTimer.current);
    };
  }, []);

  function onViewportWheel(e: React.WheelEvent) {
    if (!e.altKey) return;
    e.preventDefault();
    const rect = viewportRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const worldX = (mx - view.x) / view.zoom;
    const worldY = (my - view.y) / view.zoom;
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    const zoom = clamp(view.zoom * factor, 0.35, 1.75);
    setView({
      zoom,
      x: mx - worldX * zoom,
      y: my - worldY * zoom,
    });
  }

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
    if ((e.target as HTMLElement).closest(".terminal-node, .canvas-widget")) return;
    const pos = toCanvas(e.clientX, e.clientY);
    addWidget(activeTool as WidgetKind, pos);
  }

  function onViewportMouseMove(e: React.MouseEvent) {
    const pan = panRef.current;
    if (!pan) return;
    setView((v) => ({
      ...v,
      x: pan.vx + (e.clientX - pan.sx),
      y: pan.vy + (e.clientY - pan.sy),
    }));
  }

  function onViewportMouseUp() {
    panRef.current = null;
    setPanning(false);
  }

  function zoomBy(delta: number) {
    setView((v) => ({ ...v, zoom: clamp(v.zoom + delta, 0.35, 1.75) }));
  }

  function portFor(node: NodeModel, side: "in" | "out") {
    return portPosition(node.x, node.y, node.width, node.height, side);
  }

  function handleToolChange(tool: CanvasTool) {
    setActiveTool(tool);
  }

  const canvasItems = useMemo(() => buildCanvasItems(nodes, widgets), [nodes, widgets]);

  const linkNode = linkFrom ? nodes.find((n) => n.id === linkFrom) : null;
  const linkStart = linkNode ? portFor(linkNode, "out") : null;

  if (!loaded) {
    return <div className="canvas-loading">Loading workspace…</div>;
  }

  return (
    <div className="maestri-stage">
      <header className="workspace-bar">
        <div className="workspace-title">
          <span className="ws-dot" />
          <strong>{workspaceName}</strong>
          <span className={`hub-status status-${status}`}>{status}</span>
        </div>
        <span className="hint">Link = permission to message · use agenthub-cli ask</span>
        {connectError && <span className="connect-error">{connectError}</span>}
      </header>

      <div className="maestri-body">
        <WorkspaceSidebar
          workspaceName={workspaceName}
          cwd={spawnCwd}
          items={canvasItems}
          selectedId={selectedId}
          onSelect={focusItem}
          onAddWidget={(kind) => addWidget(kind)}
          onAddTerminal={() => addTerminal(presetById("bash"))}
          folders={folders}
          onOpenFile={onOpenFile}
          onAddFolder={() => setPicker("folder")}
          onRemoveFolder={handleRemoveFolder}
          subagents={subagents}
          workspaces={workspaces}
          activeId={activeId}
          onSwitchWorkspace={handleSwitch}
          onDeleteWorkspace={handleDeleteWorkspace}
          onNewWorkspace={() => setPicker("new")}
        />
        {picker === "new" && (
          <DirectoryPicker
            title="New workspace — pick a folder"
            onCancel={() => setPicker(null)}
            onConfirm={handleNewWorkspace}
          />
        )}
        {picker === "folder" && (
          <DirectoryPicker
            title="Add a folder to Files"
            onCancel={() => setPicker(null)}
            onConfirm={handleAddFolder}
          />
        )}
        {picker === "spawn" && pendingPresetId && (
          <DirectoryPicker
            title="Pick a folder to open"
            onCancel={() => { setPicker(null); setPendingPresetId(null); }}
            onConfirm={(dir) => { addTerminal(presetById(pendingPresetId), dir); setPicker(null); setPendingPresetId(null); }}
          />
        )}

        <div className="maestri-canvas-wrap">
          <CanvasToolbar
            activeTool={activeTool}
            onToolChange={handleToolChange}
            onAddTerminal={(presetId) => { setPendingPresetId(presetId); setPicker("spawn"); }}
          />

          {prefixActive && (
            <div className="prefix-indicator" role="status">
              <strong>Ctrl-b</strong>
              <span>c new · x close · n/p cycle · ←↑↓→ move · z zoom · 0-9 jump</span>
            </div>
          )}

          <div
            className={`canvas-viewport${spaceHeld ? " pan-ready" : ""}${panning ? " panning" : ""}${activeTool !== "select" ? " place-mode" : ""}`}
            ref={viewportRef}
            onWheel={onViewportWheel}
            onMouseDown={onViewportMouseDown}
            onMouseMove={onViewportMouseMove}
            onMouseUp={onViewportMouseUp}
            onMouseLeave={onViewportMouseUp}
          >
            <div
              className="canvas-world"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
            >
              {nodes.length === 0 && widgets.length === 0 && (
                <div className="canvas-hint">
                  <p>Add a notepad, text, or agent from the sidebar or toolbar</p>
                  <p className="sub">
                    Space+drag pan · Alt+scroll zoom · pick a tool then click canvas
                  </p>
                </div>
              )}

              <svg className="edge-layer" width="8000" height="8000">
                {edges.map(([a, b]) => {
                  const na = nodes.find((n) => n.name === a);
                  const nb = nodes.find((n) => n.name === b);
                  if (!na || !nb) return null;
                  const [left, right] = na.x <= nb.x ? [na, nb] : [nb, na];
                  const p1 = portFor(left, "out");
                  const p2 = portFor(right, "in");
                  return (
                    <path
                      key={`${a}-${b}`}
                      d={cablePath(p1.x, p1.y, p2.x, p2.y)}
                      className="edge-cable"
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        const ws = hubRef.current?.ws;
                        if (ws && ws.readyState === WebSocket.OPEN) hubDisconnect(ws, a, b);
                      }}
                    />
                  );
                })}
                {widgetEdges.map(([nodeId, widgetId]) => {
                  const node = nodes.find((n) => n.id === nodeId);
                  const widget = widgets.find((w) => w.id === widgetId);
                  if (!node || !widget) return null;
                  const p1 = portFor(node, "out");
                  const p2 = { x: widget.x, y: widget.y + widget.height / 2 };
                  return (
                    <path
                      key={`we-${nodeId}-${widgetId}`}
                      d={cablePath(p1.x, p1.y, p2.x, p2.y)}
                      className="edge-cable widget-edge"
                    />
                  );
                })}
                {linkStart && linkCursor && (
                  <path
                    d={cablePath(linkStart.x, linkStart.y, linkCursor.x, linkCursor.y)}
                    className="edge-cable drafting"
                  />
                )}
              </svg>

              {widgets.map((widget) => (
                <CanvasWidget
                  key={widget.id}
                  widget={widget}
                  selected={selectedId === widget.id}
                  zoom={view.zoom}
                  spaceHeld={spaceHeld}
                  linking={!!linkFrom}
                  screenToCanvas={toCanvas}
                  onMove={moveWidget}
                  onResize={resizeWidget}
                  onRemove={removeWidget}
                  onUpdate={updateWidget}
                  onSelect={setSelectedId}
                />
              ))}

              {nodes.map((node) => {
                const ws = hubRef.current?.ws;
                const nodeConnections = edges
                  .filter(([a, b]) => a === node.name || b === node.name)
                  .map(([a, b]) => (a === node.name ? b : a));
                return (
                  <TerminalNode
                    key={node.id}
                    node={node}
                    preset={presetById(node.preset)}
                    zoom={view.zoom}
                    screenToCanvas={toCanvas}
                    onMove={moveNode}
                    onResize={resizeNode}
                    onRemove={removeNode}
                    onPortMouseDown={startLink}
                    onPortMouseUp={finishLink}
                    connections={nodeConnections}
                    onDisconnect={(otherName) => {
                      if (ws && ws.readyState === WebSocket.OPEN)
                        hubDisconnect(ws, node.name, otherName);
                    }}
                    linking={!!linkFrom}
                    spaceHeld={spaceHeld}
                    selected={selectedId === node.id}
                  />
                );
              })}
            </div>
          </div>

          <div className="zoom-bar">
            <button type="button" onClick={() => zoomBy(-0.1)} aria-label="Zoom out">
              −
            </button>
            <span>{Math.round(view.zoom * 100)}%</span>
            <button type="button" onClick={() => zoomBy(0.1)} aria-label="Zoom in">
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
