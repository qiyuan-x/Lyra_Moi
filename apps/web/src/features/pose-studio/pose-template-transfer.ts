import {
  clonePose,
  readPoseSnapshot,
  type PoseSnapshot,
  type PoseTemplate,
  type PoseTemplateKind,
  type PoseTemplateTransfer
} from "./pose-types.js";
import {
  createTemplateArchive,
  isZip,
  readTemplateArchive
} from "../templates/template-archive.js";

export interface ImportedPoseTemplate {
  name: string;
  pose: PoseSnapshot;
  kind: PoseTemplateKind;
  sourceSide?: "left" | "right";
  preview?: Blob;
}

interface PoseArchiveManifest {
  schemaVersion: 2;
  type: "lyra-pose-templates";
  exportedAt: string;
  templates: Array<{
    name: string;
    pose: PoseSnapshot;
    kind: PoseTemplateKind;
    sourceSide?: "left" | "right";
    preview?: { path: string; mimeType: string };
  }>;
}

export function createPoseTemplateExport(
  templates: PoseTemplate[],
  selectedIds: ReadonlySet<string>
): PoseTemplateTransfer {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    templates: templates
      .filter((template) => selectedIds.has(template.id))
      .map((template) => ({
        name: template.name,
        pose: clonePose(template.pose),
        kind: template.kind,
        ...(template.sourceSide ? { sourceSide: template.sourceSide } : {})
      }))
  };
}

export function parsePoseTemplateImport(text: string): ImportedPoseTemplate[] {
  const parsed: unknown = JSON.parse(text);
  return parseRecords(parsed);
}

export async function createPoseTemplateArchive(
  templates: PoseTemplate[],
  selectedIds: ReadonlySet<string>,
  previews: ReadonlyMap<string, Blob>
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const records: PoseArchiveManifest["templates"] = [];
  for (const template of templates.filter((item) => selectedIds.has(item.id))) {
    const preview = previews.get(template.id);
    const previewPath = preview
      ? `previews/${String(records.length + 1).padStart(3, "0")}.${previewExtension(preview.type)}`
      : "";
    if (preview && previewPath) {
      files[previewPath] = new Uint8Array(await preview.arrayBuffer());
    }
    records.push({
      name: template.name,
      pose: clonePose(template.pose),
      kind: template.kind,
      ...(template.sourceSide ? { sourceSide: template.sourceSide } : {}),
      ...(preview && previewPath
        ? { preview: { path: previewPath, mimeType: preview.type || "image/png" } }
        : {})
    });
  }
  const manifest: PoseArchiveManifest = {
    schemaVersion: 2,
    type: "lyra-pose-templates",
    exportedAt: new Date().toISOString(),
    templates: records
  };
  return createTemplateArchive(manifest, files);
}

export async function parsePoseTemplateFile(file: File): Promise<ImportedPoseTemplate[]> {
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!isZip(header)) return parsePoseTemplateImport(await file.text());
  const archive = await readTemplateArchive(file);
  if (!archive.manifest || typeof archive.manifest !== "object") {
    throw new Error("动作模板包清单无效。");
  }
  const manifest = archive.manifest as Record<string, unknown>;
  if (manifest.type !== "lyra-pose-templates" || manifest.schemaVersion !== 2) {
    throw new Error("这不是 Lyra 动作模板包。");
  }
  const rawRecords = Array.isArray(manifest.templates) ? manifest.templates : [];
  const imported = rawRecords.flatMap((raw) => {
    const template = parseRecord(raw);
    if (!template || !raw || typeof raw !== "object") return [];
    const preview = (raw as Record<string, unknown>).preview;
    if (!preview || typeof preview !== "object") return [template];
    const descriptor = preview as Record<string, unknown>;
    const path = typeof descriptor.path === "string" ? descriptor.path : "";
    const mimeType = typeof descriptor.mimeType === "string" ? descriptor.mimeType : "";
    const data = archive.files[path];
    if (!path.startsWith("previews/") || !mimeType.startsWith("image/") || !data) {
      return [template];
    }
    return [{
      ...template,
      preview: new Blob([data.slice().buffer as ArrayBuffer], { type: mimeType })
    }];
  });
  if (!imported.length) throw new Error("导入文件中没有有效的动作模板。");
  return imported;
}

function parseRecords(parsed: unknown): ImportedPoseTemplate[] {
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { templates?: unknown }).templates)
      ? (parsed as { templates: unknown[] }).templates
      : [];

  const templates = records.flatMap((record) => {
    const template = parseRecord(record);
    return template ? [template] : [];
  });

  if (!templates.length) throw new Error("导入文件中没有有效的动作模板。");
  return templates;
}

function parseRecord(record: unknown): ImportedPoseTemplate | null {
  if (!record || typeof record !== "object") return null;
  const candidate = record as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const pose = readPoseSnapshot(candidate.pose);
  if (!name || !pose) return null;
  const kind: PoseTemplateKind = candidate.kind === "hand" ? "hand" : "body";
  const sourceSide: "left" | "right" = candidate.sourceSide === "right" ? "right" : "left";
  return {
    name,
    pose,
    kind,
    ...(kind === "hand" ? { sourceSide } : {})
  };
}

function previewExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "image/gif") return "gif";
  return "png";
}
