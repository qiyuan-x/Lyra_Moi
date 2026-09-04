import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  AssetSnapshot,
  JobSnapshot,
  ModelInputMode,
  ModelOutputFormat,
  ModelViewType,
  MultiViewImageAssetIds,
  ProviderModelSnapshot,
  ProviderProfileSnapshot
} from "@lyra/contracts";
import {
  isHunyuan31ModelId,
  resolveModelGenerationAdapter
} from "@lyra/contracts";
import { ModelViewer } from "./ModelViewer.js";
import { ModelGenerationPanel } from "../features/modeling/ModelGenerationPanel.js";
import { ModelAssetList } from "../features/modeling/ModelAssetList.js";
import { ProviderModelSelects } from "../features/providers/ProviderModelSelects.js";
import {
  readPersistedModelingState,
  savePersistedModelingState,
  type ModelPageConfig,
  type PersistedModelingState
} from "../features/modeling/modeling-state.js";
import {
  defaultModelParameters,
  validateModelParameters
} from "../features/modeling/model-provider-config.js";

interface ModelingPageProps {
  projectId: string;
  images: AssetSnapshot[];
  models: ProviderModelSnapshot[];
  profiles: ProviderProfileSnapshot[];
  modelAssets: AssetSnapshot[];
  jobs: JobSnapshot[];
  initialModelAssetId?: string;
  defaultModelId: string;
  busy: boolean;
  thumbnailUrl: (assetId: string) => string;
  contentUrl: (assetId: string) => string;
  onUpload: (files: File[]) => Promise<AssetSnapshot[]>;
  onDefaultModelChange: (modelId: string) => void;
  onGenerate: (input: {
    textureImageAssetId?: string;
    modelId: string;
    outputFormats: ModelOutputFormat[];
    parameters: Record<string, unknown>;
  } & (
    | { inputMode: "image"; imageAssetId: string }
    | { inputMode: "text"; prompt: string }
    | { inputMode: "multiview"; multiViewImageAssetIds: MultiViewImageAssetIds }
  )) => Promise<void>;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onDeleteModel: (assetIds: string[]) => Promise<void>;
  onOpenSettings: () => void;
}

