import type { GenerationRequest } from "@lyra/contracts";

export interface GeneratedImageBinary {
  data: Uint8Array;
  mimeType: string;
  name: string;
}

export interface BinaryImageProvider {
  generate(request: GenerationRequest, signal?: AbortSignal): Promise<GeneratedImageBinary[]>;
}
