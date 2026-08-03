import type { ModelOutputFormat, ProviderAdapterType } from "@lyra/contracts";

export function defaultModelParameters(
  adapter: ProviderAdapterType | undefined,
  model: string
): Record<string, unknown> {
  if (adapter === "meshy") {
    return {
      texture: true,
      pbr: true,
      textureResolution: "2k",
      topology: "triangle",
      targetFaceCount: model === "meshy-t1" ? null : model === "meshy-t2" ? 4_000 : 30_000,
      poseMode: "",
      imageEnhancement: true,
      removeLighting: true
    };
  }
  if (adapter === "hunyuan") {
    return {
      generateType: "Normal",
      pbr: true,
      targetFaceCount: 500_000,
      polygonType: "triangle"
    };
  }
  return {
    texture: true,
    pbr: true,
    geometryQuality: "standard",
    textureQuality: "standard",
    imageAutofix: false,
    orientation: "default",
    targetFaceCount: model.startsWith("P1-") ? 20_000 : 500_000
  };
}

export function validateModelParameters(
  adapter: ProviderAdapterType | undefined,
  model: string,
  parameters: Record<string, unknown>,
  outputFormats: ModelOutputFormat[]
): string | null {
  if (!adapter) return "请选择建模模型。";
  if (outputFormats.length === 0) return "至少选择一种输出格式。";
  const faceCount = parameters.targetFaceCount;
  if (adapter === "meshy") {
    if (model === "meshy-t1" || faceCount === null) return null;
    const maximum = model === "meshy-t2" ? 15_000 : 300_000;
    return isIntegerInRange(faceCount, 100, maximum)
      ? null
      : `目标面数应为 100 至 ${maximum.toLocaleString()}。`;
  }
  if (adapter === "hunyuan") {
    if (parameters.generateType === "LowPoly") return null;
    return isIntegerInRange(faceCount, 3_000, 1_500_000)
      ? null
      : "目标面数应为 3,000 至 1,500,000。";
  }
  const p1 = model.startsWith("P1-");
  const minimum = p1 ? 48 : 1_000;
  const maximum = p1
    ? 20_000
    : !model.startsWith("v3.")
      ? 500_000
      : parameters.geometryQuality === "detailed"
        ? 2_000_000
        : 1_500_000;
  return isIntegerInRange(faceCount, minimum, maximum)
    ? null
    : `目标面数应为 ${minimum.toLocaleString()} 至 ${maximum.toLocaleString()}。`;
}

export function modelAdapterLabel(adapter: ProviderAdapterType | undefined): string {
  if (adapter === "meshy") return "Meshy";
  if (adapter === "hunyuan") return "混元";
  if (adapter === "tripo") return "Tripo";
  return "";
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum;
}
