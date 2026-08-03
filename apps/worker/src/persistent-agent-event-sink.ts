import type { AgentEvent, AgentEventSink } from "@lyra/agent-engine";
import type {
  AgentRunRepository,
  AgentStepRepository,
  ConversationRepository,
  LyraDatabase,
  RuntimeEventRepository
} from "@lyra/storage";

export interface PersistentAgentEventSinkOptions {
  database: LyraDatabase;
  agentRunId: string;
  workerId: string;
  agentRuns: AgentRunRepository;
  agentSteps: AgentStepRepository;
  conversations: ConversationRepository;
  runtimeEvents: RuntimeEventRepository;
}

export class PersistentAgentEventSink implements AgentEventSink {
  readonly #database: LyraDatabase;
  readonly #agentRunId: string;
  readonly #workerId: string;
  readonly #agentRuns: AgentRunRepository;
  readonly #agentSteps: AgentStepRepository;
  readonly #conversations: ConversationRepository;
  readonly #runtimeEvents: RuntimeEventRepository;

  constructor(options: PersistentAgentEventSinkOptions) {
    this.#database = options.database;
    this.#agentRunId = options.agentRunId;
    this.#workerId = options.workerId;
    this.#agentRuns = options.agentRuns;
    this.#agentSteps = options.agentSteps;
    this.#conversations = options.conversations;
    this.#runtimeEvents = options.runtimeEvents;
  }

  emit(event: AgentEvent): void {
    if (event.runId !== this.#agentRunId) {
      throw new Error(`Agent event run ID does not match ${this.#agentRunId}.`);
    }
    const run = this.#agentRuns.requireStored(this.#agentRunId);
    switch (event.type) {
      case "agent.tool.called": {
        const toolCallId = requireString(event.data, "toolCallId");
        const toolName = requireString(event.data, "toolName");
        const toolCallCount = requirePositiveInteger(event.data, "toolCallCount");
        this.#database.transaction(() => {
          this.#agentRuns.markCallingTool(this.#agentRunId, this.#workerId, toolCallCount);
          this.#agentSteps.append({
            agentRunId: this.#agentRunId,
            type: "tool_call",
            status: "running",
            toolName,
            payload: {
              toolCallId,
              arguments: structuredClone(event.data.arguments)
            }
          });
          this.#appendRuntime(run, event);
        });
        return;
      }
      case "agent.tool.completed": {
        const toolCallId = requireString(event.data, "toolCallId");
        const toolName = requireString(event.data, "toolName");
        const toolCall = this.#agentSteps.findToolCall(this.#agentRunId, toolCallId);
        if (!toolCall) throw new Error(`Agent tool call step not found: ${toolCallId}`);
        this.#database.transaction(() => {
          this.#agentSteps.update(toolCall.id, { status: "completed" });
          this.#agentSteps.append({
            agentRunId: this.#agentRunId,
            type: "tool_result",
            status: "completed",
            toolName,
            childJobId: toolCall.childJobId,
            payload: {
              toolCallId,
              content: typeof event.data.content === "string" ? event.data.content : ""
            }
          });
          this.#appendRuntime(run, event);
        });
        return;
      }
      case "agent.waiting_tool": {
        const toolCallId = requireString(event.data, "toolCallId");
        const taskId = requireString(event.data, "taskId");
        const checkpoint = requireRecord(event.data, "checkpoint");
        this.#database.transaction(() => {
          this.#agentSteps.saveToolCheckpoint(
            this.#agentRunId,
            toolCallId,
            taskId,
            checkpoint
          );
          this.#agentRuns.releaseWaiting(
            this.#agentRunId,
            this.#workerId,
            "waiting_tool",
            { jobId: taskId, toolCallId }
          );
        });
        return;
      }
      case "agent.awaiting_user": {
        const toolCallId = requireString(event.data, "toolCallId");
        const request = requireRecord(event.data, "request");
        const checkpoint = requireRecord(event.data, "checkpoint");
        this.#database.transaction(() => {
          const requestStep = this.#agentSteps.saveUserInputCheckpoint(
            this.#agentRunId,
            toolCallId,
            request,
            checkpoint
          );
          this.#agentRuns.releaseWaiting(
            this.#agentRunId,
            this.#workerId,
            "awaiting_user",
            { requestStepId: requestStep.id, toolCallId, request }
          );
        });
        return;
      }
      case "agent.completed": {
        const text = requireStringAllowEmpty(event.data, "text");
        this.#database.transaction(() => {
          this.#agentSteps.append({
            agentRunId: this.#agentRunId,
            type: "final_message",
            status: "completed",
            payload: { text }
          });
          const message = this.#conversations.createMessage({
            conversationId: run.conversationId,
            role: "assistant",
            text,
            replyToId: run.requestMessageId
          });
          this.#runtimeEvents.append({
            projectId: run.projectId,
            conversationId: run.conversationId,
            agentRunId: run.id,
            jobId: null,
            type: "message.created",
            payload: { messageId: message.id, role: "assistant" },
            createdAt: message.createdAt
          });
          this.#agentRuns.complete(this.#agentRunId, this.#workerId, {
            messageId: message.id
          });
        });
        return;
      }
      case "agent.thinking":
      case "agent.resuming":
        this.#appendRuntime(run, event);
        return;
    }
  }

  #appendRuntime(
    run: ReturnType<AgentRunRepository["requireStored"]>,
    event: AgentEvent
  ): void {
    this.#runtimeEvents.append({
      projectId: run.projectId,
      conversationId: run.conversationId,
      agentRunId: run.id,
      jobId: null,
      type: event.type,
      payload: structuredClone(event.data),
      createdAt: event.createdAt
    });
  }
}

function requireString(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string" || !value) throw new Error(`Agent event ${key} is required.`);
  return value;
}

function requireStringAllowEmpty(data: Record<string, unknown>, key: string): string {
  const value = data[key];
  if (typeof value !== "string") throw new Error(`Agent event ${key} must be a string.`);
  return value;
}

function requirePositiveInteger(data: Record<string, unknown>, key: string): number {
  const value = data[key];
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new Error(`Agent event ${key} must be a positive integer.`);
  }
  return value as number;
}

function requireRecord(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = data[key];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Agent event ${key} must be an object.`);
  }
  return structuredClone(value as Record<string, unknown>);
}
