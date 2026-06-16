import { useEffect, useRef, useState } from "react";
import {
  connectHub,
  hubConnect,
  hubDisconnect,
  type AgentSnapshot,
  type HubEvent,
  type HubMsg,
} from "./hub";

export function AgentPanel() {
  const wsRef = useRef<WebSocket | null>(null);
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [edges, setEdges] = useState<[string, string][]>([]);
  const [messages, setMessages] = useState<HubMsg[]>([]);
  const [status, setStatus] = useState<"open" | "closed" | "error">("closed");
  const [pickA, setPickA] = useState("");
  const [pickB, setPickB] = useState("");

  useEffect(() => {
    const ws = connectHub(
      (ev: HubEvent) => {
        if (ev.type === "state") {
          setAgents(ev.agents);
          setEdges(ev.edges);
        } else if (ev.type === "msg") {
          setMessages((m) => [...m.slice(-199), ev]);
        }
      },
      setStatus,
    );
    wsRef.current = ws;
    return () => ws.close();
  }, []);

  function connectSelected() {
    if (!pickA || !pickB || pickA === pickB || !wsRef.current) return;
    hubConnect(wsRef.current, pickA, pickB);
  }

  function disconnectEdge(a: string, b: string) {
    if (wsRef.current) hubDisconnect(wsRef.current, a, b);
  }

  return (
    <div className="agents">
      <div className="agents-header">
        <h2>Agents</h2>
        <span className={`status status-${status}`}>{status}</span>
      </div>

      <p className="hint">
        Connect agents from terminal:{" "}
        <code>cargo run --bin agenthub-connect -- --name claude --tag claude</code>
      </p>

      <section>
        <h3>Connected</h3>
        {agents.length === 0 ? (
          <p className="muted">No agents yet. Run agenthub-connect in a terminal.</p>
        ) : (
          <ul className="agent-list">
            {agents.map((a) => (
              <li key={a.name}>
                <strong>{a.name}</strong>
                {a.tags.length > 0 && (
                  <span className="tags">{a.tags.join(", ")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3>Link agents</h3>
        <div className="link-row">
          <select value={pickA} onChange={(e) => setPickA(e.target.value)}>
            <option value="">—</option>
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <span>↔</span>
          <select value={pickB} onChange={(e) => setPickB(e.target.value)}>
            <option value="">—</option>
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={connectSelected} disabled={!pickA || !pickB}>
            Connect
          </button>
        </div>
        <ul className="edge-list">
          {edges.map(([a, b]) => (
            <li key={`${a}-${b}`}>
              {a} ↔ {b}{" "}
              <button type="button" className="link-btn" onClick={() => disconnectEdge(a, b)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="msg-log">
        <h3>Messages</h3>
        {messages.length === 0 ? (
          <p className="muted">No messages yet.</p>
        ) : (
          <ul>
            {messages.map((m, i) => (
              <li key={i}>
                <strong>{m.from}</strong> → {m.to}: {m.content}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
