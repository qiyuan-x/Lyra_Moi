import type { GenerationTaskSnapshot } from "@lyra/contracts";
import type { AgentTool } from "@lyra/agent-engine";
import type { GenerationService } from "@lyra/core";

interface GenerateImageArguments {
  prompt: string;
  count?: number;
  parameters?: Record<string, unknown>;
}

export function createGenerateImageTool(generationService: GenerationService): AgentTool {
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
      const input = argumentsValue as GenerateImageArguments;
      if (!context.defaultImageProviderProfileId || !context.defaultImageModelId) {
        throw new Error("Default image provider and model are not configured.");
      }
      const task = generationService.submit({
        projectId: context.projectId,
        prompt: input.prompt,
        attachments: context.attachments,
        providerProfileId: context.defaultImageProviderProfileId,
        providerModelId: context.defaultImageModelId,
        count: input.count ?? 1,
        parameters: input.parameters ?? {},
        source: "agent"
      });

      return {
        status: "waiting_tool",
        taskId: task.id,
        content: `生图任务 ${task.id} 已提交。`
      };
    }
  };
}

export function generationTaskToToolResult(task: GenerationTaskSnapshot): string {
  return JSON.stringify({
    taskId: task.id,
    status: task.status,
    error: task.error,
    outputs: task.outputs
  });
}
