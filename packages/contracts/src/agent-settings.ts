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
