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
  connectHub,
  hubConnect,
  hubDisconnect,
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

let nextId = 1;
let nextWidgetId = 1;

function makeNode(preset: AgentPreset, cwd: string, x: number, y: number): NodeModel {
  const n = nextId++;
  return {
    id: `node-${n}`,
    name: `terminal-${n}`,
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

export function AgentCanvas() {
  const hubRef = useRef<HubConnection | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [nodes, setNodes] = useState<NodeModel[]>([]);
  const [widgets, setWidgets] = useState<WidgetModel[]>([]);
  const [edges, setEdges] = useState<[string, string][]>([]);
  const [pendingEdges, setPendingEdges] = useState<[string, string][]>([]);
  const [status, setStatus] = useState<"open" | "closed" | "error">("closed");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const linkFromRef = useRef<string | null>(null);
  const [linkCursor, setLinkCursor] = useState<{ x: number; y: number } | null>(null);
  const [cwd, setCwd] = useState("");
  const [workspaceName, setWorkspaceName] = useState("Workspace");
  const [view, setView] = useState<CanvasView>(DEFAULT_VIEW);
  const [loaded, setLoaded] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  useEffect(() => {
    fetchSessions()
      .then((data) => {
        setCwd(data.workspace);
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
        }
        if (data.widgets?.length) {
          setWidgets(data.widgets);
          const maxW = data.widgets.reduce((m, w) => {
            const n = parseInt(w.id.replace(/\D/g, ""), 10);
            return Number.isFinite(n) ? Math.max(m, n) : m;
          }, 0);
          nextWidgetId = maxW + 1;
        }
        if (data.edges) setPendingEdges(data.edges);
        if (data.view) setView(data.view);
      })
      .catch(() => setCwd("."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const hub = connectHub(
      (ev: HubEvent) => {
        if (ev.type === "state") {
          setEdges(ev.edges);
          setConnectError(null);
        } else if (ev.type === "error") {
          setConnectError(ev.reason);
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
      saveSessions({ terminals: nodes, widgets, edges, view }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [nodes, widgets, edges, view, loaded]);

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

  function addTerminal(preset: AgentPreset) {
    setNodes((ns) => {
      const { x, y } = nextCanvasPosition(allRects(ns, widgets), DEFAULT_TERM_WIDTH, DEFAULT_TERM_HEIGHT);
      const node = makeNode(preset, cwd, x, y);
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
    if (selectedId === id) setSelectedId(null);
  }

  function removeWidget(id: string) {
    setWidgets((ws) => ws.filter((w) => w.id !== id));
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

  const completeLink = useCallback(
    (targetId: string) => {
      const fromId = linkFromRef.current;
      if (!fromId || fromId === targetId) return;
      const a = nodes.find((n) => n.id === fromId);
      const b = nodes.find((n) => n.id === targetId);
      const ws = hubRef.current?.ws;
      if (!a || !b) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setConnectError("hub not connected");
        return;
      }
      hubConnect(ws, a.name, b.name);
      linkFromRef.current = null;
      setLinkFrom(null);
      setLinkCursor(null);
    },
    [nodes],
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
    if (!panRef.current) return;
    setView((v) => ({
      ...v,
      x: panRef.current!.vx + (e.clientX - panRef.current!.sx),
      y: panRef.current!.vy + (e.clientY - panRef.current!.sy),
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
        <label className="cwd-field">
          <span>Directory</span>
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/path/to/project"
          />
        </label>
        <span className="hint">Link = permission to message · use agenthub-cli ask</span>
        {connectError && <span className="connect-error">{connectError}</span>}
      </header>

      <div className="maestri-body">
        <WorkspaceSidebar
          workspaceName={workspaceName}
          cwd={cwd}
          items={canvasItems}
          selectedId={selectedId}
          onSelect={focusItem}
          onAddWidget={(kind) => addWidget(kind)}
          onAddTerminal={() => addTerminal(presetById("bash"))}
        />

        <div className="maestri-canvas-wrap">
          <CanvasToolbar
            activeTool={activeTool}
            onToolChange={handleToolChange}
            onAddTerminal={(presetId) => addTerminal(presetById(presetId))}
          />

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
                  const p1 = portFor(na, "out");
                  const p2 = portFor(nb, "in");
                  return (
                    <path
                      key={`${a}-${b}`}
                      d={cablePath(p1.x, p1.y, p2.x, p2.y)}
                      className="edge-cable"
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
                  screenToCanvas={toCanvas}
                  onMove={moveWidget}
                  onResize={resizeWidget}
                  onRemove={removeWidget}
                  onUpdate={updateWidget}
                  onSelect={setSelectedId}
                />
              ))}

              {nodes.map((node) => (
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
                  linking={!!linkFrom}
                  spaceHeld={spaceHeld}
                />
              ))}
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
