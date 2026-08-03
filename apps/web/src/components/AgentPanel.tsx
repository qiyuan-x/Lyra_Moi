import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  AssetSnapshot,
  MessageSnapshot
} from "@lyra/contracts";
import { Icon } from "./Icon.js";

interface AgentPanelProps {
  messages: MessageSnapshot[];
  runs: AgentRunSnapshot[];
  stepsByRun: Map<string, AgentStepSnapshot[]>;
  assistantName: string;
  assetsById: Map<string, AssetSnapshot>;
  thumbnailUrl: (assetId: string) => string;
  onPreview: (assetId: string) => void;
  onSubmitInput: (runId: string, text: string, choiceId?: string) => Promise<void>;
  onCancel: (runId: string) => Promise<void>;
}

const runStatusText: Record<AgentRunSnapshot["status"], string> = {
  queued: "等待执行",
  thinking: "正在理解",
  calling_tool: "正在调用工具",
  waiting_tool: "等待生成结果",
  resuming: "继续执行",
  awaiting_user: "等待你的回复",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
  interrupted: "已中断"
};

export function AgentPanel(props: AgentPanelProps) {
  const messageListRef = useRef<HTMLDivElement>(null);
  const runsByMessage = useMemo(
    () => new Map(props.runs.map((run) => [run.requestMessageId, run])),
    [props.runs]
  );
  const scrollKey = [
    props.messages.at(-1)?.id ?? "",
    props.runs.map((run) => `${run.id}:${run.status}`).join("|"),
    [...props.stepsByRun.entries()].map(([runId, steps]) => `${runId}:${steps.length}`).join("|")
  ].join(";");

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [scrollKey]);

  return (
    <section className="agent-panel" aria-label="对话">
      <header className="panel-header">
        <div>
          <Icon name="chat" size={18} />
          <strong>对话</strong>
        </div>
      </header>
      <div className="message-list" ref={messageListRef}>
        {props.messages.length === 0 && (
          <div className="agent-empty">
            <p>输入需求开始对话。</p>
            <span>生成结果会显示在工作区。</span>
          </div>
        )}
        {props.messages.filter((message) => message.role !== "system" && message.role !== "tool").map((message) => {
          const run = runsByMessage.get(message.id);
          return (
            <div className={`message-block role-${message.role}`} key={message.id}>
              <div className="message-meta">
                <strong>{message.role === "user" ? "你" : props.assistantName}</strong>
                <time>{formatTime(message.createdAt)}</time>
              </div>
              {message.attachments.length > 0 && (
                <div className="message-attachments">
                  {message.attachments.map((attachment) => (
                    <button type="button" key={`${message.id}-${attachment.position}`} onClick={() => props.onPreview(attachment.assetId)}>
                      <img
                        src={props.thumbnailUrl(attachment.assetId)}
                        alt={props.assetsById.get(attachment.assetId)?.name ?? attachment.label}
                      />
                      <span>{attachment.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {message.text && <p className="message-text">{message.text}</p>}
              {run && (
                <RunCard
                  run={run}
                  steps={props.stepsByRun.get(run.id) ?? []}
                  onSubmitInput={props.onSubmitInput}
                  onCancel={props.onCancel}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

interface RunCardProps {
  run: AgentRunSnapshot;
  steps: AgentStepSnapshot[];
  onSubmitInput: (runId: string, text: string, choiceId?: string) => Promise<void>;
  onCancel: (runId: string) => Promise<void>;
}

function RunCard({ run, steps, onSubmitInput, onCancel }: RunCardProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const active = !["completed", "failed", "cancelled", "interrupted"].includes(run.status);
  const visibleSteps = steps.filter((step) => ["tool_call", "tool_result", "user_input_request"].includes(step.type));
  const waitingStep = [...steps].reverse().find((step) => step.type === "user_input_request" && step.status === "waiting");
  const request = readInputRequest(waitingStep?.payload.request);

  async function submit(choiceId?: string) {
    if (submitting || (!choiceId && !input.trim())) return;
    setSubmitting(true);
    try {
      await onSubmitInput(run.id, input.trim(), choiceId);
      setInput("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="run-card">
      <div className="run-status">
        <span className={`run-dot run-${run.status}`} />
        <span>{runStatusText[run.status]}</span>
        {active && run.status !== "awaiting_user" && (
          <button type="button" onClick={() => void onCancel(run.id)}>停止</button>
        )}
      </div>
      {visibleSteps.length > 0 && (
        <details className="run-steps" open={active}>
          <summary>{visibleSteps.length} 条执行记录</summary>
          <div>
            {visibleSteps.map((step) => (
              <div className="step-row" key={step.id}>
                <span className={`step-state step-${step.status}`} />
                <div>
                  <strong>{step.toolName || stepLabel(step.type)}</strong>
                  <small>{stepSummary(step)}</small>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
      {run.errorMessage && <p className="inline-error">{run.errorMessage}</p>}
      {run.status === "awaiting_user" && request && (
        <div className="agent-question">
          {request.metadata?.kind === "approval" && (
            <span className="agent-question-kind">操作审核</span>
          )}
          <strong>{request.prompt}</strong>
          {request.choices.length > 0 && (
            <div className="choice-row">
              {request.choices.map((choice) => (
                <button type="button" disabled={submitting} key={choice.id} onClick={() => void submit(choice.id)}>
                  {choice.label}
                </button>
              ))}
            </div>
          )}
          <div className="question-input">
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="补充说明" />
            <button type="button" disabled={submitting || !input.trim()} onClick={() => void submit()}>
              <Icon name="send" size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function readInputRequest(value: unknown): {
  prompt: string;
  choices: Array<{ id: string; label: string }>;
  metadata?: Record<string, unknown>;
} | null {
  if (!isRecord(value) || typeof value.prompt !== "string") return null;
  const choices = Array.isArray(value.choices)
    ? value.choices.filter(isRecord).flatMap((choice) =>
        typeof choice.id === "string" && typeof choice.label === "string"
          ? [{ id: choice.id, label: choice.label }]
          : []
      )
    : [];
  return {
    prompt: value.prompt,
    choices,
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {})
  };
}

function stepSummary(step: AgentStepSnapshot): string {
  if (step.type === "tool_call" && isRecord(step.payload.arguments)) {
    const prompt = step.payload.arguments.prompt;
    if (typeof prompt === "string") return prompt;
  }
  if (step.type === "tool_result") {
    if (typeof step.payload.error === "string") return step.payload.error;
    if (typeof step.payload.taskId === "string") return `任务 ${step.payload.taskId.slice(0, 8)}`;
  }
  return step.status === "completed" ? "完成" : step.status === "waiting" ? "等待" : "执行中";
}

function stepLabel(type: AgentStepSnapshot["type"]): string {
  if (type === "tool_call") return "调用工具";
  if (type === "tool_result") return "工具结果";
  return "等待回复";
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
