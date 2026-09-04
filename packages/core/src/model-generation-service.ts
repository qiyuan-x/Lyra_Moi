import type {
  GenerationSource,
  JobSnapshot,
  ManualModelGenerationRequestBody,
  ModelGenerationRequest,
  ModelOutputFormat,
  MultiViewImageAssetIds,
  ModelGenerationAdapterType
} from "@lyra/contracts";
import {
  isHunyuan31ModelId,
  isMultiViewToModelGenerationRequest,
  resolveModelGenerationAdapter,
  parseManualModelGenerationRequest
} from "@lyra/contracts";
import type {
  AssetRepository,
  JobRepository,
  ProjectRepository,
  ProviderRepository
} from "@lyra/storage";

export interface ModelGenerationSubmitOptions {
  source?: GenerationSource;
  conversationId?: string | null;
  agentRunId?: string | null;
  agentStepId?: string | null;
  requestMessageId?: string | null;
}

export interface ModelGenerationServiceOptions {
  projects: ProjectRepository;
  assets: AssetRepository;
  providers: ProviderRepository;
  jobs: JobRepository;
}

export class ModelGenerationService {
  readonly #projects: ProjectRepository;
  readonly #assets: AssetRepository;
  readonly #providers: ProviderRepository;
  readonly #jobs: JobRepository;

  constructor(options: ModelGenerationServiceOptions) {
    this.#projects = options.projects;
    this.#assets = options.assets;
    this.#providers = options.providers;
    this.#jobs = options.jobs;
  }

  submit(
    projectId: string,
    value: unknown,
    options: ModelGenerationSubmitOptions = {}
  ): JobSnapshot {
    const normalizedProjectId = projectId.trim();
    const input = parseManualModelGenerationRequest({
      ...(isRecord(value) ? value : {}),
      projectId: normalizedProjectId
    });
    const project = this.#projects.findById(normalizedProjectId);
    if (!project || project.deletedAt !== null) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const image = input.inputMode === "image"
      ? this.#assets.requireStored(input.imageAssetId)
      : null;
    if (
      image &&
      (image.projectId !== normalizedProjectId || image.kind !== "image")
    ) {
      throw new Error("Model input must be an image in the selected project.");
    }
    const prompt = input.inputMode === "text" ? input.prompt.trim() : null;
    if (input.inputMode === "text" && !prompt) {
      throw new Error("Text-to-model prompt is required.");
    }
    const multiViewImages = input.inputMode === "multiview"
      ? Object.fromEntries(Object.entries(input.multiViewImageAssetIds).map(([view, assetId]) => [
          view,
          this.#assets.requireStored(assetId)
        ]))
      : null;
    if (multiViewImages) {
      for (const asset of Object.values(multiViewImages)) {
        if (asset.projectId !== normalizedProjectId || asset.kind !== "image") {
          throw new Error("Multi-view inputs must be images in the selected project.");
        }
      }
    }
    const textureImage = input.textureImageAssetId
      ? this.#assets.requireStored(input.textureImageAssetId)
      : null;
    if (
      textureImage &&
      (textureImage.projectId !== normalizedProjectId || textureImage.kind !== "image")
    ) {
      throw new Error("Texture input must be an image in the selected project.");
    }
    const profile = this.#providers.requireProfile(input.providerProfileId);
    const model = this.#providers.requireModel(input.providerModelId);
    if (
      !profile.enabled ||
      !model.enabled ||
      profile.serviceType !== "model" ||
      model.serviceType !== "model" ||
      model.providerProfileId !== profile.id
    ) {
      throw new Error("Selected model provider is not available.");
    }
    const generationAdapter = resolveModelGenerationAdapter(
      profile.adapterType,
      model.remoteModelId
    );
    if (!generationAdapter) {
      throw new Error("Selected model is not supported by its modeling provider.");
    }
    if (input.inputMode === "text" && generationAdapter === "stability-3d") {
      throw new Error("The selected Stability AI 3D model requires an image input.");
    }
    if (input.inputMode === "multiview") {
      validateMultiViewProvider(
        generationAdapter,
        model.remoteModelId,
        input.multiViewImageAssetIds
      );
    }
    if (
      textureImage &&
      generationAdapter !== "meshy"
    ) {
      throw new Error("Only Meshy supports a separate texture reference image.");
    }
    if (textureImage && input.parameters.texture === false) {
      throw new Error("Texture generation must be enabled to use a texture reference image.");
    }
    const commonRequest = {
      projectId: normalizedProjectId,
      ...(textureImage ? { textureImageAssetId: textureImage.id } : {}),
      providerProfileId: profile.id,
      providerModelId: model.id,
      outputFormats: normalizeOutputFormats(
        generationAdapter,
        model.remoteModelId,
        input.outputFormats,
        input.parameters
      ),
      parameters: structuredClone(input.parameters),
      source: options.source ?? "manual"
    };
    const request: ModelGenerationRequest = input.inputMode === "text"
      ? {
          ...commonRequest,
          inputMode: "text",
          prompt: prompt!
        }
      : input.inputMode === "multiview"
        ? {
            ...commonRequest,
            inputMode: "multiview",
            multiViewImageAssetIds: structuredClone(input.multiViewImageAssetIds)
          }
        : {
          ...commonRequest,
          inputMode: "image",
          inputImageAssetId: image!.id
        };
    return this.#jobs.create({
      request,
      kind: "model.generate",
      conversationId: options.conversationId ?? null,
      agentRunId: options.agentRunId ?? null,
      agentStepId: options.agentStepId ?? null,
      requestMessageId: options.requestMessageId ?? null,
      title: input.inputMode === "text"
        ? `${prompt!.slice(0, 40)} · 文字生成 3D 模型`
        : isMultiViewToModelGenerationRequest(request)
          ? `${multiViewImages!.front!.name} 等 ${Object.keys(multiViewImages!).length} 张 · 多视图生成 3D 模型`
          : `${image!.name} · 生成 3D 模型`
    });
  }
}

