import { randomUUID } from "node:crypto";
import type {
  AssetKind,
  AssetListQuery,
  AssetSnapshot,
  AssetSource,
  CursorPage,
  UpdateAssetRequestBody
} from "@lyra/contracts";
import type { LyraDatabase } from "./database.js";

interface AssetRow {
  id: string;
  project_id: string;
  kind: AssetKind;
  source: AssetSource;
  name: string;
  original_name: string | null;
  mime_type: string;
  blob_key: string;
  checksum_sha256: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface AssetTagRow {
  asset_id: string;
  tag: string;
}

interface AssetCursor {
  createdAt: string;
  id: string;
}

export interface StoredAsset extends AssetSnapshot {
  blobKey: string;
}

export interface CreateStoredAssetInput {
  projectId: string;
  kind: AssetKind;
  source: AssetSource;
  name: string;
  originalName: string | null;
  mimeType: string;
  blobKey: string;
  checksumSha256: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  tags: string[];
}

export class AssetNotFoundError extends Error {
  constructor(assetId: string) {
    super(`Asset not found: ${assetId}`);
    this.name = "AssetNotFoundError";
  }
}

export class AssetRepository {
  readonly #database: LyraDatabase;

  constructor(database: LyraDatabase) {
    this.#database = database;
  }

  create(input: CreateStoredAssetInput): AssetSnapshot {
    const id = randomUUID();
    const now = new Date().toISOString();
    const tags = normalizeTags(input.tags);
    this.#database.transaction(() => {
      this.#database.connection
        .prepare(`
          INSERT INTO assets (
            id, project_id, kind, source, name, original_name, mime_type, blob_key,
            checksum_sha256, byte_size, width, height, created_at, updated_at, deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        `)
        .run(
          id,
          input.projectId,
          input.kind,
          input.source,
          input.name,
          input.originalName,
          input.mimeType,
          input.blobKey,
          input.checksumSha256,
          input.byteSize,
          input.width,
          input.height,
          now,
          now
        );
      this.#replaceTags(id, tags, now);
    });

