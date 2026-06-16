import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
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
  linking: boolean;
  spaceHeld: boolean;
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
  linking,
  spaceHeld,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyRef = useRef<ReturnType<typeof connectPty> | null>(null);
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ w: number; h: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.15,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      theme: { background: "#1a1b1e", foreground: "#e6e6e6", cursor: "#e6e6e6" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fitRef.current = fit;
    termRef.current = term;

    requestAnimationFrame(() => {
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
      ptyRef.current?.close();
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
    function handleMouseMove(e: MouseEvent) {
      if (dragRef.current) {
        const c = screenToCanvas(e.clientX, e.clientY);
        onMove(node.id, c.x - dragRef.current.ox, c.y - dragRef.current.oy);
      }
      if (resizeRef.current) {
        const dw = (e.clientX - resizeRef.current.x) / zoom;
        const dh = (e.clientY - resizeRef.current.y) / zoom;
        onResize(
          node.id,
          Math.max(300, resizeRef.current.w + dw),
          Math.max(180, resizeRef.current.h + dh),
        );
      }
    }
    function onUp() {
      dragRef.current = null;
      resizeRef.current = null;
    }
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [node.id, node.width, node.height, onMove, onResize, screenToCanvas, zoom]);

  return (
    <div
      className={`terminal-node${linking ? " link-target" : ""}`}
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
        <button type="button" className="node-close" onClick={() => onRemove(node.id)}>
          ×
        </button>
      </div>
      <div className="node-cwd" title={node.cwd}>
        {node.cwd.split("/").slice(-2).join("/") || node.cwd}
      </div>
      <div
        className={`node-port port-in ${linking ? "active" : ""}`}
        onMouseUp={() => onPortMouseUp(node.id)}
      />
      <div className="node-body" ref={hostRef} onMouseDown={onBodyMouseDown} />
      <div
        className={`node-port port-out ${linking ? "active" : ""}`}
        onMouseDown={(e) => onPortMouseDown(node.id, e)}
      />
      <div className="resize-handle" onMouseDown={onResizeMouseDown} />
    </div>
  );
}
