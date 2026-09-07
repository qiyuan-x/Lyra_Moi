import type {
  TaskRuntimeSettings,
  TaskRuntimeSettingsSnapshot
} from "@lyra/contracts";
import type { AppSettingsRepository } from "@lyra/storage";

const MODEL_GENERATION_CONCURRENCY_KEY = "model_generation_concurrency";
export const MIN_MODEL_GENERATION_CONCURRENCY = 1;
export const MAX_MODEL_GENERATION_CONCURRENCY = 8;
export const DEFAULT_MODEL_GENERATION_CONCURRENCY = 2;

const DEFAULT_SETTINGS: TaskRuntimeSettings = {
  modelGenerationConcurrency: DEFAULT_MODEL_GENERATION_CONCURRENCY
};

type SettingsStore = Pick<AppSettingsRepository, "get" | "set" | "delete">;

export class TaskRuntimeSettingsService {
  readonly #settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.#settings = settings;
  }

  get(): TaskRuntimeSettings {
    return {
      modelGenerationConcurrency: readConcurrency(
        this.#settings.get(MODEL_GENERATION_CONCURRENCY_KEY),
        DEFAULT_SETTINGS.modelGenerationConcurrency
      )
    };
  }

  snapshot(): TaskRuntimeSettingsSnapshot {
    return {
      settings: this.get(),
      defaults: structuredClone(DEFAULT_SETTINGS)
    };
  }

  update(value: unknown): TaskRuntimeSettingsSnapshot {
    if (!isRecord(value)) {
      throw new Error("Task runtime settings must be an object.");
    }
    const current = this.get();
    const modelGenerationConcurrency = "modelGenerationConcurrency" in value
      ? validateConcurrency(value.modelGenerationConcurrency)
      : current.modelGenerationConcurrency;
    this.#settings.set(
      MODEL_GENERATION_CONCURRENCY_KEY,
      modelGenerationConcurrency
    );
    return this.snapshot();
  }

  reset(): TaskRuntimeSettingsSnapshot {
    this.#settings.delete(MODEL_GENERATION_CONCURRENCY_KEY);
    return this.snapshot();
  }
}

function readConcurrency(value: unknown, fallback: number): number {
  return Number.isInteger(value) &&
    Number(value) >= MIN_MODEL_GENERATION_CONCURRENCY &&
    Number(value) <= MAX_MODEL_GENERATION_CONCURRENCY
    ? Number(value)
    : fallback;
}

function validateConcurrency(value: unknown): number {
  if (
    !Number.isInteger(value) ||
    Number(value) < MIN_MODEL_GENERATION_CONCURRENCY ||
    Number(value) > MAX_MODEL_GENERATION_CONCURRENCY
  ) {
    throw new Error(
      `modelGenerationConcurrency must be an integer between ${MIN_MODEL_GENERATION_CONCURRENCY} and ${MAX_MODEL_GENERATION_CONCURRENCY}.`
    );
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
