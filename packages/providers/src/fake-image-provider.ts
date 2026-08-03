import { randomUUID } from "node:crypto";
import type { GeneratedAsset, GenerationRequest } from "@lyra/contracts";
import type { ImageProvider } from "@lyra/core";

export interface FakeImageProviderOptions {
  delayMs?: number;
  failWith?: string;
}

export class FakeImageProvider implements ImageProvider {
  readonly requests: GenerationRequest[] = [];
  readonly #delayMs: number;
  readonly #failWith: string | null;

  constructor(options: FakeImageProviderOptions = {}) {
    this.#delayMs = options.delayMs ?? 5;
    this.#failWith = options.failWith ?? null;
  }

  async generate(request: GenerationRequest, signal?: AbortSignal): Promise<GeneratedAsset[]> {
    this.requests.push(structuredClone(request));
    await delay(this.#delayMs, signal);
    if (this.#failWith) throw new Error(this.#failWith);

    return Array.from({ length: request.count }, (_, index) => ({
      id: randomUUID(),
      mimeType: "image/png",
      width: 1024,
      height: 1024,
      name: `fake-output-${index + 1}.png`
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
