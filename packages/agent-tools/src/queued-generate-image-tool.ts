import type { AgentTool } from "@lyra/agent-engine";
import type { QueuedGenerationService } from "@lyra/core";
import type { AgentToolStepStore } from "./agent-step-store.js";

interface GenerateImageArguments {
  prompt: string;
  count?: number;
  parameters?: Record<string, unknown>;
}

export function createQueuedGenerateImageTool(
  generationService: QueuedGenerationService,
  agentSteps: Pick<AgentToolStepStore, "findToolCall">
): AgentTool {
  return {
    definition: {
      name: "generate_image",
      description:
        "根据用户提示词和本轮有序参考素材创建生图任务。返回任务编号后，Agent 必须等待任务完成。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["prompt"],
        properties: {
          prompt: { type: "string", minLength: 1 },
          count: { type: "integer", minimum: 1, maximum: 8 },
          parameters: { type: "object", additionalProperties: true }
        }
      }
    },
    async execute(argumentsValue, context) {
      if (!context.defaultImageProviderProfileId || !context.defaultImageModelId) {
        throw new Error("Default image provider and model are not configured.");
      }
      const input = argumentsValue as GenerateImageArguments;
      const agentRunId = requireMetadata(context.metadata, "agentRunId");
      const toolCallId = requireMetadata(context.metadata, "agentToolCallId");
      const conversationId = requireMetadata(context.metadata, "conversationId");
      const requestMessageId = requireMetadata(context.metadata, "requestMessageId");
      const effectivePrompt = context.metadata.optimizeImagePrompt === false
        ? requireMetadata(context.metadata, "requestPrompt")
        : input.prompt;
      const toolStep = agentSteps.findToolCall(agentRunId, toolCallId);
      if (!toolStep) throw new Error(`Agent tool step not found: ${toolCallId}`);
      const job = generationService.submit(
        {
          projectId: context.projectId,
          prompt: effectivePrompt,
          attachments: context.attachments,
          providerProfileId: context.defaultImageProviderProfileId,
          providerModelId: context.defaultImageModelId,
          count: input.count ?? 1,
          parameters: input.parameters ?? {},
          source: "agent"
        },
        {
          conversationId,
          agentRunId,
          agentStepId: toolStep.id,
          requestMessageId,
          title: effectivePrompt
        }
      );
      return {
        status: "waiting_tool",
        taskId: job.id,
        content: `生图任务 ${job.id} 已提交。`
      };
    }
  };
}

function requireMetadata(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Agent tool metadata is missing: ${key}`);
  }
  return value;
}
