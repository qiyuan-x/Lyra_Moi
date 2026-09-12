import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type {
  AgentRunSnapshot,
  AgentStepSnapshot,
  AssetSnapshot,
  ConversationSnapshot,
  JobSnapshot,
  MessageSnapshot
} from "@lyra/contracts";
import { ApiClient } from "../lib/api-client.js";
import { applyAgentProgress, isActiveAgentRun, mergeAgentSteps, readAgentProgress } from "../features/conversations/agent-stream-state.js";

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
  conversationDraftActive: boolean;
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
  projectAssetsReady: boolean;
  projectAssetsError: string;
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
  "agent.runtime.turn.started",
  "agent.runtime.run.completed",
  "agent.runtime.run.failed",
  "agent.runtime.plan.updated",
  "agent.runtime.tool.started",
  "agent.runtime.tool.completed",
  "agent.runtime.context.compacted",
  "message.created",
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
  const projectRefreshSequenceRef = useRef({ assets: 0, modelAssets: 0, jobs: 0, conversations: 0 });
  const conversationRefreshSequenceRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const pendingProjectRefreshRef = useRef<ProjectRefreshOptions>({});
  const pendingProjectRefreshAllRef = useRef(false);
  const pendingConversationRefreshRef = useRef(false);
  const completedStepsRef = useRef(new Map<string, { version: string; steps: AgentStepSnapshot[] }>());
  const cachedConversationRef = useRef("");
  const [loadedAssetsProject, setLoadedAssetsProject] = useState("");
  const [projectAssetsError, setProjectAssetsError] = useState("");
  useEffect(() => { setLoadedAssetsProject(""); setProjectAssetsError(""); }, [options.projectId]);

  const refreshConversation = useCallback(async (targetConversationId: string) => {
    const currentOptions = optionsRef.current;
    const sequence = ++conversationRefreshSequenceRef.current;
    if (cachedConversationRef.current !== targetConversationId) {
      cachedConversationRef.current = targetConversationId;
      completedStepsRef.current.clear();
    }
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
      nextRuns.map(async (run) => {
        const version = `${run.status}:${run.updatedAt}:${run.currentStep}`;
        const cached = completedStepsRef.current.get(run.id);
        const steps = !isActiveAgentRun(run) && cached?.version === version
          ? cached.steps : await currentOptions.api.listAgentSteps(run.id);
        return [run.id, steps] as const;
      })
    );
    if (sequence !== conversationRefreshSequenceRef.current) return;
    const latestOptions = optionsRef.current;
    if (latestOptions.conversationId !== targetConversationId) return;
    if (latestOptions.projectId !== currentOptions.projectId) return;
    const entries = new Map(stepEntries);
    completedStepsRef.current = new Map(nextRuns.filter((run) => !isActiveAgentRun(run)).map((run) => [run.id, {
      version: `${run.status}:${run.updatedAt}:${run.currentStep}`, steps: entries.get(run.id) ?? []
    }]));
    latestOptions.setMessages(nextMessages);
    latestOptions.setRuns(nextRuns);
    latestOptions.setStepsByRun((current) => new Map(stepEntries.map(([runId, steps]) => [
      runId, mergeAgentSteps(current.get(runId) ?? [], steps)
    ])));
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
    const sequence = { ...projectRefreshSequenceRef.current };
    for (const key of Object.keys(sequence) as Array<keyof ProjectRefreshOptions>) {
      if (refreshOptions[key]) sequence[key] = ++projectRefreshSequenceRef.current[key];
    }
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
    ]).catch((error) => {
      if (refreshOptions.assets && optionsRef.current.projectId === targetProjectId && sequence.assets === projectRefreshSequenceRef.current.assets) {
        setProjectAssetsError(error instanceof Error ? error.message : String(error));
      }
      throw error;
    });
    const latestOptions = optionsRef.current;
    if (latestOptions.projectId !== targetProjectId) return;
    if (nextAssets && sequence.assets === projectRefreshSequenceRef.current.assets) {
      latestOptions.setAssets(nextAssets);
      setLoadedAssetsProject(targetProjectId);
      setProjectAssetsError("");
    }
    if (nextModelAssets && sequence.modelAssets === projectRefreshSequenceRef.current.modelAssets) latestOptions.setModelAssets(nextModelAssets);
    if (nextJobs && sequence.jobs === projectRefreshSequenceRef.current.jobs) latestOptions.setJobs(nextJobs);
    if (nextConversations && sequence.conversations === projectRefreshSequenceRef.current.conversations) {
      latestOptions.setConversations(nextConversations);
      latestOptions.setConversationId((current) => {
        if (latestOptions.conversationDraftActive) return "";
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
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data);
          if (payload.conversationId && payload.conversationId !== optionsRef.current.conversationId) return;
        } catch { /* Older event sources may not include a payload. */ }
        scheduleRefresh({}, true);
        return;
      }
      if (event.type === "message.created") {
        scheduleRefresh({ conversations: true }, true);
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
    let streamFrame: number | null = null;
    const progressUpdates = new Map<string, { conversationId: string; step: AgentStepSnapshot }>();
    const receiveProgress = (event: Event) => {
      const current = optionsRef.current;
      const step = readAgentProgress((event as MessageEvent<string>).data, current.projectId, current.conversationId);
      if (!step) return;
      const pending = progressUpdates.get(step.id)?.step;
      if (!pending || Number(step.payload.revision) >= Number(pending.payload.revision)) {
        progressUpdates.set(step.id, { conversationId: current.conversationId, step });
      }
      if (streamFrame !== null) return;
      streamFrame = window.requestAnimationFrame(() => {
        streamFrame = null;
        const updates = [...progressUpdates.values()]
          .filter((item) => item.conversationId === optionsRef.current.conversationId).map((item) => item.step);
        progressUpdates.clear();
        if (updates.length) {
          optionsRef.current.setStepsByRun((previous) => applyAgentProgress(previous, updates));
        }
      });
    };
    source.addEventListener("agent.runtime.message.delta", receiveProgress);
    source.addEventListener("agent.runtime.message.progress", receiveProgress);
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
      if (streamFrame !== null) window.cancelAnimationFrame(streamFrame);
      stopFallbackPolling();
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", reconcileOnVisibility);
      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
      pendingProjectRefreshRef.current = {};
      pendingProjectRefreshAllRef.current = false;
      pendingConversationRefreshRef.current = false;
    };
  }, [options.api, options.projectId, options.reportError, refreshConversation, refreshProject]);

  return { refreshProject, refreshConversation, projectAssetsError, projectAssetsReady: Boolean(options.projectId) && loadedAssetsProject === options.projectId };
}
