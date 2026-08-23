export interface AgentPromptSettings {
  systemPrompt: string;
  optimizeEnabledPrompt: string;
  optimizeDisabledPrompt: string;
}

export type UpdateAgentPromptSettingsRequestBody =
  Partial<AgentPromptSettings>;

export interface AgentPromptSettingsSnapshot {
  settings: AgentPromptSettings;
  defaults: AgentPromptSettings;
}

export interface AgentRuntimeSettings {
  maxToolCalls: number;
}

export type UpdateAgentRuntimeSettingsRequestBody =
  Partial<AgentRuntimeSettings>;

export interface AgentRuntimeSettingsSnapshot {
  settings: AgentRuntimeSettings;
  defaults: AgentRuntimeSettings;
}
