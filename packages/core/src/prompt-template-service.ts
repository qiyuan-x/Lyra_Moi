import type {
  CreatePromptTemplateRequestBody,
  PromptTemplateListQuery,
  PromptTemplateSnapshot,
  UpdatePromptTemplateRequestBody
} from "@lyra/contracts";
import {
  parseCreatePromptTemplateRequest,
  parseUpdatePromptTemplateRequest
} from "@lyra/contracts";
import type { PromptTemplateRepository } from "@lyra/storage";
import type { PromptPreviewContent, PromptPreviewStore } from "@lyra/storage";

const supportedPreviewMimeTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const maxPreviewBytes = 20 * 1024 * 1024;

export class PromptTemplateService {
  readonly #prompts: PromptTemplateRepository;
  readonly #previews: PromptPreviewStore | undefined;

  constructor(options: {
    prompts: PromptTemplateRepository;
    previews?: PromptPreviewStore;
  }) {
    this.#prompts = options.prompts;
    this.#previews = options.previews;
  }

  list(query: PromptTemplateListQuery = {}): PromptTemplateSnapshot[] {
    return this.#prompts.list(query);
  }

  create(value: unknown): PromptTemplateSnapshot {
    const input = normalizeCreate(parseCreatePromptTemplateRequest(value));
    return this.#prompts.create(input);
  }

  update(promptId: string, value: unknown): PromptTemplateSnapshot {
    const input = normalizeUpdate(parseUpdatePromptTemplateRequest(value));
    return this.#prompts.update(promptId, input);
  }

  delete(promptId: string): PromptTemplateSnapshot {
    this.#prompts.requireById(promptId);
    this.#previews?.delete(promptId);
    return this.#prompts.softDelete(promptId);
  }

  setPreview(promptId: string, data: Uint8Array, mimeType: string): PromptTemplateSnapshot {
    this.#prompts.requireById(promptId);
    const normalizedMimeType = mimeType.trim().toLowerCase();
    if (!supportedPreviewMimeTypes.has(normalizedMimeType)) {
      throw new Error("提示词效果图只支持 PNG、JPEG、WebP、GIF 或 AVIF。");
    }
    if (data.byteLength === 0) throw new Error("提示词效果图不能为空。");
    if (data.byteLength > maxPreviewBytes) throw new Error("提示词效果图不能超过 20 MB。");
    const previews = this.#requirePreviews();
    previews.write(promptId, data, normalizedMimeType);
    return this.#prompts.setPreviewMimeType(promptId, normalizedMimeType);
  }

  getPreview(promptId: string): PromptPreviewContent {
    const prompt = this.#prompts.requireById(promptId);
    if (!prompt.previewMimeType) throw new Error("提示词模板没有效果图。");
    return this.#requirePreviews().read(promptId, prompt.previewMimeType);
  }

  deletePreview(promptId: string): PromptTemplateSnapshot {
    this.#prompts.requireById(promptId);
    this.#requirePreviews().delete(promptId);
    return this.#prompts.setPreviewMimeType(promptId, null);
  }

  #requirePreviews(): PromptPreviewStore {
    if (!this.#previews) throw new Error("Prompt preview storage is not configured.");
    return this.#previews;
  }
}

function normalizeCreate(input: CreatePromptTemplateRequestBody): CreatePromptTemplateRequestBody {
  return {
    name: input.name.trim(),
    content: input.content.trim(),
    ...(input.category === undefined ? {} : { category: input.category.trim() }),
    ...(input.note === undefined ? {} : { note: input.note === null ? null : input.note.trim() }),
    ...(input.variables === undefined ? {} : { variables: normalizeVariables(input.variables) }),
    ...(input.favorite === undefined ? {} : { favorite: input.favorite })
  };
}

function normalizeUpdate(input: UpdatePromptTemplateRequestBody): UpdatePromptTemplateRequestBody {
  return {
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(input.content === undefined ? {} : { content: input.content.trim() }),
    ...(input.category === undefined ? {} : { category: input.category.trim() }),
    ...(input.note === undefined ? {} : { note: input.note === null ? null : input.note.trim() }),
    ...(input.variables === undefined ? {} : { variables: normalizeVariables(input.variables) }),
    ...(input.favorite === undefined ? {} : { favorite: input.favorite })
  };
}

function normalizeVariables(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
