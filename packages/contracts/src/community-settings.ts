export interface CommunitySettings {
  url: string;
}

export interface CommunitySettingsSnapshot {
  settings: CommunitySettings;
}

export type UpdateCommunitySettingsRequestBody = Partial<CommunitySettings>;
