import type { AssetSnapshot } from "@lyra/contracts";
import type { ImageResolution } from "./image-resolution.js";

export interface ManualImageTaskInput {
  prompt: string;
  attachments: AssetSnapshot[];
  modelId: string;
  count: number;
  aspectRatio: string;
  resolution: ImageResolution;
}
