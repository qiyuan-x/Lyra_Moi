import { useEffect, useRef, useState } from "react";
import type { AgentRuntimeSettingsSnapshot } from "@lyra/contracts";
import type { ApiClient } from "../../lib/api-client.js";
import { Icon } from "../../components/Icon.js";

interface AgentRuntimeSettingsProps {
  api: ApiClient;
  onBack: () => void;
  onError: (error: unknown) => void;
}

type SaveState = "loading" | "saved" | "pending" | "saving" | "error";

export function AgentRuntimeSettings(props: AgentRuntimeSettingsProps) {
  const [snapshot, setSnapshot] = useState<AgentRuntimeSettingsSnapshot | null>(null);
  const [maxToolCalls, setMaxToolCalls] = useState("10");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const savedValueRef = useRef(10);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    let active = true;
    void props.api.getAgentRuntimeSettings()
      .then((value) => {
        if (!active) return;
        setSnapshot(value);
        setMaxToolCalls(String(value.settings.maxToolCalls));
        savedValueRef.current = value.settings.maxToolCalls;
        setSaveState("saved");
      })
      .catch((error) => {
        if (!active) return;
        setSaveState("error");
        props.onError(error);
      });
    return () => {
      active = false;
    };
  }, [props.api, props.onError]);

  const parsedValue = Number(maxToolCalls);
  const valid = Number.isInteger(parsedValue) && parsedValue >= 1 && parsedValue <= 100;

  useEffect(() => {
    if (!snapshot || !valid || parsedValue === savedValueRef.current) return;
    setSaveState("pending");
    const timer = window.setTimeout(() => {
      void persist(parsedValue);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [parsedValue, snapshot, valid]);

  async function persist(value: number) {
    const requestVersion = ++requestVersionRef.current;
    setSaveState("saving");
    try {
      const next = await props.api.updateAgentRuntimeSettings({ maxToolCalls: value });
      if (requestVersion !== requestVersionRef.current) return;
      savedValueRef.current = next.settings.maxToolCalls;
      setSnapshot(next);
      setMaxToolCalls(String(next.settings.maxToolCalls));
      setSaveState("saved");
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      setSaveState("error");
      props.onError(error);
    }
  }

  async function reset() {
    const requestVersion = ++requestVersionRef.current;
    setSaveState("saving");
    try {
      const next = await props.api.resetAgentRuntimeSettings();
      if (requestVersion !== requestVersionRef.current) return;
      savedValueRef.current = next.settings.maxToolCalls;
      setSnapshot(next);
      setMaxToolCalls(String(next.settings.maxToolCalls));
      setSaveState("saved");
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      setSaveState("error");
      props.onError(error);
    }
  }

  return (
    <section className="agent-runtime-settings">
      <header className="settings-detail-heading agent-settings-detail-heading">
        <button type="button" className="icon-button" aria-label="返回 Agent 设置" onClick={props.onBack}>
          <Icon name="chevron" size={18} />
        </button>
        <div>
          <h2>其他设置</h2>
          <p>修改后自动保存，并从下一轮 Agent 任务开始生效。</p>
        </div>
      </header>

      {!snapshot ? (
        <div className="settings-loading">
          {saveState === "error" ? "Agent 其他设置加载失败" : "正在加载 Agent 其他设置…"}
        </div>
      ) : (
        <section className="settings-detail-section agent-runtime-section">
          <header>
            <div>
              <strong>运行参数</strong>
              <span>限制单轮 Agent 执行可以连续调用工具的次数。</span>
            </div>
            <span className={`agent-prompt-save-state state-${saveState}`}>
              {saveStateLabel(saveState)}
            </span>
          </header>
          <div className="agent-runtime-form">
            <label className="field">
              <span>单轮最大工具调用次数</span>
              <input
                type="number"
                min={1}
                max={100}
                step={1}
                value={maxToolCalls}
                aria-invalid={!valid}
                onChange={(event) => setMaxToolCalls(event.target.value)}
              />
              <small className={valid ? "" : "field-error"}>允许范围 1–100，默认值为 10。</small>
            </label>
            <button
              type="button"
              className="button button-secondary"
              disabled={saveState === "saving" || savedValueRef.current === snapshot.defaults.maxToolCalls}
              onClick={() => void reset()}
            >
              恢复默认
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

function saveStateLabel(value: SaveState): string {
  if (value === "pending") return "等待自动保存";
  if (value === "saving") return "正在保存";
  if (value === "error") return "保存失败";
  if (value === "loading") return "正在加载";
  return "已自动保存";
}
