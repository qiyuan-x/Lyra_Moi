import { useState } from "react";
import type { AgentRunSnapshot, AgentStepSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import { MessageMarkdown } from "../../components/MessageMarkdown.js";
import { isActiveAgentRun } from "./agent-stream-state.js";
import { buildAgentTimeline } from "./agent-timeline.js";
import { AgentToolStep } from "./AgentToolStep.js";

const runStatusText: Record<AgentRunSnapshot["status"], string> = {
  queued: "正在思考",
  thinking: "正在思考",
  calling_tool: "正在调用工具",
  waiting_tool: "等待生成结果",
  resuming: "正在思考",
  awaiting_user: "等待你的回复",
  completed: "已完成",
  failed: "执行失败",
  cancelled: "已取消",
  interrupted: "已中断"
};

interface AgentRunCardProps {
  finalText?: string | undefined;
  run: AgentRunSnapshot;
  steps: AgentStepSnapshot[];
  onSubmitInput: (runId: string, text: string, choiceId?: string) => Promise<void>;
  onCancel: (runId: string) => Promise<void>;
}

export function AgentRunCard({ run, steps, finalText, onSubmitInput, onCancel }: AgentRunCardProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [inputError, setInputError] = useState("");
  const active = isActiveAgentRun(run);
  const waitingStep = [...steps].reverse().find((step) => step.type === "user_input_request" && step.status === "waiting");
  const request = readInputRequest(waitingStep?.payload.request);
  const timeline = buildAgentTimeline(steps, finalText);
  const last = timeline.at(-1);
  const streaming = active && run.status === "thinking" && last?.kind === "text" && last.streaming;

  async function submit(choiceId?: string) {
    if (submitting || (!choiceId && !input.trim())) return;
    setSubmitting(true);
    setInputError("");
    try {
      await onSubmitInput(run.id, input.trim(), choiceId);
      setInput("");
    } catch (error) {
      setInputError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="run-card">
      <div className="run-status" role="status">
        <span className={`run-dot run-${run.status}`} />
        <span>{streaming ? "正在输出" : runStatusText[run.status]}</span>
        {active && run.status !== "awaiting_user" && (
          <button type="button" onClick={() => void onCancel(run.id).catch((error) => setInputError(error instanceof Error ? error.message : String(error)))}>停止</button>
        )}
      </div>
      <div className="agent-timeline">
        {timeline.map((item) => {
          if (item.kind === "text") return <div className="agent-live-response" key={item.id} data-step-id={item.id} aria-busy={active && item.streaming}>
            <MessageMarkdown text={item.text} />
          </div>;
          if (item.kind === "tool") return <AgentToolStep key={item.id} step={item.step} result={item.result} runStatus={run.status} />;
          if (item.kind === "plan") {
            const value = item.step.payload.steps;
            const plan = Array.isArray(value) ? value.filter(isRecord).filter((step) =>
              typeof step.id === "string" && typeof step.text === "string" && ["pending", "running", "completed"].includes(String(step.status))) : [];
            return plan.length > 0 && <ol key={item.id} className="agent-plan" aria-label="执行计划" data-step-id={item.id}>
              {plan.map((step) => <li key={String(step.id)} data-status={String(step.status)}>
                <span>{step.status === "completed" ? "已完成" : step.status === "running" ? "执行中" : "待执行"}</span><span>{String(step.text)}</span>
              </li>)}
            </ol>;
          }
          const inputRequest = readInputRequest(item.step.payload.request);
          if (!inputRequest || item.step.status === "waiting") return null;
          return <div className="agent-input-record" key={item.id} data-step-id={item.id}>
            {inputRequest.metadata?.kind === "approval" ? "操作审核已处理" : inputRequest.prompt}
          </div>;
        })}
      </div>
      {run.errorMessage && <p className="inline-error" role="alert">{run.errorMessage}</p>}
      {inputError && <p className="inline-error" role="alert">{inputError}</p>}
      {run.status === "awaiting_user" && request && request.metadata?.kind !== "approval" && (
        <div className="agent-question">
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
          {request.metadata?.kind !== "approval" && <div className="question-input">
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="补充说明" />
            <button type="button" disabled={submitting || !input.trim()} onClick={() => void submit()}>
              <Icon name="send" size={15} />
            </button>
          </div>}
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
