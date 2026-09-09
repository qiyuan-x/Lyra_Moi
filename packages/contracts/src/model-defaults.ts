import { isMeshyGenerationModel } from "./model-generation.js";
import type { ProviderAdapterType } from "./provider.js";

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

export function defaultModelOutputFormats(
  adapter: ProviderAdapterType | undefined, model: string
): import("./model-generation.js").ModelOutputFormat[] {
  if (isMeshyGenerationModel(adapter, model)) return ["glb", "obj", "fbx", "stl", "usdz"];
  return !adapter || adapter === "tripo" || adapter === "stability-3d" ? ["glb"] : ["glb", "obj"];
}
