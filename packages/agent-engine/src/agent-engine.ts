import { randomUUID } from "node:crypto";
import { AgentCheckpointError, AgentToolCallLimitError } from "./errors.js";
import { noOpAgentEventSink } from "./event-sink.js";
import type { ToolRegistry } from "./tool-registry.js";
import type {
  AgentEvent,
  AgentEventSink,
  AgentMessage,
  AgentResumeInput,
  AgentRunInput,
  AgentRunOutcome,
  AgentToolContext,
  AgentToolCheckpoint,
  AgentUserInputCheckpoint,
  AgentUserInputResumeInput,
  LlmProvider
} from "./types.js";

export interface AgentEngineOptions {
  provider: LlmProvider;
  tools: ToolRegistry;
  eventSink?: AgentEventSink;
  maxToolCalls?: number;
}

interface RunState {
  runId: string;
  messages: AgentMessage[];
  context: AgentToolContext;
  toolCallCount: number;
}

export class AgentEngine {
  readonly #provider: LlmProvider;
  readonly #tools: ToolRegistry;
  readonly #eventSink: AgentEventSink;
  readonly #maxToolCalls: number;

  constructor(options: AgentEngineOptions) {
    this.#provider = options.provider;
    this.#tools = options.tools;
    this.#eventSink = options.eventSink ?? noOpAgentEventSink;
    this.#maxToolCalls = options.maxToolCalls ?? 10;
    if (!Number.isInteger(this.#maxToolCalls) || this.#maxToolCalls < 1) {
      throw new Error("maxToolCalls must be a positive integer.");
    }
  }

  async run(input: AgentRunInput, signal?: AbortSignal): Promise<AgentRunOutcome> {
    const state: RunState = {
      runId: input.runId?.trim() || randomUUID(),
      messages: structuredClone(input.messages),
      context: structuredClone(input.context),
      toolCallCount: 0
    };
    return this.#continue(state, signal);
  }

  async resume(
    checkpoint: AgentToolCheckpoint,
    toolResult: AgentResumeInput,
    signal?: AbortSignal
  ): Promise<AgentRunOutcome> {
    validateCheckpoint(checkpoint, toolResult);
    const state: RunState = {
      runId: checkpoint.runId,
      messages: structuredClone(checkpoint.messages),
      context: structuredClone(checkpoint.context),
      toolCallCount: checkpoint.toolCallCount
    };
    state.messages.push({
      role: "tool",
      content: toolResult.content,
      toolCallId: checkpoint.pendingTool.call.id,
      toolName: checkpoint.pendingTool.call.name
    });
    await this.#emit(state.runId, "agent.tool.completed", {
      taskId: toolResult.taskId,
      toolCallId: checkpoint.pendingTool.call.id,
      toolName: checkpoint.pendingTool.call.name,
      content: toolResult.content
    });
    await this.#emit(state.runId, "agent.resuming", { taskId: toolResult.taskId });
    return this.#continue(state, signal);
  }

  async resumeUserInput(
    checkpoint: AgentUserInputCheckpoint,
    userInput: AgentUserInputResumeInput,
    signal?: AbortSignal
  ): Promise<AgentRunOutcome> {
    validateUserInputCheckpoint(checkpoint, userInput);
    const state: RunState = {
      runId: checkpoint.runId,
      messages: structuredClone(checkpoint.messages),
      context: structuredClone(checkpoint.context),
      toolCallCount: checkpoint.toolCallCount
    };
    if (userInput.attachments?.length) {
      state.context.attachments = structuredClone(userInput.attachments);
    }
    const userInputContent = JSON.stringify({
      text: userInput.text,
      choiceId: userInput.choiceId ?? null,
      attachments: userInput.attachments ?? []
    });
    state.messages.push({
      role: "tool",
      content: userInputContent,
      toolCallId: checkpoint.pendingUserInput.call.id,
      toolName: checkpoint.pendingUserInput.call.name
    });
    await this.#emit(state.runId, "agent.tool.completed", {
      toolCallId: checkpoint.pendingUserInput.call.id,
      toolName: checkpoint.pendingUserInput.call.name,
      userInput: true,
      content: userInputContent
    });
    await this.#emit(state.runId, "agent.resuming", { userInput: true });
    return this.#continue(state, signal);
  }

  async #continue(state: RunState, signal?: AbortSignal): Promise<AgentRunOutcome> {
    while (true) {
      signal?.throwIfAborted();
      const canUseTools = state.toolCallCount < this.#maxToolCalls;
      await this.#emit(state.runId, "agent.thinking", {
        toolCallCount: state.toolCallCount,
        toolsEnabled: canUseTools
      });
      signal?.throwIfAborted();

      const completion = await this.#provider.complete({
        messages: structuredClone(state.messages),
        tools: canUseTools ? this.#tools.definitions() : [],
        projectId: state.context.projectId,
        signal
      });
      signal?.throwIfAborted();

      if (completion.type === "message") {
        const text = completion.text.trim();
        state.messages.push({ role: "assistant", content: text });
        await this.#emit(state.runId, "agent.completed", {
          text,
          toolCallCount: state.toolCallCount
        });
        return {
          status: "completed",
          runId: state.runId,
          text,
          messages: structuredClone(state.messages),
          toolCallCount: state.toolCallCount
        };
      }

      if (!canUseTools) throw new AgentToolCallLimitError(this.#maxToolCalls);

      const call = structuredClone(completion.call);
      state.toolCallCount += 1;
      state.messages.push({ role: "assistant", content: "", toolCall: call });
      await this.#emit(state.runId, "agent.tool.called", {
        toolCallId: call.id,
        toolName: call.name,
        toolCallCount: state.toolCallCount,
        arguments: structuredClone(call.arguments)
      });

      const toolContext = structuredClone(state.context);
      toolContext.metadata = {
        ...toolContext.metadata,
        agentRunId: state.runId,
        agentToolCallId: call.id,
        agentToolName: call.name,
        agentToolCallCount: state.toolCallCount
      };
      const result = await this.#tools.execute(call.name, call.arguments, toolContext, signal);
      if (result.status === "waiting_tool") {
        const checkpoint: AgentToolCheckpoint = {
          version: 1,
          runId: state.runId,
          messages: structuredClone(state.messages),
          context: structuredClone(state.context),
          toolCallCount: state.toolCallCount,
          pendingTool: {
            call,
            taskId: result.taskId
          }
        };
        await this.#emit(state.runId, "agent.waiting_tool", {
          taskId: result.taskId,
          toolCallId: call.id,
          toolName: call.name,
          checkpoint: structuredClone(checkpoint)
        });
        return {
          status: "waiting_tool",
          runId: state.runId,
          taskId: result.taskId,
          checkpoint
        };
      }

      if (result.status === "awaiting_user") {
        const checkpoint: AgentUserInputCheckpoint = {
          version: 2,
          runId: state.runId,
          messages: structuredClone(state.messages),
          context: structuredClone(state.context),
          toolCallCount: state.toolCallCount,
          pendingUserInput: {
            call,
            request: structuredClone(result.request)
          }
        };
        await this.#emit(state.runId, "agent.awaiting_user", {
          toolCallId: call.id,
          toolName: call.name,
          request: structuredClone(result.request),
          checkpoint: structuredClone(checkpoint)
        });
        return {
          status: "awaiting_user",
          runId: state.runId,
          request: structuredClone(result.request),
          checkpoint
        };
      }

      state.messages.push({
        role: "tool",
        content: result.content,
        toolCallId: call.id,
        toolName: call.name
      });
      await this.#emit(state.runId, "agent.tool.completed", {
        toolCallId: call.id,
        toolName: call.name,
        content: result.content
      });
    }
  }

  async #emit(
    runId: string,
    type: AgentEvent["type"],
    data: Record<string, unknown>
  ): Promise<void> {
    await this.#eventSink.emit({
      runId,
      type,
      data: structuredClone(data),
      createdAt: new Date().toISOString()
    });
  }
}

function validateCheckpoint(checkpoint: AgentToolCheckpoint, toolResult: AgentResumeInput): void {
  if (checkpoint.version !== 1) {
    throw new AgentCheckpointError(`Unsupported Agent checkpoint version: ${checkpoint.version}`);
  }
  if (checkpoint.pendingTool.taskId !== toolResult.taskId) {
    throw new AgentCheckpointError("Tool result does not match the pending Agent task.");
  }
}

function validateUserInputCheckpoint(
  checkpoint: AgentUserInputCheckpoint,
  input: AgentUserInputResumeInput
): void {
  if (checkpoint.version !== 2) {
    throw new AgentCheckpointError(
      `Unsupported Agent user-input checkpoint version: ${checkpoint.version}`
    );
  }
  if (!input.text.trim() && !input.choiceId?.trim() && !input.attachments?.length) {
    throw new AgentCheckpointError("Agent user input cannot be empty.");
  }
  if (input.choiceId && !checkpoint.pendingUserInput.request.choices.some((choice) => choice.id === input.choiceId)) {
    throw new AgentCheckpointError("Agent user input choice is invalid.");
  }
}
