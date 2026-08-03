import type { EntityId, UtcDateTime } from "./common.js";
import type { GenerationSource, GenerationTaskStatus } from "./generation.js";

export type JobKind = "image.generate" | "model.generate";

export interface JobInputSnapshot {
  assetId: EntityId;
  position: number;
  label: string;
}

export interface JobOutputSnapshot {
  assetId: EntityId;
  position: number;
}

export interface JobSnapshot {
  id: EntityId;
  projectId: EntityId;
  conversationId: EntityId | null;
  agentRunId: EntityId | null;
  agentStepId: EntityId | null;
  requestMessageId: EntityId | null;
  retryOfJobId: EntityId | null;
  source: GenerationSource;
  kind: JobKind;
  status: GenerationTaskStatus;
  title: string;
  stage: string;
  providerProfileId: EntityId;
  providerModelId: EntityId;
  providerName: string;
  remoteModelId: string;
  prompt: string | null;
  count: number | null;
  parameters: Record<string, unknown>;
  cancelRequested: boolean;
  attempt: number;
  inputs: JobInputSnapshot[];
  outputs: JobOutputSnapshot[];
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  progress: number;
  externalTaskId: string | null;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
  startedAt: UtcDateTime | null;
  finishedAt: UtcDateTime | null;
  dismissedAt: UtcDateTime | null;
}

export interface RuntimeEventSnapshot {
  id: number;
  projectId: EntityId;
  conversationId: EntityId | null;
  agentRunId: EntityId | null;
  jobId: EntityId | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: UtcDateTime;
}

export type WorkerKind = "combined" | "agent" | "image" | "model";

export interface WorkerInstanceSnapshot {
  id: EntityId;
  kind: WorkerKind;
  version: string;
  pid: number | null;
  startedAt: UtcDateTime;
  heartbeatAt: UtcDateTime;
  stoppedAt: UtcDateTime | null;
}

export interface JobListQuery {
  projectId: EntityId;
  conversationId?: EntityId;
  agentRunId?: EntityId;
  source?: GenerationSource;
  status?: GenerationTaskStatus;
  kind?: JobKind;
  limit?: number;
}
