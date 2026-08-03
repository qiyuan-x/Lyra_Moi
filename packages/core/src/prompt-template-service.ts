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

export class PromptTemplateService {
  readonly #prompts: PromptTemplateRepository;

  constructor(options: { prompts: PromptTemplateRepository }) {
    this.#prompts = options.prompts;
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
    return this.#prompts.softDelete(promptId);
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
