import { createHash } from "node:crypto";
import type {
  AssetContentDescriptor,
  AssetListQuery,
  AssetSnapshot,
  CursorPage,
  ModelOutputFormat,
  UpdateAssetRequestBody
} from "@lyra/contracts";
import { parseUpdateAssetRequest } from "@lyra/contracts";
import type {
  AssetRepository,
  ImmutableBlobStore,
  SharpImageProcessor,
  ThumbnailStore
} from "@lyra/storage";
import { ImageValidationError } from "@lyra/storage";

export interface UploadImageInput {
  projectId: string;
  originalName: string;
  data: Uint8Array;
  claimedMimeType?: string;
  name?: string;
  tags?: string[];
}

export interface StoreGeneratedImageInput {
  projectId: string;
  data: Uint8Array;
  name: string;
  claimedMimeType?: string;
  tags?: string[];
}

export interface StoreGeneratedModelInput {
  projectId: string;
  data: Uint8Array;
  name: string;
  format: ModelOutputFormat;
  extension?: string;
  mimeType?: string;
  tags?: string[];
}

export interface ModelInputImage {
  data: Buffer;
  mimeType: "image/jpeg";
  extension: "jpg";
  name: string;
}

export interface AssetBinaryResult {
  descriptor: AssetContentDescriptor;
  data: Buffer;
}

export interface AssetThumbnailResult {
  data: Buffer;
  mimeType: "image/webp";
  etag: string;
}

export interface AssetServiceOptions {
  assets: AssetRepository;
  blobs: ImmutableBlobStore;
  thumbnails: ThumbnailStore;
  images: SharpImageProcessor;
}

export class AssetService {
  readonly #assets: AssetRepository;
  readonly #blobs: ImmutableBlobStore;
  readonly #thumbnails: ThumbnailStore;
  readonly #images: SharpImageProcessor;

  constructor(options: AssetServiceOptions) {
    this.#assets = options.assets;
    this.#blobs = options.blobs;
    this.#thumbnails = options.thumbnails;
    this.#images = options.images;
  }

