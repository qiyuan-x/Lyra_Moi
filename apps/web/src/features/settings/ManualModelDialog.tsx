import { useState } from "react";
import type { ProviderModelSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";

export function ManualModelDialog(props: {
  mode: "add" | "test";
  models: ProviderModelSnapshot[];
  initialModelId: string;
  canTest: boolean;
  onClose: () => void;
  onTest: (modelId: string) => Promise<{ elapsedMs: number }>;
  onAdd: (modelId: string) => Promise<void>;
}) {
  const [modelId, setModelId] = useState(props.initialModelId);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error: boolean; text: string } | null>(null);
  const change = (value: string) => { setModelId(value); setResult(null); };
  const close = () => { if (!busy) props.onClose(); };
  async function test() {
    if (busy || !modelId.trim()) return;
    setBusy(true); setResult(null);
    try {
      const value = await props.onTest(modelId.trim());
      setResult({ error: false, text: `模型 ${modelId.trim()} 调用成功，耗时 ${value.elapsedMs} ms` });
    } catch (error) {
      setResult({ error: true, text: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(false); }
  }
  async function add() {
    if (busy || !modelId.trim()) return;
    setBusy(true);
    try { await props.onAdd(modelId.trim()); props.onClose(); }
    catch (error) { setResult({ error: true, text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onMouseDown={close} onKeyDown={(event) => { if (event.key === "Escape") close(); }}>
    <section className="form-modal manual-model-modal" role="dialog" aria-modal="true" aria-labelledby="manual-model-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><strong id="manual-model-title">{props.mode === "add" ? "添加模型" : "测试模型"}</strong>
        <button type="button" className="icon-button" disabled={busy} onClick={close} aria-label="关闭"><Icon name="close" size={18} /></button>
      </header>
      <div className="form-body">
        <label className="field"><span>模型 ID</span>
          {props.mode === "add" ? <input autoFocus value={modelId} disabled={busy} onChange={(event) => change(event.target.value)} placeholder="填写供应商要求的完整模型 ID" /> :
            <select autoFocus value={modelId} disabled={busy} onChange={(event) => change(event.target.value)}>
              <option value="">请选择已保存的模型</option>
              {props.models.map((model) => <option key={model.id} value={model.remoteModelId}>{model.remoteModelId}</option>)}
            </select>}
        </label>
        {props.canTest && <button type="button" className="button button-secondary" disabled={busy || !modelId.trim()} onClick={() => void test()}>{busy ? "处理中…" : "测试连通性"}</button>}
        {result && <pre className={`manual-model-result connection-${result.error ? "error" : "success"}`} role="status">{result.text}</pre>}
      </div>
      <footer><button type="button" className="button button-secondary" disabled={busy} onClick={close}>关闭</button>
        {props.mode === "add" && <button type="button" className="button button-primary" disabled={busy || !modelId.trim()} onClick={() => void add()}>添加模型</button>}
      </footer>
    </section>
  </div>;
}
