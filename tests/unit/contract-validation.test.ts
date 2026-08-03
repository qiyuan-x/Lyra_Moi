import { describe, expect, it } from "vitest";
import {
  ContractValidationError,
  parseManualGenerationRequest,
  parseManualModelGenerationRequest,
  parseCreatePromptTemplateRequest,
  parseResumeAgentUserInputRequest,
  parseSendAgentMessageRequest,
  parseUpdateProviderProfileRequest
} from "@lyra/contracts";

describe("request contract validation", () => {
  it("accepts arbitrary natural language and preserves ordered attachments", () => {
    const value = {
      projectId: "project-1",
      prompt: "把图二的人物完全替换为图一，保持图二动作",
      attachments: [
        { assetId: "asset-1", label: "图1", position: 1 },
        { assetId: "asset-2", label: "图2", position: 2 }
      ],
      providerProfileId: "profile-1",
      providerModelId: "model-1",
      count: 2,
      parameters: { aspectRatio: "1:1" }
    };

    expect(parseManualGenerationRequest(value)).toEqual(value);
  });

  it("accepts a separate optional Meshy texture reference image", () => {
    const value = {
      projectId: "project-1",
      imageAssetId: "geometry-image",
      textureImageAssetId: "texture-image",
      providerProfileId: "meshy-profile",
      providerModelId: "meshy-6",
      outputFormats: ["glb", "obj"],
      parameters: { texture: true, pbr: true }
    };

    expect(parseManualModelGenerationRequest(value)).toEqual(value);
  });

  it("rejects reordered attachments", () => {
    expect(() =>
      parseSendAgentMessageRequest({
        text: "test",
        attachments: [
          { assetId: "asset-2", label: "图2", position: 2 },
          { assetId: "asset-1", label: "图1", position: 1 }
        ]
      })
    ).toThrow(ContractValidationError);
  });

  it("requires provider and model selections in pairs", () => {
    expect(() =>
      parseSendAgentMessageRequest({
        text: "test",
        attachments: [],
        selection: { llmProviderProfileId: "profile-1" }
      })
    ).toThrow("llmProviderProfileId and llmModelId must be provided together");
  });

  it("accepts a boolean Agent image prompt mode", () => {
    expect(
      parseSendAgentMessageRequest({
        text: "为该图片上色",
        attachments: [],
        optimizeImagePrompt: false
      })
    ).toMatchObject({ optimizeImagePrompt: false });
    expect(() =>
      parseSendAgentMessageRequest({
        text: "test",
        attachments: [],
        optimizeImagePrompt: "false"
      })
    ).toThrow(ContractValidationError);
  });

  it("requires explicit API key clearing", () => {
    expect(() =>
      parseUpdateProviderProfileRequest({
        apiKey: "new-key",
        clearApiKey: true
      })
    ).toThrow("apiKey and clearApiKey cannot be used together");
  });

  it("accepts explicit Agent user input and rejects an empty resume", () => {
    expect(
      parseResumeAgentUserInputRequest({
        text: "保留图二背景",
        choiceId: "keep-second",
        attachments: []
      })
    ).toMatchObject({ choiceId: "keep-second" });
    expect(() =>
      parseResumeAgentUserInputRequest({ text: "", attachments: [] })
    ).toThrow("user input cannot be empty");
  });

  it("validates user prompt templates without restricting their content", () => {
    expect(parseCreatePromptTemplateRequest({
      name: "自由编辑",
      category: "我的分类",
      content: "把图二的人物替换为图一，其他内容保持不变",
      variables: ["主体", "目标"]
    })).toMatchObject({ name: "自由编辑", variables: ["主体", "目标"] });
    expect(() => parseCreatePromptTemplateRequest({ name: "空内容", content: "   " })).toThrow(
      "content cannot be blank"
    );
  });
});
