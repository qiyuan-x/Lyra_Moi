import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssetService } from "@lyra/core";
import {
  AssetRepository,
  ImageValidationError,
  ImmutableBlobStore,
  ProjectRepository,
  SharpImageProcessor,
  ThumbnailStore,
  createRuntimeLayout,
  migrateLegacyProjectAssets,
  migrateRuntimeDatabase,
  openReadyRuntimeDatabase
} from "@lyra/storage";

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("AssetService", () => {
  it("stores uploaded and generated images in separate project directories", async () => {
    const fixture = await createFixture();
    try {
      const first = await fixture.service.uploadImage({
        projectId: fixture.projectId,
        originalName: "character.png",
        claimedMimeType: "image/png",
        name: "角色参考 100%",
        tags: ["角色", "参考", "角色"],
        data: PNG_1X1
      });
      const second = await fixture.service.uploadImage({
        projectId: fixture.projectId,
        originalName: "pose.png",
        name: "姿势参考",
        tags: ["姿势"],
        data: PNG_1X1
      });
      const generated = await fixture.service.storeGeneratedImage({
        projectId: fixture.projectId,
        name: "生成结果",
        tags: ["候选"],
        data: PNG_1X1
      });

      expect(new Set([first.id, second.id, generated.id]).size).toBe(3);
      expect(new Set([first.checksumSha256, second.checksumSha256, generated.checksumSha256]).size).toBe(
        1
      );
      expect(first.tags).toEqual(["参考", "角色"]);
      expect(generated).toMatchObject({ source: "generated", originalName: null });

      const blobRows = fixture.database.connection
        .prepare("SELECT blob_key FROM assets ORDER BY id")
        .all() as unknown as Array<{ blob_key: string }>;
      expect(new Set(blobRows.map((row) => row.blob_key)).size).toBe(2);
      expect(blobRows.some((row) => row.blob_key.includes("/uploads/images/"))).toBe(true);
      expect(blobRows.some((row) => row.blob_key.includes("/generated/images/"))).toBe(true);
      expect(await countFiles(fixture.layout.projects)).toBe(4);
      expect(await countFiles(fixture.layout.blobs)).toBe(0);
      expect(await countFiles(fixture.layout.thumbnails)).toBe(0);

      const content = await fixture.service.getContent(first.id);
      expect(content.data).toEqual(PNG_1X1);
      expect(content.descriptor).toMatchObject({
        mimeType: "image/png",
        byteSize: PNG_1X1.length,
        etag: `"${first.checksumSha256}"`
      });
      expect(JSON.stringify(content.descriptor)).not.toContain("blobKey");

      const thumbnail = await fixture.service.getThumbnail(first.id);
      expect(thumbnail.mimeType).toBe("image/webp");
      expect(thumbnail.data.subarray(8, 12).toString("ascii")).toBe("WEBP");

      expect(fixture.service.listAssets(fixture.projectId, { tag: "姿势" }).items).toEqual([
        second
      ]);
      expect(
        fixture.service.listAssets(fixture.projectId, { source: "generated" }).items
      ).toEqual([generated]);
      expect(fixture.service.listAssets(fixture.projectId, { search: "%" }).items).toEqual([
        first
      ]);

      const page1 = fixture.service.listAssets(fixture.projectId, { limit: 1 });
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = fixture.service.listAssets(fixture.projectId, {
        limit: 1,
        cursor: page1.nextCursor!
      });
      expect(page2.items).toHaveLength(1);
      expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);

      const updated = fixture.service.updateAsset(second.id, {
        name: "新姿势参考",
        tags: ["动作", "参考"]
      });
      expect(updated).toMatchObject({ name: "新姿势参考", tags: ["动作", "参考"] });
      fixture.service.deleteAsset(second.id);
      expect(fixture.service.listAssets(fixture.projectId).items.map((asset) => asset.id)).not.toContain(
        second.id
      );
      expect((await fixture.service.getContent(second.id)).data).toEqual(PNG_1X1);
      expect(await countFiles(fixture.layout.projects)).toBe(4);
    } finally {
      fixture.database.close();
    }
  });

  it("rejects forged file metadata and path-like names", async () => {
    const fixture = await createFixture();
    try {
      await expect(
        fixture.service.uploadImage({
          projectId: fixture.projectId,
          originalName: "fake.jpg",
          data: PNG_1X1
        })
      ).rejects.toThrow("extension does not match");
      await expect(
        fixture.service.uploadImage({
          projectId: fixture.projectId,
          originalName: "fake.png",
          claimedMimeType: "image/jpeg",
          data: PNG_1X1
        })
      ).rejects.toThrow("MIME type does not match");
      await expect(
        fixture.service.uploadImage({
          projectId: fixture.projectId,
          originalName: "../escape.png",
          data: PNG_1X1
        })
      ).rejects.toBeInstanceOf(ImageValidationError);
      await expect(
        fixture.service.uploadImage({
          projectId: fixture.projectId,
          originalName: "text.png",
          data: Buffer.from("not an image")
        })
      ).rejects.toBeInstanceOf(ImageValidationError);
      await expect(fixture.blobs.read("../../config/.env")).rejects.toThrow("Blob key is invalid");
      expect(() =>
        fixture.service.listAssets(fixture.projectId, { cursor: "invalid-cursor" })
      ).toThrow("Asset cursor is invalid");
    } finally {
      fixture.database.close();
    }
  });

  it("reuses an identical upload and renames a changed file with the same name", async () => {
    const fixture = await createFixture();
    try {
      const first = await fixture.service.uploadImage({
        projectId: fixture.projectId,
        originalName: "reference.png",
        data: PNG_1X1
      });
      const same = await fixture.service.uploadImage({
        projectId: fixture.projectId,
        originalName: "reference.png",
        data: PNG_1X1
      });
      expect(same.id).toBe(first.id);

      // PNG decoders ignore data after IEND; the bytes still produce a new checksum.
      const different = Buffer.concat([PNG_1X1, Buffer.from([0x01])]);
      const renamed = await fixture.service.uploadImage({
        projectId: fixture.projectId,
        originalName: "reference.png",
        name: first.name,
        data: different
      });
      expect(renamed.id).not.toBe(first.id);
      expect(renamed.name).toBe("reference (2)");
      const sameRenamed = await fixture.service.uploadImage({
        projectId: fixture.projectId,
        originalName: "reference.png",
        data: different
      });
      expect(sameRenamed.id).toBe(renamed.id);
    } finally {
      fixture.database.close();
    }
  });

  it("stores model exports with their real container type", async () => {
    const fixture = await createFixture();
    try {
      const obj = Buffer.from("# model\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "utf8");
      const direct = await fixture.service.storeGeneratedModel({
        projectId: fixture.projectId,
        data: obj,
        name: "mesh.obj",
        format: "obj",
        extension: "obj"
      });
      const archiveData = Buffer.concat([Buffer.from("PK", "ascii"), Buffer.alloc(30)]);
      const archive = await fixture.service.storeGeneratedModel({
        projectId: fixture.projectId,
        data: archiveData,
        name: "mesh-obj.zip",
        format: "obj",
        extension: "zip",
        mimeType: "application/zip",
        tags: ["OBJ"]
      });
      expect(direct).toMatchObject({ kind: "model", mimeType: "model/obj" });
      expect(archive).toMatchObject({
        kind: "model",
        mimeType: "application/zip",
        tags: ["OBJ"]
      });
      expect((await fixture.service.getContent(archive.id)).data).toEqual(archiveData);
    } finally {
      fixture.database.close();
    }
  });

  it("moves legacy Blob records into the project upload directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "lyra-legacy-assets-"));
    temporaryDirectories.push(parent);
    const layout = createRuntimeLayout(join(parent, "data"));
    await migrateRuntimeDatabase(layout);
    const database = await openReadyRuntimeDatabase(layout);
    try {
      const projectId = new ProjectRepository(database).ensureDefaultProject().id;
      const checksum = createHash("sha256").update(PNG_1X1).digest("hex");
      const processor = new SharpImageProcessor();
      const processed = await processor.process(PNG_1X1);
      const legacyBlobs = new ImmutableBlobStore(layout.blobs);
      const legacyThumbnails = new ThumbnailStore(layout.thumbnails);
      const blob = await legacyBlobs.putImage(PNG_1X1, checksum, "png");
      await legacyThumbnails.put(checksum, processed.thumbnail);
      const asset = new AssetRepository(database).create({
        projectId,
        kind: "image",
        source: "upload",
        name: "旧素材",
        originalName: "legacy.png",
        mimeType: "image/png",
        blobKey: blob.key,
        checksumSha256: checksum,
        byteSize: PNG_1X1.length,
        width: 1,
        height: 1,
        tags: []
      });

      expect(await migrateLegacyProjectAssets(database, layout)).toBe(1);
      const stored = new AssetRepository(database).requireStored(asset.id);
      expect(stored.blobKey).toContain(`${projectId}/uploads/images/sha256/`);
      const migratedService = new AssetService({
        assets: new AssetRepository(database),
        blobs: new ImmutableBlobStore(layout.projects, layout.blobs),
        thumbnails: new ThumbnailStore(layout.projects, layout.thumbnails),
        images: processor
      });
      expect((await migratedService.getContent(asset.id)).data).toEqual(PNG_1X1);
      expect((await migratedService.getThumbnail(asset.id)).data).toEqual(processed.thumbnail);
      expect(await migrateLegacyProjectAssets(database, layout)).toBe(0);
    } finally {
      database.close();
    }
  });
});

async function createFixture() {
  const parent = await mkdtemp(join(tmpdir(), "lyra-assets-"));
  temporaryDirectories.push(parent);
  const layout = createRuntimeLayout(join(parent, "data"));
  await migrateRuntimeDatabase(layout);
  const database = await openReadyRuntimeDatabase(layout);
  const projectId = new ProjectRepository(database).ensureDefaultProject().id;
  const blobs = new ImmutableBlobStore(layout.projects, layout.blobs);
  const service = new AssetService({
    assets: new AssetRepository(database),
    blobs,
    thumbnails: new ThumbnailStore(layout.projects, layout.thumbnails),
    images: new SharpImageProcessor()
  });
  return { parent, layout, database, projectId, blobs, service };
}

async function countFiles(directory: string): Promise<number> {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    count += entry.isDirectory() ? await countFiles(path) : 1;
  }
  return count;
}