    return {
      id,
      projectId: input.projectId,
      kind: input.kind,
      source: input.source,
      name: input.name,
      originalName: input.originalName,
      mimeType: input.mimeType,
      checksumSha256: input.checksumSha256,
      byteSize: input.byteSize,
      width: input.width,
      height: input.height,
      tags,
      createdAt: now,
      updatedAt: now,
      deletedAt: null
    };
  }

  findById(assetId: string): AssetSnapshot | null {
    const stored = this.findStoredById(assetId);
    return stored ? toSnapshot(stored) : null;
  }

  findStoredById(assetId: string, includeDeleted = false): StoredAsset | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, project_id, kind, source, name, original_name, mime_type, blob_key,
               checksum_sha256, byte_size, width, height, created_at, updated_at, deleted_at
        FROM assets
        WHERE id = ? AND (? = 1 OR deleted_at IS NULL)
      `)
      .get(assetId, includeDeleted ? 1 : 0) as AssetRow | undefined;
    if (!row) return null;
    const tags = this.#loadTags([row.id]).get(row.id) ?? [];
    return mapStoredAsset(row, tags);
  }

  findActiveByOriginalName(
    projectId: string,
    originalName: string,
    source: AssetSource = "upload"
  ): StoredAsset | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, project_id, kind, source, name, original_name, mime_type, blob_key,
               checksum_sha256, byte_size, width, height, created_at, updated_at, deleted_at
        FROM assets
        WHERE project_id = ? AND source = ? AND original_name = ? AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `)
      .get(projectId, source, originalName) as AssetRow | undefined;
    if (!row) return null;
    return mapStoredAsset(row, this.#loadTags([row.id]).get(row.id) ?? []);
  }

  findActiveByOriginalNameAndChecksum(
    projectId: string,
    originalName: string,
    checksumSha256: string,
    source: AssetSource = "upload"
  ): StoredAsset | null {
    const row = this.#database.connection
      .prepare(`
        SELECT id, project_id, kind, source, name, original_name, mime_type, blob_key,
               checksum_sha256, byte_size, width, height, created_at, updated_at, deleted_at
        FROM assets
        WHERE project_id = ? AND source = ? AND original_name = ?
          AND checksum_sha256 = ? AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `)
      .get(projectId, source, originalName, checksumSha256) as AssetRow | undefined;
    if (!row) return null;
    return mapStoredAsset(row, this.#loadTags([row.id]).get(row.id) ?? []);
  }

  hasActiveName(
    projectId: string,
    name: string,
    source: AssetSource = "upload"
  ): boolean {
    const row = this.#database.connection
      .prepare(`
        SELECT 1 AS found
        FROM assets
        WHERE project_id = ? AND source = ? AND name = ? AND deleted_at IS NULL
        LIMIT 1
      `)
      .get(projectId, source, name) as { found: number } | undefined;
    return Boolean(row);
  }

  requireStored(assetId: string, includeDeleted = false): StoredAsset {
    const asset = this.findStoredById(assetId, includeDeleted);
    if (!asset) throw new AssetNotFoundError(assetId);
    return asset;
  }

  list(projectId: string, query: AssetListQuery = {}): CursorPage<AssetSnapshot> {
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("Asset query limit must be an integer between 1 and 100.");
    }
    const where = ["a.project_id = ?", "a.deleted_at IS NULL"];
    const parameters: Array<string | number> = [projectId];
    if (query.source !== undefined) {
      if (query.source !== "upload" && query.source !== "generated") {
        throw new Error("Asset source filter is invalid.");
      }
      where.push("a.source = ?");
      parameters.push(query.source);
    }
    if (query.kind !== undefined) {
      if (query.kind !== "image" && query.kind !== "model" && query.kind !== "file") {
        throw new Error("Asset kind filter is invalid.");
      }
      where.push("a.kind = ?");
      parameters.push(query.kind);
    }
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLike(search)}%`;
      where.push("(a.name LIKE ? ESCAPE '\\' OR a.original_name LIKE ? ESCAPE '\\')");
      parameters.push(pattern, pattern);
    }
    const tag = query.tag?.trim();
    if (tag) {
      where.push(`
        EXISTS (
          SELECT 1 FROM asset_tags at
          WHERE at.asset_id = a.id AND at.tag = ?
        )
      `);
      parameters.push(tag);
    }
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      where.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))");
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }

    parameters.push(limit + 1);
    const rows = this.#database.connection
      .prepare(`
        SELECT a.id, a.project_id, a.kind, a.source, a.name, a.original_name,
               a.mime_type, a.blob_key, a.checksum_sha256, a.byte_size,
               a.width, a.height, a.created_at, a.updated_at, a.deleted_at
        FROM assets a
        WHERE ${where.join(" AND ")}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ?
      `)
      .all(...parameters) as unknown as AssetRow[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const tagsByAsset = this.#loadTags(pageRows.map((row) => row.id));
    const items = pageRows.map((row) =>
      toSnapshot(mapStoredAsset(row, tagsByAsset.get(row.id) ?? []))
    );
    const last = pageRows.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null
    };
  }

  update(assetId: string, input: UpdateAssetRequestBody): AssetSnapshot {
    const existing = this.requireStored(assetId);
    const updatedAt = new Date().toISOString();
    const name = input.name?.trim() ?? existing.name;
    const tags = input.tags === undefined ? existing.tags : normalizeTags(input.tags);
    this.#database.transaction(() => {
      this.#database.connection
        .prepare("UPDATE assets SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .run(name, updatedAt, assetId);
      if (input.tags !== undefined) this.#replaceTags(assetId, tags, updatedAt);
    });
    return toSnapshot({ ...existing, name, tags, updatedAt });
  }

  softDelete(assetId: string): AssetSnapshot {
    const existing = this.requireStored(assetId);
    const now = new Date().toISOString();
    this.#database.connection
      .prepare("UPDATE assets SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, assetId);
    return toSnapshot({ ...existing, deletedAt: now, updatedAt: now });
  }

  #replaceTags(assetId: string, tags: readonly string[], createdAt: string): void {
    this.#database.connection.prepare("DELETE FROM asset_tags WHERE asset_id = ?").run(assetId);
    const insert = this.#database.connection.prepare(
      "INSERT INTO asset_tags (asset_id, tag, created_at) VALUES (?, ?, ?)"
    );
    for (const tag of tags) insert.run(assetId, tag, createdAt);
  }

  #loadTags(assetIds: readonly string[]): Map<string, string[]> {
    const result = new Map<string, string[]>();
    if (assetIds.length === 0) return result;
    const placeholders = assetIds.map(() => "?").join(", ");
    const rows = this.#database.connection
      .prepare(`
        SELECT asset_id, tag FROM asset_tags
        WHERE asset_id IN (${placeholders})
        ORDER BY tag
      `)
      .all(...assetIds) as unknown as AssetTagRow[];
    for (const row of rows) {
      const tags = result.get(row.asset_id) ?? [];
      tags.push(row.tag);
      result.set(row.asset_id, tags);
    }
    return result;
  }
}

function mapStoredAsset(row: AssetRow, tags: string[]): StoredAsset {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    source: row.source,
    name: row.name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    blobKey: row.blob_key,
    checksumSha256: row.checksum_sha256,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at
  };
}

function toSnapshot(asset: StoredAsset): AssetSnapshot {
  const { blobKey: _blobKey, ...snapshot } = asset;
  return structuredClone(snapshot);
}

function normalizeTags(tags: readonly string[]): string[] {
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
  if (normalized.length > 50 || normalized.some((tag) => tag.length > 50)) {
    throw new Error("Asset tags exceed the configured limits.");
  }
  return normalized;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): AssetCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "createdAt" in value &&
      typeof value.createdAt === "string" &&
      "id" in value &&
      typeof value.id === "string" &&
      value.createdAt &&
      value.id
    ) {
      return { createdAt: value.createdAt, id: value.id };
    }
  } catch {
    // Use the stable error below.
  }
  throw new Error("Asset cursor is invalid.");
}
