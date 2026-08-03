import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { AssetSource } from "@lyra/contracts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const EXTENSION_PATTERN = /^[a-z0-9]{1,10}$/u;

export interface StoredBlob {
  key: string;
  created: boolean;
}

export interface AssetStorageScope {
  projectId: string;
  source: AssetSource;
}

export class ImmutableBlobStore {
  readonly root: string;
  readonly legacyRoot: string | null;

  constructor(root: string, legacyRoot?: string) {
    this.root = resolve(root);
    this.legacyRoot = legacyRoot ? resolve(legacyRoot) : null;
  }

  async putImage(
    data: Buffer,
    checksumSha256: string,
    extension: string,
    scope?: AssetStorageScope
  ): Promise<StoredBlob> {
    return this.#put(data, checksumSha256, extension, scope, "images");
  }

  async putModel(
    data: Buffer,
    checksumSha256: string,
    extension: string,
    projectId: string
  ): Promise<StoredBlob> {
    return this.#put(
      data,
      checksumSha256,
      extension,
      { projectId, source: "generated" },
      "models"
    );
  }

  async #put(
    data: Buffer,
    checksumSha256: string,
    extension: string,
    scope: AssetStorageScope | undefined,
    category: "images" | "models"
  ): Promise<StoredBlob> {
    validateChecksum(checksumSha256);
    if (!EXTENSION_PATTERN.test(extension)) throw new Error("Blob extension is invalid.");
    const prefix = scope ? `${scopePrefix(scope)}/${category}/` : "";
    const key = `${prefix}sha256/${checksumSha256.slice(0, 2)}/${checksumSha256.slice(2, 4)}/${checksumSha256}.${extension}`;
    const target = this.#resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    try {
      await writeFile(target, data, { flag: "wx", mode: 0o600 });
      return { key, created: true };
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const existing = await stat(target);
      if (existing.size !== data.length) {
        throw new Error("Existing Blob does not match the expected content size.");
      }
      return { key, created: false };
    }
  }

  async read(key: string): Promise<Buffer> {
    try {
      return await readFile(this.#resolveKey(key));
    } catch (error) {
      if (!this.legacyRoot || !isMissingFileError(error)) throw error;
      return readFile(resolveStoreKey(this.legacyRoot, key));
    }
  }

  #resolveKey(key: string): string {
    return resolveStoreKey(this.root, key);
  }
}

export class ThumbnailStore {
  readonly root: string;
  readonly legacyRoot: string | null;

  constructor(root: string, legacyRoot?: string) {
    this.root = resolve(root);
    this.legacyRoot = legacyRoot ? resolve(legacyRoot) : null;
  }

  async put(checksumSha256: string, data: Buffer, scope?: AssetStorageScope): Promise<void> {
    validateChecksum(checksumSha256);
    const target = this.#path(checksumSha256, scope);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, data, { flag: "wx", mode: 0o600 });
      try {
        await rename(temporary, target);
      } catch (error) {
        if (!isAlreadyExistsError(error)) throw error;
      }
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async get(checksumSha256: string, scope?: AssetStorageScope): Promise<Buffer | null> {
    validateChecksum(checksumSha256);
    try {
      return await readFile(this.#path(checksumSha256, scope));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      if (scope && this.legacyRoot) {
        try {
          return await readFile(thumbnailPath(this.legacyRoot, checksumSha256));
        } catch (legacyError) {
          if (!isMissingFileError(legacyError)) throw legacyError;
        }
      }
      if (isMissingFileError(error)) return null;
      throw error;
    }
  }

  #path(checksumSha256: string, scope?: AssetStorageScope): string {
    if (!scope) return thumbnailPath(this.root, checksumSha256);
    return resolve(
      this.root,
      ...scopePrefix(scope).split("/"),
      "thumbnails",
      checksumSha256.slice(0, 2),
      checksumSha256.slice(2, 4),
      `${checksumSha256}.webp`
    );
  }
}

function scopePrefix(scope: AssetStorageScope): string {
  const projectId = scope.projectId.trim();
  if (!projectId || projectId.includes("/") || projectId.includes("\\") || projectId === "." || projectId === "..") {
    throw new Error("Project storage ID is invalid.");
  }
  return `${projectId}/${scope.source === "upload" ? "uploads" : "generated"}`;
}

function resolveStoreKey(root: string, key: string): string {
  if (!key || key.includes("\\") || key.startsWith("/") || /^[a-z]:/iu.test(key)) {
    throw new Error("Blob key is invalid.");
  }
  const segments = key.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Blob key is invalid.");
  }
  const target = resolve(root, ...segments);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Blob key escapes the storage root.");
  }
  return target;
}

function thumbnailPath(root: string, checksumSha256: string): string {
  return resolve(
    root,
    checksumSha256.slice(0, 2),
    checksumSha256.slice(2, 4),
    `${checksumSha256}.webp`
  );
}

function validateChecksum(checksumSha256: string): void {
  if (!SHA256_PATTERN.test(checksumSha256)) throw new Error("SHA-256 checksum is invalid.");
}

function isAlreadyExistsError(error: unknown): boolean {
  return getErrorCode(error) === "EEXIST";
}

function isMissingFileError(error: unknown): boolean {
  return getErrorCode(error) === "ENOENT";
}

function getErrorCode(error: unknown): string | null {
  return error instanceof Error && "code" in error
    ? ((error as NodeJS.ErrnoException).code ?? null)
    : null;
}
