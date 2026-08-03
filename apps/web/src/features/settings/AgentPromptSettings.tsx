import {
  useCallback,
  useEffect,
  useRef,
  useState
} from "react";
import type {
  AgentPromptSettings as AgentPromptSettingsValue,
  AgentPromptSettingsSnapshot
} from "@lyra/contracts";
import type { ApiClient } from "../../lib/api-client.js";

interface AgentPromptSettingsProps {
  api: ApiClient;
  onError: (error: unknown) => void;
}

type SaveState = "loading" | "saved" | "pending" | "saving" | "error";

export function AgentPromptSettings(
  props: AgentPromptSettingsProps
) {
  const [snapshot, setSnapshot] =
    useState<AgentPromptSettingsSnapshot | null>(null);
  const [draft, setDraft] =
    useState<AgentPromptSettingsValue | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const draftRef = useRef<AgentPromptSettingsValue | null>(null);
  const savedRef = useRef<AgentPromptSettingsValue | null>(null);
  const requestVersionRef = useRef(0);

  useEffect(() => {
    let active = true;
    void props.api.getAgentPromptSettings()
      .then((value) => {
        if (!active) return;
        setSnapshot(value);
        setDraft(value.settings);
        draftRef.current = value.settings;
        savedRef.current = value.settings;
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

  const persist = useCallback(async (
    value: AgentPromptSettingsValue
  ) => {
    if (sameSettings(value, savedRef.current)) {
      setSaveState("saved");
      return;
    }
    const requestVersion = ++requestVersionRef.current;
    setSaveState("saving");
    try {
      const next = await props.api.updateAgentPromptSettings(value);
      if (requestVersion !== requestVersionRef.current) return;
      savedRef.current = next.settings;
      setSnapshot(next);
      if (sameSettings(draftRef.current, value)) {
        draftRef.current = next.settings;
        setDraft(next.settings);
        setSaveState("saved");
      } else {
        setSaveState("pending");
      }
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      setSaveState("error");
      props.onError(error);
    }
  }, [props.api, props.onError]);

  useEffect(() => {
    if (!draft || sameSettings(draft, savedRef.current)) return;
    const timer = window.setTimeout(() => {
      void persist(draft);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [draft, persist]);

  function update(
    key: keyof AgentPromptSettingsValue,
    value: string
  ) {
    if (!draft) return;
    const next = { ...draft, [key]: value };
    draftRef.current = next;
    setDraft(next);
    setSaveState("pending");
  }

  function resetField(key: keyof AgentPromptSettingsValue) {
    if (!draft || !snapshot) return;
    update(key, snapshot.defaults[key]);
  }

  async function resetAll() {
    const requestVersion = ++requestVersionRef.current;
    setSaveState("saving");
    try {
      const next = await props.api.resetAgentPromptSettings();
      if (requestVersion !== requestVersionRef.current) return;
      savedRef.current = next.settings;
      draftRef.current = next.settings;
      setSnapshot(next);
      setDraft(next.settings);
      setSaveState("saved");
    } catch (error) {
      if (requestVersion !== requestVersionRef.current) return;
      setSaveState("error");
      props.onError(error);
    }
  }

  if (!draft || !snapshot) {
    return (
      <section className="agent-prompt-settings">
        <div className="settings-loading">
          {saveState === "error"
            ? "Agent 提示词设置加载失败"
            : "正在加载 Agent 提示词设置…"}
        </div>
      </section>
    );
  }

  return (
    <section className="agent-prompt-settings">
      <header className="agent-prompt-settings-heading">
        <div>
          <h2>Agent 设置</h2>
          <p>
            配置 Agent 推理时使用的系统提示词。修改会自动保存，
            并从下一轮 Agent 任务开始生效。
          </p>
        </div>
        <div>
          <span className={`agent-prompt-save-state state-${saveState}`}>
            {saveStateLabel(saveState)}
          </span>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void resetAll()}
          >
            全部恢复默认
          </button>
        </div>
      </header>

      <PromptField
        label="Agent 主系统提示词"
        description="定义 Agent 的能力、工具使用规则、图片与建模流程。"
        value={draft.systemPrompt}
        defaultValue={snapshot.defaults.systemPrompt}
        rows={13}
        onChange={(value) => update("systemPrompt", value)}
        onBlur={() => void persist(draftRef.current ?? draft)}
        onReset={() => resetField("systemPrompt")}
      />

      <PromptField
        label="允许优化提示词时的附加规则"
        description="用户开启“Agent 优化提示词”后，每轮对话额外注入。"
        value={draft.optimizeEnabledPrompt}
        defaultValue={snapshot.defaults.optimizeEnabledPrompt}
        rows={4}
        onChange={(value) => update("optimizeEnabledPrompt", value)}
        onBlur={() => void persist(draftRef.current ?? draft)}
        onReset={() => resetField("optimizeEnabledPrompt")}
      />

      <PromptField
        label="禁止优化提示词时的附加规则"
        description="用户关闭“Agent 优化提示词”后，每轮对话额外注入。"
        value={draft.optimizeDisabledPrompt}
        defaultValue={snapshot.defaults.optimizeDisabledPrompt}
        rows={4}
        onChange={(value) => update("optimizeDisabledPrompt", value)}
        onBlur={() => void persist(draftRef.current ?? draft)}
        onReset={() => resetField("optimizeDisabledPrompt")}
      />
    </section>
  );
}

function PromptField(props: {
  label: string;
  description: string;
  value: string;
  defaultValue: string;
  rows: number;
  onChange: (value: string) => void;
  onBlur: () => void;
  onReset: () => void;
}) {
  const isDefault = props.value === props.defaultValue;
  return (
    <section className="agent-prompt-field">
      <header>
        <div>
          <strong>{props.label}</strong>
          <span>{props.description}</span>
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={isDefault}
          onClick={props.onReset}
        >
          恢复默认
        </button>
      </header>
      <textarea
        value={props.value}
        rows={props.rows}
        spellCheck={false}
        onChange={(event) => props.onChange(event.target.value)}
        onBlur={props.onBlur}
      />
      <small>{props.value.length.toLocaleString("zh-CN")} 个字符</small>
    </section>
  );
}

function sameSettings(
  left: AgentPromptSettingsValue | null,
  right: AgentPromptSettingsValue | null
): boolean {
  return Boolean(
    left &&
    right &&
    left.systemPrompt === right.systemPrompt &&
    left.optimizeEnabledPrompt === right.optimizeEnabledPrompt &&
    left.optimizeDisabledPrompt === right.optimizeDisabledPrompt
  );
}

function saveStateLabel(value: SaveState): string {
  if (value === "pending") return "等待自动保存";
  if (value === "saving") return "正在保存";
  if (value === "error") return "保存失败";
  if (value === "loading") return "正在加载";
  return "已自动保存";
}
