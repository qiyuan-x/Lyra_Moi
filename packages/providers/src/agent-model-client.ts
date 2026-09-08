import type { ModelClient, ModelEvent, ModelRequest, ModelResponse } from "@lyra/agent-runtime";
import { antigravityHeaders, antigravityProject, antigravityRequest, isAntigravityOAuth, unwrapAntigravity } from "./antigravity-client.js";
import { ProviderHttpClient } from "./provider-http-client.js";
import type { ProviderProtocol } from "@lyra/contracts";
import { AgentModelTransport } from "./agent-model-transport.js";
import { ProviderConnectionError, sanitizeError } from "./provider-errors.js";
import { decodeAgentResponse, encodeAgentRequest, invalid, object, objectOrEmpty, objects, type AgentAssetLoader } from "./agent-model-codec.js";

export interface AgentModelClientOptions {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string | null;
  model: string;
  settings?: Record<string, unknown>;
  headers?: Record<string, string>;
  assetLoader?: AgentAssetLoader;
  transport?: AgentModelTransport;
}

/** Native multi-part/multi-call protocol; independent of the retired single-call engine. */
export class HttpAgentModelClient implements ModelClient {
  readonly contextWindow: number;
  private readonly transport: AgentModelTransport;
  private readonly settings: Record<string, unknown>;
  constructor(private readonly options: AgentModelClientOptions) {
    this.transport = options.transport ?? new AgentModelTransport();
    this.settings = structuredClone(options.settings ?? {});
    const context = this.settings.contextWindow ?? 32_768;
    if (typeof context !== "number" || !Number.isSafeInteger(context) || context < 2048) throw new Error("模型上下文窗口必须为不小于 2048 的整数。");
    this.contextWindow = context;
    const url = new URL(options.baseUrl);
    if (options.protocol === "openai" && url.origin === "https://chatgpt.com" && url.pathname.replace(/\/+$/u, "") === "/backend-api/codex") {
      this.settings.codexSubscription = true;
      this.settings.stream = true;
    } else {
      this.settings.codexSubscription = false;
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("模型接口地址无效。");
    if (!options.model.trim()) throw new Error("模型标识不能为空。");
  }

  async *generate(request: ModelRequest): AsyncGenerator<ModelEvent> {
    const { protocol, apiKey, model } = this.options;
    const baseUrl = this.options.baseUrl.replace(/\/+$/u, "");
    const stream = this.settings.stream !== false;
    const path = protocol === "openai" ? "/responses" : protocol === "anthropic" ? "/messages" :
      protocol === "gemini" ? `/models/${encodeURIComponent(model.replace(/^models\//u, ""))}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}` : "/chat/completions";
    const headers: Record<string, string> = protocol === "anthropic" ? { "anthropic-version": "2023-06-01" } : {};
    if (apiKey) {
      if (protocol === "anthropic" && !this.options.headers?.Authorization) headers["x-api-key"] = apiKey;
      else if (protocol === "gemini" && !this.options.headers?.Authorization) headers["x-goog-api-key"] = apiKey;
      else headers.Authorization = `Bearer ${apiKey}`;
    }
    Object.assign(headers, this.options.headers);
    let body = await encodeAgentRequest(request, { protocol, model, settings: this.settings,
      ...(this.options.assetLoader ? { assetLoader: this.options.assetLoader } : {}) });
    const decoder = new ResponseAccumulator(protocol);
    let url = `${baseUrl}${path}`;
    const antigravity = isAntigravityOAuth(this.settings);
    if (antigravity) {
      if (!apiKey) throw new Error("Antigravity 账号缺少访问令牌。");
      const project = await antigravityProject(new ProviderHttpClient(), baseUrl, apiKey, request.signal, this.settings.gcpProjectId);
      body = antigravityRequest(project, model, body);
      url = `${baseUrl}/v1internal:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      for (const key of Object.keys(headers)) delete headers[key];
      Object.assign(headers, antigravityHeaders(apiKey));
    }
    for await (const raw of this.transport.post(url, headers, body, request.signal)) {
      const value = antigravity ? unwrapAntigravity(raw) : raw;
      const event = object(value);
      if (event.error || event.type === "error" || event.type === "response.failed") {
        const detail = sanitizeError(new Error(JSON.stringify(value, null, 2)), apiKey ? [apiKey] : []).message;
        throw new ProviderConnectionError("INVALID_RESPONSE", detail);
      }
      for (const text of decoder.add(value)) if (text) yield { type: "text_delta", text };
    }
    // Never expose executable tool calls until the stream has ended successfully.
    yield { type: "response", response: decoder.finish() };
  }
}

class ResponseAccumulator {
  private response: unknown;
  private readonly blocks = new Map<number, Record<string, unknown>>();
  private readonly arguments = new Map<number, string>();
  private readonly openBlocks = new Set<number>();
  private readonly geminiParts: Record<string, unknown>[] = [];
  private text = "";
  private reasoning = "";
  private stop: unknown;
  private usage: Record<string, unknown> = {};
  private ended = false;
  constructor(private readonly protocol: ProviderProtocol) {}

  add(value: unknown): string[] {
    const event = object(value);
    if (event.error || event.type === "error" || event.type === "response.failed") invalid("模型接口报告执行错误。");
    if (this.protocol === "openai") {
      if (event.type === "response.output_text.delta") return [String(event.delta ?? "")];
      if (event.type === "response.completed" || event.type === "response.incomplete") { this.response = event.response; this.ended = true; }
      else if (Array.isArray(event.output)) { this.response = event; this.ended = true; }
      return [];
    }
    if (this.protocol === "openai-compatible") {
      if (event.usage) this.usage = object(event.usage);
      const choice = objects(event.choices ?? [])[0];
      if (!choice) return [];
      if (choice.message) { this.response = event; this.ended = true; return []; }
      const delta = objectOrEmpty(choice.delta);
      if (typeof delta.content === "string") this.text += delta.content;
      if (typeof delta.reasoning_content === "string") this.reasoning += delta.reasoning_content;
      for (const item of objects(delta.tool_calls ?? [])) {
        const index = indexOf(item.index);
        const fn = objectOrEmpty(item.function);
        const call = this.blocks.get(index) ?? { id: "", name: "", arguments: "" };
        if (typeof item.id === "string") call.id = item.id;
        if (typeof fn.name === "string") call.name = String(call.name) + fn.name;
        if (typeof fn.arguments === "string") call.arguments = String(call.arguments) + fn.arguments;
        this.blocks.set(index, call);
      }
      if (choice.finish_reason) { this.stop = choice.finish_reason; this.ended = true; }
      return typeof delta.content === "string" ? [delta.content] : [];
    }
    if (this.protocol === "gemini") {
      if (event.usageMetadata) this.usage = object(event.usageMetadata);
      const candidate = objects(event.candidates ?? [])[0];
      if (!candidate) { if (event.promptFeedback) invalid("模型未生成可用内容。"); return []; }
      const parts = objects(objectOrEmpty(candidate.content).parts ?? []);
      this.geminiParts.push(...structuredClone(parts));
      if (candidate.finishReason) { this.stop = candidate.finishReason; this.ended = true; }
      return parts.flatMap((part) => typeof part.text === "string" && part.thought !== true ? [part.text] : []);
    }
    if (event.type === "message" && Array.isArray(event.content)) { this.response = event; this.ended = true; return []; }
    if (event.type === "message_start") this.usage = objectOrEmpty(object(event.message).usage);
    if (event.type === "content_block_start") {
      const index = indexOf(event.index);
      if (this.blocks.has(index)) invalid("模型流包含重复内容块。");
      this.blocks.set(index, structuredClone(object(event.content_block)));
      this.openBlocks.add(index);
      const block = this.blocks.get(index)!;
      return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
    }
    if (event.type === "content_block_delta") {
      const index = indexOf(event.index);
      const block = this.blocks.get(index);
      if (!block || !this.openBlocks.has(index)) invalid("模型流缺少内容块起点。");
      const delta = object(event.delta);
      if (delta.type === "input_json_delta") this.arguments.set(index, (this.arguments.get(index) ?? "") + String(delta.partial_json ?? ""));
      else if (delta.type === "thinking_delta") block.thinking = String(block.thinking ?? "") + String(delta.thinking ?? "");
      else if (delta.type === "signature_delta") block.signature = String(block.signature ?? "") + String(delta.signature ?? "");
      else if (delta.type === "text_delta") { block.text = String(block.text ?? "") + String(delta.text ?? ""); return [String(delta.text ?? "")]; }
    }
    if (event.type === "content_block_stop") {
      const index = indexOf(event.index);
      if (!this.openBlocks.delete(index)) invalid("模型流包含无效内容块终点。");
      const args = this.arguments.get(index);
      if (args) this.blocks.get(index)!.input = JSON.parse(args) as unknown;
    }
    if (event.type === "message_delta") {
      this.stop = object(event.delta).stop_reason;
      Object.assign(this.usage, objectOrEmpty(event.usage));
    }
    if (event.type === "message_stop") this.ended = true;
    return [];
  }

  finish(): ModelResponse {
    if (!this.ended || this.openBlocks.size) invalid("模型连接提前结束，未执行工具。");
    if (this.response) return decodeAgentResponse(this.protocol, this.response);
    const blocks = [...this.blocks.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
    if (this.protocol === "anthropic") return decodeAgentResponse(this.protocol, { content: blocks, stop_reason: this.stop, usage: this.usage });
    if (this.protocol === "gemini") return decodeAgentResponse(this.protocol, { candidates: [{ content: { parts: this.geminiParts }, finishReason: this.stop }], usageMetadata: this.usage });
    if (this.protocol === "openai-compatible") return decodeAgentResponse(this.protocol, {
      choices: [{ finish_reason: this.stop, message: { role: "assistant", content: this.text,
        ...(this.reasoning ? { reasoning_content: this.reasoning } : {}),
        tool_calls: blocks.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) } }], usage: this.usage
    });
    return invalid("模型响应缺少完整输出。");
  }
}
function indexOf(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 1000) invalid("模型内容块编号无效。");
  return value;
}
