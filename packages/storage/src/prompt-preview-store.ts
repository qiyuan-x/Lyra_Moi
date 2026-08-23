import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { resolve, sep } from "node:path";

export interface PromptPreviewContent {
  data: Uint8Array;
  mimeType: string;
  etag: string;
}

export class PromptPreviewStore {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
    mkdirSync(this.#root, { recursive: true });
  }

  write(promptId: string, data: Uint8Array, mimeType: string): PromptPreviewContent {
    const target = this.#path(promptId);
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, data);
    rmSync(target, { force: true });
    renameSync(temporary, target);
    return describe(data, mimeType);
  }

  read(promptId: string, mimeType: string): PromptPreviewContent {
    return describe(readFileSync(this.#path(promptId)), mimeType);
  }

  delete(promptId: string): void {
    rmSync(this.#path(promptId), { force: true });
  }

  #path(promptId: string): string {
    const normalized = promptId.trim();
    if (!normalized || normalized.includes("/") || normalized.includes("\\")) {
      throw new Error("Prompt preview ID is invalid.");
    }
    const target = resolve(this.#root, `${normalized}.image`);
    if (!target.startsWith(`${this.#root}${sep}`)) {
      throw new Error("Prompt preview path escapes the storage root.");
    }
    return target;
  }
}

function describe(data: Uint8Array, mimeType: string): PromptPreviewContent {
  const checksum = createHash("sha256").update(data).digest("hex");
  return {
    data: new Uint8Array(data),
    mimeType,
    etag: `\"sha256-${checksum}\"`
  };
}
