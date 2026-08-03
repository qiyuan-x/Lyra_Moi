import type { GenerationRequest } from "@lyra/contracts";
import type { BinaryImageProvider, GeneratedImageBinary } from "@lyra/core";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export interface FakeBinaryImageProviderOptions {
  delayMs?: number;
  failWith?: string;
}

export class FakeBinaryImageProvider implements BinaryImageProvider {
  readonly requests: GenerationRequest[] = [];
  readonly #delayMs: number;
  readonly #failWith: string | null;

  constructor(options: FakeBinaryImageProviderOptions = {}) {
    this.#delayMs = options.delayMs ?? 10;
    this.#failWith = options.failWith ?? null;
  }

  async generate(
    request: GenerationRequest,
    signal?: AbortSignal
  ): Promise<GeneratedImageBinary[]> {
    this.requests.push(structuredClone(request));
    await delay(this.#delayMs, signal);
    if (this.#failWith) throw new Error(this.#failWith);
    return Array.from({ length: request.count }, (_, index) => ({
      data: Buffer.from(ONE_PIXEL_PNG),
      mimeType: "image/png",
      name: `fake-output-${index + 1}`
    }));
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("Aborted."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
