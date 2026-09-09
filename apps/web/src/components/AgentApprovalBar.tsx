import { useState } from "react";
import type { AgentRunSnapshot, AgentStepSnapshot, AssetSnapshot } from "@lyra/contracts";
import { ModelApprovalEditor } from "./ModelApprovalEditor.js";

export function AgentApprovalBar(props: {
  catalog: import("../lib/api-client.js").ProviderCatalog;
  runs: AgentRunSnapshot[];
  assets: Map<string, AssetSnapshot>;
  thumbnailUrl: (id: string) => string;
  onPreview: (id: string) => void;
  models: Array<{ id: string; name: string }>;
  providers: Array<{ id: string; name: string }>;
  stepsByRun: Map<string, AgentStepSnapshot[]>;
  onSubmit: (runId: string, text: string, choiceId?: string, modelChanges?: import("@lyra/contracts").ModelApprovalChanges) => Promise<void>;
}) {
  const [edit, setEdit] = useState<{ id: string; changes: import("@lyra/contracts").ModelApprovalChanges } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = props.runs.filter((run) => run.status === "awaiting_user").flatMap((run) =>
    (props.stepsByRun.get(run.id) ?? []).filter((step) => step.type === "user_input_request" &&
      step.status === "waiting" && !!step.payload.approvalHash).map((step) => ({ run, step })));
  const current = pending[0];
  const args = (current?.step.payload.request as { metadata?: { arguments?: Record<string, unknown> } } | undefined)?.metadata?.arguments ?? {};
  async function decide(choice: string) {
    if (!current || busy) return;
    setBusy(true); setError("");
    try { await props.onSubmit(current.run.id, "", choice, choice === "approve" && edit?.id === current.step.id ? edit.changes : undefined); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="agent-approval-bar">
    {current && <section className="agent-approval-card" key={current.step.id} aria-label="操作审核">
      <div><strong>{current.step.toolName === "generate_model" ? "请确认模型生成参数" : `请求批准：${current.step.toolName}`}</strong><span>确认后才提交任务{pending.length > 1 ? `（另有 ${pending.length - 1} 项等待审核）` : ""}</span></div>
      {current.step.toolName === "generate_model" ?
        <ModelApprovalEditor key={current.step.id} args={args} assets={props.assets} thumbnailUrl={props.thumbnailUrl} onPreview={props.onPreview} models={props.models} providers={props.providers} catalog={props.catalog} busy={busy} onChange={(changes) => setEdit({ id: current.step.id, changes })} /> :
        <details><summary>查看执行参数</summary><pre>{JSON.stringify(args, null, 2)}</pre></details>}
      <div className="choice-row agent-approval-actions"><button type="button" disabled={busy} onClick={() => void decide("reject")}>取消本次</button>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void decide("approve")}>{busy ? "提交中…" : current.step.toolName === "generate_model" ? "确认参数并生成" : "批准本次"}</button></div>
    </section>}
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
