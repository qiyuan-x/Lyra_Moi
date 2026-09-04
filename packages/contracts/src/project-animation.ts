import type { EntityId, UtcDateTime } from "./common.js";

export type ProjectAnimationFormat = "fbx" | "glb";

export interface ProjectAnimationClipSnapshot {
  name: string;
  duration: number;
}

export interface ProjectAnimationSnapshot {
  id: EntityId;
  projectId: EntityId;
  name: string;
  originalName: string;
  format: ProjectAnimationFormat;
  mimeType: string;
  byteSize: number;
  checksumSha256: string;
  clips: ProjectAnimationClipSnapshot[];
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}
