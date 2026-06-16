export type HubStatus = "open" | "closed" | "error";

export function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

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

export type HubConnection = {
  ws: WebSocket;
  close: () => void;
};

export function connectHub(
  onEvent: (ev: HubEvent) => void,
  onStatus: (s: HubStatus) => void,
): HubConnection {
  let ws: WebSocket;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  function open() {
    ws = new WebSocket(wsUrl());
    ws.onopen = () => {
      onStatus("open");
      ws.send(JSON.stringify({ type: "subscribe" }));
    };
    ws.onclose = () => {
      onStatus("closed");
      if (!closed) retryTimer = setTimeout(open, 1500);
    };
    ws.onerror = () => onStatus("error");
    ws.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data) as HubEvent);
      } catch {
        /* ignore */
      }
    };
  }

  open();

  return {
    get ws() {
      return ws;
    },
    close() {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    },
  };
}

export function hubConnect(ws: WebSocket, a: string, b: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "connect", a, b }));
  }
}

export function hubDisconnect(ws: WebSocket, a: string, b: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "disconnect", a, b }));
  }
}
