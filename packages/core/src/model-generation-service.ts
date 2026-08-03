import type {
  GenerationSource,
  JobSnapshot,
  ManualModelGenerationRequestBody,
  ModelGenerationRequest,
  ModelOutputFormat
} from "@lyra/contracts";
import { parseManualModelGenerationRequest } from "@lyra/contracts";
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
    const image = this.#assets.requireStored(input.imageAssetId);
    if (image.projectId !== normalizedProjectId || image.kind !== "image") {
      throw new Error("Model input must be an image in the selected project.");
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
    if (textureImage && profile.adapterType !== "meshy") {
      throw new Error("Only Meshy supports a separate texture reference image.");
    }
    if (textureImage && input.parameters.texture === false) {
      throw new Error("Texture generation must be enabled to use a texture reference image.");
    }
    const request: ModelGenerationRequest = {
      projectId: normalizedProjectId,
      inputImageAssetId: image.id,
      ...(textureImage ? { textureImageAssetId: textureImage.id } : {}),
      providerProfileId: profile.id,
      providerModelId: model.id,
      outputFormats: normalizeOutputFormats(
        profile.adapterType,
        input.outputFormats,
        input.parameters
      ),
      parameters: structuredClone(input.parameters),
      source: options.source ?? "manual"
    };
    return this.#jobs.create({
      request,
      kind: "model.generate",
      conversationId: options.conversationId ?? null,
      agentRunId: options.agentRunId ?? null,
      agentStepId: options.agentStepId ?? null,
      requestMessageId: options.requestMessageId ?? null,
      title: `${image.name} · 生成 3D 模型`
    });
  }
}

function normalizeOutputFormats(
  adapterType: string,
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
  throw new Error("Selected model provider is not supported.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
