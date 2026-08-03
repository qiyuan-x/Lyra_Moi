import type { EntityId, UtcDateTime } from "./common.js";

export type AssetKind = "image" | "model" | "file";
export type AssetSource = "upload" | "generated";

export interface AssetSnapshot {
  id: EntityId;
  projectId: EntityId;
  kind: AssetKind;
  source: AssetSource;
  name: string;
  originalName: string | null;
  mimeType: string;
  checksumSha256: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  tags: string[];
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
  deletedAt: UtcDateTime | null;
}

export interface AssetListQuery {
  cursor?: string;
  limit?: number;
  search?: string;
  tag?: string;
  source?: AssetSource;
  kind?: AssetKind;
}

export interface UpdateAssetRequestBody {
  name?: string;
  tags?: string[];
}

export interface AssetContentDescriptor {
  asset: AssetSnapshot;
  mimeType: string;
  byteSize: number;
  etag: string;
}
