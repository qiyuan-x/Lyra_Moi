import type { AssetSnapshot } from "@lyra/contracts";

export interface ManualImageTaskInput {
  prompt: string;
  attachments: AssetSnapshot[];
  modelId: string;
  count: number;
  aspectRatio: string;
}