function validateMultiViewProvider(
  adapterType: ModelGenerationAdapterType,
  remoteModelId: string,
  images: MultiViewImageAssetIds
): void {
  const views = Object.keys(images);
  if (adapterType === "meshy") {
    if (!["latest", "meshy-5", "meshy-6", "meshy-7"].includes(remoteModelId)) {
      throw new Error("当前 Meshy 模型不支持多图生成。");
    }
    if (views.length > 4 || views.some((view) => !["front", "left", "back", "right"].includes(view))) {
      throw new Error("Meshy 多图生成最多支持正面、左面、背面和右面四张图片。");
    }
    return;
  }
  if (views.length < 2) throw new Error("多视图生成至少需要正面图和另一张视图。");
  if (adapterType === "tripo") {
    if (remoteModelId.startsWith("Turbo-")) {
      throw new Error("当前 Tripo Turbo 模型不支持多视图生成。");
    }
    if (views.some((view) => !["front", "left", "back", "right"].includes(view))) {
      throw new Error("Tripo 多视图仅支持正面、左面、背面和右面。");
    }
    return;
  }
  if (adapterType === "hunyuan") {
    if (
      !isHunyuan31ModelId(remoteModelId) &&
      views.some((view) => ["top", "bottom", "leftFront", "rightFront"].includes(view))
    ) {
      throw new Error("混元 3.0 不支持顶面、底面和前侧 45° 视图。");
    }
    return;
  }
  throw new Error("当前建模供应商不支持多视图生成。");
}

function normalizeOutputFormats(
  adapterType: ModelGenerationAdapterType,
  remoteModelId: string,
  formats: readonly ModelOutputFormat[],
  parameters: Record<string, unknown>
): ModelOutputFormat[] {
  const requested = [...new Set(formats)];
  if (adapterType === "meshy") {
    return [...new Set<ModelOutputFormat>(["glb", ...requested])];
  }
  if (adapterType === "tripo") {
    const supported = new Set<ModelOutputFormat>([
      "glb",
      "obj",
      "fbx",
      "stl",
      "usdz",
      "3mf"
    ]);
    if (requested.some((format) => !supported.has(format))) {
      throw new Error("Tripo 不支持所选输出格式。");
    }
    return [...new Set<ModelOutputFormat>(["glb", ...requested])];
  }
  if (adapterType === "hunyuan") {
    const custom = requested.filter((format) =>
      (["fbx", "stl", "usdz"] as ModelOutputFormat[]).includes(format)
    );
    if (custom.length > 0) {
      if (requested.length !== 1 || custom.length !== 1) {
        throw new Error("混元的 FBX、STL、USDZ 每次任务只能选择一种输出格式。");
      }
      return custom;
    }
    if (requested.some((format) => format !== "glb" && format !== "obj")) {
      throw new Error("混元不支持所选输出格式。");
    }
    return parameters.generateType === "Geometry" ? ["glb"] : ["glb", "obj"];
  }
  if (adapterType === "stability-3d") {
    if (requested.some((format) => format !== "glb")) {
      throw new Error("Stability AI 3D 仅支持 GLB 输出。");
    }
    return ["glb"];
  }
  throw new Error("Selected model provider is not supported.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
