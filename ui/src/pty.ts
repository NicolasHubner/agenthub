export function ptyUrl(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws/pty`;
}

export type PtyHandle = {
  ws: WebSocket;
  input: (data: string | Uint8Array) => void;
  resize: (cols: number, rows: number) => void;
  close: () => void;
};

export function connectPty(opts: {
  name: string;
  command?: string;
  cwd?: string;
  tags?: string[];
  cols: number;
  rows: number;
  onData: (data: Uint8Array) => void;
  onError?: (reason: string) => void;
  onClose: () => void;
}): PtyHandle {
  const ws = new WebSocket(ptyUrl());
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "spawn",
        name: opts.name,
        command: opts.command ?? "bash",
        cwd: opts.cwd ?? "",
        tags: opts.tags ?? ["terminal"],
        cols: opts.cols,
        rows: opts.rows,
      }),
    );
  };

  ws.onmessage = (e) => {
    if (e.data instanceof ArrayBuffer) {
      opts.onData(new Uint8Array(e.data));
      return;
    }
    if (typeof e.data === "string") {
      try {
        const v = JSON.parse(e.data);
        if (v.type === "error" && opts.onError) opts.onError(v.reason ?? "error");
      } catch {
        /* ignore */
      }
    }
  };

  ws.onclose = () => opts.onClose();

  return {
    ws,
    input(data: string | Uint8Array) {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (typeof data === "string") ws.send(data);
      else ws.send(data);
    },
    resize(cols: number, rows: number) {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    },
    close() {
      ws.close();
    },
  };
}
