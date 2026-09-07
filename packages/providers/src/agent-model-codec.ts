import { randomUUID } from "node:crypto";
import type { MessagePart, ModelMessage, ModelRequest, ModelResponse } from "@lyra/agent-runtime";
import type { ProviderProtocol } from "@lyra/contracts";
import { ProviderConnectionError } from "./provider-errors.js";

type JsonObject = Record<string, unknown>;
export interface AgentAssetLoader {
  loadAsset(assetId: string, projectId: string): Promise<{ data: Uint8Array; mimeType: string; name: string }>;
}
export interface AgentWireOptions {
  protocol: ProviderProtocol;
  model: string;
  settings: JsonObject;
  assetLoader?: AgentAssetLoader;
}

export async function encodeAgentRequest(request: ModelRequest, options: AgentWireOptions): Promise<JsonObject> {
  const { protocol, model, settings } = options;
  const messages: JsonObject[] = [];
  const system = request.messages.filter((message) => message.role === "system")
    .flatMap((message) => message.parts.flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n\n");
  const loaded = new Map<string, Awaited<ReturnType<AgentAssetLoader["loadAsset"]>>>();
  let attachmentBytes = 0;
  for (const message of request.messages) {
    if (message.role === "system") continue;
    const native = message.role === "assistant" && message.parts.find((part) => part.type === "provider" && part.provider === protocol);
    if (native && native.type === "provider") {
      if (protocol === "openai") messages.push(...objects(native.value));
      else if (protocol === "openai-compatible") messages.push(object(native.value));
      else appendMessage(messages, protocol === "gemini" ? "model" : "assistant", objects(native.value), protocol);
      continue;
    }
    const content: JsonObject[] = [];
    const calls: JsonObject[] = [];
    for (const part of message.parts) {
      request.signal?.throwIfAborted();
      if (part.type === "text") content.push(protocol === "gemini" ? { text: part.text } :
        { type: protocol === "openai" ? (message.role === "assistant" ? "output_text" : "input_text") : "text", text: part.text });
      else if (part.type === "asset") {
        if (!options.assetLoader) invalid("素材读取服务未配置。");
        let asset = loaded.get(part.asset.assetId);
        if (!asset) {
          asset = await options.assetLoader.loadAsset(part.asset.assetId, request.projectId);
          attachmentBytes += asset.data.byteLength;
          if (attachmentBytes > 48 * 1024 * 1024) invalid("本轮素材超过模型输入大小限制。");
          loaded.set(part.asset.assetId, asset);
        }
        const label = `素材 ${part.asset.position + 1}: ${part.asset.label} [${part.asset.assetId}]`;
        content.push(protocol === "gemini" ? { text: label } : { type: protocol === "openai" ? "input_text" : "text", text: label });
        content.push(encodeAsset(asset, protocol));
      } else if (part.type === "tool_call") {
        const { id, name, arguments: args } = part.call;
        if (protocol === "openai") calls.push({ type: "function_call", call_id: id, name, arguments: JSON.stringify(args) });
        else if (protocol === "openai-compatible") calls.push({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
        else content.push(protocol === "gemini" ? { functionCall: { name, args, ...geminiId(id) } } : { type: "tool_use", id, name, input: args });
      } else if (part.type === "tool_result") {
        const output = JSON.stringify(part.result ?? null);
        if (protocol === "openai") calls.push({ type: "function_call_output", call_id: part.callId, output });
        else if (protocol === "openai-compatible") calls.push({ role: "tool", tool_call_id: part.callId, content: output });
        else content.push(protocol === "gemini" ? { functionResponse: { name: part.name, ...geminiId(part.callId), response: { result: part.result ?? null, error: part.error } } } :
          { type: "tool_result", tool_use_id: part.callId, content: output, is_error: part.error });
      }
    }
    if (protocol === "openai") {
      if (content.length) messages.push({ role: message.role, content });
      messages.push(...calls);
    } else if (protocol === "openai-compatible") {
      if (message.role === "tool") messages.push(...calls);
      else messages.push({ role: message.role, content: content.length ? content : null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else appendMessage(messages, message.role === "assistant" ? (protocol === "gemini" ? "model" : "assistant") : "user", content, protocol);
  }
  const tokens = positiveSetting(settings.maxOutputTokens, 4096);
  const temperature = settings.temperature;
  if (temperature !== undefined && (typeof temperature !== "number" || !Number.isFinite(temperature))) invalid("temperature 必须为有限数值。");
  const stream = settings.stream !== false;
  const tools = request.tools;
  if (protocol === "gemini") return {
    contents: messages, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { maxOutputTokens: tokens, ...(temperature !== undefined ? { temperature } : {}) },
    ...(tools.length ? { tools: [{ functionDeclarations: tools.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters })) }] } : {})
  };
  if (protocol === "anthropic") return {
    model, stream, system, messages, max_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}),
    ...(tools.length ? { tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {})
  };
  const reason = typeof settings.reasoningEffort === "string" ? settings.reasoningEffort : undefined;
  if (protocol === "openai") return {
    model, stream, store: false, instructions: system, input: messages, include: ["reasoning.encrypted_content"],
    ...(settings.codexSubscription === true ? {} : { max_output_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}) }), ...(reason ? { reasoning: { effort: reason } } : {}),
    ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", ...tool, strict: false })), parallel_tool_calls: true } : {})
  };
  return {
    model, stream, messages: [...(system ? [{ role: "system", content: system }] : []), ...messages],
    max_tokens: tokens, ...(temperature !== undefined ? { temperature } : {}), ...(reason ? { reasoning_effort: reason } : {}),
    ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", function: tool })), parallel_tool_calls: true } : {})
  };
}