  async uploadImage(input: UploadImageInput): Promise<AssetSnapshot> {
    const originalName = validateOriginalName(input.originalName);
    const data = Buffer.from(input.data);
    const processed = await this.#images.process(data);
    validateClaimedMimeType(input.claimedMimeType, processed.mimeType);
    const extension = originalName.slice(originalName.lastIndexOf(".") + 1).toLowerCase();
    if (!processed.allowedFileExtensions.includes(extension)) {
      throw new ImageValidationError("Image file extension does not match its content.");
    }
    const defaultName = originalName.slice(0, originalName.lastIndexOf("."));
    return this.#store({
      projectId: input.projectId,
      source: "upload",
      originalName,
      name: validateAssetName(input.name ?? defaultName),
      tags: normalizeTags(input.tags ?? []),
      data,
      processed
    });
  }

  async storeGeneratedImage(input: StoreGeneratedImageInput): Promise<AssetSnapshot> {
    const data = Buffer.from(input.data);
    const processed = await this.#images.process(data);
    validateClaimedMimeType(input.claimedMimeType, processed.mimeType);
    return this.#store({
      projectId: input.projectId,
      source: "generated",
      originalName: null,
      name: validateAssetName(input.name),
      tags: normalizeTags(input.tags ?? []),
      data,
      processed
    });
  }

  async storeGeneratedModel(input: StoreGeneratedModelInput): Promise<AssetSnapshot> {
    const data = Buffer.from(input.data);
    const extension = input.extension?.trim().toLowerCase() || input.format;
    validateModelFile(data, input.format, extension);
    const checksumSha256 = createHash("sha256").update(data).digest("hex");
    const blob = await this.#blobs.putModel(
      data,
      checksumSha256,
      extension,
      input.projectId
    );
    return this.#assets.create({
      projectId: input.projectId,
      kind: "model",
      source: "generated",
      name: validateAssetName(input.name),
      originalName: null,
      mimeType: input.mimeType?.trim() || MODEL_MIME_TYPES[input.format],
      blobKey: blob.key,
      checksumSha256,
      byteSize: data.length,
      width: null,
      height: null,
      tags: normalizeTags(input.tags ?? [])
    });
  }

  async getModelInputImage(assetId: string, projectId: string): Promise<ModelInputImage> {
    const asset = this.#assets.requireStored(assetId);
    if (asset.projectId !== projectId || asset.kind !== "image") {
      throw new Error("Model input must be an image in the selected project.");
    }
    const data = await this.#blobs.read(asset.blobKey);
    const prepared = await this.#images.prepareModelInput(data);
    return {
      ...prepared,
      name: createModelInputName(asset.name)
    };
  }

  getAsset(assetId: string): AssetSnapshot {
    return toPublicAsset(this.#assets.requireStored(assetId));
  }

  listAssets(projectId: string, query: AssetListQuery = {}): CursorPage<AssetSnapshot> {
    return this.#assets.list(projectId, query);
  }

  updateAsset(assetId: string, value: unknown): AssetSnapshot {
    const input = parseUpdateAssetRequest(value);
    const normalized: UpdateAssetRequestBody = {};
    if (input.name !== undefined) normalized.name = validateAssetName(input.name);
    if (input.tags !== undefined) normalized.tags = normalizeTags(input.tags);
    return this.#assets.update(assetId, normalized);
  }

  deleteAsset(assetId: string): AssetSnapshot {
    return this.#assets.softDelete(assetId);
  }

  async getContent(assetId: string): Promise<AssetBinaryResult> {
    const asset = this.#assets.requireStored(assetId, true);
    const data = await this.#blobs.read(asset.blobKey);
    return {
      descriptor: {
        asset: toPublicAsset(asset),
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        etag: `"${asset.checksumSha256}"`
      },
      data
    };
  }

  async getThumbnail(assetId: string): Promise<AssetThumbnailResult> {
    const asset = this.#assets.requireStored(assetId, true);
    if (asset.kind !== "image") throw new Error("Only image assets have thumbnails.");
    const scope = { projectId: asset.projectId, source: asset.source };
    let data = await this.#thumbnails.get(asset.checksumSha256, scope);
    if (!data) {
      const source = await this.#blobs.read(asset.blobKey);
      const processed = await this.#images.process(source);
      data = processed.thumbnail;
      await this.#thumbnails.put(asset.checksumSha256, data, scope);
    }
    return {
      data,
      mimeType: "image/webp",
      etag: `"thumbnail-${asset.checksumSha256}"`
    };
  }

  async #store(input: {
    projectId: string;
    source: "upload" | "generated";
    originalName: string | null;
    name: string;
    tags: string[];
    data: Buffer;
    processed: Awaited<ReturnType<SharpImageProcessor["process"]>>;
  }): Promise<AssetSnapshot> {
    const checksumSha256 = createHash("sha256").update(input.data).digest("hex");
    let name = input.name;
    if (input.source === "upload" && input.originalName) {
      const sameFile = this.#assets.findActiveByOriginalNameAndChecksum(
        input.projectId,
        input.originalName,
        checksumSha256,
        "upload"
      );
      if (sameFile) {
        return toPublicAsset(sameFile);
      }
      if (
        this.#assets.findActiveByOriginalName(input.projectId, input.originalName, "upload") ||
        this.#assets.hasActiveName(input.projectId, name, "upload")
      ) {
        name = await this.#nextAvailableName(input.projectId, name);
      }
    }
    const blob = await this.#blobs.putImage(
      input.data,
      checksumSha256,
      input.processed.extension,
      { projectId: input.projectId, source: input.source }
    );
    await this.#thumbnails.put(
      checksumSha256,
      input.processed.thumbnail,
      { projectId: input.projectId, source: input.source }
    );
    return this.#assets.create({
      projectId: input.projectId,
      kind: "image",
      source: input.source,
      name,
      originalName: input.originalName,
      mimeType: input.processed.mimeType,
      blobKey: blob.key,
      checksumSha256,
      byteSize: input.processed.byteSize,
      width: input.processed.width,
      height: input.processed.height,
      tags: input.tags
    });
  }

  async #nextAvailableName(projectId: string, name: string): Promise<string> {
    const extensionIndex = name.lastIndexOf(".");
    const hasExtension = extensionIndex > 0 && extensionIndex < name.length - 1;
    const base = hasExtension ? name.slice(0, extensionIndex) : name;
    const extension = hasExtension ? name.slice(extensionIndex) : "";
    for (let index = 2; index < 10000; index += 1) {
      const candidate = `${base} (${index})${extension}`;
      if (!this.#assets.hasActiveName(projectId, candidate, "upload")) {
        return candidate;
      }
    }
    throw new Error("Unable to create a unique asset name.");
  }
}

