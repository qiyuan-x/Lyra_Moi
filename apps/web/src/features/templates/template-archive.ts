import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const maxArchiveBytes = 100 * 1024 * 1024;
const maxArchiveEntryBytes = 25 * 1024 * 1024;
const maxExtractedBytes = 120 * 1024 * 1024;

export interface TemplateArchive {
  manifest: unknown;
  files: Record<string, Uint8Array>;
}

export function createTemplateArchive(
  manifest: unknown,
  files: Record<string, Uint8Array>
): Blob {
  const zipped = zipSync({
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    ...files
  }, { level: 6 });
  return new Blob([zipped], { type: "application/zip" });
}

export async function readTemplateArchive(file: Blob): Promise<TemplateArchive> {
  if (file.size > maxArchiveBytes) throw new Error("模板包不能超过 100 MB。");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isZip(bytes)) throw new Error("模板包不是有效的 ZIP 文件。");
  const files = unzipSync(bytes, {
    filter: (entry) => {
      if (entry.originalSize > maxArchiveEntryBytes) {
        throw new Error(`模板包中的文件过大：${entry.name}`);
      }
      return entry.name === "manifest.json" || entry.name.startsWith("previews/");
    }
  });
  const total = Object.values(files).reduce((sum, item) => sum + item.byteLength, 0);
  if (total > maxExtractedBytes) throw new Error("模板包解压后的内容过大。");
  const manifestBytes = files["manifest.json"];
  if (!manifestBytes) throw new Error("模板包缺少 manifest.json。");
  try {
    return {
      manifest: JSON.parse(strFromU8(manifestBytes)) as unknown,
      files
    };
  } catch {
    throw new Error("模板包清单格式无效。");
  }
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 &&
    bytes[0] === 0x50 && bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.+)$/u.exec(dataUrl);
  if (!match) throw new Error("效果图数据无效。");
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: match[1]! });
}

export async function createPreviewDataUrl(blob: Blob): Promise<string> {
  if (!blob.type.startsWith("image/")) throw new Error("效果图不是有效图片。");
  const bitmap = await createImageBitmap(blob);
  try {
    const scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理效果图。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", .82);
  } finally {
    bitmap.close();
  }
}
