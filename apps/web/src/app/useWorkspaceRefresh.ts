import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  AssetSnapshot,
  ConversationSnapshot,
  JobSnapshot,
  MessageSnapshot
} from "@lyra/contracts";
import { ApiClient } from "../lib/api-client.js";

export type ProjectRefreshOptions = {
  assets?: boolean;
  modelAssets?: boolean;
  jobs?: boolean;
  conversations?: boolean;
};

type WorkspaceRefreshOptions = {
  api: ApiClient;
  projectId: string;
  conversationId: string;
  setAssets: Dispatch<SetStateAction<AssetSnapshot[]>>;
  setModelAssets: Dispatch<SetStateAction<AssetSnapshot[]>>;
  setJobs: Dispatch<SetStateAction<JobSnapshot[]>>;
  setConversations: Dispatch<SetStateAction<ConversationSnapshot[]>>;
  setConversationId: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<MessageSnapshot[]>>;
  setRuns: Dispatch<SetStateAction<AgentRunSnapshot[]>>;
  setStepsByRun: Dispatch<SetStateAction<Map<string, AgentStepSnapshot[]>>>;
  reportError: (error: unknown) => void;
};

export interface WorkspaceRefreshController {
  refreshProject(targetProjectId: string, options?: ProjectRefreshOptions): Promise<void>;
  refreshConversation(targetConversationId: string): Promise<void>;
}

const refreshEverything: Required<ProjectRefreshOptions> = {
  assets: true,
  modelAssets: true,
  jobs: true,
  conversations: true
};

const runtimeEventTypes = [
  "agent.awaiting_user",
  "agent.cancelled",
  "agent.completed",
  "agent.failed",
  "agent.resuming",
  "agent.thinking",
  "agent.updated",
  "agent.waiting_tool",
  "asset.created",
  "job.cancelled",
  "job.completed",
  "job.created",
  "job.dismissed",
  "job.failed",
  "job.updated"
];

