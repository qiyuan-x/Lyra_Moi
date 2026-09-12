import { readAgentModelDefaults } from "../features/modeling/modeling-state.js";
import { flushProjectForms } from "../features/generation/project-form-state.js";
import {
  useState,
  useEffect,
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
  selectedLlmModel: ProviderModelSnapshot | undefined;
  selectedModelModel: ProviderModelSnapshot | undefined;
  agentReady: boolean;
  ensureCurrentConversation: () => Promise<string>;
  clearComposer: () => void;
  setAttachments: Dispatch<SetStateAction<AssetSnapshot[]>>;
  refreshProject: (projectId: string) => Promise<void>;
  refreshConversation: (conversationId: string) => Promise<void>;
  onMissingLlm: () => void;
}

export function useAgentActions(options: UseAgentActionsOptions) {
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  useEffect(() => setSubmissionError(""), [options.projectId, options.conversationId]);

  async function submitAgent() {
    if (!options.projectId) return;
    if (!options.agentReady) {
      options.onMissingLlm();
      return;
    }
    setSubmissionError("");
    setSubmitting(true);
    try {
      await flushProjectForms(options.projectId);
      const conversationId = await options.ensureCurrentConversation();
      await options.api.sendAgentMessage(conversationId, {
        text: options.prompt,
        modelDefaults: readAgentModelDefaults(options.projectId),
        attachments: toOrderedAttachments(options.attachments),
        ...(options.selectedLlmModel || options.selectedImageModel || options.selectedModelModel
          ? {
              selection: {
                ...(options.selectedLlmModel
                  ? {
                      llmProviderProfileId: options.selectedLlmModel.providerProfileId,
                      llmModelId: options.selectedLlmModel.id
                    }
                  : {}),
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
      setSubmissionError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitAgentInput(
    runId: string,
    text: string,
    choiceId?: string,
    modelChanges?: import("@lyra/contracts").ModelApprovalChanges
  ) {
    await options.api.submitAgentInput(runId, {
      text,
      attachments: choiceId === "approve" || choiceId === "reject" ? [] : toOrderedAttachments(options.attachments),
      ...(choiceId ? { choiceId } : {}),
      ...(modelChanges ? { modelChanges } : {})
    });
    if (choiceId !== "approve" && choiceId !== "reject") options.setAttachments([]);
    await options.refreshConversation(options.conversationId);
  }

  async function cancelAgent(runId: string) {
    await options.api.cancelAgent(runId);
    await Promise.all([
      options.refreshConversation(options.conversationId),
      options.refreshProject(options.projectId)
    ]);
  }

  return {
    submitting,
    submissionError,
    submitAgent,
    submitAgentInput,
    cancelAgent
  };
}
