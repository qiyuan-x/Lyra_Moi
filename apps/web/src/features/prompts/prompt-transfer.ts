import type {
  CreatePromptTemplateRequestBody,
  PromptTemplateSnapshot
} from "@lyra/contracts";
import {
  createTemplateArchive,
  isZip,
  readTemplateArchive
} from "../templates/template-archive.js";

export interface ImportedPromptTemplate {
  value: CreatePromptTemplateRequestBody;
  preview?: Blob;
}

interface PromptExportPayload {
  version: 1;
  prompts: Array<{
    name: string;
    category: string;
    note: string | null;
    content: string;
    variables: string[];
    favorite: boolean;
  }>;
}

export function createPromptExportPayload(
  prompts: PromptTemplateSnapshot[],
  selectedIds: ReadonlySet<string>
): PromptExportPayload {
  return {
    version: 1,
    prompts: prompts
      .filter((item) => selectedIds.has(item.id))
      .map(({ name, category, note, content, variables, favorite }) => ({
        name,
        category,
        note,
        content,
        variables,
        favorite
      }))
  };
}

export function parsePromptImport(
  text: string
): CreatePromptTemplateRequestBody[] {
  const parsed: unknown = JSON.parse(text);
  const records = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { prompts?: unknown }).prompts)
      ? (parsed as { prompts: unknown[] }).prompts
      : [];

  if (!records.length) {
    throw new Error("导入文件中没有有效提示词。");
  }

  const prompts = records.flatMap((record) => {
    const prompt = parsePromptRecord(record);
    return prompt ? [prompt] : [];
  });

  if (!prompts.length) {
    throw new Error("导入文件中没有可创建的提示词。");
  }
  return prompts;
}

export async function createPromptArchive(
  prompts: PromptTemplateSnapshot[],
  selectedIds: ReadonlySet<string>,
  previews: ReadonlyMap<string, Blob>
): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const records: Array<{
    name: string;
    category: string;
    note: string | null;
    content: string;
    variables: string[];
    favorite: boolean;
    preview?: { path: string; mimeType: string };
  }> = [];
  for (const prompt of prompts.filter((item) => selectedIds.has(item.id))) {
    const preview = previews.get(prompt.id);
    const previewPath = preview
      ? `previews/${String(records.length + 1).padStart(3, "0")}.${previewExtension(preview.type)}`
      : "";
    if (preview && previewPath) {
      files[previewPath] = new Uint8Array(await preview.arrayBuffer());
    }
    records.push({
      name: prompt.name,
      category: prompt.category,
      note: prompt.note,
      content: prompt.content,
      variables: [...prompt.variables],
      favorite: prompt.favorite,
      ...(preview && previewPath
        ? { preview: { path: previewPath, mimeType: preview.type } }
        : {})
    });
  }
  return createTemplateArchive({
    schemaVersion: 2,
    type: "lyra-prompt-templates",
    exportedAt: new Date().toISOString(),
    prompts: records
  }, files);
}

export async function parsePromptImportFile(file: File): Promise<ImportedPromptTemplate[]> {
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!isZip(header)) {
    return parsePromptImport(await file.text()).map((value) => ({ value }));
  }
  const archive = await readTemplateArchive(file);
  if (!archive.manifest || typeof archive.manifest !== "object") {
    throw new Error("提示词模板包清单无效。");
  }
  const manifest = archive.manifest as Record<string, unknown>;
  if (manifest.type !== "lyra-prompt-templates" || manifest.schemaVersion !== 2) {
    throw new Error("这不是 Lyra 提示词模板包。");
  }
  const rawRecords = Array.isArray(manifest.prompts) ? manifest.prompts : [];
  const imported = rawRecords.flatMap((raw) => {
    const value = parsePromptRecord(raw);
    if (!value || !raw || typeof raw !== "object") return [];
    const preview = (raw as Record<string, unknown>).preview;
    if (!preview || typeof preview !== "object") return [{ value }];
    const descriptor = preview as Record<string, unknown>;
    const path = typeof descriptor.path === "string" ? descriptor.path : "";
    const mimeType = typeof descriptor.mimeType === "string" ? descriptor.mimeType : "";
    const data = archive.files[path];
    if (!path.startsWith("previews/") || !mimeType.startsWith("image/") || !data) {
      return [{ value }];
    }
    return [{
      value,
      preview: new Blob([data.slice().buffer as ArrayBuffer], { type: mimeType })
    }];
  });
  if (!imported.length) throw new Error("导入文件中没有可创建的提示词。");
  return imported;
}

function parsePromptRecord(record: unknown): CreatePromptTemplateRequestBody | null {
  if (!record || typeof record !== "object") return null;
  const item = record as Record<string, unknown>;
  const name = typeof item.name === "string" ? item.name.trim() : "";
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!name || !content) return null;
  const variables = Array.isArray(item.variables)
    ? item.variables.filter((value): value is string => typeof value === "string")
    : undefined;
  const note = typeof item.note === "string" && item.note.trim()
    ? item.note.trim()
    : typeof item.shortcut === "string" && item.shortcut.trim()
      ? item.shortcut.trim()
      : null;
  return {
    name,
    content,
    category: typeof item.category === "string" ? item.category.trim() : "",
    note,
    favorite: item.favorite === true,
    ...(variables && variables.length > 0 ? { variables } : {})
  };
}

function previewExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "image/gif") return "gif";
  return "png";
}