const MODEL_MIME_TYPES: Record<ModelOutputFormat, string> = {
  glb: "model/gltf-binary",
  obj: "model/obj",
  fbx: "application/octet-stream",
  stl: "model/stl",
  usdz: "model/vnd.usdz+zip",
  "3mf": "model/3mf"
};

function validateModelFile(
  data: Buffer,
  format: ModelOutputFormat,
  extension: string
): void {
  if (data.length < 16 || data.length > 300 * 1024 * 1024) {
    throw new Error("Generated model file size is invalid.");
  }
  if (format === "glb") {
    if (
      data.toString("ascii", 0, 4) !== "glTF" ||
      data.readUInt32LE(4) !== 2 ||
      data.readUInt32LE(8) !== data.length
    ) {
      throw new Error("Generated GLB header is invalid.");
    }
    return;
  }
  if (extension === "zip") {
    if (data.subarray(0, 2).toString("ascii") !== "PK") {
      throw new Error("Generated model archive is invalid.");
    }
    return;
  }
  if (format === "obj") {
    const sample = data.subarray(0, Math.min(data.length, 64 * 1024)).toString("utf8");
    if (sample.includes("\0") || !/^(?:v|o|g|mtllib|#)\s/mu.test(sample)) {
      throw new Error("Generated OBJ content is invalid.");
    }
    return;
  }
  if (format === "fbx") {
    const header = data.subarray(0, 32).toString("ascii");
    if (!header.startsWith("Kaydara FBX Binary") && !header.trimStart().startsWith("; FBX")) {
      throw new Error("Generated FBX header is invalid.");
    }
    return;
  }
  if (format === "stl") {
    const binaryLength = data.length >= 84 ? 84 + data.readUInt32LE(80) * 50 : 0;
    if (!data.subarray(0, 5).toString("ascii").toLowerCase().startsWith("solid") &&
        binaryLength !== data.length) {
      throw new Error("Generated STL content is invalid.");
    }
    return;
  }
  if (data.subarray(0, 2).toString("ascii") !== "PK") {
    throw new Error(`Generated ${format.toUpperCase()} archive is invalid.`);
  }
}

function createModelInputName(name: string): string {
  const normalized = name
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 120);
  return `${normalized || "model-input"}.jpg`;
}

function validateOriginalName(value: string): string {
  const name = value.trim();
  if (
    !name ||
    name.length > 255 ||
    name.includes("\0") ||
    name.includes("/") ||
    name.includes("\\") ||
    name.lastIndexOf(".") <= 0 ||
    name.endsWith(".")
  ) {
    throw new ImageValidationError("Image file name is invalid.");
  }
  return name;
}

function validateClaimedMimeType(claimed: string | undefined, actual: string): void {
  if (!claimed) return;
  const normalized = claimed.split(";", 1)[0]!.trim().toLowerCase();
  if (!normalized || normalized === "application/octet-stream") return;
  const comparable = normalized === "image/jpg" ? "image/jpeg" : normalized;
  if (comparable !== actual) {
    throw new ImageValidationError("Image MIME type does not match its content.");
  }
}

function validateAssetName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 200) throw new Error("Asset name must contain 1 to 200 characters.");
  return name;
}

function normalizeTags(tags: readonly string[]): string[] {
  const normalized = [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort();
  if (normalized.length > 50 || normalized.some((tag) => tag.length > 50)) {
    throw new Error("Asset tags exceed the configured limits.");
  }
  return normalized;
}

function toPublicAsset(asset: ReturnType<AssetRepository["requireStored"]>): AssetSnapshot {
  const { blobKey: _blobKey, ...snapshot } = asset;
  return structuredClone(snapshot);
}
