import {
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  ConversationSnapshot,
  MessageSnapshot
} from "@lyra/contracts";
import type { ApiClient } from "../lib/api-client.js";

interface UseConversationWorkspaceOptions {
  api: ApiClient;
  projectId: string;
  conversationId: string;
  setConversations: Dispatch<SetStateAction<ConversationSnapshot[]>>;
  setConversationId: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<MessageSnapshot[]>>;
  setRuns: Dispatch<SetStateAction<AgentRunSnapshot[]>>;
  setStepsByRun: Dispatch<
    SetStateAction<Map<string, AgentStepSnapshot[]>>
  >;
  refreshProject: (projectId: string) => Promise<void>;
  onError: (error: unknown) => void;
}

export function useConversationWorkspace(
  options: UseConversationWorkspaceOptions
) {
  const [busy, setBusy] = useState(false);

  function activateConversation(conversation: ConversationSnapshot) {
    options.setConversations((current) =>
      prependConversation(current, conversation)
    );
    options.setConversationId(conversation.id);
    options.setMessages([]);
    options.setRuns([]);
    options.setStepsByRun(new Map());
  }

  async function ensureCurrentConversation(): Promise<string> {
    if (options.conversationId) return options.conversationId;
    if (!options.projectId) throw new Error("请先选择项目。");
    const conversation = await options.api.createConversation(
      options.projectId
    );
    activateConversation(conversation);
    return conversation.id;
  }

  async function createNewConversation() {
    if (!options.projectId) return;
    try {
      const conversation = await options.api.createConversation(
        options.projectId
      );
      activateConversation(conversation);
    } catch (error) {
      options.onError(error);
    }
  }

  async function renameConversation(
    conversationId: string,
    title: string
  ) {
    setBusy(true);
    try {
      const updated = await options.api.updateConversation(
        conversationId,
        title
      );
      options.setConversations((current) =>
        prependConversation(current, updated)
      );
    } catch (error) {
      options.onError(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function deleteConversation(conversationId: string) {
    setBusy(true);
    try {
      await options.api.deleteConversation(conversationId);
      await options.refreshProject(options.projectId);
    } catch (error) {
      options.onError(error);
      throw error;
    } finally {
      setBusy(false);
    }
  }

  return {
    conversationBusy: busy,
    ensureCurrentConversation,
    createNewConversation,
    renameConversation,
    deleteConversation
  };
}

export function prependConversation(
  conversations: ConversationSnapshot[],
  conversation: ConversationSnapshot
): ConversationSnapshot[] {
  return [
    conversation,
    ...conversations.filter((item) => item.id !== conversation.id)
  ];
}
