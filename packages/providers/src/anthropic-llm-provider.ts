import type {
  AgentMessage,
  AgentToolDefinition,
  LlmCompletion,
  LlmCompletionInput,
  LlmProvider
} from "@lyra/agent-engine";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";

export interface AnthropicLlmProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  settings?: Record<string, unknown>;
  client?: ProviderHttpClient;
}

export class AnthropicLlmProvider implements LlmProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #settings: Record<string, unknown>;
  readonly #client: ProviderHttpClient;

  constructor(options: AnthropicLlmProviderOptions) {
    this.#baseUrl = requireText(options.baseUrl, "Provider Base URL").replace(/\/+$/u, "");
    this.#apiKey = requireText(options.apiKey, "Provider API key");
    this.#model = requireText(options.model, "Provider model");
    this.#settings = structuredClone(options.settings ?? {});
    this.#client = options.client ?? new ProviderHttpClient();
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    const body = await this.#client.postJson(
      `${this.#baseUrl}/messages`,
      {
        Accept: "application/json",
        "x-api-key": this.#apiKey,
        "anthropic-version": "2023-06-01"
      },
      createRequest(this.#model, this.#settings, input.messages, input.tools),
      input.signal
    );
    return parseCompletion(body);
  }
}

function createRequest(
  model: string,
  settings: Record<string, unknown>,
  messages: readonly AgentMessage[],
  tools: readonly AgentToolDefinition[]
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model,
    max_tokens: positiveInteger(settings.maxOutputTokens, 4096, "maxOutputTokens"),
    messages: messages.filter((message) => message.role !== "system").map(toMessage)
  };
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  if (system) request.system = system;
  if (tools.length) {
    request.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters
    }));
    request.tool_choice = { type: "auto" };
  }
  if (settings.temperature !== undefined) {
    if (typeof settings.temperature !== "number" || !Number.isFinite(settings.temperature)) {
      invalidSetting("temperature");
    }
    request.temperature = settings.temperature;
  }
  return request;
}

function toMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCall) {
    return {
      role: "assistant",
      content: [{
        type: "tool_use",
        id: message.toolCall.id,
        name: message.toolCall.name,
        input: message.toolCall.arguments
      }]
    };
  }
  if (message.role === "tool") {
    return {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: requireText(message.toolCallId, "Tool call ID"),
        content: message.content
      }]
    };
  }
  return { role: message.role, content: message.content };
}

function parseCompletion(value: unknown): LlmCompletion {
  if (!isRecord(value) || !Array.isArray(value.content)) invalidResponse();
  for (const block of value.content) {
    if (!isRecord(block) || block.type !== "tool_use") continue;
    const id = readString(block.id);
    const name = readString(block.name);
    if (!id || !name || block.input === undefined) invalidResponse();
    return {
      type: "tool_call",
      call: { id, name, arguments: structuredClone(block.input) }
    };
  }
  const text = value.content.flatMap((block): string[] =>
    isRecord(block) && block.type === "text" && typeof block.text === "string"
      ? [block.text]
      : []
  ).join("");
  if (!text) invalidResponse();
  return { type: "message", text };
}

function positiveInteger(
  value: unknown,
  fallback: number,
  label: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1) invalidSetting(label);
  return value as number;
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
  throw new ProviderConnectionError("INVALID_RESPONSE", "Anthropic response is invalid.");
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
