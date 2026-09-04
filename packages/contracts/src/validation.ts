import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import type {
  ResumeAgentUserInputRequestBody,
  SendAgentMessageRequestBody
} from "./agent.js";
import type {
  ManualGenerationRequestBody
} from "./generation.js";
import type { ManualModelGenerationRequestBody } from "./model-generation.js";
import type { OrderedAssetInput } from "./common.js";
import type { UpdateAssetRequestBody } from "./asset.js";
import type {
  CreateProviderModelRequestBody,
  CreateProviderProfileRequestBody,
  UpdateProviderModelRequestBody,
  UpdateProviderProfileRequestBody
} from "./provider.js";
import type {
  CreatePromptTemplateRequestBody,
  UpdatePromptTemplateRequestBody
} from "./prompt.js";
import {
  createPromptTemplateRequestSchema,
  createProviderModelRequestSchema,
  createProviderProfileRequestSchema,
  manualGenerationRequestSchema,
  manualModelGenerationRequestSchema,
  resumeAgentUserInputRequestSchema,
  sendAgentMessageRequestSchema,
  updateAssetRequestSchema,
  updateProviderModelRequestSchema,
  updateProviderProfileRequestSchema,
  updatePromptTemplateRequestSchema
} from "./schemas.js";

const ajv = new Ajv({ allErrors: true, strict: false });
const validateManual = ajv.compile(
  manualGenerationRequestSchema
) as ValidateFunction<ManualGenerationRequestBody>;
const validateManualModel = ajv.compile(
  manualModelGenerationRequestSchema
) as ValidateFunction<ManualModelGenerationRequestBody>;
const validateAgentMessage = ajv.compile(
  sendAgentMessageRequestSchema
) as ValidateFunction<SendAgentMessageRequestBody>;
const validateAgentUserInput = ajv.compile(
  resumeAgentUserInputRequestSchema
) as ValidateFunction<ResumeAgentUserInputRequestBody>;
const validateCreateProviderProfile = ajv.compile(
  createProviderProfileRequestSchema
) as ValidateFunction<CreateProviderProfileRequestBody>;
const validateUpdateProviderProfile = ajv.compile(
  updateProviderProfileRequestSchema
) as ValidateFunction<UpdateProviderProfileRequestBody>;
const validateCreateProviderModel = ajv.compile(
  createProviderModelRequestSchema
) as ValidateFunction<CreateProviderModelRequestBody>;
const validateUpdateProviderModel = ajv.compile(
  updateProviderModelRequestSchema
) as ValidateFunction<UpdateProviderModelRequestBody>;
const validateUpdateAsset = ajv.compile(
  updateAssetRequestSchema
) as ValidateFunction<UpdateAssetRequestBody>;
const validateCreatePrompt = ajv.compile(
  createPromptTemplateRequestSchema
) as ValidateFunction<CreatePromptTemplateRequestBody>;
const validateUpdatePrompt = ajv.compile(
  updatePromptTemplateRequestSchema
) as ValidateFunction<UpdatePromptTemplateRequestBody>;

export class ContractValidationError extends Error {
  readonly details: string[];

  constructor(details: string[]) {
    super(details.join("; "));
    this.name = "ContractValidationError";
    this.details = [...details];
  }
}

export function parseManualGenerationRequest(value: unknown): ManualGenerationRequestBody {
  assertSchema(validateManual, value);
  if (!value.prompt.trim()) throw new ContractValidationError(["prompt cannot be blank"]);
  assertOrderedAttachments(value.attachments);
  return structuredClone(value);
}

export function parseManualModelGenerationRequest(
  value: unknown
): ManualModelGenerationRequestBody {
  const normalized = isRecord(value) && value.inputMode === undefined &&
    typeof value.imageAssetId === "string"
    ? { ...value, inputMode: "image" }
    : value;
  assertSchema(validateManualModel, normalized);
  return structuredClone(normalized);
}

export function parseSendAgentMessageRequest(value: unknown): SendAgentMessageRequestBody {
  assertSchema(validateAgentMessage, value);
  assertOrderedAttachments(value.attachments);
  if (!value.text.trim() && value.attachments.length === 0) {
    throw new ContractValidationError(["message cannot be empty"]);
  }

  const selection = value.selection;
  if (selection) {
    const hasLlmProfile = Boolean(selection.llmProviderProfileId);
    const hasLlmModel = Boolean(selection.llmModelId);
    if (hasLlmProfile !== hasLlmModel) {
      throw new ContractValidationError([
        "llmProviderProfileId and llmModelId must be provided together"
      ]);
    }
    const hasImageProfile = Boolean(selection.defaultImageProviderProfileId);
    const hasImageModel = Boolean(selection.defaultImageModelId);
    if (hasImageProfile !== hasImageModel) {
      throw new ContractValidationError([
        "defaultImageProviderProfileId and defaultImageModelId must be provided together"
      ]);
    }
    const hasModelProfile = Boolean(selection.defaultModelProviderProfileId);
    const hasModel = Boolean(selection.defaultModelId);
    if (hasModelProfile !== hasModel) {
      throw new ContractValidationError([
        "defaultModelProviderProfileId and defaultModelId must be provided together"
      ]);
    }
  }

  return structuredClone(value);
}

