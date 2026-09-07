import { useEffect, useRef, useState } from "react";
import type { TaskRuntimeSettingsSnapshot } from "@lyra/contracts";
import type { ApiClient } from "../../lib/api-client.js";

interface TaskRuntimeSettingsProps {
  api: ApiClient;
  onError: (error: unknown) => void;
}

type SaveState = "loading" | "saved" | "saving" | "error";

export function TaskRuntimeSettings(props: TaskRuntimeSettingsProps) {
  const [snapshot, setSnapshot] = useState<TaskRuntimeSettingsSnapshot | null>(null);
  const [concurrency, setConcurrency] = useState("2");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const savedValueRef = useRef(2);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    let active = true;
    void props.api.getTaskRuntimeSettings()
      .then((value) => {
        if (!active) return;
        const saved = value.settings.modelGenerationConcurrency;
        setSnapshot(value);
        setConcurrency(String(saved));
        savedValueRef.current = saved;
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

  const parsedValue = Number(concurrency);
  const valid = Number.isInteger(parsedValue) && parsedValue >= 1 && parsedValue <= 8;

  async function persist(value: number) {
    const requestVersion = ++requestVersionRef.current;
    setSaveState("saving");
    try {
      const next = await props.api.updateTaskRuntimeSettings({
        modelGenerationConcurrency: value
      });
      if (requestVersion !== requestVersionRef.current) return;
      const saved = next.settings.modelGenerationConcurrency;
      savedValueRef.current = saved;
      setSnapshot(next);
      setConcurrency(String(saved));
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
      const next = await props.api.resetTaskRuntimeSettings();
      if (requestVersion !== requestVersionRef.current) return;
      const saved = next.settings.modelGenerationConcurrency;
      savedValueRef.current = saved;
      setSnapshot(next);
      setConcurrency(String(saved));
      setSaveState("saved");
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      setSaveState("error");
      props.onError(error);
    }
  }

  return (
    <section className="task-runtime-settings">
      <header className="settings-overview-heading">
        <div>
          <h2>任务设置</h2>
          <p>调整后台生成任务的执行数量。修改后自动保存并在约一秒内生效。</p>
        </div>
        <span className={`agent-prompt-save-state state-${saveState}`}>
          {saveStateLabel(saveState)}
        </span>
      </header>

      {!snapshot ? (
        <div className="settings-loading">
          {saveState === "error" ? "任务设置加载失败" : "正在加载任务设置…"}
        </div>
      ) : (
        <section className="settings-detail-section task-runtime-section">
          <header>
            <div>
              <strong>模型生成</strong>
              <span>多个模型任务可以同时调用供应商 API。</span>
            </div>
          </header>
          <div className="agent-runtime-form">
            <label className="field">
              <span>模型任务并发数</span>
              <select
                aria-label="模型任务并发数"
                disabled={saveState === "saving"}
                value={concurrency}
                aria-invalid={!valid}
                onChange={(event) => {
                  setConcurrency(event.target.value);
                  void persist(Number(event.target.value));
                }}
              >
                {Array.from({ length: 8 }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
              <small className={valid ? "" : "field-error"}>
                允许范围 1–8，默认值为 2。调低时不会中断正在生成的模型。
              </small>
            </label>
            <button
              type="button"
              className="button button-secondary"
              disabled={saveState === "saving" || savedValueRef.current === snapshot.defaults.modelGenerationConcurrency}
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
  if (value === "saving") return "正在保存";
  if (value === "error") return "保存失败";
  if (value === "loading") return "正在加载";
  return "已自动保存";
}
