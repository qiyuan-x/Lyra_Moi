import type { EntityId } from "./common.js";
import type { GenerationSource } from "./generation.js";
import type { ProviderAdapterType } from "./provider.js";

export type ModelOutputFormat =
  | "glb"
  | "obj"
  | "fbx"
  | "stl"
  | "usdz"
  | "3mf";

interface ModelGenerationRequestBase {
  projectId: EntityId;
  textureImageAssetId?: EntityId;
  providerProfileId: EntityId;
  providerModelId: EntityId;
  outputFormats: ModelOutputFormat[];
  parameters: Record<string, unknown>;
  source: GenerationSource;
}

export interface ImageToModelGenerationRequest
  extends ModelGenerationRequestBase {
  inputMode: "image";
  inputImageAssetId: EntityId;
}

export interface TextToModelGenerationRequest
  extends ModelGenerationRequestBase {
  inputMode: "text";
  prompt: string;
}

export type ModelGenerationRequest =
  | ImageToModelGenerationRequest
  | TextToModelGenerationRequest;

interface ManualModelGenerationRequestBase {
  projectId: EntityId;
  textureImageAssetId?: EntityId;
  providerProfileId: EntityId;
  providerModelId: EntityId;
  outputFormats: ModelOutputFormat[];
  parameters: Record<string, unknown>;
}

export type ManualModelGenerationRequestBody =
  | (ManualModelGenerationRequestBase & {
      inputMode: "image";
      imageAssetId: EntityId;
    })
  | (ManualModelGenerationRequestBase & {
      inputMode: "text";
      prompt: string;
    });

export type ManualModelGenerationInput =
  ManualModelGenerationRequestBody extends infer Request
    ? Request extends unknown
      ? Omit<Request, "projectId">
      : never
    : never;

export type JobRequest =
  | import("./generation.js").GenerationRequest
  | ModelGenerationRequest;

export function isModelGenerationRequest(
  request: JobRequest
): request is ModelGenerationRequest {
  return "outputFormats" in request;
}

export function isTextToModelGenerationRequest(
  request: ModelGenerationRequest
): request is TextToModelGenerationRequest {
  return request.inputMode === "text";
}

export function isMeshyGenerationModel(
  adapterType: ProviderAdapterType | undefined,
  remoteModelId: string
): boolean {
  if (adapterType === "meshy") return true;
  if (adapterType !== "openai-compatible") return false;
  return /^(?:meshy-[567]|meshy-t[12])$/u.test(remoteModelId.trim().toLowerCase());
}
