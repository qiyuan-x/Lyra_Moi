import type { BinaryImageProvider, AssetService } from "@lyra/core";
import { isModelGenerationRequest } from "@lyra/contracts";
import type { StoredJob } from "@lyra/storage";
import type { JobExecutionResult, JobExecutor } from "./job-worker-runtime.js";

export interface ImageJobExecutorOptions {
  provider?: BinaryImageProvider;
  providerResolver?: ImageProviderResolver;
  assets: AssetService;
}

export interface ImageProviderResolver {
  resolve(
    providerProfileId: string,
    providerModelId: string
  ): BinaryImageProvider | Promise<BinaryImageProvider>;
}

export class ImageJobExecutor implements JobExecutor {
  readonly #provider: BinaryImageProvider | null;
  readonly #providerResolver: ImageProviderResolver | null;
  readonly #assets: AssetService;

  constructor(options: ImageJobExecutorOptions) {
    if (Boolean(options.provider) === Boolean(options.providerResolver)) {
      throw new Error("ImageJobExecutor requires exactly one provider or provider resolver.");
    }
    this.#provider = options.provider ?? null;
    this.#providerResolver = options.providerResolver ?? null;
    this.#assets = options.assets;
  }

  async execute(job: StoredJob, signal: AbortSignal): Promise<JobExecutionResult> {
    if (job.kind !== "image.generate") {
      throw new Error(`Image worker cannot execute job kind ${job.kind}.`);
    }
    if (isModelGenerationRequest(job.request)) {
      throw new Error("Image job request is invalid.");
    }
    const request = job.request;
    const provider = this.#provider ?? await this.#providerResolver!.resolve(
      request.providerProfileId,
      request.providerModelId
    );
    const generated = await provider.generate(request, signal);
    if (generated.length !== request.count) {
      throw new Error(
        `Image provider returned ${generated.length} outputs, expected ${request.count}.`
      );
    }
    const outputAssetIds: string[] = [];
    for (const image of generated) {
      if (signal.aborted) throw signal.reason ?? new Error("Image job was aborted.");
      const asset = await this.#assets.storeGeneratedImage({
        projectId: job.projectId,
        data: image.data,
        name: image.name,
        claimedMimeType: image.mimeType
      });
      outputAssetIds.push(asset.id);
    }
    return {
      outputAssetIds,
      result: { outputCount: outputAssetIds.length }
    };
  }
}
