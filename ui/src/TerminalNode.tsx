import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { connectPty } from "./pty";
import { presetById, type AgentPreset, type TerminalSession } from "./sessions";
import "@xterm/xterm/css/xterm.css";

export type NodeModel = TerminalSession;

type Props = {
  node: NodeModel;
  preset: AgentPreset;
  zoom: number;
  screenToCanvas: (sx: number, sy: number) => { x: number; y: number };
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onPortMouseDown: (id: string, e: React.MouseEvent) => void;
  onPortMouseUp: (id: string) => void;
  onDisconnect: (otherName: string) => void;
  onOpenFile?: (path: string) => void;
  connections: string[];
  widgetConnections?: { id: string; title: string }[];
  onDisconnectWidget?: (id: string) => void;
  linking: boolean;
  spaceHeld: boolean;
  selected: boolean;
};

export function TerminalNode({
  node,
  preset,
  zoom,
  screenToCanvas,
  onMove,
  onResize,
  onRemove,
  onPortMouseDown,
  onPortMouseUp,
  onDisconnect,
  connections,
  widgetConnections = [],
  onDisconnectWidget = () => {},
  linking,
  spaceHeld,
  selected,
  onOpenFile,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<ReturnType<typeof connectPty> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ w: number; h: number; x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<{ x?: number; y?: number; w?: number; h?: number } | null>(null);
  const onOpenFileRef = useRef(onOpenFile);
  const [gearOpen, setGearOpen] = useState(false);

  useEffect(() => { onOpenFileRef.current = onOpenFile; }, [onOpenFile]);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: "#1a1b1e", foreground: "#e6e6e6", cursor: "#e6e6e6" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(hostRef.current);
    term.registerLinkProvider({
      provideLinks(y: number, callback: (links: any[] | undefined) => void) {
        const line = term.buffer.active.getLine(y - 1);
        if (!line) { callback(undefined); return; }
        const text = line.translateToString(true);
        const re = /(?:^|[\s(["'`→])([a-zA-Z0-9][a-zA-Z0-9._/-]*\.(?:md|ts|tsx|js|jsx|rs|json|yaml|yml|toml|txt|py|sh|go|css|scss|html))/g;
        const links: any[] = [];
        let match;
        while ((match = re.exec(text)) !== null) {
          const path = match[1];
          const prefixLen = match[0].length - path.length;
          const startX = match.index + prefixLen + 1;
          const endX = match.index + match[0].length;
          links.push({
            range: { start: { x: startX, y }, end: { x: endX, y } },
            text: path,
            activate(_e: MouseEvent, t: string) { onOpenFileRef.current?.(t); },
          });
        }
        callback(links.length > 0 ? links : undefined);
      },
    });
    fitRef.current = fit;
    termRef.current = term;

    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      fit.fit();
      const pty = connectPty({
        name: node.name,
        command: node.command,
        cwd: node.cwd,
        cols: term.cols,
        rows: term.rows,
        onData: (data) => term.write(data),
        onError: (reason) => term.writeln(`\r\n\x1b[31m[error] ${reason}\x1b[0m`),
        onClose: () => term.write("\r\n\x1b[33m[disconnected — restart agenthub or click agent again]\x1b[0m\r\n"),
      });
      ptyRef.current = pty;
      term.onData((data) => pty.input(data));
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ptyRef.current?.close();
      ptyRef.current = null;
      term.dispose();
    };
  }, [node.name, node.command, node.cwd]);

  useEffect(() => {
    if (!hostRef.current || !fitRef.current || !termRef.current) return;
    const ro = new ResizeObserver(() => {
      fitRef.current?.fit();
      const term = termRef.current!;
      ptyRef.current?.resize(term.cols, term.rows);
    });
    ro.observe(hostRef.current);
    fitRef.current.fit();
    return () => ro.disconnect();
  }, [node.width, node.height]);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const raf = requestAnimationFrame(() => {
      fitRef.current?.fit();
      ptyRef.current?.resize(term.cols, term.rows);
      if (term.rows > 0) term.refresh(0, term.rows - 1);
    });
    return () => cancelAnimationFrame(raf);
  }, [zoom]);

  // Focus the terminal when it becomes the selected pane (keyboard navigation).
  useEffect(() => {
    if (selected) termRef.current?.focus();
  }, [selected]);

  // Correct xterm mouse coordinates when canvas CSS scale != 1.
  // xterm divides (clientY - rect.top) by cellHeight (DOM px), but when the parent
  // canvas has a CSS scale transform, clientY - rect.top is in visual px. We intercept
  // and re-dispatch corrected events so xterm sees DOM-px offsets.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    function fix(e: MouseEvent) {
      if (!e.isTrusted || zoom === 1) return;
      const screen = host!.querySelector<HTMLElement>(".xterm-screen");
      if (!screen) return;
      const rect = screen.getBoundingClientRect();
      const cx = rect.left + (e.clientX - rect.left) / zoom;
      const cy = rect.top + (e.clientY - rect.top) / zoom;
      e.preventDefault();
      e.stopImmediatePropagation();
      screen.dispatchEvent(
        new MouseEvent(e.type, {
          bubbles: true,
          cancelable: e.cancelable,
          view: e.view,
          detail: e.detail,
          screenX: e.screenX,
          screenY: e.screenY,
          clientX: cx,
          clientY: cy,
          button: e.button,
          buttons: e.buttons,
          relatedTarget: e.relatedTarget,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        })
      );
    }
    host.addEventListener("mousedown", fix, true);
    host.addEventListener("mousemove", fix, true);
    host.addEventListener("mouseup", fix, true);
    return () => {
      host.removeEventListener("mousedown", fix, true);
      host.removeEventListener("mousemove", fix, true);
      host.removeEventListener("mouseup", fix, true);
    };
  }, [zoom]);

  // Close gear dropdown when clicking outside.
  useEffect(() => {
    if (!gearOpen) return;
    function onOutside(e: MouseEvent) {
      const el = (e.target as HTMLElement).closest(".node-gear-menu,.node-gear-btn");
      if (!el) setGearOpen(false);
    }
    window.addEventListener("mousedown", onOutside);
    return () => window.removeEventListener("mousedown", onOutside);
  }, [gearOpen]);

  function onHeaderMouseDown(e: React.MouseEvent) {
    if (spaceHeld) return;
    if ((e.target as HTMLElement).closest("button")) return;
    const c = screenToCanvas(e.clientX, e.clientY);
    dragRef.current = { ox: c.x - node.x, oy: c.y - node.y };
    e.preventDefault();
  }

  function onBodyMouseDown(e: React.MouseEvent) {
    if (spaceHeld) return;
    e.stopPropagation();
    termRef.current?.focus();
  }

  function onResizeMouseDown(e: React.MouseEvent) {
    if (spaceHeld) return;
    e.stopPropagation();
    resizeRef.current = { w: node.width, h: node.height, x: e.clientX, y: e.clientY };
  }

  useEffect(() => {
    function flush() {
      rafRef.current = null;
      const p = pendingRef.current;
      if (!p) return;
      pendingRef.current = null;
      const el = rootRef.current;
      if (p.x !== undefined && p.y !== undefined) {
        if (el) {
          el.style.left = `${p.x}px`;
          el.style.top = `${p.y}px`;
        }
        onMove(node.id, p.x, p.y);
      }
      if (p.w !== undefined && p.h !== undefined) {
        if (el) {
          el.style.width = `${p.w}px`;
          el.style.height = `${p.h}px`;
        }
        onResize(node.id, p.w, p.h);
      }
    }
    function handleMouseMove(e: MouseEvent) {
      if (dragRef.current) {
        const c = screenToCanvas(e.clientX, e.clientY);
        pendingRef.current = {
          ...pendingRef.current,
          x: c.x - dragRef.current.ox,
          y: c.y - dragRef.current.oy,
        };
      }
      if (resizeRef.current) {
        const dw = (e.clientX - resizeRef.current.x) / zoom;
        const dh = (e.clientY - resizeRef.current.y) / zoom;
        pendingRef.current = {
          ...pendingRef.current,
          w: Math.max(300, resizeRef.current.w + dw),
          h: Math.max(180, resizeRef.current.h + dh),
        };
      }
      if (pendingRef.current && rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    }
    function onUp() {
      dragRef.current = null;
      resizeRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      flush();
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", onUp);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [node.id, onMove, onResize, screenToCanvas, zoom]);

  return (
    <div
      ref={rootRef}
      className={`terminal-node${linking ? " link-target" : ""}${selected ? " selected" : ""}`}
      style={
        {
          left: node.x,
          top: node.y,
          width: node.width,
          height: node.height,
          "--agent-color": preset.color,
        } as React.CSSProperties
      }
      data-node-id={node.id}
      onMouseUp={() => linking && onPortMouseUp(node.id)}
    >
      <div className="node-header" onMouseDown={onHeaderMouseDown}>
        <span className="node-icon" style={{ color: preset.color }}>
          {preset.icon}
        </span>
        <span className="node-title">
          {preset.label}
          <span className="node-agent-name">{node.name}</span>
        </span>
        <span className="node-badge" style={{ background: preset.color }}>
          {preset.badge}
        </span>
        {(connections.length > 0 || widgetConnections.length > 0) && (
          <div className="node-gear-wrap">
            <button
              type="button"
              className="node-gear-btn"
              title="Connections"
              onClick={(e) => { e.stopPropagation(); setGearOpen((o) => !o); }}
            >
              ⚙
            </button>
            {gearOpen && (
              <div className="node-gear-menu">
                <div className="gear-menu-title">Connections</div>
                {connections.map((name) => (
                  <div key={name} className="gear-menu-item">
                    <span className="gear-peer-name">{name}</span>
                    <button
                      type="button"
                      className="gear-disconnect-btn"
                      title={`Disconnect ${name}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDisconnect(name);
                        if (connections.length + widgetConnections.length <= 1) setGearOpen(false);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {widgetConnections.map((w) => (
                  <div key={w.id} className="gear-menu-item">
                    <span className="gear-peer-name">📓 {w.title}</span>
                    <button
                      type="button"
                      className="gear-disconnect-btn"
                      title={`Disconnect ${w.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDisconnectWidget(w.id);
                        if (connections.length + widgetConnections.length <= 1) setGearOpen(false);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        <button type="button" className="node-close" onClick={() => onRemove(node.id)}>
          ×
        </button>
      </div>
      <div className="node-cwd" title={node.cwd}>
        {node.cwd.split("/").slice(-2).join("/") || node.cwd}
      </div>
      <div
        className={`node-port port-in ${linking ? "active" : ""}`}
        onMouseDown={(e) => onPortMouseDown(node.id, e)}
        onMouseUp={() => onPortMouseUp(node.id)}
      />
      <div
        className={`node-port port-top ${linking ? "active" : ""}`}
        onMouseDown={(e) => onPortMouseDown(node.id, e)}
        onMouseUp={() => onPortMouseUp(node.id)}
      />
      <div className="node-body" ref={hostRef} onMouseDown={onBodyMouseDown} />
      <div
        className={`node-port port-out ${linking ? "active" : ""}`}
        onMouseDown={(e) => onPortMouseDown(node.id, e)}
        onMouseUp={() => onPortMouseUp(node.id)}
      />
      <div
        className={`node-port port-bottom ${linking ? "active" : ""}`}
        onMouseDown={(e) => onPortMouseDown(node.id, e)}
        onMouseUp={() => onPortMouseUp(node.id)}
      />
      <div className="resize-handle" onMouseDown={onResizeMouseDown} />
    </div>
  );
}
