import type {
  AgentRuntimeSettings,
  AgentRuntimeSettingsSnapshot
} from "@lyra/contracts";
import type { AppSettingsRepository } from "@lyra/storage";

const MAX_TOOL_CALLS_KEY = "agent_max_tool_calls";
const DEFAULT_SETTINGS: AgentRuntimeSettings = {
  maxToolCalls: 10
};

type SettingsStore = Pick<AppSettingsRepository, "get" | "set" | "delete">;

export class AgentRuntimeSettingsService {
  readonly #settings: SettingsStore;

  constructor(settings: SettingsStore) {
    this.#settings = settings;
  }

  get(): AgentRuntimeSettings {
    return {
      maxToolCalls: readMaxToolCalls(
        this.#settings.get(MAX_TOOL_CALLS_KEY),
        DEFAULT_SETTINGS.maxToolCalls
      )
    };
  }

  snapshot(): AgentRuntimeSettingsSnapshot {
    return {
      settings: this.get(),
      defaults: structuredClone(DEFAULT_SETTINGS)
    };
  }

  update(value: unknown): AgentRuntimeSettingsSnapshot {
    if (!isRecord(value)) {
      throw new Error("Agent runtime settings must be an object.");
    }
    const current = this.get();
    const maxToolCalls = "maxToolCalls" in value
      ? validateMaxToolCalls(value.maxToolCalls)
      : current.maxToolCalls;
    this.#settings.set(MAX_TOOL_CALLS_KEY, maxToolCalls);
    return this.snapshot();
  }

  reset(): AgentRuntimeSettingsSnapshot {
    this.#settings.delete(MAX_TOOL_CALLS_KEY);
    return this.snapshot();
  }
}

function readMaxToolCalls(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100
    ? Number(value)
    : fallback;
}

function validateMaxToolCalls(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100) {
    throw new Error("maxToolCalls must be an integer between 1 and 100.");
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
