/** Project-local form values. Provider credentials belong to application settings. */
export interface ProjectGenerationForms {
  modeling?: Record<string, unknown>;
  image?: Record<string, unknown>;
}

export function validateProjectGenerationForms(value: unknown): ProjectGenerationForms {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("生成参数必须为 JSON 对象。");
  for (const [key, section] of Object.entries(value)) {
    if (!["modeling", "image"].includes(key) || !section || typeof section !== "object" || Array.isArray(section)) {
      throw new Error("生成参数仅支持 modeling 和 image 对象。");
    }
  }
  if (JSON.stringify(value).length > 256_000) throw new Error("项目生成参数不能超过 256 KB。");
  return value as ProjectGenerationForms;
}
