import { Icon } from "../../components/Icon.js";

interface AgentSettingsOverviewProps {
  onOpenPrompts: () => void;
  onOpenRuntime: () => void;
}

export function AgentSettingsOverview(props: AgentSettingsOverviewProps) {
  return (
    <section className="agent-settings-overview">
      <header className="settings-overview-heading">
        <div>
          <h2>Agent 设置</h2>
          <p>管理 Agent 使用的系统提示词和运行参数。</p>
        </div>
      </header>

      <div className="agent-settings-list" role="list">
        <AgentSettingsRow
          icon="prompt"
          title="Agent 提示词设置"
          description="配置系统提示词和图片提示词处理规则。"
          summary="3 项提示词"
          onOpen={props.onOpenPrompts}
        />
        <AgentSettingsRow
          icon="settings"
          title="其他设置"
          description="配置 Agent 单轮可调用工具的最大次数。"
          summary="运行参数"
          onOpen={props.onOpenRuntime}
        />
      </div>
    </section>
  );
}

function AgentSettingsRow(props: {
  icon: "prompt" | "settings";
  title: string;
  description: string;
  summary: string;
  onOpen: () => void;
}) {
  return (
    <article role="listitem">
      <span className="agent-settings-row-icon">
        <Icon name={props.icon} size={19} />
      </span>
      <div>
        <strong>{props.title}</strong>
        <small>{props.description}</small>
      </div>
      <span className="agent-settings-row-summary">{props.summary}</span>
      <button
        type="button"
        className="button button-secondary"
        onClick={props.onOpen}
      >
        配置
      </button>
    </article>
  );
}
