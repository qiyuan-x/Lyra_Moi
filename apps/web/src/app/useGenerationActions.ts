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

interface ModelGenerationInput {
  imageAssetId: string;
  textureImageAssetId?: string;
  modelId: string;
  outputFormats: ModelOutputFormat[];
  parameters: Record<string, unknown>;
}

interface UseGenerationActionsOptions {
  api: ApiClient;
  catalog: ProviderCatalog;
  projectId: string;
  selectedImageModel: ProviderModelSnapshot | undefined;
  ensureCurrentConversation: () => Promise<string>;
  setAttachments: Dispatch<SetStateAction<AssetSnapshot[]>>;
  refreshProject: (projectId: string) => Promise<void>;
  onNotice: (text: string) => void;
  onError: (error: unknown) => void;
}

export function useGenerationActions(
  options: UseGenerationActionsOptions
) {
  const [taskEditor, setTaskEditor] = useState<{
    job: JobSnapshot | null;
  } | null>(null);
  const [taskEditorBusy, setTaskEditorBusy] = useState(false);
  const [modelSubmitting, setModelSubmitting] = useState(false);

  async function openNewTask() {
    try {
      if (!options.selectedImageModel) {
        throw new Error("请先在设置中配置可用的图片模型。");
      }
      await options.ensureCurrentConversation();
      setTaskEditor({ job: null });
    } catch (error) {
      options.onError(error);
    }
  }

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
    setTaskEditorBusy(true);
    try {
      const conversationId = await options.ensureCurrentConversation();
      await options.api.createGeneration(options.projectId, {
        conversationId,
        prompt: input.prompt,
        attachments: toOrderedAttachments(input.attachments),
        providerProfileId: selectedModel.providerProfileId,
        providerModelId: selectedModel.id,
        count: input.count,
        parameters: input.aspectRatio === "auto"
          ? {}
          : { aspectRatio: input.aspectRatio }
      });
      setTaskEditor(null);
      options.setAttachments([]);
      await options.refreshProject(options.projectId);
    } catch (error) {
      options.onError(error);
    } finally {
      setTaskEditorBusy(false);
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
      await options.api.createModelGeneration(options.projectId, {
        imageAssetId: input.imageAssetId,
        ...(input.textureImageAssetId
          ? { textureImageAssetId: input.textureImageAssetId }
          : {}),
        providerProfileId: selectedModel.providerProfileId,
        providerModelId: selectedModel.id,
        outputFormats: input.outputFormats,
        parameters: input.parameters
      });
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
    taskEditor,
    setTaskEditor,
    taskEditorBusy,
    modelSubmitting,
    openNewTask,
    submitConfiguredTask,
    submitModelGeneration
  };
}
