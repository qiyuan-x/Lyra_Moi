import { Fragment, useEffect, useMemo, useRef } from "react";
import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  AssetSnapshot,
  MessageSnapshot
} from "@lyra/contracts";
import { Icon } from "./Icon.js";
import { isActiveAgentRun } from "../features/conversations/agent-stream-state.js";
import { AgentRunCard } from "../features/conversations/AgentRunCard.js";
import { MessageMarkdown } from "./MessageMarkdown.js";

interface AgentPanelProps {
  messages: MessageSnapshot[];
  submitting?: boolean;
  submissionError?: string;
  runs: AgentRunSnapshot[];
  stepsByRun: Map<string, AgentStepSnapshot[]>;
  assistantName: string;
  assetsById: Map<string, AssetSnapshot>;
  thumbnailUrl: (assetId: string) => string;
  onPreview: (assetId: string) => void;
  onSubmitInput: (runId: string, text: string, choiceId?: string) => Promise<void>;
  onCancel: (runId: string) => Promise<void>;
}

export function AgentPanel(props: AgentPanelProps) {
  const messageListRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const previousLastMessageRef = useRef("");
  const runsByMessage = useMemo(
    () => new Map(props.runs.map((run) => [run.requestMessageId, run])),
    [props.runs]
  );
  const repliesByRequest = useMemo(() => new Map(props.messages
    .filter((message) => message.role === "assistant" && message.replyToId)
    .map((message) => [message.replyToId, message])), [props.messages]);
  const scrollKey = [
    props.messages.at(-1)?.id ?? "",
    props.runs.map((run) => `${run.id}:${run.status}`).join("|"),
    [...props.stepsByRun.entries()].map(([runId, steps]) => `${runId}:${steps.map((step) => `${step.id}:${step.updatedAt}:${step.payload.revision ?? 0}`).join(",")}`).join("|")
  ].join(";");

  useEffect(() => {
    const last = props.messages.at(-1);
    if (last?.role === "user" && previousLastMessageRef.current !== last.id) followOutputRef.current = true;
    previousLastMessageRef.current = last?.id ?? "";
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (list && followOutputRef.current) list.scrollTop = list.scrollHeight;
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
      <div className="message-list" ref={messageListRef} onScroll={() => {
        const list = messageListRef.current;
        if (list) followOutputRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
      }}>
        {props.messages.length === 0 && (
          <div className="agent-empty">
            <p>输入需求开始对话。</p>
            <span>生成结果会显示在工作区。</span>
          </div>
        )}
        {props.messages.filter((message) => message.role !== "system" && message.role !== "tool" &&
          !(message.role === "assistant" && message.replyToId && runsByMessage.has(message.replyToId)) &&
          (message.text.trim() || message.attachments.length || runsByMessage.has(message.id))).map((message) => {
          const run = runsByMessage.get(message.id);
          return (
            <Fragment key={message.id}><div className={`message-block role-${message.role}`}>
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
              {message.text && (message.role === "assistant" ? <MessageMarkdown text={message.text} /> : <p className="message-text">{message.text}</p>)}
            </div>
              {run && (
                <div className="agent-response role-assistant">
                <div className="message-meta"><strong>{props.assistantName}</strong></div>
                <AgentRunCard
                  run={run}
                  finalText={repliesByRequest.get(run.requestMessageId)?.text}
                  steps={props.stepsByRun.get(run.id) ?? []}
                  onSubmitInput={props.onSubmitInput}
                  onCancel={props.onCancel}
                /></div>
              )}
            </Fragment>
          );
        })}
        {props.submitting && !props.runs.some(isActiveAgentRun) && <div className="run-status" role="status"><span className="run-dot run-thinking" />正在思考</div>}
        {props.submissionError && <p className="inline-error" role="alert">{props.submissionError}</p>}
      </div>
    </section>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
