import {
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  AssetSnapshot,
  JobSnapshot,
  ModelOutputFormat,
  ProviderModelSnapshot
} from "@lyra/contracts";
import type { ManualImageTaskInput } from "../features/generation/task-input.js";
import { findEnabledModel } from "../features/providers/catalog-selectors.js";
import {
  toOrderedAttachments,
  type ApiClient,
  type ProviderCatalog
} from "../lib/api-client.js";

type ModelGenerationInput = {
  textureImageAssetId?: string;
  modelId: string;
  outputFormats: ModelOutputFormat[];
  parameters: Record<string, unknown>;
} & (
  | { inputMode: "image"; imageAssetId: string }
  | { inputMode: "text"; prompt: string }
);

interface UseGenerationActionsOptions {
  api: ApiClient;
  catalog: ProviderCatalog;
  projectId: string;
  selectedImageModel: ProviderModelSnapshot | undefined;
  setAttachments: Dispatch<SetStateAction<AssetSnapshot[]>>;
  refreshProject: (projectId: string) => Promise<void>;
  onNotice: (text: string) => void;
  onError: (error: unknown) => void;
}

export function useGenerationActions(
  options: UseGenerationActionsOptions
) {
  const [editingImageJob, setEditingImageJob] = useState<JobSnapshot | null>(null);
  const [imageSubmitting, setImageSubmitting] = useState(false);
  const [modelSubmitting, setModelSubmitting] = useState(false);

  async function submitConfiguredTask(input: ManualImageTaskInput) {
    if (!options.projectId) return;
    const selectedModel = findEnabledModel(
      options.catalog,
      "image",
      input.modelId
    );
    if (!selectedModel) {
      options.onError(new Error("选择的图片模型不可用。"));
      return;
    }
    setImageSubmitting(true);
    try {
      await options.api.createGeneration(options.projectId, {
        prompt: input.prompt,
        attachments: toOrderedAttachments(input.attachments),
        providerProfileId: selectedModel.providerProfileId,
        providerModelId: selectedModel.id,
        count: input.count,
        parameters: input.aspectRatio === "auto"
          ? {}
          : { aspectRatio: input.aspectRatio }
      });
      setEditingImageJob(null);
      options.setAttachments([]);
      await options.refreshProject(options.projectId);
    } catch (error) {
      options.onError(error);
      throw error;
    } finally {
      setImageSubmitting(false);
    }
  }

  async function submitModelGeneration(input: ModelGenerationInput) {
    if (!options.projectId) return;
    const selectedModel = findEnabledModel(
      options.catalog,
      "model",
      input.modelId
    );
    if (!selectedModel) {
      throw new Error("选择的建模模型不可用。");
    }
    setModelSubmitting(true);
    try {
      const common = {
        ...(input.textureImageAssetId
          ? { textureImageAssetId: input.textureImageAssetId }
          : {}),
        providerProfileId: selectedModel.providerProfileId,
        providerModelId: selectedModel.id,
        outputFormats: input.outputFormats,
        parameters: input.parameters
      };
      await options.api.createModelGeneration(
        options.projectId,
        input.inputMode === "image"
          ? { ...common, inputMode: "image", imageAssetId: input.imageAssetId }
          : { ...common, inputMode: "text", prompt: input.prompt }
      );
      options.onNotice("建模任务已提交。");
      await options.refreshProject(options.projectId);
    } catch (error) {
      options.onError(error);
      throw error;
    } finally {
      setModelSubmitting(false);
    }
  }

  return {
    editingImageJob,
    setEditingImageJob,
    imageSubmitting,
    modelSubmitting,
    submitConfiguredTask,
    submitModelGeneration
  };
}
