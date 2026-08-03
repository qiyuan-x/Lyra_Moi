import type { EntityId } from "./common.js";
import type { GenerationSource } from "./generation.js";

export type ModelOutputFormat =
  | "glb"
  | "obj"
  | "fbx"
  | "stl"
  | "usdz"
  | "3mf";

export interface ModelGenerationRequest {
  projectId: EntityId;
  inputImageAssetId: EntityId;
  textureImageAssetId?: EntityId;
  providerProfileId: EntityId;
  providerModelId: EntityId;
  outputFormats: ModelOutputFormat[];
  parameters: Record<string, unknown>;
  source: GenerationSource;
}

export interface ManualModelGenerationRequestBody {
  projectId: EntityId;
  imageAssetId: EntityId;
  textureImageAssetId?: EntityId;
  providerProfileId: EntityId;
  providerModelId: EntityId;
  outputFormats: ModelOutputFormat[];
  parameters: Record<string, unknown>;
}

export type JobRequest = import("./generation.js").GenerationRequest | ModelGenerationRequest;

export function isModelGenerationRequest(
  request: JobRequest
): request is ModelGenerationRequest {
  return "inputImageAssetId" in request;
}
