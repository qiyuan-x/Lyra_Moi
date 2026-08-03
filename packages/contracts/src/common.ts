export type EntityId = string;
export type UtcDateTime = string;
export type ImageMode = "agent" | "manual";

export interface OrderedAssetInput {
  assetId: EntityId;
  label: string;
  position: number;
}

export interface ProjectSnapshot {
  id: EntityId;
  name: string;
  description: string;
  lastImageMode: ImageMode;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
  deletedAt: UtcDateTime | null;
}
