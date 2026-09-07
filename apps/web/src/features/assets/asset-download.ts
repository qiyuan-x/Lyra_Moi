import type { AssetSnapshot } from "@lyra/contracts";
import { Zip, ZipPassThrough } from "fflate";

const mimeExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "model/gltf-binary": "glb", "model/gltf+json": "gltf", "model/obj": "obj",
  "model/stl": "stl", "model/vnd.usdz+zip": "usdz", "model/3mf": "3mf",
  "application/zip": "zip", "application/x-zip-compressed": "zip"
};

export function assetDownloadName(asset: AssetSnapshot): string {
  const source = asset.name || asset.originalName || "素材";
  const extension = mimeExtensions[asset.mimeType]
    ?? source.match(/\.(glb|gltf|obj|fbx|stl|usdz|3mf|zip)$/iu)?.[1]?.toLowerCase()
    ?? (asset.tags.some((tag) => tag.toUpperCase() === "FBX") ? "fbx" : "bin");
  return `${safeFileStem(source)}.${extension}`;
}

function safeFileStem(value: string): string {
  let stem = value.replace(/\.(png|jpe?g|webp|gif|glb|gltf|obj|fbx|stl|usdz|3mf|zip|bin)$/iu, "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .trim().slice(0, 140).replace(/[. ]+$/u, "") || "素材";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(stem)) stem = `_${stem}`;
  return stem;
}

export async function prepareAssetDownload(
  assets: readonly AssetSnapshot[],
  contentUrl: (assetId: string) => string,
  archiveName = "模型文件"
): Promise<{ blob: Blob; name: string }> {
  if (assets.length === 0) throw new Error("没有可下载的文件。");
  async function read(asset: AssetSnapshot) {
    const response = await fetch(contentUrl(asset.id));
    if (!response.ok) throw new Error(`下载“${asset.name}”失败：HTTP ${response.status}`);
    return response;
  }
  if (assets.length === 1) {
    const asset = assets[0]!;
    return { blob: await (await read(asset)).blob(), name: assetDownloadName(asset) };
  }

  const chunks: BlobPart[] = [];
  let failure: Error | null = null;
  let complete = false;
  const archive = new Zip((error, data, final) => {
    if (error) { failure = error; return; }
    chunks.push(new Uint8Array(data));
    complete = final;
  });
  const usedNames = new Set<string>();
  try {
    // Store original bytes without recompressing large model files or upstream ZIPs.
    for (const asset of assets) {
      const baseName = assetDownloadName(asset);
      let name = baseName;
      for (let number = 2; usedNames.has(name.toLocaleLowerCase("zh-CN")); number += 1) {
        const dot = baseName.lastIndexOf(".");
        name = `${baseName.slice(0, dot)} (${number})${baseName.slice(dot)}`;
      }
      usedNames.add(name.toLocaleLowerCase("zh-CN"));
      const response = await read(asset);
      const entry = new ZipPassThrough(name);
      archive.add(entry);
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            entry.push(chunk.value);
          }
        } finally {
          reader.releaseLock();
        }
        entry.push(new Uint8Array(), true);
      } else {
        entry.push(new Uint8Array(await response.arrayBuffer()), true);
      }
      if (failure) throw failure;
    }
    archive.end();
    if (failure) throw failure;
    if (!complete) throw new Error("模型文件打包未完成，请重试。");
    return { blob: new Blob(chunks, { type: "application/zip" }), name: `${safeFileStem(archiveName)}.zip` };
  } catch (error) {
    archive.terminate();
    throw error;
  }
}

export function saveDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
