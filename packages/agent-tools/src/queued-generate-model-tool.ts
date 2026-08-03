import type { AgentTool } from "@lyra/agent-engine";
import type { ModelGenerationService } from "@lyra/core";
import type { ModelOutputFormat } from "@lyra/contracts";
import type { AgentToolStepStore } from "./agent-step-store.js";

const OUTPUT_FORMATS = new Set<ModelOutputFormat>([
  "glb",
  "obj",
  "fbx",
  "stl",
  "usdz",
  "3mf"
]);

interface GenerateModelArguments {
  imageAssetId: string;
  textureImageAssetId?: string;
  providerProfileId?: string;
  providerModelId?: string;
  outputFormats?: ModelOutputFormat[];
  parameters?: Record<string, unknown>;
}

type ApprovalDecision = "approved" | "rejected" | "none";

export function createQueuedGenerateModelTool(
  generationService: ModelGenerationService,
  agentSteps: AgentToolStepStore
): AgentTool {
  return {
    definition: {
      name: "generate_model",
      description:
        "根据指定图片创建 3D 建模任务。该操作会先请求用户审核，只有用户批准后才会提交任务。imageAssetId 必须使用本轮附件中的项目图片资产 ID，或此前工具结果中的输出 assetId。",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["imageAssetId"],
        properties: {
          imageAssetId: { type: "string", minLength: 1 },
          textureImageAssetId: { type: "string", minLength: 1 },
          providerProfileId: { type: "string", minLength: 1 },
          providerModelId: { type: "string", minLength: 1 },
          outputFormats: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: {
              type: "string",
              enum: [...OUTPUT_FORMATS]
            }
          },
          parameters: { type: "object", additionalProperties: true }
        }
      }
    },
    async execute(argumentsValue, context) {
      const input = normalizeArguments(argumentsValue, context);
      const agentRunId = requireMetadata(context.metadata, "agentRunId");
      const toolCallId = requireMetadata(context.metadata, "agentToolCallId");
      const conversationId = requireMetadata(context.metadata, "conversationId");
      const requestMessageId = requireMetadata(context.metadata, "requestMessageId");
      const toolStep = agentSteps.findToolCall(agentRunId, toolCallId);
      if (!toolStep) throw new Error(`Agent tool step not found: ${toolCallId}`);

      const decision = consumeApproval(agentSteps, agentRunId, input);
      if (decision === "none") {
        return {
          status: "awaiting_user",
          request: {
            prompt: buildApprovalPrompt(input),
            choices: [
              { id: "approve", label: "批准并开始建模" },
              { id: "reject", label: "取消本次建模" }
            ],
            metadata: {
              kind: "approval",
              action: "model.generate",
              arguments: input
            }
          }
        };
      }
      if (decision === "rejected") {
        return {
          status: "completed",
          content: "用户未批准本次建模任务，未提交任何模型生成请求。"
        };
      }

      const job = generationService.submit(
        context.projectId,
        {
          imageAssetId: input.imageAssetId,
          ...(input.textureImageAssetId
            ? { textureImageAssetId: input.textureImageAssetId }
            : {}),
          providerProfileId: input.providerProfileId,
          providerModelId: input.providerModelId,
          outputFormats: input.outputFormats ?? ["glb"],
          parameters: input.parameters ?? {}
        },
        {
          source: "agent",
          conversationId,
          agentRunId,
          agentStepId: toolStep.id,
          requestMessageId
        }
      );
      return {
        status: "waiting_tool",
        taskId: job.id,
        content: `模型生成任务 ${job.id} 已提交。请等待任务完成后再向用户报告结果。`
      };
    }
  };
}

