import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AgentPromptSettings,
  AgentPromptSettingsSnapshot
} from "@lyra/contracts";
import type { AppSettingsRepository } from "@lyra/storage";

const SETTINGS_KEY = "agent.prompt-settings.v1";
const MAX_PROMPT_LENGTH = 30_000;

export const defaultOptimizeEnabledPrompt =
  "本轮允许 Agent 优化生图提示词。";

export const defaultOptimizeDisabledPrompt =
  "本轮已关闭提示词优化。判断需要生图时仍可调用工具，但生图服务会使用用户本轮原文，不得改写。";

export interface LoadAgentPromptDefaultsOptions {
  systemPrompt?: string;
  systemPromptFile?: string;
  workingDirectory?: string;
}

export async function loadAgentPromptDefaults(
  options: LoadAgentPromptDefaultsOptions = {}
): Promise<AgentPromptSettings> {
  const configuredPrompt = options.systemPrompt?.trim();
  const systemPrompt = configuredPrompt || await readSystemPromptFile(
    options.systemPromptFile,
    options.workingDirectory
  );
  return {
    systemPrompt,
    optimizeEnabledPrompt: defaultOptimizeEnabledPrompt,
    optimizeDisabledPrompt: defaultOptimizeDisabledPrompt
  };
}

export class AgentPromptSettingsService {
  readonly #settings: Pick<AppSettingsRepository, "get" | "set" | "delete">;
  readonly #defaults: AgentPromptSettings;

  constructor(
    settings: Pick<AppSettingsRepository, "get" | "set" | "delete">,
    defaults: AgentPromptSettings
  ) {
    this.#settings = settings;
    this.#defaults = validateCompleteSettings(defaults);
  }

  get(): AgentPromptSettings {
    const stored = this.#settings.get(SETTINGS_KEY);
    if (!isRecord(stored)) return structuredClone(this.#defaults);
    return {
      systemPrompt: readStoredPrompt(
        stored.systemPrompt,
        this.#defaults.systemPrompt
      ),
      optimizeEnabledPrompt: readStoredPrompt(
        stored.optimizeEnabledPrompt,
        this.#defaults.optimizeEnabledPrompt
      ),
      optimizeDisabledPrompt: readStoredPrompt(
        stored.optimizeDisabledPrompt,
        this.#defaults.optimizeDisabledPrompt
      )
    };
  }

  snapshot(): AgentPromptSettingsSnapshot {
    return {
      settings: this.get(),
      defaults: structuredClone(this.#defaults)
    };
  }

  update(value: unknown): AgentPromptSettingsSnapshot {
    if (!isRecord(value)) {
      throw new Error("Agent prompt settings must be an object.");
    }
    const current = this.get();
    const next: AgentPromptSettings = {
      systemPrompt: readUpdatedPrompt(
        value,
        "systemPrompt",
        current.systemPrompt
      ),
      optimizeEnabledPrompt: readUpdatedPrompt(
        value,
        "optimizeEnabledPrompt",
        current.optimizeEnabledPrompt
      ),
      optimizeDisabledPrompt: readUpdatedPrompt(
        value,
        "optimizeDisabledPrompt",
        current.optimizeDisabledPrompt
      )
    };
    this.#settings.set(SETTINGS_KEY, next);
    return {
      settings: structuredClone(next),
      defaults: structuredClone(this.#defaults)
    };
  }

  reset(): AgentPromptSettingsSnapshot {
    this.#settings.delete(SETTINGS_KEY);
    return this.snapshot();
  }
}

async function readSystemPromptFile(
  configuredFile: string | undefined,
  workingDirectory = process.cwd()
): Promise<string> {
  const filePath = configuredFile?.trim() || resolve(
    workingDirectory,
    "resources",
    "prompts",
    "agent-system-v1.txt"
  );
  const prompt = (await readFile(resolve(filePath), "utf8")).trim();
  if (!prompt) throw new Error(`Agent system prompt is empty: ${filePath}`);
  return validatePrompt("systemPrompt", prompt);
}

function validateCompleteSettings(
  value: AgentPromptSettings
): AgentPromptSettings {
  return {
    systemPrompt: validatePrompt("systemPrompt", value.systemPrompt),
    optimizeEnabledPrompt: validatePrompt(
      "optimizeEnabledPrompt",
      value.optimizeEnabledPrompt
    ),
    optimizeDisabledPrompt: validatePrompt(
      "optimizeDisabledPrompt",
      value.optimizeDisabledPrompt
    )
  };
}

function readUpdatedPrompt(
  value: Record<string, unknown>,
  key: keyof AgentPromptSettings,
  fallback: string
): string {
  return key in value
    ? validatePrompt(key, value[key])
    : fallback;
}

function readStoredPrompt(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_PROMPT_LENGTH
    ? trimmed
    : fallback;
}

function validatePrompt(label: string, value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} cannot be blank.`);
  }
  const prompt = value.trim();
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `${label} cannot exceed ${MAX_PROMPT_LENGTH} characters.`
    );
  }
  return prompt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}
