import type {
  ModelGenerationRequest,
  ModelOutputFormat
} from "@lyra/contracts";
import { ProviderConnectionError } from "./provider-errors.js";
import type {
  GeneratedModelBinary,
  ModelProviderResult,
  ModelTextureUrlSet
} from "./model-provider-types.js";
import { ProviderHttpClient } from "./provider-http-client.js";

const MIME_TYPES: Record<ModelOutputFormat, string> = {
  glb: "model/gltf-binary",
  obj: "model/obj",
  fbx: "application/octet-stream",
  stl: "model/stl",
  usdz: "model/vnd.usdz+zip",
  "3mf": "model/3mf"
};

/** Remove Lyra-only profile metadata before sending provider parameters. */
export function stripInternalProviderSettings(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const result = structuredClone(settings);
  delete result.__lyra;
  return result;
}

export async function downloadGeneratedModels(
  client: ProviderHttpClient,
  result: ModelProviderResult,
  request: ModelGenerationRequest,
  namePrefix: string,
  signal?: AbortSignal
): Promise<GeneratedModelBinary[]> {
  if (result.status !== "succeeded" || !result.modelUrls) {
    throw new ProviderConnectionError(
      "INVALID_RESPONSE",
      "Provider did not return downloadable model files."
    );
  }
  const files: GeneratedModelBinary[] = [];
  for (const format of request.outputFormats) {
    const source = result.modelUrls[format];
    if (!source) {
      throw new ProviderConnectionError(
        "INVALID_RESPONSE",
        `Provider did not return the requested ${format.toUpperCase()} model.`
      );
    }
    const response = await client.getBinary(validateDownloadUrl(source), {}, signal);
    const archive = response.data.subarray(0, 2).toString("ascii") === "PK" &&
      format !== "usdz" &&
      format !== "3mf";
    const packaged = format === "obj" && !archive && result.textureUrls?.length
      ? await packageObjWithTextures(client, response.data, result.textureUrls, namePrefix, signal)
      : null;
    const extension = archive ? "zip" : format;
    files.push({
      data: packaged?.data ?? response.data,
      format,
      extension: packaged ? "zip" : extension,
      mimeType: packaged ? "application/zip" : archive ? "application/zip" : MIME_TYPES[format],
      name: archive
        ? `${namePrefix}-${format}.zip`
        : packaged
          ? `${namePrefix}-${format}.zip`
        : `${namePrefix}.${format}`
    });
  }
  return files;
}

async function packageObjWithTextures(
  client: ProviderHttpClient,
  obj: Buffer,
  textureSets: readonly ModelTextureUrlSet[],
  namePrefix: string,
  signal?: AbortSignal
): Promise<{ data: Buffer } | null> {
  const entries: Array<{ name: string; data: Buffer }> = [
    { name: `${namePrefix}.obj`, data: obj }
  ];
  for (const [setIndex, textureSet] of textureSets.entries()) {
    for (const [kind, url] of Object.entries(textureSet)) {
      if (!url) continue;
      const response = await client.getBinary(validateDownloadUrl(url), {}, signal);
      const extension = extensionFromUrl(url) || "png";
      entries.push({
        name: `textures/texture_${setIndex}_${kind}.${extension}`,
        data: response.data
      });
    }
  }
  return entries.length > 1 ? { data: createStoredZip(entries) } : null;
}

function createStoredZip(entries: ReadonlyArray<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0x0800, 6);
    local.writeUInt32LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    localParts.push(local, entry.data);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(0x0800, 8);
    central.writeUInt32LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centralParts.push(central);
    offset += local.length + entry.data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function extensionFromUrl(value: string): string | null {
  try {
    const pathname = new URL(value).pathname;
    const match = pathname.match(/\.([A-Za-z0-9]+)$/u);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

export function validateDownloadUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderConnectionError("INVALID_RESPONSE", "Provider model URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ProviderConnectionError(
      "INVALID_RESPONSE",
      "Provider model URL must use HTTP or HTTPS."
    );
  }
  return url.toString();
}

export function providerFailure(message: string): ModelProviderResult {
  return {
    status: "failed",
    progress: 100,
    errorMessage: message
  };
}

export function readOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