function normalizeArguments(
  value: unknown,
  context: { defaultModelProviderProfileId?: string; defaultModelId?: string }
): GenerateModelArguments {
  if (!isRecord(value) || typeof value.imageAssetId !== "string" || !value.imageAssetId.trim()) {
    throw new Error("generate_model requires imageAssetId.");
  }
  const providerProfileId = readOptionalString(value.providerProfileId);
  const providerModelId = readOptionalString(value.providerModelId);
  if ((providerProfileId && !providerModelId) || (!providerProfileId && providerModelId)) {
    throw new Error("providerProfileId and providerModelId must be provided together.");
  }
  const resolvedProfileId = providerProfileId ?? context.defaultModelProviderProfileId;
  const resolvedModelId = providerModelId ?? context.defaultModelId;
  if (!resolvedProfileId || !resolvedModelId) {
    throw new Error("AI 建模默认供应商和模型尚未配置。请先在设置中启用 AI 建模模型。");
  }
  const textureImageAssetId = readOptionalString(value.textureImageAssetId);
  const outputFormats = readOutputFormats(value.outputFormats);
  const parameters = value.parameters === undefined
    ? undefined
    : isRecord(value.parameters)
      ? structuredClone(value.parameters)
      : (() => {
          throw new Error("parameters must be an object.");
        })();
  return {
    imageAssetId: value.imageAssetId.trim(),
    ...(textureImageAssetId ? { textureImageAssetId } : {}),
    providerProfileId: resolvedProfileId,
    providerModelId: resolvedModelId,
    outputFormats: outputFormats ?? ["glb"],
    parameters: parameters ?? {}
  };
}

function consumeApproval(
  agentSteps: AgentToolStepStore,
  agentRunId: string,
  argumentsValue: GenerateModelArguments
): ApprovalDecision {
  const argumentsFingerprint = stableStringify(argumentsValue);
  const steps = agentSteps.list(agentRunId);
  for (const resultStep of [...steps].reverse()) {
    if (resultStep.type !== "user_input_result") continue;
    const requestStepId = readOptionalString(resultStep.payload.requestStepId);
    const input = isRecord(resultStep.payload.input) ? resultStep.payload.input : null;
    if (!requestStepId || !input) continue;
    const requestStep = agentSteps.findById(requestStepId);
    if (!requestStep || requestStep.payload.approvalConsumedAt) continue;
    const request = isRecord(requestStep.payload.request) ? requestStep.payload.request : null;
    const metadata = request && isRecord(request.metadata) ? request.metadata : null;
    if (
      !metadata ||
      metadata.kind !== "approval" ||
      metadata.action !== "model.generate" ||
      stableStringify(metadata.arguments) !== argumentsFingerprint
    ) {
      continue;
    }
    const choiceId = readOptionalString(input.choiceId);
    if (choiceId !== "approve" && choiceId !== "reject") continue;
    agentSteps.update(requestStep.id, {
      payload: {
        ...requestStep.payload,
        approvalConsumedAt: new Date().toISOString(),
        approvalDecision: choiceId
      }
    });
    return choiceId === "approve" ? "approved" : "rejected";
  }
  return "none";
}

function buildApprovalPrompt(input: GenerateModelArguments): string {
  const formats = (input.outputFormats ?? ["glb"]).join(", ");
  const texture = input.textureImageAssetId
    ? `，纹理输入图为 ${input.textureImageAssetId}`
    : "";
  return `准备使用图片资产 ${input.imageAssetId}${texture} 创建 3D 模型，输出格式：${formats}。是否批准开始建模？`;
}

function readOutputFormats(value: unknown): ModelOutputFormat[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("outputFormats must be a non-empty array.");
  }
  const formats = [...new Set(value.map((format) => {
    if (typeof format !== "string" || !OUTPUT_FORMATS.has(format as ModelOutputFormat)) {
      throw new Error(`Unsupported model output format: ${String(format)}`);
    }
    return format as ModelOutputFormat;
  }))];
  return formats;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requireMetadata(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  if (typeof value !== "string" || !value) throw new Error(`Agent tool metadata is missing: ${key}`);
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
