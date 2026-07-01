import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { CanvasToolbar, type CanvasTool } from "./CanvasToolbar";
import { CanvasWidget } from "./CanvasWidget";
import { GroupBox } from "./GroupBox";
import {
  cycleSelection,
  isModifierKey,
  isPrefixChord,
  jumpSelection,
  resolveAltCommand,
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
import { buildCanvasItems, WorkspaceSidebar } from "./WorkspaceSidebar";
import { getFolders, type FolderFiles } from "./api";
import {
  listWorkspaces,
  switchWorkspace,
  createWorkspace,
  removeWorkspace,
  renameWorkspace,
  connectFolder,
  disconnectFolder,
  type WorkspaceEntry,
} from "./workspaces";
import { DirectoryPicker } from "./DirectoryPicker";
import { ThemeToggle } from "./ThemeToggle";

let nextId = 1;
let nextWidgetId = 1;
let nextGroupId = 1;

const AGENT_NAMES = [
  "alpha", "bravo", "tango", "delta", "echo", "foxtrot", "golf", "hotel",
  "juliet", "kilo", "lima", "mike", "oscar", "papa", "romeo", "sierra",
  "victor", "whiskey", "zulu", "nova", "vega", "orion", "lyra", "atlas",
  "phoenix", "cygnus", "hydra", "draco", "aquila", "corvus", "lupus",
];

function pickName(existing: string[], workspaceId: string): string {
  const used = new Set(existing);
  const suffix = workspaceId ? `-${workspaceId}` : "";
  const available = AGENT_NAMES
    .map((n) => `${n}${suffix}`)
    .filter((n) => !used.has(n));
  if (available.length > 0) return available[Math.floor(Math.random() * available.length)];
  const base = AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)];
  return `${base}${suffix}-${used.size + 1}`;
}

function makeNode(preset: AgentPreset, cwd: string, x: number, y: number, existingNames: string[], workspaceId: string): NodeModel {
  const n = nextId++;
  return {
    id: `node-${n}`,
    name: pickName(existingNames, workspaceId),
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

function allRects(nodes: NodeModel[], widgets: WidgetModel[], groups: GroupBoxModel[] = []): Rect[] {
  return [
    ...nodes.map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })),
    ...widgets.map((w) => ({ x: w.x, y: w.y, width: w.width, height: w.height })),
    ...groups.map((g) => ({ x: g.x, y: g.y, width: g.width, height: g.height })),
  ];
}

interface AgentCanvasProps {
  onOpenFile: (root: string, path: string) => void;
  activeRoot?: string;
  activePath?: string;
}

