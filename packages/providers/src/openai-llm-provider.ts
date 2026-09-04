import type {
  AgentToolDefinition,
  LlmCompletion,
  LlmCompletionInput,
  LlmProvider
} from "@lyra/agent-engine";
import { ProviderConnectionError } from "./provider-errors.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import {
  attachmentDataUrl,
  loadLlmMessages,
  type LlmProviderAssetLoader,
  type LoadedAgentMessage
} from "./llm-provider-types.js";

export interface OpenAiLlmProviderOptions {
  baseUrl: string;
  apiKey: string | null;
  model: string;
  settings?: Record<string, unknown>;
  assetLoader?: LlmProviderAssetLoader;
  client?: ProviderHttpClient;
}

export class OpenAiResponsesLlmProvider implements LlmProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #settings: Record<string, unknown>;
  readonly #assetLoader: LlmProviderAssetLoader | undefined;
  readonly #client: ProviderHttpClient;

  constructor(options: OpenAiLlmProviderOptions) {
    this.#baseUrl = trimBaseUrl(options.baseUrl);
    this.#apiKey = requireApiKey(options.apiKey);
    this.#model = requireText(options.model, "Provider model");
    this.#settings = structuredClone(options.settings ?? {});
    this.#assetLoader = options.assetLoader;
    this.#client = options.client ?? new ProviderHttpClient();
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    const messages = await loadLlmMessages(
      input.messages,
      input.projectId,
      this.#assetLoader
    );
    const body = await this.#client.postJson(
      `${this.#baseUrl}/responses`,
      { Authorization: `Bearer ${this.#apiKey}`, Accept: "application/json" },
      createResponsesRequest(this.#model, this.#settings, messages, input.tools),
      input.signal
    );
    return parseResponsesCompletion(body);
  }
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly #baseUrl: string;
  readonly #apiKey: string | null;
  readonly #model: string;
  readonly #settings: Record<string, unknown>;
  readonly #assetLoader: LlmProviderAssetLoader | undefined;
  readonly #client: ProviderHttpClient;

  constructor(options: OpenAiLlmProviderOptions) {
    this.#baseUrl = trimBaseUrl(options.baseUrl);
    this.#apiKey = normalizeOptionalApiKey(options.apiKey);
    this.#model = requireText(options.model, "Provider model");
    this.#settings = structuredClone(options.settings ?? {});
    this.#assetLoader = options.assetLoader;
    this.#client = options.client ?? new ProviderHttpClient();
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    const messages = await loadLlmMessages(
      input.messages,
      input.projectId,
      this.#assetLoader
    );
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;
    const body = await this.#client.postJson(
      `${this.#baseUrl}/chat/completions`,
      headers,
      createChatCompletionsRequest(this.#model, this.#settings, messages, input.tools),
      input.signal
    );
    return parseChatCompletion(body);
  }
}

function createResponsesRequest(
  model: string,
  settings: Record<string, unknown>,
  messages: readonly LoadedAgentMessage[],
  tools: readonly AgentToolDefinition[]
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model,
    store: false,
    input: messages.filter((message) => message.role !== "system").map(toResponsesInput)
  };
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .filter(Boolean)
    .join("\n\n");
  if (instructions) request.instructions = instructions;
  if (tools.length) {
    request.tools = tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false
    }));
    request.tool_choice = "auto";
    request.parallel_tool_calls = false;
  }
  applyLlmSettings(request, settings, "responses");
  return request;
}

function createChatCompletionsRequest(
  model: string,
  settings: Record<string, unknown>,
  messages: readonly LoadedAgentMessage[],
  tools: readonly AgentToolDefinition[]
): Record<string, unknown> {
  const request: Record<string, unknown> = {
    model,
    messages: messages.map(toChatMessage)
  };
  if (tools.length) {
    request.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }));
    request.tool_choice = "auto";
  }
  applyLlmSettings(request, settings, "chat");
  return request;
}

function toResponsesInput(message: LoadedAgentMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCall) {
    return {
      type: "function_call",
      call_id: message.toolCall.id,
      name: message.toolCall.name,
      arguments: JSON.stringify(message.toolCall.arguments)
    };
  }
  if (message.role === "tool") {
    return {
      type: "function_call_output",
      call_id: requireText(message.toolCallId, "Tool call ID"),
      output: message.content
    };
  }
  if (message.role === "user" && message.attachments.length > 0) {
    return {
      role: "user",
      content: [
        ...message.attachments.map((attachment) => ({
          type: "input_image",
          image_url: attachmentDataUrl(attachment)
        })),
        ...(message.content ? [{ type: "input_text", text: message.content }] : [])
      ]
    };
  }
  return { role: message.role, content: message.content };
}

