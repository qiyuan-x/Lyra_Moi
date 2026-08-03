import type {
  AgentConversationService,
  AgentPromptSettingsService,
  AssetService,
  ManualGenerationService,
  ModelGenerationService,
  PromptTemplateService,
  RuntimeEventFeed,
  WorkspaceQueryService
} from "@lyra/core";
import type { ProviderSettingsService } from "@lyra/providers";

export interface CreateApiServerOptions {
  events: RuntimeEventFeed;
  workspace?: WorkspaceQueryService;
  conversations?: AgentConversationService;
  manualGenerations?: ManualGenerationService;
  modelGenerations?: ModelGenerationService;
  assets?: AssetService;
  providers?: ProviderSettingsService;
  prompts?: PromptTemplateService;
  agentPromptSettings?: AgentPromptSettingsService;
  isReady?: () => boolean;
  readiness?: () => { ok: boolean; [key: string]: unknown };
  eventPollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maxJsonBodyBytes?: number;
  maxAssetBodyBytes?: number;
  webRoot?: string;
  accessToken?: string;
}
