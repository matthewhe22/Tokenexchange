"use client";

import { useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

export function Playground({ models }: { models: string[] }) {
  const [model, setModel] = useState(models[0] ?? "");
  const [system, setSystem] = useState("");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState("");
  const abort = useRef<AbortController | null>(null);

  async function send() {
    if (!input.trim() || !model) return;
    const history: Msg[] = [...messages, { role: "user", content: input }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setError("");
    setStats("");
    setBusy(true);
    abort.current = new AbortController();
    const started = performance.now();
    try {
      const res = await fetch("/api/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify({
          model,
          stream: true,
          stream_options: { include_usage: true },
          temperature,
          max_tokens: maxTokens,
          messages: [...(system ? [{ role: "system", content: system }] : []), ...history],
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `request failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const data = ev.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
          if (!data || data === "[DONE]") continue;
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            answer += delta;
            setMessages([...history, { role: "assistant", content: answer }]);
          }
          if (json.usage) {
            setStats(`${json.usage.prompt_tokens} in · ${json.usage.completion_tokens} out · ${((performance.now() - started) / 1000).toFixed(1)}s`);
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="playground">
      <div className="card form-grid">
        <div>
          <label htmlFor="pg-model">Model</label>
          <select id="pg-model" value={model} onChange={(e) => setModel(e.target.value)}>
            {models.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="pg-temp">Temperature ({temperature})</label>
          <input id="pg-temp" type="range" min={0} max={1} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
        </div>
        <div>
          <label htmlFor="pg-max">Max output tokens</label>
          <input id="pg-max" type="number" min={1} max={32768} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
        </div>
        <div className="wide">
          <label htmlFor="pg-system">System prompt (optional)</label>
          <textarea id="pg-system" value={system} onChange={(e) => setSystem(e.target.value)} style={{ minHeight: 48 }} />
        </div>
      </div>
      <div className="card chat-log" aria-live="polite">
        {messages.length === 0 && <div className="muted">Messages you send are billed to your balance at the normal rates.</div>}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            <div className="chat-role">{m.role === "user" ? "You" : model}</div>
            <div className="chat-text">{m.content || (busy && i === messages.length - 1 ? "…" : "")}</div>
          </div>
        ))}
        {error && <div className="error">{error}</div>}
        {stats && <div className="muted" style={{ fontSize: 12 }}>{stats}</div>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          aria-label="Message"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Send a message (Shift+Enter for a new line)"
          style={{ flex: 1, minHeight: 56, fontFamily: "inherit", fontSize: 14 }}
        />
        {busy ? (
          <button type="button" className="secondary" onClick={() => abort.current?.abort()}>Stop</button>
        ) : (
          <button disabled={!input.trim()}>Send</button>
        )}
        <button type="button" className="secondary" onClick={() => setMessages([])} disabled={busy || !messages.length}>Clear</button>
      </form>
    </div>
  );
}
