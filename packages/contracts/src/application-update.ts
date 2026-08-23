export const APPLICATION_UPDATE_PLATFORM = "windows-x64" as const;

export type ApplicationUpdatePlatform = typeof APPLICATION_UPDATE_PLATFORM;

export type ApplicationUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "scheduled"
  | "downloading"
  | "verifying"
  | "installing"
  | "restarting"
  | "completed"
  | "rolling_back"
  | "failed";

export interface ApplicationUpdateArtifact {
  url: string;
  sha256: string;
  size: number;
}
export interface ApplicationUpdateManifest {
  schemaVersion: 1;
  version: string;
  publishedAt: string;
  releaseNotes: string[];
  artifacts: Record<ApplicationUpdatePlatform, ApplicationUpdateArtifact>;
}

export interface ApplicationUpdateSnapshot {
  enabled: boolean;
  currentVersion: string;
  latestVersion: string | null;
  platform: ApplicationUpdatePlatform;
  updateAvailable: boolean;
  status: ApplicationUpdateStatus;
  progress: number | null;
  message: string;
  checkedAt: string | null;
  publishedAt: string | null;
  releaseNotes: string[];
  artifactSize: number | null;
}
