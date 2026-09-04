import {
  isMeshyGenerationModel,
  type ModelOutputFormat,
  type ProviderAdapterType
} from "@lyra/contracts";

export function defaultModelParameters(
  adapter: ProviderAdapterType | undefined,
  model: string
): Record<string, unknown> {
  if (isMeshyGenerationModel(adapter, model)) {
    const smartTopology = model === "meshy-t1" || model === "meshy-t2";
    return {
      texture: true,
      pbr: false,
      textureResolution: "2k",
      textureGuideMode: "none",
      texturePrompt: "",
      topology: "triangle",
      decimationMode: null,
      targetFaceCount: model === "meshy-t2" ? 4_000 : null,
      remesh: !smartTopology && model === "meshy-5",
      savePreRemeshedModel: false,
      poseMode: "",
      imageEnhancement: true,
      removeLighting: true,
      ultraMode: false,
      moderation: false,
      multiViewThumbnails: false,
      alphaThumbnail: false,
      autoSize: false,
      originAt: "bottom"
    };
  }
  if (adapter === "hunyuan") {
    return {
      generateType: "Normal",
      pbr: false,
      targetFaceCount: 500_000,
      polygonType: "triangle"
    };
  }
  if (!adapter || adapter === "stability-3d") return {};
  return {
    texture: true,
    pbr: true,
    geometryQuality: "standard",
    textureQuality: "standard",
    imageAutofix: false,
    textureAlignment: "original_image",
    orientation: "default",
    targetFaceCount: null,
    negativePrompt: "",
    imageSeed: null,
    modelSeed: null,
    textureSeed: null,
    autoSize: false,
    quad: false,
    smartLowPoly: false,
    generateParts: false,
    exportUv: true,
    compression: "default"
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
  if (isMeshyGenerationModel(adapter, model)) {
    if (parameters.pbr === true && parameters.texture === false) {
      return "生成 PBR 贴图需要先开启生成纹理。";
    }
    if (
      parameters.textureGuideMode === "text" &&
      typeof parameters.texturePrompt === "string" &&
      parameters.texturePrompt.length > 600
    ) {
      return "纹理提示词不能超过 600 个字符。";
    }
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
  if (adapter === "stability-3d") {
    return outputFormats.length === 1 && outputFormats[0] === "glb"
      ? null
      : "Stability AI 3D 当前仅支持 GLB 输出。";
  }
  if (
    typeof parameters.negativePrompt === "string" &&
    parameters.negativePrompt.length > 255
  ) {
    return "反向提示词不能超过 255 个字符。";
  }
  if (
    parameters.generateParts === true &&
    (parameters.texture !== false || parameters.pbr === true || parameters.quad === true)
  ) {
    return "生成可编辑部件时必须关闭纹理、PBR 和四边面。";
  }
  if (faceCount === null) return null;
  const { minimum, maximum } = tripoFaceCountRange(model, parameters);
  return isIntegerInRange(faceCount, minimum, maximum)
    ? null
    : `目标面数应为 ${minimum.toLocaleString()} 至 ${maximum.toLocaleString()}。`;
}

export function tripoFaceCountRange(
  model: string,
  parameters: Record<string, unknown>
): { minimum: number; maximum: number } {
  if (model.startsWith("P1-")) return { minimum: 48, maximum: 20_000 };
  if (parameters.smartLowPoly === true && parameters.quad === true) {
    return { minimum: 500, maximum: 10_000 };
  }
  if (parameters.smartLowPoly === true) return { minimum: 1_000, maximum: 20_000 };
  if (parameters.quad === true) return { minimum: 1_000, maximum: 150_000 };
  if (!model.startsWith("v3.")) return { minimum: 1_000, maximum: 500_000 };
  return {
    minimum: 1_000,
    maximum: parameters.geometryQuality === "detailed" ? 2_000_000 : 1_500_000
  };
}

export function modelAdapterLabel(adapter: ProviderAdapterType | undefined): string {
  if (adapter === "meshy") return "Meshy";
  if (adapter === "hunyuan") return "混元";
  if (adapter === "tripo") return "Tripo";
  if (adapter === "stability-3d") return "Stability AI";
  if (adapter === "frostapi-3d") return "FrostAPI";
  return "";
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum &&
    value <= maximum;
}
