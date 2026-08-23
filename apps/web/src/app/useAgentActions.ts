import {
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  AssetSnapshot,
  ProviderModelSnapshot
} from "@lyra/contracts";
import {
  toOrderedAttachments,
  type ApiClient
} from "../lib/api-client.js";

interface UseAgentActionsOptions {
  api: ApiClient;
  projectId: string;
  conversationId: string;
  prompt: string;
  attachments: AssetSnapshot[];
  selectedImageModel: ProviderModelSnapshot | undefined;
  selectedModelModel: ProviderModelSnapshot | undefined;
  agentReady: boolean;
  ensureCurrentConversation: () => Promise<string>;
  clearComposer: () => void;
  setAttachments: Dispatch<SetStateAction<AssetSnapshot[]>>;
  refreshProject: (projectId: string) => Promise<void>;
  refreshConversation: (conversationId: string) => Promise<void>;
  onMissingLlm: () => void;
  onError: (error: unknown) => void;
}

export function useAgentActions(options: UseAgentActionsOptions) {
  const [submitting, setSubmitting] = useState(false);

  async function submitAgent() {
    if (!options.projectId) return;
    if (!options.agentReady) {
      options.onMissingLlm();
      return;
    }
    setSubmitting(true);
    try {
      const conversationId = await options.ensureCurrentConversation();
      await options.api.sendAgentMessage(conversationId, {
        text: options.prompt,
        attachments: toOrderedAttachments(options.attachments),
        ...(options.selectedImageModel || options.selectedModelModel
          ? {
              selection: {
                ...(options.selectedImageModel
                  ? {
                      defaultImageProviderProfileId:
                        options.selectedImageModel.providerProfileId,
                      defaultImageModelId: options.selectedImageModel.id
                    }
                  : {}),
                ...(options.selectedModelModel
                  ? {
                      defaultModelProviderProfileId:
                        options.selectedModelModel.providerProfileId,
                      defaultModelId: options.selectedModelModel.id
                    }
                  : {})
              }
            }
          : {})
      });
      options.clearComposer();
      await Promise.all([
        options.refreshProject(options.projectId),
        options.refreshConversation(conversationId)
      ]);
    } catch (error) {
      options.onError(error);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAgentInput(
    runId: string,
    text: string,
    choiceId?: string
  ) {
    try {
      await options.api.submitAgentInput(runId, {
        text,
        attachments: toOrderedAttachments(options.attachments),
        ...(choiceId ? { choiceId } : {})
      });
      options.setAttachments([]);
      await options.refreshConversation(options.conversationId);
    } catch (error) {
      options.onError(error);
    }
  }

  async function cancelAgent(runId: string) {
    try {
      await options.api.cancelAgent(runId);
      await Promise.all([
        options.refreshConversation(options.conversationId),
        options.refreshProject(options.projectId)
      ]);
    } catch (error) {
      options.onError(error);
    }
  }

  return {
    submitting,
    submitAgent,
    submitAgentInput,
    cancelAgent
  };
}
