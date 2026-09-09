export interface AssetRef { assetId: string; label: string; position: number }
export interface ToolCall { id: string; name: string; arguments: unknown }
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "asset"; asset: AssetRef }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; callId: string; name: string; result: unknown; error: boolean }
  | { type: "provider"; provider: string; value: unknown };
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  parts: MessagePart[];
}
export interface ModelUsage { inputTokens: number; outputTokens: number }
export interface ModelResponse {
  message: ModelMessage;
  finishReason: "stop" | "tool_calls" | "length";
  usage?: ModelUsage;
}
export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "response"; response: ModelResponse };
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ModelRequest {
  projectId: string;
  messages: ModelMessage[];
  tools: ToolDefinition[];
  signal?: AbortSignal;
}
export interface ModelClient {
  contextWindow: number;
  generate(request: ModelRequest): AsyncIterable<ModelEvent>;
}
export interface PlanStep { id: string; text: string; status: "pending" | "running" | "completed" }
export interface RunContext {
  modelDefaults?: Record<string, { parameters: Record<string, unknown>; outputFormats: string[]; textureImageAssetId?: string }>;
  approvalMode?: "ask" | "auto" | "full";
  projectId: string;
  conversationId: string;
  requestMessageId: string;
  attachments: AssetRef[];
  defaults: { imageProfile?: string; imageModel?: string; modelProfile?: string; modelModel?: string };
  originalPrompt: string;
  optimizeImagePrompt: boolean;
}
export type ToolOutcome =
  | { kind: "result"; value: unknown; assets?: AssetRef[] }
  | { kind: "job"; jobId: string }
  /** A delegated child run. The parent remains suspended until the child terminates. */
  | { kind: "subagent"; runId: string }
  | { kind: "input"; prompt: string; choices: { id: string; label: string }[] };
export interface ToolContext {
  runId: string;
  operationId: string;
  context: RunContext;
  signal?: AbortSignal;
}
export interface RuntimeTool {
  definition: ToolDefinition;
  policy: "read" | "write" | "approval";
  /** Normalize defaults before approval; execution always receives the saved value. */
  prepare?: (value: unknown, context: RunContext) => unknown;
  execute(value: unknown, context: ToolContext): Promise<ToolOutcome>;
}
export interface Invocation {
  call: ToolCall;
  operationId: string;
  status: "pending" | "running" | "approval" | "job" | "input" | "done";
  arguments: unknown;
  approved?: boolean;
  approvalHash?: string;
  jobId?: string;
  childRunId?: string;
  input?: { prompt: string; choices: { id: string; label: string }[] };
  result?: unknown;
  error?: boolean;
  assets?: AssetRef[];
}
export interface RuntimeState {
  version: 3;
  runId: string;
  context: RunContext;
  status: "ready" | "running" | "waiting" | "completed" | "failed" | "cancelled";
  messages: ModelMessage[];
  plan: PlanStep[];
  invocations: Invocation[];
  turn: number;
  calls: number;
  maxCalls: number;
  summary: string;
  recentCalls: string[];
  blockedTools?: string[];
  finalText: string;
  error: string | null;
}
export interface RuntimeEvent {
  type: "run.started" | "turn.started" | "message.delta" | "message.progress" |
    "plan.updated" | "tool.started" | "tool.completed" | "run.waiting" |
    "context.compacted" | "run.completed" | "run.failed";
  data: Record<string, unknown>;
}
export interface RunStore {
  /** Atomically persist the checkpoint and event before publishing the event. */
  save(state: RuntimeState, event?: RuntimeEvent): Promise<void>;
}
export type ResumeCommand =
  | { type: "approval"; operationId: string; hash: string; approved: boolean; modelChanges?: { parameters: Record<string, unknown>; outputFormats: string[] } }
  | { type: "input"; operationId: string; text: string; choiceId?: string; assets?: AssetRef[] }
  | { type: "job"; operationId: string; jobId: string; result: unknown; error: boolean; assets?: AssetRef[] }
  | { type: "subagent"; operationId: string; runId: string; result: unknown; error: boolean };

export function textMessage(role: ModelMessage["role"], text: string): ModelMessage {
  return { role, parts: [{ type: "text", text }] };
}
export function messageText(message: ModelMessage): string {
  return message.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("");
}