export function decodeAgentResponse(protocol: ProviderProtocol, value: unknown): ModelResponse {
  const response = object(value);
  const parts: MessagePart[] = [];
  let reason: unknown;
  let native: unknown;
  let usage = objectOrEmpty(response.usage);
  if (protocol === "openai") {
    if (response.status !== "completed" && response.status !== "incomplete") invalid("模型响应未完成。");
    reason = response.status === "incomplete" ? "length" : "stop";
    native = response.output;
    for (const item of objects(response.output)) {
      if (item.type === "function_call") parts.push(toolPart(item.call_id, item.name, parseArguments(item.arguments)));
      if (item.type === "message") for (const content of objects(item.content)) {
        if (typeof content.text === "string") parts.push({ type: "text", text: content.text });
        if (typeof content.refusal === "string") parts.push({ type: "text", text: content.refusal });
      }
    }
  } else if (protocol === "openai-compatible") {
    const choice = objects(response.choices)[0] ?? invalid("模型响应没有候选项。");
    const message = object(choice.message);
    reason = choice.finish_reason;
    native = message;
    if (typeof message.content === "string") parts.push({ type: "text", text: message.content });
    else if (Array.isArray(message.content)) for (const item of objects(message.content)) if (typeof item.text === "string") parts.push({ type: "text", text: item.text });
    if (typeof message.refusal === "string") parts.push({ type: "text", text: message.refusal });
    for (const call of objects(message.tool_calls ?? [])) {
      const fn = object(call.function);
      parts.push(toolPart(call.id, fn.name, parseArguments(fn.arguments)));
    }
  } else if (protocol === "anthropic") {
    native = response.content;
    reason = response.stop_reason;
    for (const item of objects(response.content)) {
      if (item.type === "text") parts.push({ type: "text", text: string(item.text) });
      else if (item.type === "tool_use") parts.push(toolPart(item.id, item.name, item.input));
    }
  } else {
    const candidate = objects(response.candidates)[0] ?? invalid("模型响应没有候选项。");
    native = object(candidate.content).parts;
    reason = candidate.finishReason;
    usage = objectOrEmpty(response.usageMetadata);
    for (const item of objects(native)) {
      if (typeof item.text === "string" && item.thought !== true) parts.push({ type: "text", text: item.text });
      if (item.functionCall) {
        const call = object(item.functionCall);
        parts.push(toolPart(call.id ?? `lyra_${randomUUID()}`, call.name, call.args ?? {}));
      }
    }
  }
  if (!["stop", "tool_calls", "end_turn", "tool_use", "stop_sequence", "STOP", "length", "max_tokens", "MAX_TOKENS"].includes(String(reason))) invalid("模型没有正常结束，本轮不执行工具。");
  const truncated = ["length", "max_tokens", "MAX_TOKENS"].includes(String(reason));
  parts.push({ type: "provider", provider: protocol, value: structuredClone(native) });
  return {
    message: { role: "assistant", parts },
    finishReason: truncated ? "length" : parts.some((part) => part.type === "tool_call") ? "tool_calls" : "stop",
    usage: { inputTokens: numeric(usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount),
      outputTokens: numeric(usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount) }
  };
}

function encodeAsset(asset: Awaited<ReturnType<AgentAssetLoader["loadAsset"]>>, protocol: ProviderProtocol): JsonObject {
  const image = /^image\/(png|jpeg|webp|gif)$/u.test(asset.mimeType);
  const pdf = asset.mimeType === "application/pdf";
  if (!image && !pdf && !(protocol === "gemini" && /^(audio|video)\//u.test(asset.mimeType))) invalid(`模型接口不支持此素材类型：${asset.mimeType}`);
  const data = Buffer.from(asset.data).toString("base64");
  const url = `data:${asset.mimeType};base64,${data}`;
  if (protocol === "gemini") return { inlineData: { mimeType: asset.mimeType, data } };
  if (protocol === "anthropic") return { type: image ? "image" : "document", source: { type: "base64", media_type: asset.mimeType, data } };
  if (protocol === "openai") return image ? { type: "input_image", image_url: url } : { type: "input_file", filename: asset.name, file_data: url };
  return image ? { type: "image_url", image_url: { url } } : { type: "file", file: { filename: asset.name, file_data: url } };
}
function appendMessage(messages: JsonObject[], role: string, content: JsonObject[], protocol: ProviderProtocol): void {
  if (!content.length) return;
  const key = protocol === "gemini" ? "parts" : "content";
  const last = messages.at(-1);
  if (last?.role === role) (last[key] as JsonObject[]).push(...content);
  else messages.push({ role, [key]: content });
}
function geminiId(id: string): JsonObject { return id.startsWith("lyra_") ? {} : { id }; }
function toolPart(id: unknown, name: unknown, args: unknown): MessagePart {
  return { type: "tool_call", call: { id: string(id), name: string(name), arguments: structuredClone(object(args)) } };
}
function parseArguments(value: unknown): unknown {
  try { return JSON.parse(string(value)) as unknown; } catch { return invalid("模型工具参数不是完整 JSON。"); }
}
function positiveSetting(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) invalid("模型 Token 限制必须为正整数。");
  return value;
}
function numeric(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }
export function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("模型返回的对象格式无效。");
  return value as JsonObject;
}
export function objectOrEmpty(value: unknown): JsonObject { return value === undefined || value === null ? {} : object(value); }
export function objects(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) invalid("模型返回的列表格式无效。");
  return value.map(object);
}
function string(value: unknown): string {
  if (typeof value !== "string" || !value) invalid("模型返回的文本字段无效。");
  return value;
}
export function invalid(message: string): never { throw new ProviderConnectionError("INVALID_RESPONSE", message); }
