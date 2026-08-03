import type { OrderedAssetInput } from "@lyra/contracts";

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export interface AgentToolCall {
  id: string;
  name: string;
  arguments: unknown;
  providerMetadata?: Record<string, unknown>;
}

export interface AgentMessage {
  role: AgentMessageRole;
  content: string;
  toolCall?: AgentToolCall;
  toolCallId?: string;
  toolName?: string;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AgentToolContext {
  projectId: string;
  attachments: OrderedAssetInput[];
  defaultImageProviderProfileId?: string;
  defaultImageModelId?: string;
  defaultModelProviderProfileId?: string;
  defaultModelId?: string;
  metadata: Record<string, unknown>;
}

export interface CompletedToolResult {
  status: "completed";
  content: string;
}

export interface WaitingToolResult {
  status: "waiting_tool";
  taskId: string;
  content: string;
}

export interface AgentUserInputChoice {
  id: string;
  label: string;
}

export interface AgentUserInputRequest {
  prompt: string;
  choices: AgentUserInputChoice[];
  metadata?: Record<string, unknown>;
}

export interface AwaitingUserToolResult {
  status: "awaiting_user";
  request: AgentUserInputRequest;
}

export type AgentToolResult = CompletedToolResult | WaitingToolResult | AwaitingUserToolResult;

export interface AgentTool {
  definition: AgentToolDefinition;
  execute(
    argumentsValue: unknown,
    context: AgentToolContext,
    signal: AbortSignal | undefined
  ): Promise<AgentToolResult>;
}

export interface LlmCompletionInput {
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  signal: AbortSignal | undefined;
}

export type LlmCompletion =
  | { type: "message"; text: string }
  | { type: "tool_call"; call: AgentToolCall };

export interface LlmProvider {
  complete(input: LlmCompletionInput): Promise<LlmCompletion>;
}

export interface AgentRunInput {
  runId?: string;
  messages: AgentMessage[];
  context: AgentToolContext;
}

export interface AgentToolCheckpoint {
  version: 1;
  runId: string;
  messages: AgentMessage[];
  context: AgentToolContext;
  toolCallCount: number;
  pendingTool: {
    call: AgentToolCall;
    taskId: string;
  };
}

export interface AgentUserInputCheckpoint {
  version: 2;
  runId: string;
  messages: AgentMessage[];
  context: AgentToolContext;
  toolCallCount: number;
  pendingUserInput: {
    call: AgentToolCall;
    request: AgentUserInputRequest;
  };
}

export type AgentCheckpoint = AgentToolCheckpoint | AgentUserInputCheckpoint;

export interface CompletedAgentRun {
  status: "completed";
  runId: string;
  text: string;
  messages: AgentMessage[];
  toolCallCount: number;
}

export interface WaitingAgentRun {
  status: "waiting_tool";
  runId: string;
  taskId: string;
  checkpoint: AgentToolCheckpoint;
}

export interface AwaitingUserAgentRun {
  status: "awaiting_user";
  runId: string;
  request: AgentUserInputRequest;
  checkpoint: AgentUserInputCheckpoint;
}

export type AgentRunOutcome = CompletedAgentRun | WaitingAgentRun | AwaitingUserAgentRun;

export interface AgentResumeInput {
  taskId: string;
  content: string;
}

export interface AgentUserInputResumeInput {
  text: string;
  choiceId?: string;
  attachments?: OrderedAssetInput[];
}

export interface AgentEvent {
  runId: string;
  type:
    | "agent.thinking"
    | "agent.tool.called"
    | "agent.tool.completed"
    | "agent.waiting_tool"
    | "agent.awaiting_user"
    | "agent.resuming"
    | "agent.completed";
  data: Record<string, unknown>;
  createdAt: string;
}

export interface AgentEventSink {
  emit(event: AgentEvent): void | Promise<void>;
}
