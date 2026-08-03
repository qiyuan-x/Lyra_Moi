export type JsonSchema = Record<string, unknown>;

export const orderedAssetInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["assetId", "label", "position"],
  properties: {
    assetId: { type: "string", minLength: 1 },
    label: { type: "string", minLength: 1 },
    position: { type: "integer", minimum: 1 }
  }
} as const satisfies JsonSchema;

export const manualGenerationRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "projectId",
    "prompt",
    "attachments",
    "providerProfileId",
    "providerModelId",
    "count",
    "parameters"
  ],
  properties: {
    projectId: { type: "string", minLength: 1 },
    conversationId: { type: "string", minLength: 1 },
    prompt: { type: "string", minLength: 1 },
    attachments: { type: "array", items: orderedAssetInputSchema },
    providerProfileId: { type: "string", minLength: 1 },
    providerModelId: { type: "string", minLength: 1 },
    count: { type: "integer", minimum: 1, maximum: 8 },
    parameters: { type: "object", additionalProperties: true }
  }
} as const satisfies JsonSchema;

export const manualModelGenerationRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "projectId",
    "imageAssetId",
    "providerProfileId",
    "providerModelId",
    "outputFormats",
    "parameters"
  ],
  properties: {
    projectId: { type: "string", minLength: 1 },
    imageAssetId: { type: "string", minLength: 1 },
    textureImageAssetId: { type: "string", minLength: 1 },
    providerProfileId: { type: "string", minLength: 1 },
    providerModelId: { type: "string", minLength: 1 },
    outputFormats: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { enum: ["glb", "obj", "fbx", "stl", "usdz", "3mf"] }
    },
    parameters: { type: "object", additionalProperties: true }
  }
} as const satisfies JsonSchema;

export const sendAgentMessageRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "attachments"],
  properties: {
    text: { type: "string", minLength: 1 },
    attachments: { type: "array", items: orderedAssetInputSchema },
    optimizeImagePrompt: { type: "boolean" },
    selection: {
      type: "object",
      additionalProperties: false,
      properties: {
        llmProviderProfileId: { type: "string", minLength: 1 },
        llmModelId: { type: "string", minLength: 1 },
        defaultImageProviderProfileId: { type: "string", minLength: 1 },
        defaultImageModelId: { type: "string", minLength: 1 }
      }
    }
  }
} as const satisfies JsonSchema;

export const resumeAgentUserInputRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text", "attachments"],
  properties: {
    text: { type: "string" },
    choiceId: { type: "string", minLength: 1 },
    attachments: { type: "array", items: orderedAssetInputSchema }
  }
} as const satisfies JsonSchema;

export const createProviderProfileRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["serviceType", "name", "protocol"],
  properties: {
    serviceType: { enum: ["llm", "image", "model"] },
    name: { type: "string", minLength: 1 },
    protocol: { enum: ["openai", "gemini", "openai-compatible"] },
    adapterType: {
      enum: ["openai", "gemini", "openai-compatible", "meshy", "tripo", "hunyuan"]
    },
    baseUrl: { type: "string" },
    settings: { type: "object", additionalProperties: true },
    apiKey: { type: "string", minLength: 1 },
    secondaryApiKey: { type: "string", minLength: 1 },
    enabled: { type: "boolean" }
  }
} as const satisfies JsonSchema;

export const updateProviderProfileRequestSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1 },
    protocol: { enum: ["openai", "gemini", "openai-compatible"] },
    adapterType: {
      enum: ["openai", "gemini", "openai-compatible", "meshy", "tripo", "hunyuan"]
    },
    baseUrl: { type: "string" },
    settings: { type: "object", additionalProperties: true },
    enabled: { type: "boolean" },
    apiKey: { type: "string", minLength: 1 },
    clearApiKey: { type: "boolean" },
    secondaryApiKey: { type: "string", minLength: 1 },
    clearSecondaryApiKey: { type: "boolean" }
  }
} as const satisfies JsonSchema;

export const createProviderModelRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["serviceType", "remoteModelId", "displayName"],
  properties: {
    serviceType: { enum: ["llm", "image", "model"] },
    remoteModelId: { type: "string", minLength: 1 },
    displayName: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    isDefault: { type: "boolean" },
    settings: { type: "object", additionalProperties: true }
  }
} as const satisfies JsonSchema;

export const updateProviderModelRequestSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    displayName: { type: "string", minLength: 1 },
    enabled: { type: "boolean" },
    isDefault: { type: "boolean" },
    settings: { type: "object", additionalProperties: true }
  }
} as const satisfies JsonSchema;

export const updateAssetRequestSchema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    tags: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 50 }
    }
  }
} as const satisfies JsonSchema;

export const createPromptTemplateRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "content"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    category: { type: "string", maxLength: 80 },
    note: { anyOf: [{ type: "string", minLength: 1, maxLength: 200 }, { type: "null" }] },
    content: { type: "string", minLength: 1, maxLength: 10000 },
    variables: {
      type: "array",
      maxItems: 50,
      items: { type: "string", minLength: 1, maxLength: 80 }
    },
    favorite: { type: "boolean" }
  }
} as const satisfies JsonSchema;

export const updatePromptTemplateRequestSchema = {
  ...createPromptTemplateRequestSchema,
  required: [],
  minProperties: 1
} as const satisfies JsonSchema;
