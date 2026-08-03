import type { EntityId, OrderedAssetInput, UtcDateTime } from "./common.js";

export type GenerationSource = "agent" | "manual";

export interface GenerationRequest {
  projectId: EntityId;
  prompt: string;
  attachments: OrderedAssetInput[];
  providerProfileId: EntityId;
  providerModelId: EntityId;
  count: number;
  parameters: Record<string, unknown>;
  source: GenerationSource;
}

export interface GeneratedAsset {
  id: EntityId;
  mimeType: string;
  width: number | null;
  height: number | null;
  name: string;
}

export type GenerationTaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface GenerationTaskSnapshot {
  id: EntityId;
  status: GenerationTaskStatus;
  request: GenerationRequest;
  outputs: GeneratedAsset[];
  error: string | null;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

export interface ManualGenerationRequestBody {
  projectId: EntityId;
  conversationId?: EntityId;
  prompt: string;
  attachments: OrderedAssetInput[];
  providerProfileId: EntityId;
  providerModelId: EntityId;
  count: number;
  parameters: Record<string, unknown>;
}
