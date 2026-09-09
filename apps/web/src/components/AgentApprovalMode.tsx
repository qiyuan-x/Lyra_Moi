import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../lib/api-client.js";

const api = new ApiClient();
const modes = [
  { id: "ask", name: "请求批准", description: "修改数据和提交生成任务前确认" },
  { id: "auto", name: "帮我批准", description: "生成自动执行，删除、重试前确认" },
  { id: "full", name: "完全访问权限", description: "应用操作免审核，含生成、删除与重试" }
] as const;

export function AgentApprovalMode() {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState("ask");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
  }, [open]);
  useEffect(() => {
    let alive = true;
    void api.getAgentRuntimeSettings().then((value) => {
      if (alive) { setMode(value.settings.approvalMode ?? "ask"); setReady(true); }
    }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, []);
  async function changeMode(value: "ask" | "auto" | "full") {
    setSaving(true); setError("");
    try { const result = await api.updateAgentRuntimeSettings({ approvalMode: value });
      setMode(result.settings.approvalMode ?? "ask"); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  return <>
    <div className="agent-approval-selector" ref={rootRef}>
      <button ref={buttonRef} type="button" className="button button-quiet" disabled={!ready || saving} aria-expanded={open} onClick={() => setOpen(!open)}>
        {ready ? modes.find((item) => item.id === mode)?.name : "加载审核设置…"} ▾
      </button>
      {open && <div className="agent-approval-menu" role="group" aria-label="审核模式">
        {modes.map((item) => <button type="button" key={item.id} disabled={saving} aria-pressed={mode === item.id} onClick={() => void changeMode(item.id)}>
          <strong>{item.name}{mode === item.id ? " ✓" : ""}</strong><small>{item.description}</small>
        </button>)}
        <small>对后续新任务生效，不自动批准等待中的操作。</small>
      </div>}
    </div>
    {error && <span className="inline-error" role="alert">{error}</span>}
  </>;
}