export function AgentCanvas({ onOpenFile, activeRoot, activePath }: AgentCanvasProps) {
  const hubRef = useRef<HubConnection | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasWorldRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<NodeModel[]>([]);
  const [widgets, setWidgets] = useState<WidgetModel[]>([]);
  const [groups, setGroups] = useState<GroupBoxModel[]>([]);
  const [edges, setEdges] = useState<[string, string][]>([]);
  const [widgetEdges, setWidgetEdges] = useState<[string, string][]>([]);
  const nodesRef = useRef<NodeModel[]>([]);
  nodesRef.current = nodes;
  const widgetsRef = useRef<WidgetModel[]>([]);
  widgetsRef.current = widgets;
  const widgetEdgesRef = useRef<[string, string][]>([]);
  widgetEdgesRef.current = widgetEdges;
  const drawRef = useRef<{ sx: number; sy: number } | null>(null);
  const drawRectRef = useRef<Rect | null>(null);
  const [subagents, setSubagents] = useState<SubagentSnapshot[]>([]);
  const [pendingEdges, setPendingEdges] = useState<[string, string][]>([]);
  const savedEdgesRef = useRef<[string, string][]>([]);
  const [status, setStatus] = useState<"open" | "closed" | "error">("closed");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const linkFromRef = useRef<string | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(null);
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [picker, setPicker] = useState<null | "new" | "folder" | "spawn">(null);
  const [pendingPresetId, setPendingPresetId] = useState<string | null>(null);
  const [view, setView] = useState<CanvasView>(DEFAULT_VIEW);
  const flushSaveRef = useRef<() => Promise<void>>(async () => {});
  const [loaded, setLoaded] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [drawRect, setDrawRect] = useState<Rect | null>(null);
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [folders, setFolders] = useState<FolderFiles[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [prefixActive, setPrefixActive] = useState(false);
  const prefixActiveRef = useRef(false);
  const prefixTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panRef = useRef<{ sx: number; sy: number; vx: number; vy: number; nx: number; ny: number } | null>(null);
  const groupMembersRef = useRef<Record<string, { nodeIds: string[]; widgetIds: string[] }>>({});
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
      setWorkspaceId(data.workspaceId || "");
      setWorkspaceName(data.workspace || "Workspace");
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
      if (data.edges) { setPendingEdges(data.edges); savedEdgesRef.current = data.edges; }
      else { setPendingEdges([]); savedEdgesRef.current = []; }
      if (data.widgetEdges?.length) setWidgetEdges(data.widgetEdges);
      else setWidgetEdges([]);
      if (data.view) setView(data.view);
    } catch { /* ignore */ }
    finally { setLoaded(true); }
    getFolders().then(setFolders).catch(() => {});
  }, []);

  // Restore orphaned tmux sessions: terminals alive in tmux but missing from the
  // saved canvas layout (e.g. created then never persisted, or survived a crash).
  // The saved layout always wins; we only add nodes for sessions not already shown.
  const reconcileTmux = useCallback(async () => {
    let sessions;
    try {
      sessions = await listTmuxSessions();
    } catch { return; }
    if (sessions.length === 0) return;
    // Mirror the server-side sanitize so node.name matches the tmux session name.
    const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
    setNodes((ns) => {
      const known = new Set(ns.map((n) => sanitize(n.name)));
      const orphans = sessions.filter((s) => !known.has(s.name));
      if (orphans.length === 0) return ns;
      const bash = presetById("bash");
      const acc = [...ns];
      for (const s of orphans) {
        const { x, y } = nextCanvasPosition(allRects(acc, widgets, groups), DEFAULT_TERM_WIDTH, DEFAULT_TERM_HEIGHT);
        const node: NodeModel = {
          id: `node-${nextId++}`,
          name: s.name,
          command: bash.command,
          preset: bash.id,
          cwd: s.cwd || ".",
          x,
          y,
          width: DEFAULT_TERM_WIDTH,
          height: DEFAULT_TERM_HEIGHT,
        };
        acc.push(node);
      }
      return acc;
    });
  }, [widgets, groups]);

  useEffect(() => { void reload(); void loadWorkspaces(); }, [reload, loadWorkspaces]);

  // Once the saved layout is loaded, fold in any orphaned tmux sessions (one-shot).
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (!loaded || reconciledRef.current) return;
    reconciledRef.current = true;
    void reconcileTmux();
  }, [loaded, reconcileTmux]);

  async function handleSwitch(id: string) {
    if (id === activeId) return;
    await flushPendingSave();
    setActiveId(id);
    reconciledRef.current = false;
    await switchWorkspace(id);
    await reload();
    await loadWorkspaces();
    // New workspace layout is loaded — restore its orphaned tmux sessions too.
    await reconcileTmux();
  }

  const activeFolders = workspaces.find((w) => w.id === activeId)?.folders ?? [];

  async function handleNewWorkspace(dir: string) {
    await flushPendingSave();
    const created = await createWorkspace(dir);
    setActiveId(created.id);
    reconciledRef.current = false;
    setPicker(null);
    await reload();
    await loadWorkspaces();
  }

  async function handleDeleteWorkspace(id: string) {
    if (workspaces.length <= 1) return;
    if (!window.confirm("Delete this workspace?")) return;
    if (id === activeId) await flushPendingSave();
    await removeWorkspace(id);
    if (id === activeId) {
      const next = workspaces.find((w) => w.id !== id);
      if (next) {
        setActiveId(next.id);
        reconciledRef.current = false;
        await switchWorkspace(next.id);
        await reload();
      }
    }
    await loadWorkspaces();
  }

  async function handleRenameWorkspace(id: string) {
    const current = workspaces.find((w) => w.id === id);
    const next = window.prompt("Rename workspace", current?.name ?? workspaceName)?.trim();
    if (!next || next === current?.name) return;
    await renameWorkspace(id, next);
    if (id === activeId) setWorkspaceName(next);
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
    if (!loaded || !workspaceId || workspaceId !== activeId) return;
    const save = () => saveSessions({ terminals: nodes, widgets, groups, edges, widgetEdges, view }).catch(() => {});
    flushSaveRef.current = save;
    const t = setTimeout(save, 400);
    return () => clearTimeout(t);
  }, [nodes, widgets, groups, edges, widgetEdges, view, loaded, workspaceId, activeId]);

  // Deletions (e.g. removeNode) only update local state; the debounced save above
  // is what actually persists them and lets the backend kill the tmux session for
  // anything removed. Switching workspaces right after a delete can cancel that
  // pending save (deps change), leaving the tmux session orphaned forever and
  // making it reappear via reconcileTmux. Flush synchronously before switching.
  async function flushPendingSave() {
    await flushSaveRef.current();
  }

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
      const g = gs.find((item) => item.id === id);
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
      const { x, y } = nextCanvasPosition(allRects(ns, widgets, groups), DEFAULT_TERM_WIDTH, DEFAULT_TERM_HEIGHT);
      const node = makeNode(preset, dir, x, y, ns.map((n) => n.name), workspaceId);
      setSelectedId(node.id);
      return [...ns, node];
    });
    setActiveTool("select");
  }

  function addWidget(kind: WidgetKind, at?: { x: number; y: number }) {
    const d = WIDGET_DEFAULTS[kind];
    setWidgets((ws) => {
      const pos = at ?? nextCanvasPosition(allRects(nodes, ws, groups), d.width, d.height);
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
      const altCmd = resolveAltCommand(e);
      if (altCmd) {
        e.preventDefault();
        e.stopPropagation();
        actionsRef.current(altCmd);
        return;
      }
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
        nx: viewRef.current.x,
        ny: viewRef.current.y,
      };
      setPanning(true);
      return;
    }

    if (e.button !== 0 || activeTool === "select") return;
    if ((e.target as HTMLElement).closest(".terminal-node, .canvas-widget, .canvas-group")) return;
    const pos = toCanvas(e.clientX, e.clientY);
    if (activeTool === "group") {
      drawRef.current = { sx: pos.x, sy: pos.y };
      drawRectRef.current = { x: pos.x, y: pos.y, width: 0, height: 0 };
      setDrawRect(drawRectRef.current);
      return;
    }
    addWidget(activeTool as WidgetKind, pos);
  }

  function onViewportMouseMove(e: React.MouseEvent) {
    const pan = panRef.current;
    if (pan) {
      pan.nx = pan.vx + (e.clientX - pan.sx);
      pan.ny = pan.vy + (e.clientY - pan.sy);
      const world = canvasWorldRef.current;
      if (world) world.style.transform = `translate(${pan.nx}px, ${pan.ny}px) scale(${viewRef.current.zoom})`;
      return;
    }
    if (drawRef.current) {
      const pos = toCanvas(e.clientX, e.clientY);
      const { sx, sy } = drawRef.current;
      const next = {
        x: Math.min(sx, pos.x),
        y: Math.min(sy, pos.y),
        width: Math.abs(pos.x - sx),
        height: Math.abs(pos.y - sy),
      };
      drawRectRef.current = next;
      setDrawRect(next);
    }
  }

  function onViewportMouseUp() {
    const pan = panRef.current;
    if (pan && (pan.nx !== pan.vx || pan.ny !== pan.vy)) {
      setView((v) => ({ ...v, x: pan.nx, y: pan.ny }));
    }
    panRef.current = null;
    setPanning(false);
    if (drawRef.current) {
      drawRef.current = null;
      const rect = drawRectRef.current;
      if (rect && rect.width > 24 && rect.height > 24) {
        const group = makeGroup(rect.x, rect.y, rect.width, rect.height);
        setGroups((gs) => [...gs, group]);
        setSelectedId(group.id);
      }
      drawRectRef.current = null;
      setDrawRect(null);
      setActiveTool("select");
    }
  }

  function zoomBy(delta: number) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) {
      setView((v) => ({ ...v, zoom: clamp(v.zoom + delta, 0.35, 1.75) }));
      return;
    }
    const mx = rect.width / 2;
    const my = rect.height / 2;
    setView((v) => {
      const worldX = (mx - v.x) / v.zoom;
      const worldY = (my - v.y) / v.zoom;
      const zoom = clamp(v.zoom + delta, 0.35, 1.75);
      return {
        zoom,
        x: mx - worldX * zoom,
        y: my - worldY * zoom,
      };
    });
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
        <ThemeToggle />
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
          activeRoot={activeRoot}
          activePath={activePath}
          onAddFolder={() => setPicker("folder")}
          onRemoveFolder={handleRemoveFolder}
          subagents={subagents}
          workspaces={workspaces}
          activeId={activeId}
          onSwitchWorkspace={handleSwitch}
          onDeleteWorkspace={handleDeleteWorkspace}
          onRenameWorkspace={handleRenameWorkspace}
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
            initialPath={activeFolders[0]}
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
              ref={canvasWorldRef}
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

              {drawRect && (
                <div
                  className="canvas-group-preview"
                  style={{ left: drawRect.x, top: drawRect.y, width: drawRect.width, height: drawRect.height }}
                />
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
                  const widgetLeft = widget.x + widget.width / 2 < node.x + node.width / 2;
                  const p1 = portFor(node, widgetLeft ? "in" : "out");
                  const p2 = {
                    x: widgetLeft ? widget.x + widget.width : widget.x,
                    y: widget.y + widget.height / 2,
                  };
                  return (
                    <path
                      key={`we-${nodeId}-${widgetId}`}
                      d={cablePath(p1.x, p1.y, p2.x, p2.y)}
                      className="edge-cable widget-edge"
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setWidgetEdges((we) =>
                          we.filter(([nid, wid]) => !(nid === nodeId && wid === widgetId)));
                      }}
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
                const nodeWidgets = widgetEdges
                  .filter(([nid]) => nid === node.id)
                  .map(([, wid]) => widgets.find((w) => w.id === wid))
                  .filter(Boolean) as WidgetModel[];
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
                    widgetConnections={nodeWidgets.map((w) => ({
                      id: w.id,
                      title: w.title || "Notepad",
                    }))}
                    onDisconnectWidget={(wid) =>
                      setWidgetEdges((we) =>
                        we.filter(([nid, w]) => !(nid === node.id && w === wid)))
                    }
                    onDisconnect={(otherName) => {
                      if (ws && ws.readyState === WebSocket.OPEN)
                        hubDisconnect(ws, node.name, otherName);
                    }}
                    linking={!!linkFrom}
                    spaceHeld={spaceHeld}
                    selected={selectedId === node.id}
                    onOpenFile={(path) => onOpenFile(node.cwd, path)}
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
