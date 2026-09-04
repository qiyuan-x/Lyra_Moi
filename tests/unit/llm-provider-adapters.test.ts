import { describe, expect, it } from "vitest";
import type { AgentMessage, AgentToolDefinition } from "@lyra/agent-engine";
import {
  AnthropicLlmProvider,
  GeminiInteractionsLlmProvider,
  OpenAiCompatibleLlmProvider,
  OpenAiResponsesLlmProvider,
  ProviderHttpClient,
  type FetchLike,
  type LlmProviderAssetLoader
} from "@lyra/providers";

const tools: AgentToolDefinition[] = [
  {
    name: "generate_image",
    description: "Generate an image",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["prompt"],
      properties: { prompt: { type: "string", minLength: 1 } }
    }
  }
];

const assetLoader: LlmProviderAssetLoader = {
  async loadAsset(assetId, projectId) {
    expect(assetId).toBe("asset-image");
    expect(projectId).toBe("project-1");
    return {
      data: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      name: "reference.png"
    };
  }
};

describe("LLM provider adapters", () => {
  it("maps Agent tools through the native Anthropic Messages API", async () => {
    let request: { url: string; init: RequestInit; body: Record<string, unknown> } | null = null;
    const provider = new AnthropicLlmProvider({
      baseUrl: "https://api.anthropic.test/v1",
      apiKey: "anthropic-secret",
      model: "claude-test",
      settings: { maxOutputTokens: 300 },
      client: new ProviderHttpClient({
        fetchImplementation: async (input, init = {}) => {
          request = {
            url: String(input),
            init,
            body: JSON.parse(String(init.body)) as Record<string, unknown>
          };
          return Response.json({
            content: [{
              type: "tool_use",
              id: "tool_1",
              name: "generate_image",
              input: { prompt: "draw it" }
            }]
          });
        }
      })
    });

    await expect(provider.complete({
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Draw" }
      ],
      tools,
      signal: undefined
    })).resolves.toEqual({
      type: "tool_call",
      call: {
        id: "tool_1",
        name: "generate_image",
        arguments: { prompt: "draw it" }
      }
    });
    expect(request!.url).toBe("https://api.anthropic.test/v1/messages");
    expect(request!.init.headers).toMatchObject({
      "x-api-key": "anthropic-secret",
      "anthropic-version": "2023-06-01"
    });
    expect(request!.body).toMatchObject({
      model: "claude-test",
      max_tokens: 300,
      system: "System prompt",
      tool_choice: { type: "auto" }
    });
  });

  it("maps Agent messages and tool calls through the OpenAI Responses API", async () => {
    const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
    const fetchImplementation: FetchLike = async (input, init = {}) => {
      requests.push({
        url: String(input),
        init,
        body: JSON.parse(String(init.body)) as Record<string, unknown>
      });
      return Response.json({
        id: "resp_1",
        output: [
          {
            type: "function_call",
            call_id: "call_1",
            name: "generate_image",
            arguments: '{"prompt":"draw it"}'
          }
        ]
      });
    };
    const provider = new OpenAiResponsesLlmProvider({
      baseUrl: "https://api.openai.test/v1/",
      apiKey: "secret",
      model: "gpt-test",
      settings: { maxOutputTokens: 200, reasoningEffort: "medium" },
      client: new ProviderHttpClient({ fetchImplementation })
    });
    const completion = await provider.complete({
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Draw" }
      ],
      tools,
      signal: undefined
    });

    expect(completion).toEqual({
      type: "tool_call",
      call: { id: "call_1", name: "generate_image", arguments: { prompt: "draw it" } }
    });
    expect(requests[0]?.url).toBe("https://api.openai.test/v1/responses");
    expect(requests[0]?.init.headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(requests[0]?.body).toMatchObject({
      model: "gpt-test",
      store: false,
      instructions: "System prompt",
      parallel_tool_calls: false,
      max_output_tokens: 200,
      reasoning: { effort: "medium" }
    });
  });

  it("supports OpenAI-compatible Chat Completions without an API key", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const provider = new OpenAiCompatibleLlmProvider({
      baseUrl: "http://127.0.0.1:9000/v1",
      apiKey: null,
      model: "local-model",
      assetLoader,
      client: new ProviderHttpClient({
        fetchImplementation: async (_input, init = {}) => {
          requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({
            choices: [{ message: { role: "assistant", content: "local reply" } }]
          });
        }
      })
    });
    const messages: AgentMessage[] = [
      {
        role: "user",
        content: "Draw",
        attachments: [{ assetId: "asset-image", label: "图1", position: 1 }]
      },
      {
        role: "assistant",
        content: "",
        toolCall: { id: "call_local", name: "generate_image", arguments: { prompt: "one" } }
      },
      { role: "tool", content: "done", toolCallId: "call_local", toolName: "generate_image" }
    ];
    await expect(provider.complete({
      projectId: "project-1",
      messages,
      tools,
      signal: undefined
    })).resolves.toEqual({
      type: "message",
      text: "local reply"
    });
    expect(requestBody).toMatchObject({ model: "local-model", tool_choice: "auto" });
    expect((requestBody!.messages as Array<Record<string, unknown>>)[0]).toEqual({
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
        { type: "text", text: "Draw" }
      ]
    });
    expect((requestBody!.messages as Array<Record<string, unknown>>)[1]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "call_local",
          function: { name: "generate_image", arguments: '{"prompt":"one"}' }
        }
      ]
    });
  });

  it("persists the Gemini interaction ID across a tool result", async () => {
    const bodies: Record<string, unknown>[] = [];
    const responses = [
      {
        id: "interaction_1",
        status: "completed",
        steps: [
          {
            type: "function_call",
            id: "gemini_call_1",
            name: "generate_image",
            arguments: { prompt: "gemini draw" }
          }
        ]
      },
      {
        id: "interaction_2",
        status: "completed",
        steps: [
          {
            type: "model_output",
            content: [{ type: "text", text: "finished" }]
          }
        ]
      }
    ];
    const provider = new GeminiInteractionsLlmProvider({
      baseUrl: "https://generativelanguage.test/v1beta",
      apiKey: "gemini-secret",
      model: "gemini-test",
      client: new ProviderHttpClient({
        fetchImplementation: async (_input, init = {}) => {
          bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          return Response.json(responses.shift());
        }
      })
    });
    const first = await provider.complete({
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Draw" }
      ],
      tools,
      signal: undefined
    });
    expect(first).toEqual({
      type: "tool_call",
      call: {
        id: "gemini_call_1",
        name: "generate_image",
        arguments: { prompt: "gemini draw" },
        providerMetadata: { geminiInteractionId: "interaction_1" }
      }
    });
    if (first.type !== "tool_call") throw new Error("Expected tool call.");
    const second = await provider.complete({
      messages: [
        { role: "system", content: "System prompt" },
        { role: "user", content: "Draw" },
        { role: "assistant", content: "", toolCall: first.call },
        {
          role: "tool",
          content: '{"status":"succeeded"}',
          toolCallId: first.call.id,
          toolName: first.call.name
        }
      ],
      tools,
      signal: undefined
    });
    expect(second).toEqual({ type: "message", text: "finished" });
    expect(bodies[0]).toMatchObject({
      model: "gemini-test",
      store: true,
      system_instruction: "System prompt",
      input: "User: Draw"
    });
    const geminiTool = (bodies[0]!.tools as Array<Record<string, unknown>>)[0]!;
    expect(geminiTool.parameters).toEqual({
      type: "object",
      required: ["prompt"],
      properties: { prompt: { type: "string" } }
    });
    expect(bodies[1]).toMatchObject({
      previous_interaction_id: "interaction_1",
      input: [
        {
          type: "function_result",
          name: "generate_image",
          call_id: "gemini_call_1",
          result: [{ type: "text", text: '{"status":"succeeded"}' }]
        }
      ]
    });
  });

  it("passes image attachments to the OpenAI Responses API without changing the text", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const provider = new OpenAiResponsesLlmProvider({
      baseUrl: "https://api.openai.test/v1",
      apiKey: "secret",
      model: "gpt-vision",
      assetLoader,
      client: new ProviderHttpClient({
        fetchImplementation: async (_input, init = {}) => {
          requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ output_text: "description", output: [] });
        }
      })
    });

    await provider.complete({
      projectId: "project-1",
      messages: [{
        role: "user",
        content: "  描述这张图片  ",
        attachments: [{ assetId: "asset-image", label: "图1", position: 1 }]
      }],
      tools: [],
      signal: undefined
    });

    expect(requestBody!.input).toEqual([{
      role: "user",
      content: [
        { type: "input_image", image_url: "data:image/png;base64,AQID" },
        { type: "input_text", text: "  描述这张图片  " }
      ]
    }]);
  });

  it("passes image attachments to the Anthropic Messages API", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const provider = new AnthropicLlmProvider({
      baseUrl: "https://api.anthropic.test/v1",
      apiKey: "secret",
      model: "claude-vision",
      assetLoader,
      client: new ProviderHttpClient({
        fetchImplementation: async (_input, init = {}) => {
          requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({ content: [{ type: "text", text: "description" }] });
        }
      })
    });

    await provider.complete({
      projectId: "project-1",
      messages: [{
        role: "user",
        content: "描述图片",
        attachments: [{ assetId: "asset-image", label: "图1", position: 1 }]
      }],
      tools: [],
      signal: undefined
    });

    expect(requestBody!.messages).toEqual([{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "AQID" }
        },
        { type: "text", text: "描述图片" }
      ]
    }]);
  });

  it("passes image attachments to the Gemini Interactions API", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const provider = new GeminiInteractionsLlmProvider({
      baseUrl: "https://generativelanguage.test/v1beta",
      apiKey: "secret",
      model: "gemini-vision",
      assetLoader,
      client: new ProviderHttpClient({
        fetchImplementation: async (_input, init = {}) => {
          requestBody = JSON.parse(String(init.body)) as Record<string, unknown>;
          return Response.json({
            id: "interaction-image",
            status: "completed",
            steps: [{ type: "model_output", content: [{ type: "text", text: "description" }] }]
          });
        }
      })
    });

    await provider.complete({
      projectId: "project-1",
      messages: [{
        role: "user",
        content: "描述图片",
        attachments: [{ assetId: "asset-image", label: "图1", position: 1 }]
      }],
      tools: [],
      signal: undefined
    });

    expect(requestBody!.input).toEqual([
      { type: "image", data: "AQID", mime_type: "image/png" },
      { type: "text", text: "描述图片" }
    ]);
  });
});
