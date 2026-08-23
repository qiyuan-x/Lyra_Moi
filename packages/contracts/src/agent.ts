import type { EntityId, OrderedAssetInput, UtcDateTime } from "./common.js";

export type MessageRole = "user" | "assistant" | "system" | "tool";

export interface ConversationSnapshot {
  id: EntityId;
  projectId: EntityId;
  title: string;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
  deletedAt: UtcDateTime | null;
}

export interface MessageSnapshot {
  id: EntityId;
  conversationId: EntityId;
  role: MessageRole;
  text: string;
  replyToId: EntityId | null;
  attachments: OrderedAssetInput[];
  createdAt: UtcDateTime;
}

export type AgentRunStatus =
  | "queued"
  | "thinking"
  | "calling_tool"
  | "waiting_tool"
  | "resuming"
  | "awaiting_user"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export type AgentStepType =
  | "llm_request"
  | "llm_response"
  | "tool_call"
  | "tool_result"
  | "user_input_request"
  | "user_input_result"
  | "final_message";

export type AgentStepStatus = "pending" | "running" | "waiting" | "completed" | "failed";

export interface AgentRunSnapshot {
  id: EntityId;
  projectId: EntityId;
  conversationId: EntityId;
  requestMessageId: EntityId;
  status: AgentRunStatus;
  toolCallCount: number;
  currentStep: number;
  cancelRequested: boolean;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
  finishedAt: UtcDateTime | null;
}

export interface AgentStepSnapshot {
  id: EntityId;
  agentRunId: EntityId;
  sequence: number;
  type: AgentStepType;
  status: AgentStepStatus;
  toolName: string | null;
  payload: Record<string, unknown>;
  childJobId: EntityId | null;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

export interface SendAgentMessageRequestBody {
  text: string;
  attachments: OrderedAssetInput[];
  optimizeImagePrompt?: boolean;
  selection?: {
    llmProviderProfileId?: EntityId;
    llmModelId?: EntityId;
    defaultImageProviderProfileId?: EntityId;
    defaultImageModelId?: EntityId;
    defaultModelProviderProfileId?: EntityId;
    defaultModelId?: EntityId;
  };
}

export interface ResumeAgentUserInputRequestBody {
  text: string;
  choiceId?: string;
  attachments: OrderedAssetInput[];
}
