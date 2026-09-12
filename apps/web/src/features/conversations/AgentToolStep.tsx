import { memo } from "react";
import type { AgentRunStatus, AgentStepSnapshot } from "@lyra/contracts";

const labels: Record<string, string> = {
  generate_image: "生成图片", generate_model: "生成模型", update_plan: "更新计划",
  list_assets: "查看素材", inspect_asset: "查看素材详情", update_asset: "修改素材", delete_asset: "删除素材",
  list_jobs: "查看生成任务", get_job: "查看任务详情", cancel_job: "取消任务", retry_job: "重试任务", dismiss_job: "移除任务",
  delegate_subagent: "创建子智能体", request_user_input: "询问信息",
  list_app_tools: "查看应用功能", list_projects: "查看项目", create_project: "创建项目", update_project: "修改项目",
  list_conversations: "查看对话", rename_conversation: "修改对话名称", list_provider_models: "查看可用模型",
  list_prompt_templates: "查看提示词", create_prompt_template: "保存提示词", update_prompt_template: "修改提示词", delete_prompt_template: "删除提示词"
};
const statuses = { pending: "准备调用", running: "执行中", waiting: "等待中", completed: "已完成", failed: "失败" };

export const AgentToolStep = memo(function AgentToolStep({ step, result, runStatus }: {
  step: AgentStepSnapshot; result?: AgentStepSnapshot | undefined; runStatus: AgentRunStatus;
}) {
  const status = result?.status ?? step.status;
  const stopped = !["completed", "failed"].includes(status) && ["cancelled", "interrupted", "failed"].includes(runStatus);
  return <details className="agent-tool-step" data-step-id={step.id}>
    <summary>
      <span className={`step-state step-${stopped ? "pending" : status}`} />
      <span className="agent-tool-name">{labels[step.toolName ?? ""] ?? step.toolName ?? "调用工具"}</span>
      <span className="agent-tool-status">{stopped ? "已停止" : statuses[status]}</span>
    </summary>
    <div className="agent-tool-details">
      {step.type === "tool_call" && step.payload.arguments != null && <div>
        <span>调用参数</span><pre className="agent-tool-result">{formatValue(step.payload.arguments)}</pre>
      </div>}
      {result && <div>
        <span>执行结果</span><pre className="agent-tool-result">{formatValue(result.payload.content ?? result.payload.error ?? "完成")}</pre>
      </div>}
    </div>
  </details>;
});

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
}