export function parseResumeAgentUserInputRequest(
  value: unknown
): ResumeAgentUserInputRequestBody {
  assertSchema(validateAgentUserInput, value);
  assertOrderedAttachments(value.attachments);
  if (!value.text.trim() && !value.choiceId?.trim() && value.attachments.length === 0) {
    throw new ContractValidationError(["user input cannot be empty"]);
  }
  return structuredClone(value);
}

export function assertOrderedAttachments(attachments: readonly OrderedAssetInput[]): void {
  for (const [index, attachment] of attachments.entries()) {
    if (attachment.position !== index + 1) {
      throw new ContractValidationError([
        "attachment positions must be continuous, ordered, and start at 1"
      ]);
    }
  }
}

export function parseCreateProviderProfileRequest(
  value: unknown
): CreateProviderProfileRequestBody {
  assertSchema(validateCreateProviderProfile, value);
  assertNonBlank("name", value.name);
  if (value.apiKey !== undefined) assertNonBlank("apiKey", value.apiKey);
  if (value.secondaryApiKey !== undefined) {
    assertNonBlank("secondaryApiKey", value.secondaryApiKey);
  }
  return structuredClone(value);
}

export function parseUpdateProviderProfileRequest(
  value: unknown
): UpdateProviderProfileRequestBody {
  assertSchema(validateUpdateProviderProfile, value);
  if (value.name !== undefined) assertNonBlank("name", value.name);
  if (value.apiKey !== undefined) assertNonBlank("apiKey", value.apiKey);
  if (value.secondaryApiKey !== undefined) {
    assertNonBlank("secondaryApiKey", value.secondaryApiKey);
  }
  if (value.apiKey !== undefined && value.clearApiKey === true) {
    throw new ContractValidationError(["apiKey and clearApiKey cannot be used together"]);
  }
  if (value.secondaryApiKey !== undefined && value.clearSecondaryApiKey === true) {
    throw new ContractValidationError([
      "secondaryApiKey and clearSecondaryApiKey cannot be used together"
    ]);
  }
  return structuredClone(value);
}

export function parseCreateProviderModelRequest(
  value: unknown
): CreateProviderModelRequestBody {
  assertSchema(validateCreateProviderModel, value);
  assertNonBlank("remoteModelId", value.remoteModelId);
  assertNonBlank("displayName", value.displayName);
  return structuredClone(value);
}

export function parseUpdateProviderModelRequest(
  value: unknown
): UpdateProviderModelRequestBody {
  assertSchema(validateUpdateProviderModel, value);
  if (value.displayName !== undefined) assertNonBlank("displayName", value.displayName);
  return structuredClone(value);
}

export function parseUpdateAssetRequest(value: unknown): UpdateAssetRequestBody {
  assertSchema(validateUpdateAsset, value);
  if (value.name !== undefined) assertNonBlank("name", value.name);
  if (value.tags !== undefined) {
    for (const tag of value.tags) assertNonBlank("tag", tag);
  }
  return structuredClone(value);
}

export function parseCreatePromptTemplateRequest(
  value: unknown
): CreatePromptTemplateRequestBody {
  assertSchema(validateCreatePrompt, value);
  assertNonBlank("name", value.name);
  assertNonBlank("content", value.content);
  validatePromptStrings(value.category, value.note, value.variables);
  return structuredClone(value);
}

export function parseUpdatePromptTemplateRequest(
  value: unknown
): UpdatePromptTemplateRequestBody {
  assertSchema(validateUpdatePrompt, value);
  if (value.name !== undefined) assertNonBlank("name", value.name);
  if (value.content !== undefined) assertNonBlank("content", value.content);
  validatePromptStrings(value.category, value.note, value.variables);
  return structuredClone(value);
}

function assertSchema<T>(validator: ValidateFunction<T>, value: unknown): asserts value is T {
  if (validator(value)) return;
  throw new ContractValidationError(formatErrors(validator.errors));
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors?.length) return ["request is invalid"];
  return errors.map(
    (error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNonBlank(field: string, value: string): void {
  if (!value.trim()) throw new ContractValidationError([`${field} cannot be blank`]);
}

function validatePromptStrings(
  category: string | undefined,
  note: string | null | undefined,
  variables: string[] | undefined
): void {
  if (category !== undefined && category.trim().length !== category.length) {
    throw new ContractValidationError(["category cannot start or end with whitespace"]);
  }
  if (note !== undefined && note !== null) assertNonBlank("note", note);
  if (variables !== undefined) {
    for (const variable of variables) assertNonBlank("variable", variable);
  }
}
