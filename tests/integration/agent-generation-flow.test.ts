import { describe, expect, it } from "vitest";
import {
  AgentEngine,
  MemoryAgentEventSink,
  ToolRegistry,
  type AgentCheckpoint,
  type LlmCompletion,
  type LlmCompletionInput,
  type LlmProvider
} from "@lyra/agent-engine";
import {
  createGenerateImageTool,
  generationTaskToToolResult
} from "@lyra/agent-tools";
import { GenerationService } from "@lyra/core";
import { FakeImageProvider } from "@lyra/providers";

class ScriptedLlmProvider implements LlmProvider {
  readonly inputs: LlmCompletionInput[] = [];
  readonly #responses: LlmCompletion[];

  constructor(responses: LlmCompletion[]) {
    this.#responses = [...responses];
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletion> {
    this.inputs.push(structuredClone(input));
    const response = this.#responses.shift();
    if (!response) throw new Error("Scripted LLM response is missing.");
    return structuredClone(response);
  }
}

describe("Agent and manual generation share one service", () => {
  it("waits for image generation, restores a checkpoint, and resumes", async () => {
    const imageProvider = new FakeImageProvider({ delayMs: 10 });
    const generationService = new GenerationService(imageProvider);
    const tools = new ToolRegistry().register(createGenerateImageTool(generationService));
    const llm = new ScriptedLlmProvider([
      {
        type: "tool_call",
        call: {
          id: "call-1",
          name: "generate_image",
          arguments: {
            prompt: "把图二的人物替换为图一的人物，保持图二姿势",
            count: 2
          }
        }
      },
      { type: "message", text: "已生成两张候选图，请验收。" }
    ]);
    const events = new MemoryAgentEventSink();
    const engine = new AgentEngine({ provider: llm, tools, eventSink: events });
    const attachments = [
      { assetId: "asset-character", label: "图1", position: 1 },
      { assetId: "asset-pose", label: "图2", position: 2 }
    ];

    const firstOutcome = await engine.run({
      messages: [{ role: "user", content: "把图二的人物完全替换为图一" }],
      context: {
        projectId: "project-1",
        attachments,
        defaultImageProviderProfileId: "image-provider-1",
        defaultImageModelId: "image-model-1",
        metadata: {}
      }
    });

    expect(firstOutcome.status).toBe("waiting_tool");
    if (firstOutcome.status !== "waiting_tool") throw new Error("Expected waiting_tool.");

    const manualTask = generationService.submit({
      projectId: "project-1",
      prompt: "生成单独的头部三视图",
      attachments: [{ assetId: "asset-character", label: "图1", position: 1 }],
      providerProfileId: "image-provider-1",
      providerModelId: "image-model-1",
      count: 1,
      parameters: { aspectRatio: "1:1" },
      source: "manual"
    });

    const [agentTask, completedManualTask] = await Promise.all([
      generationService.wait(firstOutcome.taskId),
      generationService.wait(manualTask.id)
    ]);
    expect(agentTask.status).toBe("succeeded");
    expect(completedManualTask.status).toBe("succeeded");

    const restoredCheckpoint = JSON.parse(
      JSON.stringify(firstOutcome.checkpoint)
    ) as AgentCheckpoint;
    const finalOutcome = await engine.resume(restoredCheckpoint, {
      taskId: agentTask.id,
      content: generationTaskToToolResult(agentTask)
    });

    expect(finalOutcome).toMatchObject({
      status: "completed",
      text: "已生成两张候选图，请验收。",
      toolCallCount: 1
    });
    expect(imageProvider.requests).toHaveLength(2);
    expect(imageProvider.requests.map((request) => request.source).sort()).toEqual([
      "agent",
      "manual"
    ]);
    const agentRequest = imageProvider.requests.find((request) => request.source === "agent");
    expect(agentRequest?.attachments).toEqual(attachments);
    expect(llm.inputs[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolCallId: "call-1",
      toolName: "generate_image"
    });
    expect(events.events.map((event) => event.type)).toEqual([
      "agent.thinking",
      "agent.tool.called",
      "agent.waiting_tool",
      "agent.tool.completed",
      "agent.resuming",
      "agent.thinking",
      "agent.completed"
    ]);
  });
});
