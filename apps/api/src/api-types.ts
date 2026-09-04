import type {
  AgentConversationService,
  AgentPromptSettingsService,
  AgentRuntimeSettingsService,
  AssetService,
  CommunitySettingsService,
  ManualGenerationService,
  ModelGenerationService,
  PromptTemplateService,
  RuntimeEventFeed,
  WorkspaceQueryService
} from "@lyra/core";
import type { ProviderSettingsService } from "@lyra/providers";
import type { ProjectAnimationStore } from "@lyra/storage";
import type { ApplicationUpdateService } from "./application-update-service.js";

export interface CreateApiServerOptions {
  events: RuntimeEventFeed;
  workspace?: WorkspaceQueryService;
  conversations?: AgentConversationService;
  manualGenerations?: ManualGenerationService;
  modelGenerations?: ModelGenerationService;
  assets?: AssetService;
  projectAnimations?: ProjectAnimationStore;
  providers?: ProviderSettingsService;
  prompts?: PromptTemplateService;
  agentPromptSettings?: AgentPromptSettingsService;
  agentRuntimeSettings?: AgentRuntimeSettingsService;
  communitySettings?: CommunitySettingsService;
  applicationUpdates?: ApplicationUpdateService;
  isReady?: () => boolean;
  readiness?: () => { ok: boolean; [key: string]: unknown };
  eventPollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxJsonBodyBytes?: number;
  maxAssetBodyBytes?: number;
  maxAnimationBodyBytes?: number;
  webRoot?: string;
  accessToken?: string;
}
