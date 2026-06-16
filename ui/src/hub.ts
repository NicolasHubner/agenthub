export type AgentSnapshot = {
  name: string;
  connected: boolean;
  tags: string[];
};

export type HubState = {
  type: "state";
  agents: AgentSnapshot[];
  edges: [string, string][];
};

export type HubMsg = {
  type: "msg";
  from: string;
  to: string;
  content: string;
};

export type HubError = {
  type: "error";
  reason: string;
  to?: string;
};

export type HubEvent = HubState | HubMsg | HubError;

export function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export function connectHub(
  onEvent: (ev: HubEvent) => void,
  onStatus: (s: "open" | "closed" | "error") => void,
): WebSocket {
  const ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    onStatus("open");
    ws.send(JSON.stringify({ type: "subscribe" }));
  };
  ws.onclose = () => onStatus("closed");
  ws.onerror = () => onStatus("error");
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data) as HubEvent);
    } catch {
      /* ignore */
    }
  };
  return ws;
}

export function hubConnect(ws: WebSocket, a: string, b: string) {
  ws.send(JSON.stringify({ type: "connect", a, b }));
}

export function hubDisconnect(ws: WebSocket, a: string, b: string) {
  ws.send(JSON.stringify({ type: "disconnect", a, b }));
}