export function ModelingPage(props: ModelingPageProps) {
  const pageStateRef = useRef<PersistedModelingState>(
    readPersistedModelingState(props.projectId)
  );
  const [inputMode, setInputModeState] = useState<ModelInputMode>(
    () => pageStateRef.current.inputMode
  );
  const [prompt, setPromptState] = useState(() => pageStateRef.current.prompt);
  const [selectedImageId, setSelectedImageId] = useState(
    () => pageStateRef.current.selectedImageId
  );
  const [selectedTextureImageId, setSelectedTextureImageId] = useState(
    () => pageStateRef.current.selectedTextureImageId
  );
  const [selectedMultiViewImageIds, setSelectedMultiViewImageIds] = useState(
    () => pageStateRef.current.selectedMultiViewImageIds
  );
  const [selectedModelAssetId, setSelectedModelAssetId] = useState(
    () => props.initialModelAssetId ?? ""
  );
  const [modelListExpanded, setModelListExpanded] = useState(true);
  const [parameters, setParameters] = useState<Record<string, unknown>>({});
  const [outputFormats, setOutputFormats] = useState<ModelOutputFormat[]>(["glb"]);
  const modelConfigsRef = useRef<Record<string, ModelPageConfig>>(
    pageStateRef.current.modelConfigs
  );
  const modelJobs = useMemo(
    () => [...props.jobs]
      .filter((job) => job.kind === "model.generate")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [props.jobs]
  );
  const selectedModel = props.models.find((model) => model.id === props.defaultModelId);
  const selectedProvider = props.profiles.find(
    (profile) => profile.id === selectedModel?.providerProfileId
  );
  const providerOptions = props.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name
  }));
  const modelOptions = props.models.map((model) => ({
    id: model.id,
    providerId: model.providerProfileId,
    name: model.displayName
  }));
  const generationAdapter = resolveModelGenerationAdapter(
    selectedProvider?.adapterType,
    selectedModel?.remoteModelId ?? ""
  );
  const usesMeshySettings = generationAdapter === "meshy";
  const supportsTextureImage = usesMeshySettings;
  const usesTextureImageGuide = supportsTextureImage &&
    parameters.textureGuideMode === "image";
  const supportsTextInput = generationAdapter !== "stability-3d";
  const supportsMeshyMultiView = generationAdapter === "meshy" &&
    ["latest", "meshy-5", "meshy-6", "meshy-7"].includes(selectedModel?.remoteModelId ?? "");
  const supportsMultiView = supportsMeshyMultiView ||
    generationAdapter === "hunyuan" ||
    (generationAdapter === "tripo" &&
      !selectedModel?.remoteModelId.startsWith("Turbo-"));
  const minimumMultiViewImages = supportsMeshyMultiView ? 1 : 2;
  const multiViewOptions = useMemo(() => {
    const basic = [
      { view: "front" as const, label: "正面图", required: true },
      { view: "left" as const, label: "左面图" },
      { view: "back" as const, label: "背面图" },
      { view: "right" as const, label: "右面图" }
    ];
    return generationAdapter === "hunyuan" &&
      isHunyuan31ModelId(selectedModel?.remoteModelId ?? "")
      ? [
          ...basic,
          { view: "top" as const, label: "顶面图" },
          { view: "bottom" as const, label: "底面图" },
          { view: "leftFront" as const, label: "左前 45° 图" },
          { view: "rightFront" as const, label: "右前 45° 图" }
        ]
      : basic;
  }, [generationAdapter, selectedModel?.remoteModelId]);
  const textureEnabled = parameters.texture !== false;
  const selectedInputImage = props.images.find((asset) => asset.id === selectedImageId);
  const selectedTextureImage = props.images.find(
    (asset) => asset.id === selectedTextureImageId
  );
  const selectedMultiViewImages = useMemo(() => {
    const selected: Partial<Record<ModelViewType, AssetSnapshot>> = {};
    const allowedViews = new Set(multiViewOptions.map((option) => option.view));
    if (selectedInputImage) selected.front = selectedInputImage;
    for (const [view, assetId] of Object.entries(selectedMultiViewImageIds)) {
      if (!allowedViews.has(view as ModelViewType)) continue;
      const asset = props.images.find((candidate) => candidate.id === assetId);
      if (asset) selected[view as ModelViewType] = asset;
    }
    return selected;
  }, [multiViewOptions, props.images, selectedInputImage, selectedMultiViewImageIds]);
  const selectedMultiViewCount = Object.keys(selectedMultiViewImages).length;
  const multiViewInputReady = Boolean(selectedMultiViewImages.front) &&
    selectedMultiViewCount >= minimumMultiViewImages;
  const glbAssets = [...props.modelAssets]
    .filter((asset) => asset.mimeType === "model/gltf-binary")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const selectedModelAsset = glbAssets.find(
    (asset) => asset.id === selectedModelAssetId
  ) ?? glbAssets[0] ?? null;
  const providerParameterError = validateModelParameters(
    generationAdapter ?? undefined,
    selectedModel?.remoteModelId ?? "",
    parameters,
    outputFormats
  );
  const parameterError = selectedProvider?.adapterType === "frostapi-3d" && !generationAdapter
    ? "当前 FrostAPI 模型未匹配 Meshy、Tripo、混元或 Stability 3D。"
    : providerParameterError ?? (
    inputMode === "multiview" && !multiViewInputReady
      ? minimumMultiViewImages === 1
        ? "请选择正面图。"
        : "多视图生成至少需要正面图和另一张视图。"
      : usesMeshySettings && textureEnabled && parameters.textureGuideMode === "image" &&
      !selectedTextureImage
      ? "请选择纹理输入图。"
      : usesMeshySettings && textureEnabled && parameters.textureGuideMode === "text" &&
          !(typeof parameters.texturePrompt === "string" && parameters.texturePrompt.trim())
        ? "请输入纹理提示词。"
        : null
  );

  function persistPageState() {
    savePersistedModelingState(props.projectId, pageStateRef.current);
  }

  function selectImage(value: string) {
    setSelectedImageId(value);
    pageStateRef.current.selectedImageId = value;
    persistPageState();
  }

  function selectTextureImage(value: string) {
    setSelectedTextureImageId(value);
    pageStateRef.current.selectedTextureImageId = value;
    persistPageState();
  }

  function clearTextureImage() {
    selectTextureImage("");
  }

  function clearInputImage() {
    selectImage("");
  }

  function selectMultiViewImage(view: ModelViewType, value: string) {
    if (view === "front") {
      selectImage(value);
      return;
    }
    const next = { ...selectedMultiViewImageIds, [view]: value };
    setSelectedMultiViewImageIds(next);
    pageStateRef.current.selectedMultiViewImageIds = next;
    persistPageState();
  }

  function clearMultiViewImage(view: ModelViewType) {
    if (view === "front") {
      clearInputImage();
      return;
    }
    const next = { ...selectedMultiViewImageIds };
    delete next[view];
    setSelectedMultiViewImageIds(next);
    pageStateRef.current.selectedMultiViewImageIds = next;
    persistPageState();
  }

  function clearGenerationInputs() {
    clearInputImage();
    clearTextureImage();
    setSelectedMultiViewImageIds({});
    pageStateRef.current.selectedMultiViewImageIds = {};
    persistPageState();
  }

  function setInputMode(value: ModelInputMode) {
    setInputModeState(value);
    pageStateRef.current.inputMode = value;
    persistPageState();
    if (value === "multiview" && generationAdapter === "hunyuan") {
      updateParameters({ ...parameters, generateType: "Normal" });
    }
  }

  function setPrompt(value: string) {
    setPromptState(value);
    pageStateRef.current.prompt = value;
    persistPageState();
  }

  useEffect(() => {
    if (!selectedImageId) return;
    if (props.images.some((asset) => asset.id === selectedImageId)) return;
    clearInputImage();
  }, [props.images, selectedImageId]);

  useEffect(() => {
    if (
      !selectedTextureImageId ||
      props.images.some((asset) => asset.id === selectedTextureImageId)
    ) {
      return;
    }
    clearTextureImage();
  }, [props.images, selectedTextureImageId]);

  useEffect(() => {
    const availableIds = new Set(props.images.map((asset) => asset.id));
    const next = Object.fromEntries(Object.entries(selectedMultiViewImageIds).filter(
      ([, assetId]) => availableIds.has(assetId)
    ));
    if (Object.keys(next).length === Object.keys(selectedMultiViewImageIds).length) return;
    setSelectedMultiViewImageIds(next);
    pageStateRef.current.selectedMultiViewImageIds = next;
    persistPageState();
  }, [props.images, selectedMultiViewImageIds]);

  useEffect(() => {
    if (glbAssets.some((asset) => asset.id === selectedModelAssetId)) return;
    if (
      props.initialModelAssetId &&
      glbAssets.some((asset) => asset.id === props.initialModelAssetId)
    ) {
      setSelectedModelAssetId(props.initialModelAssetId);
      return;
    }
    setSelectedModelAssetId(glbAssets[0]?.id ?? "");
  }, [glbAssets, props.initialModelAssetId, selectedModelAssetId]);

  useEffect(() => {
    if (!selectedModel || !selectedProvider) {
      setParameters({});
      setOutputFormats(["glb"]);
      return;
    }
    const existing = modelConfigsRef.current[selectedModel.id];
    if (existing) {
      const defaults = defaultModelParameters(
        generationAdapter ?? undefined,
        selectedModel.remoteModelId
      );
      const legacyMeshyConfig = usesMeshySettings &&
        !("textureGuideMode" in existing.parameters);
      const restoredParameters = usesMeshySettings
        ? legacyMeshyConfig
          ? defaults
          : { ...defaults, ...existing.parameters }
        : existing.parameters;
      if (legacyMeshyConfig) {
        modelConfigsRef.current[selectedModel.id] = {
          parameters: restoredParameters,
          outputFormats: ["glb", "obj", "fbx", "stl", "usdz"]
        };
        pageStateRef.current.modelConfigs = modelConfigsRef.current;
        persistPageState();
      }
      setParameters(structuredClone(restoredParameters));
      setOutputFormats(legacyMeshyConfig
        ? ["glb", "obj", "fbx", "stl", "usdz"]
        : [...existing.outputFormats]);
      return;
    }
    const defaults = defaultModelParameters(
      generationAdapter ?? undefined,
      selectedModel.remoteModelId
    );
    const formats: ModelOutputFormat[] = usesMeshySettings
      ? ["glb", "obj", "fbx", "stl", "usdz"]
      : generationAdapter === "tripo" || generationAdapter === "stability-3d"
      ? ["glb"]
      : ["glb", "obj"];
    modelConfigsRef.current[selectedModel.id] = {
      parameters: defaults,
      outputFormats: formats
    };
    pageStateRef.current.modelConfigs = modelConfigsRef.current;
    persistPageState();
    setParameters(structuredClone(defaults));
    setOutputFormats([...formats]);
  }, [generationAdapter, selectedModel?.id, selectedModel?.remoteModelId, selectedProvider?.adapterType, usesMeshySettings]);

  useEffect(() => {
    if (!supportsTextInput && inputMode === "text") setInputMode("image");
    if (!supportsMultiView && inputMode === "multiview") setInputMode("image");
  }, [inputMode, supportsMultiView, supportsTextInput]);

  useEffect(() => {
    if (
      inputMode === "multiview" &&
      generationAdapter === "hunyuan" &&
      parameters.generateType !== "Normal"
    ) {
      updateParameters({ ...parameters, generateType: "Normal" });
    }
  }, [generationAdapter, inputMode, parameters.generateType]);

  function updateParameters(value: Record<string, unknown>) {
    setParameters(value);
    if (selectedModel) {
      const current = modelConfigsRef.current[selectedModel.id];
      modelConfigsRef.current[selectedModel.id] = {
        parameters: value,
        outputFormats: current?.outputFormats ?? outputFormats
      };
      pageStateRef.current.modelConfigs = modelConfigsRef.current;
      persistPageState();
    }
  }

  function updateOutputFormats(value: ModelOutputFormat[]) {
    setOutputFormats(value);
    if (selectedModel) {
      const current = modelConfigsRef.current[selectedModel.id];
      modelConfigsRef.current[selectedModel.id] = {
        parameters: current?.parameters ?? parameters,
        outputFormats: value
      };
      pageStateRef.current.modelConfigs = modelConfigsRef.current;
      persistPageState();
    }
  }

  async function generate() {
    if (!props.defaultModelId || !selectedProvider) return;
    if (inputMode === "image" && !selectedImageId) return;
    if (inputMode === "text" && !prompt.trim()) return;
    if (inputMode === "multiview" && !multiViewInputReady) return;
    const multiViewImageAssetIds = inputMode === "multiview"
      ? Object.fromEntries(Object.entries(selectedMultiViewImages).map(
          ([view, asset]) => [view, asset.id]
        )) as MultiViewImageAssetIds
      : null;
    await props.onGenerate({
      ...(inputMode === "image"
        ? { inputMode: "image" as const, imageAssetId: selectedImageId }
        : inputMode === "multiview"
          ? {
              inputMode: "multiview" as const,
              multiViewImageAssetIds: multiViewImageAssetIds!
            }
          : { inputMode: "text" as const, prompt: prompt.trim() }),
      ...(usesTextureImageGuide && selectedTextureImageId
        ? { textureImageAssetId: selectedTextureImageId }
        : {}),
      modelId: props.defaultModelId,
      outputFormats,
      parameters
    });
    clearGenerationInputs();
  }

  return (
    <section className="modeling-page">
      <header className="modeling-toolbar">
        <div>
          <strong>生成 3D 模型</strong>
          <span>支持图片生成和文字生成；网页使用 GLB 预览，其他格式可下载。</span>
        </div>
        <ProviderModelSelects
          className="modeling-model-picker"
          providers={providerOptions}
          models={modelOptions}
          modelId={props.defaultModelId}
          providerLabel="建模供应商"
          modelLabel="建模模型"
          onModelChange={props.onDefaultModelChange}
        />
      </header>

      <div className={`modeling-layout ${modelListExpanded ? "model-list-expanded" : "model-list-collapsed"}`}>
        <ModelAssetList
          assets={props.modelAssets}
          jobs={modelJobs}
          images={props.images}
          thumbnailUrl={props.thumbnailUrl}
          contentUrl={props.contentUrl}
          selectedAssetId={selectedModelAsset?.id ?? ""}
          expanded={modelListExpanded}
          onCancel={props.onCancel}
          onRetry={props.onRetry}
          onDismiss={props.onDismiss}
          onDeleteModel={props.onDeleteModel}
          onExpandedChange={setModelListExpanded}
          onSelect={setSelectedModelAssetId}
        />

        <main className="modeling-viewer-column">
          <ModelViewer
            asset={selectedModelAsset}
            contentUrl={selectedModelAsset ? props.contentUrl(selectedModelAsset.id) : ""}
          />
        </main>

        <aside className="modeling-settings-panel">
          <ModelGenerationPanel
            inputMode={inputMode}
            supportsTextInput={supportsTextInput}
            supportsMultiView={supportsMultiView}
            minimumMultiViewImages={minimumMultiViewImages}
            multiViewOptions={multiViewOptions}
            prompt={prompt}
            provider={selectedProvider}
            generationAdapter={generationAdapter}
            model={selectedModel}
            models={props.models}
            providerProfileId={selectedProvider?.id}
            onModelChange={props.onDefaultModelChange}
            parameters={parameters}
            outputFormats={outputFormats}
            parameterError={parameterError}
            modelsAvailable={props.models.length > 0}
            busy={props.busy}
            images={props.images}
            selectedInputImage={selectedInputImage}
            selectedTextureImage={selectedTextureImage}
            selectedMultiViewImages={selectedMultiViewImages}
            thumbnailUrl={props.thumbnailUrl}
            inputReady={inputMode === "image"
              ? Boolean(selectedImageId)
              : inputMode === "multiview"
                ? multiViewInputReady
                : Boolean(prompt.trim())}
            onInputModeChange={setInputMode}
            onPromptChange={setPrompt}
            onImageSelect={selectImage}
            onTextureImageSelect={selectTextureImage}
            onClearImage={clearInputImage}
            onClearTextureImage={clearTextureImage}
            onMultiViewImageSelect={selectMultiViewImage}
            onClearMultiViewImage={clearMultiViewImage}
            onUpload={props.onUpload}
            onParametersChange={updateParameters}
            onOutputFormatsChange={updateOutputFormats}
            onGenerate={generate}
            onOpenSettings={props.onOpenSettings}
          />
        </aside>
      </div>
    </section>
  );
}
