import type {
  ModelGenerationRequest,
  ModelOutputFormat
} from "@lyra/contracts";
import {
  isMultiViewToModelGenerationRequest,
  isTextToModelGenerationRequest
} from "@lyra/contracts";

export interface ModelProviderResult {
  status: "pending" | "running" | "succeeded" | "failed";
  progress: number;
  /**
   * Providers that fan out one logical job into multiple remote tasks can
   * replace the persisted checkpoint ID before the next poll.
   */
  nextExternalTaskId?: string;
  modelUrls?: Partial<Record<ModelOutputFormat, string>>;
  textureUrls?: ModelTextureUrlSet[];
  previewUrl?: string;
  errorMessage?: string;
  consumedCredits?: number;
  providerState?: Record<string, unknown>;
}

export interface ModelTextureUrlSet {
  baseColor?: string;
  metallic?: string;
  normal?: string;
  roughness?: string;
  emission?: string;
}

export interface GeneratedModelBinary {
  data: Buffer;
  format: ModelOutputFormat;
  extension: string;
  mimeType: string;
  name: string;
}

export interface BinaryModelProvider {
  submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string>;
  query(externalTaskId: string, signal?: AbortSignal): Promise<ModelProviderResult>;
  download(
    result: ModelProviderResult,
    request: ModelGenerationRequest,
    signal?: AbortSignal
  ): Promise<GeneratedModelBinary[]>;
}

export interface ModelProviderAssetLoader {
  loadModelInput(
    assetId: string,
    projectId: string
  ): Promise<{ data: Buffer; mimeType: "image/jpeg"; name: string }>;
}

export function requireModelInput(request: ModelGenerationRequest): {
  assetId: string;
  projectId: string;
} {
  if (
    isTextToModelGenerationRequest(request) ||
    isMultiViewToModelGenerationRequest(request)
  ) {
    throw new Error("This provider operation requires an image input.");
  }
  return {
    assetId: requireText(request.inputImageAssetId, "Model input image is required."),
    projectId: requireText(request.projectId, "Model project is required.")
  };
}

export function requireModelPrompt(request: ModelGenerationRequest): string {
  if (!isTextToModelGenerationRequest(request)) {
    throw new Error("This provider operation requires a text prompt.");
  }
  return requireText(request.prompt, "Model prompt is required.");
}

export function readBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean.`);
  return value;
}

export function readNullableInteger(
  record: Record<string, unknown>,
  key: string
): number | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value)) throw new Error(`${key} must be an integer.`);
  return value as number;
}

export function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = record[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${key} is invalid.`);
  }
  return value as T;
}

export function normalizeProgress(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.round(value)))
    : fallback;
}

export function requireRecord(
  value: unknown,
  message = "Provider response is invalid."
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

export function requireText(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(message);
  return value.trim();
}