export function useWorkspaceRefresh(
  options: WorkspaceRefreshOptions
): WorkspaceRefreshController {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const projectRefreshSequenceRef = useRef(0);
  const conversationRefreshSequenceRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const pendingProjectRefreshRef = useRef<ProjectRefreshOptions>({});
  const pendingProjectRefreshAllRef = useRef(false);
  const pendingConversationRefreshRef = useRef(false);

  const refreshConversation = useCallback(async (targetConversationId: string) => {
    const currentOptions = optionsRef.current;
    const sequence = ++conversationRefreshSequenceRef.current;
    if (!targetConversationId) {
      currentOptions.setMessages([]);
      currentOptions.setRuns([]);
      currentOptions.setStepsByRun(new Map());
      return;
    }
    const [nextMessages, nextRuns] = await Promise.all([
      currentOptions.api.listMessages(targetConversationId),
      currentOptions.api.listAgentRuns(targetConversationId)
    ]);
    const stepEntries = await Promise.all(
      nextRuns.map(async (run) => [
        run.id,
        await currentOptions.api.listAgentSteps(run.id)
      ] as const)
    );
    if (sequence !== conversationRefreshSequenceRef.current) return;
    currentOptions.setMessages(nextMessages);
    currentOptions.setRuns(nextRuns);
    currentOptions.setStepsByRun(new Map(stepEntries));
  }, []);

  const refreshProject = useCallback(async (
    targetProjectId: string,
    requestedOptions?: ProjectRefreshOptions
  ) => {
    const currentOptions = optionsRef.current;
    if (!targetProjectId) return;
    const refreshOptions = requestedOptions
      ? {
          assets: false,
          modelAssets: false,
          jobs: false,
          conversations: false,
          ...requestedOptions
        }
      : refreshEverything;
    const sequence = ++projectRefreshSequenceRef.current;
    const [nextAssets, nextModelAssets, nextJobs, nextConversations] = await Promise.all([
      refreshOptions.assets
        ? currentOptions.api.listAllAssets(targetProjectId)
        : Promise.resolve(undefined),
      refreshOptions.modelAssets
        ? currentOptions.api.listAllAssets(targetProjectId, { kind: "model" })
        : Promise.resolve(undefined),
      refreshOptions.jobs
        ? currentOptions.api.listJobs(targetProjectId)
        : Promise.resolve(undefined),
      refreshOptions.conversations
        ? currentOptions.api.listConversations(targetProjectId)
        : Promise.resolve(undefined)
    ]);
    if (sequence !== projectRefreshSequenceRef.current) return;
    if (nextAssets) currentOptions.setAssets(nextAssets);
    if (nextModelAssets) currentOptions.setModelAssets(nextModelAssets);
    if (nextJobs) currentOptions.setJobs(nextJobs);
    if (nextConversations) {
      currentOptions.setConversations(nextConversations);
      currentOptions.setConversationId((current) => {
        if (nextConversations.some((conversation) => conversation.id === current)) return current;
        return nextConversations[0]?.id ?? "";
      });
    }
  }, []);

  useEffect(() => {
    if (!options.projectId) return;
    const scheduleRefresh = (
      projectOptions?: ProjectRefreshOptions,
      refreshConversationToo = false
    ) => {
      if (projectOptions) {
        pendingProjectRefreshRef.current = {
          ...pendingProjectRefreshRef.current,
          ...projectOptions
        };
      } else {
        pendingProjectRefreshAllRef.current = true;
      }
      pendingConversationRefreshRef.current ||= refreshConversationToo;
      if (refreshTimerRef.current !== null) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        const currentOptions = optionsRef.current;
        const shouldRefreshAll = pendingProjectRefreshAllRef.current;
        const projectOptions = pendingProjectRefreshRef.current;
        const shouldRefreshConversation = pendingConversationRefreshRef.current;
        pendingProjectRefreshAllRef.current = false;
        pendingProjectRefreshRef.current = {};
        pendingConversationRefreshRef.current = false;
        if (shouldRefreshAll) {
          void refreshProject(currentOptions.projectId).catch(currentOptions.reportError);
        } else if (Object.keys(projectOptions).length > 0) {
          void refreshProject(currentOptions.projectId, projectOptions).catch(currentOptions.reportError);
        }
        if (shouldRefreshConversation && currentOptions.conversationId) {
          void refreshConversation(currentOptions.conversationId).catch(currentOptions.reportError);
        }
      }, 120);
    };
    const refreshByEvent = (event: Event) => {
      if (event.type.startsWith("agent.")) {
        scheduleRefresh({ jobs: true, conversations: true }, true);
        return;
      }
      if (event.type.startsWith("job.")) {
        scheduleRefresh({ jobs: true });
        return;
      }
      if (event.type === "asset.created") {
        scheduleRefresh({
          assets: true,
          modelAssets: true,
          jobs: true
        });
        return;
      }
      scheduleRefresh(undefined, true);
    };
    const source = options.api.createEventSource(options.projectId);
    for (const eventType of runtimeEventTypes) {
      source.addEventListener(eventType, refreshByEvent);
    }
    let fallbackPolling: number | null = null;
    const stopFallbackPolling = () => {
      if (fallbackPolling === null) return;
      window.clearInterval(fallbackPolling);
      fallbackPolling = null;
    };
    const startFallbackPolling = () => {
      if (fallbackPolling !== null) return;
      fallbackPolling = window.setInterval(
        () => scheduleRefresh({ jobs: true, conversations: true }, true),
        5_000
      );
    };
    source.onopen = () => {
      stopFallbackPolling();
      scheduleRefresh({ jobs: true, conversations: true }, true);
    };
    source.onerror = () => {
      startFallbackPolling();
    };
    const reconcileOnVisibility = () => {
      if (document.visibilityState !== "visible") return;
      scheduleRefresh(undefined, true);
    };
    document.addEventListener("visibilitychange", reconcileOnVisibility);
    const watchdog = window.setInterval(() => {
      if (source.readyState !== 1) startFallbackPolling();
    }, 60_000);
    return () => {
      source.close();
      stopFallbackPolling();
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", reconcileOnVisibility);
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      pendingProjectRefreshRef.current = {};
      pendingProjectRefreshAllRef.current = false;
      pendingConversationRefreshRef.current = false;
    };
  }, [options.api, options.conversationId, options.projectId, options.reportError, refreshConversation, refreshProject]);

  return { refreshProject, refreshConversation };
}
