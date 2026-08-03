import type {
  AgentMessage,
  AgentToolDefinition,
  LlmCompletion,
  LlmCompletionInput,
  LlmProvider
} from "@lyra/agent-engine";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";

export interface GeminiLlmProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class GeminiInteractionsLlmProvider implements LlmProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #settings: Record<string, unknown>;
  readonly #client: ProviderHttpClient;

  constructor(options: GeminiLlmProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Provider Base URL").replace(/\/+$/u, "");
    this.#apiKey = requireApiKey(options.apiKey);
    this.#model = requireText(options.model, "Provider model");
    this.#settings = structuredClone(options.settings ?? {});
    this.#client = options.client ?? new ProviderHttpClient();
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    const body = await this.#client.postJson(
      `${this.#baseUrl}/interactions`,
      { "x-goog-api-key": this.#apiKey, Accept: "application/json" },
      createInteractionRequest(this.#model, this.#settings, input.messages, input.tools),
      input.signal
    );
    return parseInteractionCompletion(body);
  }
}

function createInteractionRequest(
  model: string,
  settings: Record<string, unknown>,
  messages: readonly AgentMessage[],
  tools: readonly AgentToolDefinition[]
): Record<string, unknown> {
  const request: Record<string, unknown> = { model, store: true };
  const systemInstruction = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  if (systemInstruction) request.system_instruction = systemInstruction;
  if (tools.length) {
    request.tools = tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: toGeminiSchema(tool.parameters)
    }));
  }

  const last = messages.at(-1);
  const previous = messages.at(-2);
  if (last?.role === "tool" && previous?.role === "assistant" && previous.toolCall) {
    const interactionId = previous.toolCall.providerMetadata?.geminiInteractionId;
    if (typeof interactionId !== "string" || !interactionId) {
      throw new ProviderConnectionError(
        "INVALID_CONFIGURATION",
        "Gemini interaction checkpoint is missing."
      );
    }
    request.previous_interaction_id = interactionId;
    request.input = [
      {
        type: "function_result",
        name: previous.toolCall.name,
        call_id: previous.toolCall.id,
        result: [{ type: "text", text: last.content }]
      }
    ];
  } else {
    request.input = createConversationTranscript(messages);
  }
  applyGeminiSettings(request, settings);
  return request;
}

function parseInteractionCompletion(value: unknown): LlmCompletion {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.steps)) {
    invalidResponse();
  }
  if (value.status === "failed" || value.status === "cancelled" || value.status === "incomplete") {
    throw new ProviderConnectionError(
      "INVALID_RESPONSE",
      `Gemini interaction ended with status ${String(value.status)}.`
    );
  }
  for (const step of value.steps) {
    if (!isRecord(step) || step.type !== "function_call") continue;
    const id = readString(step.call_id) ?? readString(step.id);
    const name = readString(step.name);
    if (!id || !name || step.arguments === undefined) invalidResponse();
    return {
      type: "tool_call",
      call: {
        id,
        name,
        arguments: parseArguments(step.arguments),
        providerMetadata: { geminiInteractionId: value.id }
      }
    };
  }

  const text: string[] = [];
  for (const step of value.steps) {
    if (!isRecord(step) || step.type !== "model_output" || !Array.isArray(step.content)) continue;
    for (const content of step.content) {
      if (isRecord(content) && content.type === "text" && typeof content.text === "string") {
        text.push(content.text);
      }
    }
  }
  if (!text.length && typeof value.output_text === "string") text.push(value.output_text);
  if (!text.length) invalidResponse();
  return { type: "message", text: text.join("") };
}

function createConversationTranscript(messages: readonly AgentMessage[]): string {
  const lines = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      if (message.role === "assistant") return `Assistant: ${message.content}`;
      if (message.role === "tool") return `Tool ${message.toolName ?? "result"}: ${message.content}`;
      return `User: ${message.content}`;
    });
  const transcript = lines.join("\n\n").trim();
  if (!transcript) {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", "Gemini user input is required.");
  }
  return transcript;
}

function applyGeminiSettings(
  request: Record<string, unknown>,
  settings: Record<string, unknown>
): void {
  const generationConfig: Record<string, unknown> = {};
  if (settings.temperature !== undefined) {
    if (typeof settings.temperature !== "number" || !Number.isFinite(settings.temperature)) {
      invalidSetting("temperature");
    }
    generationConfig.temperature = settings.temperature;
  }
  if (settings.maxOutputTokens !== undefined) {
    if (!Number.isInteger(settings.maxOutputTokens) || (settings.maxOutputTokens as number) < 1) {
      invalidSetting("maxOutputTokens");
    }
    generationConfig.max_output_tokens = settings.maxOutputTokens;
  }
  if (settings.thinkingLevel !== undefined) {
    if (
      typeof settings.thinkingLevel !== "string" ||
      !["minimal", "low", "medium", "high"].includes(settings.thinkingLevel)
    ) {
      invalidSetting("thinkingLevel");
    }
    generationConfig.thinking_level = settings.thinkingLevel;
  }
  if (Object.keys(generationConfig).length) request.generation_config = generationConfig;
}

function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!isRecord(value)) return value;
  const allowed = new Set([
    "type",
    "description",
    "enum",
    "format",
    "nullable",
    "items",
    "properties",
    "required",
    "minimum",
    "maximum",
    "minItems",
    "maxItems"
  ]);
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!allowed.has(key)) continue;
    if (key === "properties" && isRecord(item)) {
      result[key] = Object.fromEntries(
        Object.entries(item).map(([propertyName, schema]) => [
          propertyName,
          toGeminiSchema(schema)
        ])
      );
    } else {
      result[key] = toGeminiSchema(item);
    }
  }
  return result;
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== "string") return structuredClone(value);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ProviderConnectionError("INVALID_RESPONSE", "Gemini returned invalid tool arguments.");
  }
}

function requireApiKey(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
  }
  return normalized;
}

function requireText(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", `${label} is required.`);
  }
  return normalized;
}

function invalidSetting(label: string): never {
  throw new ProviderConnectionError("INVALID_CONFIGURATION", `Provider setting ${label} is invalid.`);
}

function invalidResponse(): never {
  throw new ProviderConnectionError("INVALID_RESPONSE", "Gemini LLM response is invalid.");
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
