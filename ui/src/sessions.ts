export type TerminalSession = {
  id: string;
  name: string;
  command: string;
  cwd: string;
  preset: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WidgetKind = "notepad" | "text" | "sticky";

export type CanvasWidget = {
  id: string;
  kind: WidgetKind;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GroupBox = {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  titleScale?: number;
};

export type CanvasView = { x: number; y: number; zoom: number };

export type SessionSnapshot = {
  terminals: TerminalSession[];
  widgets?: CanvasWidget[];
  groups?: GroupBox[];
  edges: [string, string][];
  widgetEdges?: [string, string][];
  view?: CanvasView;
};

export const WIDGET_DEFAULTS: Record<WidgetKind, { width: number; height: number; title: string }> = {
  notepad: { width: 320, height: 260, title: "Notepad" },
  text: { width: 300, height: 100, title: "Text" },
  sticky: { width: 220, height: 200, title: "Sticky" },
};

export const GROUP_COLORS = ["#7c5cff", "#3b82f6", "#0d9488", "#f59e0b", "#ef4444", "#64748b"];

export type SessionsResponse = SessionSnapshot & {
  workspaceId: string;
  workspace: string;
};

export async function fetchSessions(): Promise<SessionsResponse> {
  const r = await fetch("/sessions");
  if (!r.ok) throw new Error(`sessions ${r.status}`);
  return r.json();
}

export type TmuxSession = {
  name: string;
  cwd: string;
  attached: boolean;
  dead: boolean;
};

export async function listTmuxSessions(): Promise<TmuxSession[]> {
  const r = await fetch("/tmux/sessions");
  if (!r.ok) throw new Error(`tmux sessions ${r.status}`);
  const data = await r.json();
  return data.sessions ?? [];
}

export async function saveSessions(snap: SessionSnapshot): Promise<void> {
  const r = await fetch("/sessions", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snap),
  });
  if (!r.ok) throw new Error(`save sessions ${r.status}`);
}

export type AgentPreset = {
  id: string;
  label: string;
  command: string;
  badge: string;
  color: string;
  icon: string;
};

export const AGENT_PRESETS: AgentPreset[] = [
  { id: "claude", label: "Claude", command: "claude", badge: "Code", color: "#c15f3c", icon: "✳" },
  { id: "codex", label: "Codex", command: "codex", badge: "Codex", color: "#7c5cff", icon: "◉" },
  { id: "cursor", label: "Cursor", command: "cursor-agent", badge: "Agent", color: "#3b82f6", icon: "⌁" },
  { id: "gemini", label: "Gemini", command: "gemini", badge: "CLI", color: "#0d9488", icon: "◇" },
  { id: "opencode", label: "OpenCode", command: "opencode", badge: "OSS", color: "#22c55e", icon: "◆" },
  { id: "bash", label: "Shell", command: "bash", badge: "Shell", color: "#64748b", icon: "▸" },
];

export function presetById(id: string): AgentPreset {
  return AGENT_PRESETS.find((p) => p.id === id) ?? AGENT_PRESETS.find((p) => p.id === "bash")!;
}

export const DEFAULT_TERM_WIDTH = 700;
export const DEFAULT_TERM_HEIGHT = 480;
export const DEFAULT_VIEW: CanvasView = { x: 48, y: 48, zoom: 1 };
