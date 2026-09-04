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

export type ModelInputMode = "image" | "text" | "multiview";

export type ModelGenerationAdapterType =
  | "meshy"
  | "tripo"
  | "hunyuan"
  | "stability-3d";

export type ModelViewType =
  | "front"
  | "left"
  | "back"
  | "right"
  | "top"
  | "bottom"
  | "leftFront"
  | "rightFront";

export type MultiViewImageAssetIds = Partial<Record<ModelViewType, EntityId>> & {
  front: EntityId;
};

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

export interface MultiViewToModelGenerationRequest
  extends ModelGenerationRequestBase {
  inputMode: "multiview";
  multiViewImageAssetIds: MultiViewImageAssetIds;
}

export type ModelGenerationRequest =
  | ImageToModelGenerationRequest
  | TextToModelGenerationRequest
  | MultiViewToModelGenerationRequest;

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
    })
  | (ManualModelGenerationRequestBase & {
      inputMode: "multiview";
      multiViewImageAssetIds: MultiViewImageAssetIds;
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

export function isMultiViewToModelGenerationRequest(
  request: ModelGenerationRequest
): request is MultiViewToModelGenerationRequest {
  return request.inputMode === "multiview";
}

export function isMeshyGenerationModel(
  adapterType: ProviderAdapterType | undefined,
  remoteModelId: string
): boolean {
  return resolveModelGenerationAdapter(adapterType, remoteModelId) === "meshy";
}

export function resolveModelGenerationAdapter(
  adapterType: ProviderAdapterType | undefined,
  remoteModelId: string
): ModelGenerationAdapterType | null {
  if (
    adapterType === "meshy" ||
    adapterType === "tripo" ||
    adapterType === "hunyuan" ||
    adapterType === "stability-3d"
  ) {
    return adapterType;
  }
  if (adapterType !== "frostapi-3d") return null;

  const model = remoteModelId.trim().toLowerCase();
  if (/^(?:meshy-(?:[567]|t[12])|latest)$/u.test(model)) return "meshy";
  if (
    /^(?:tripo[-_.]|p1[-_.]|turbo[-_.]|v(?:2(?:\.\d+)?|3(?:\.\d+)?)[-_.])/u.test(model)
  ) {
    return "tripo";
  }
  if (/^(?:hunyuan[-_.]|hy[-_.]?3d[-_.]|3\.[01]$)/u.test(model)) return "hunyuan";
  if (/^(?:stability[-_.]|stable-fast-3d|sf3d|spar3d)/u.test(model)) {
    return "stability-3d";
  }
  return null;
}

export function normalizeHunyuan3dModelId(
  remoteModelId: string
): "hy-3d-3.0" | "hy-3d-3.1" | null {
  const normalized = remoteModelId.trim().toLowerCase().replaceAll("_", "-");
  if (["3.0", "hy-3d-3.0", "hunyuan-3.0"].includes(normalized)) {
    return "hy-3d-3.0";
  }
  if (["3.1", "hy-3d-3.1", "hunyuan-3.1"].includes(normalized)) {
    return "hy-3d-3.1";
  }
  return null;
}

export function isHunyuan31ModelId(remoteModelId: string): boolean {
  return normalizeHunyuan3dModelId(remoteModelId) === "hy-3d-3.1";
}
