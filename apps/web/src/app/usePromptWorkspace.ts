import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type {
  CreatePromptTemplateRequestBody,
  PromptTemplateSnapshot,
  UpdatePromptTemplateRequestBody
} from "@lyra/contracts";
import type { ApiClient } from "../lib/api-client.js";

const PROMPT_DRAFT_KEY = "lyra.promptDraft";

interface UsePromptWorkspaceOptions {
  api: ApiClient;
  setPrompts: Dispatch<SetStateAction<PromptTemplateSnapshot[]>>;
  onError: (error: unknown) => void;
}

export function usePromptWorkspace(options: UsePromptWorkspaceOptions) {
  const [prompt, setPrompt] = useState(
    () => localStorage.getItem(PROMPT_DRAFT_KEY) ?? ""
  );

  useEffect(() => {
    localStorage.setItem(PROMPT_DRAFT_KEY, prompt);
  }, [prompt]);

  function insertPromptText(value: string) {
    setPrompt((current) =>
      current.trim()
        ? `${current.trimEnd()}\n${value}`
        : value
    );
  }

  function clearPrompt() {
    setPrompt("");
  }

  async function createPromptTemplate(
    value: CreatePromptTemplateRequestBody
  ) {
    try {
      const created = await options.api.createPrompt(value);
      options.setPrompts((current) => [created, ...current]);
      return created;
    } catch (error) {
      options.onError(error);
      throw error;
    }
  }

  async function updatePromptTemplate(
    promptId: string,
    value: UpdatePromptTemplateRequestBody
  ) {
    try {
      const updated = await options.api.updatePrompt(promptId, value);
      options.setPrompts((current) =>
        current.map((item) => item.id === updated.id ? updated : item)
      );
      return updated;
    } catch (error) {
      options.onError(error);
      throw error;
    }
  }

  async function deletePromptTemplate(promptId: string) {
    try {
      await options.api.deletePrompt(promptId);
      options.setPrompts((current) =>
        current.filter((item) => item.id !== promptId)
      );
    } catch (error) {
      options.onError(error);
      throw error;
    }
  }

  async function setPromptPreview(promptId: string, file: Blob) {
    try {
      const updated = await options.api.setPromptPreview(promptId, file);
      options.setPrompts((current) =>
        current.map((item) => item.id === updated.id ? updated : item)
      );
      return updated;
    } catch (error) {
      options.onError(error);
      throw error;
    }
  }

  async function deletePromptPreview(promptId: string) {
    try {
      const updated = await options.api.deletePromptPreview(promptId);
      options.setPrompts((current) =>
        current.map((item) => item.id === updated.id ? updated : item)
      );
      return updated;
    } catch (error) {
      options.onError(error);
      throw error;
    }
  }

  return {
    prompt,
    setPrompt,
    insertPromptText,
    clearPrompt,
    createPromptTemplate,
    updatePromptTemplate,
    deletePromptTemplate,
    setPromptPreview,
    deletePromptPreview
  };
}