function toChatMessage(message: LoadedAgentMessage): Record<string, unknown> {
  if (message.role === "assistant" && message.toolCall) {
    return {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: message.toolCall.id,
          type: "function",
          function: {
            name: message.toolCall.name,
            arguments: JSON.stringify(message.toolCall.arguments)
          }
        }
      ]
    };
  }
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: requireText(message.toolCallId, "Tool call ID"),
      content: message.content
    };
  }
  if (message.role === "user" && message.attachments.length > 0) {
    return {
      role: "user",
      content: [
        ...message.attachments.map((attachment) => ({
          type: "image_url",
          image_url: { url: attachmentDataUrl(attachment) }
        })),
        ...(message.content ? [{ type: "text", text: message.content }] : [])
      ]
    };
  }
  return { role: message.role, content: message.content };
}

function parseResponsesCompletion(value: unknown): LlmCompletion {
  if (!isRecord(value) || !Array.isArray(value.output)) invalidResponse();
  for (const item of value.output) {
    if (!isRecord(item) || item.type !== "function_call") continue;
    const id = readString(item.call_id) ?? readString(item.id);
    const name = readString(item.name);
    const argumentsText = readString(item.arguments);
    if (!id || !name || argumentsText === null) invalidResponse();
    return {
      type: "tool_call",
      call: { id, name, arguments: parseToolArguments(argumentsText) }
    };
  }

  const text: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (!isRecord(content)) continue;
      const part = readString(content.text);
      if (part !== null) text.push(part);
    }
  }
  if (!text.length && typeof value.output_text === "string") text.push(value.output_text);
  if (!text.length) invalidResponse();
  return { type: "message", text: text.join("") };
}

function parseChatCompletion(value: unknown): LlmCompletion {
  if (!isRecord(value) || !Array.isArray(value.choices)) invalidResponse();
  const first = value.choices[0];
  if (!isRecord(first) || !isRecord(first.message)) invalidResponse();
  const message = first.message;
  if (Array.isArray(message.tool_calls) && message.tool_calls.length) {
    const toolCall = message.tool_calls[0];
    if (!isRecord(toolCall) || !isRecord(toolCall.function)) invalidResponse();
    const id = readString(toolCall.id);
    const name = readString(toolCall.function.name);
    const argumentsText = readString(toolCall.function.arguments);
    if (!id || !name || argumentsText === null) invalidResponse();
    return {
      type: "tool_call",
      call: { id, name, arguments: parseToolArguments(argumentsText) }
    };
  }
  const content = readMessageContent(message.content);
  if (content === null) invalidResponse();
  return { type: "message", text: content };
}

function applyLlmSettings(
  request: Record<string, unknown>,
  settings: Record<string, unknown>,
  api: "responses" | "chat"
): void {
  const temperature = optionalFiniteNumber(settings.temperature, "temperature");
  if (temperature !== null) request.temperature = temperature;
  const maxOutputTokens = optionalPositiveInteger(settings.maxOutputTokens, "maxOutputTokens");
  if (maxOutputTokens !== null) {
    request[api === "responses" ? "max_output_tokens" : "max_tokens"] = maxOutputTokens;
  }
  const reasoningEffort = optionalEnum(
    settings.reasoningEffort,
    ["none", "low", "medium", "high", "xhigh", "max"] as const,
    "reasoningEffort"
  );
  if (reasoningEffort !== null) {
    if (api === "responses") request.reasoning = { effort: reasoningEffort };
    else request.reasoning_effort = reasoningEffort;
  }
}

function readMessageContent(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  const parts = value.flatMap((item): string[] => {
    if (!isRecord(item) || typeof item.text !== "string") return [];
    return [item.text];
  });
  return parts.length ? parts.join("") : null;
}

function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ProviderConnectionError("INVALID_RESPONSE", "Provider returned invalid tool arguments.");
  }
}

function invalidResponse(): never {
  throw new ProviderConnectionError("INVALID_RESPONSE", "Provider LLM response is invalid.");
}

function trimBaseUrl(value: string): string {
  return requireText(value, "Provider Base URL").replace(/\/+$/u, "");
}

function requireApiKey(value: string | null): string {
  const key = normalizeOptionalApiKey(value);
  if (!key) throw new ProviderConnectionError("MISSING_API_KEY", "Provider API key is not configured.");
  return key;
}

function normalizeOptionalApiKey(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function requireText(value: string | null | undefined, label: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new ProviderConnectionError("INVALID_CONFIGURATION", `${label} is required.`);
  }
  return normalized;
}

function optionalFiniteNumber(value: unknown, label: string): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) invalidSetting(label);
  return value;
}

function optionalPositiveInteger(value: unknown, label: string): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || (value as number) < 1) invalidSetting(label);
  return value as number;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string
): T | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !allowed.includes(value as T)) invalidSetting(label);
  return value as T;
}

function invalidSetting(label: string): never {
  throw new ProviderConnectionError("INVALID_CONFIGURATION", `Provider setting ${label} is invalid.`);
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
