import { randomUUID } from "node:crypto";
import type { ModelGenerationRequest } from "@lyra/contracts";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import {
  requireModelInput,
  requireText,
  type BinaryModelProvider,
  type GeneratedModelBinary,
  type ModelProviderAssetLoader,
  type ModelProviderResult
} from "./model-provider-types.js";

export interface StabilityModelProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  assetLoader: ModelProviderAssetLoader;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class StabilityModelProvider implements BinaryModelProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #assetLoader: ModelProviderAssetLoader;
  readonly #client: ProviderHttpClient;
  readonly #results = new Map<string, GeneratedModelBinary>();

  constructor(options: StabilityModelProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Stability Base URL is required.").replace(/\/+$/u, "");
    this.#apiKey = requireText(options.apiKey, "Stability API key is required.");
    this.#model = requireText(options.model, "Stability 3D model is required.");
    this.#assetLoader = options.assetLoader;
    this.#client = options.client ?? new ProviderHttpClient({
      timeoutMs: 10 * 60_000,
      maxResponseBytes: 300 * 1024 * 1024
    });
  }

  async submit(request: ModelGenerationRequest, signal?: AbortSignal): Promise<string> {
    const input = requireModelInput(request);
    const image = await this.#assetLoader.loadModelInput(input.assetId, input.projectId);
    const form = new FormData();
    form.append(
      "image",
      new Blob([new Uint8Array(image.data)], { type: image.mimeType }),
      image.name
    );
    const binary = await this.#client.postMultipartBinary(
      `${this.#baseUrl}${endpointFor(this.#model)}`,
      { Authorization: `Bearer ${this.#apiKey}`, Accept: "model/gltf-binary" },
      form,
      signal
    );
    const id = randomUUID();
    this.#results.set(id, {
      data: binary.data,
      format: "glb",
      extension: "glb",
      mimeType: binary.mimeType ?? "model/gltf-binary",
      name: `stability-${this.#model}-${Date.now()}.glb`
    });
    return id;
  }

  query(externalTaskId: string): Promise<ModelProviderResult> {
    return Promise.resolve(this.#results.has(externalTaskId)
      ? { status: "succeeded", progress: 100, providerState: { resultId: externalTaskId } }
      : {
          status: "failed",
          progress: 0,
          errorMessage: "Stability 3D result is no longer available; retry the task."
        });
  }

  download(result: ModelProviderResult): Promise<GeneratedModelBinary[]> {
    const id = typeof result.providerState?.resultId === "string"
      ? result.providerState.resultId
      : "";
    const binary = this.#results.get(id);
    if (!binary) {
      throw new ProviderConnectionError("INVALID_RESPONSE", "Stability 3D output is missing.");
    }
    this.#results.delete(id);
    return Promise.resolve([{ ...binary, data: Buffer.from(binary.data) }]);
  }
}

function endpointFor(model: string): string {
  if (model === "stable-fast-3d") return "/v2beta/3d/stable-fast-3d";
  if (model === "spar3d") return "/v2beta/3d/stable-point-aware-3d";
  throw new ProviderConnectionError("INVALID_CONFIGURATION", `Unsupported Stability 3D model: ${model}.`);
}
