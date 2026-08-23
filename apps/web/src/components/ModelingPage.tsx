import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  AssetSnapshot,
  JobSnapshot,
  ModelOutputFormat,
  ProviderModelSnapshot,
  ProviderProfileSnapshot
} from "@lyra/contracts";
import { isMeshyGenerationModel } from "@lyra/contracts";
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
  const [inputMode, setInputModeState] = useState<"image" | "text">(
    () => pageStateRef.current.inputMode
  );
  const [prompt, setPromptState] = useState(() => pageStateRef.current.prompt);
  const [selectedImageId, setSelectedImageId] = useState(
    () => pageStateRef.current.selectedImageId
  );
  const [selectedTextureImageId, setSelectedTextureImageId] = useState(
    () => pageStateRef.current.selectedTextureImageId
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
  const usesMeshySettings = isMeshyGenerationModel(
    selectedProvider?.adapterType,
    selectedModel?.remoteModelId ?? ""
  );
  const supportsTextureImage = usesMeshySettings;
  const supportsTextInput = selectedProvider?.adapterType !== "stability-3d";
  const textureEnabled = parameters.texture !== false;
  const selectedInputImage = props.images.find((asset) => asset.id === selectedImageId);
  const selectedTextureImage = props.images.find(
    (asset) => asset.id === selectedTextureImageId
  );
  const glbAssets = [...props.modelAssets]
    .filter((asset) => asset.mimeType === "model/gltf-binary")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const selectedModelAsset = glbAssets.find(
    (asset) => asset.id === selectedModelAssetId
  ) ?? glbAssets[0] ?? null;
  const parameterError = validateModelParameters(
    selectedProvider?.adapterType,
    selectedModel?.remoteModelId ?? "",
    parameters,
    outputFormats
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

  function setInputMode(value: "image" | "text") {
    setInputModeState(value);
    pageStateRef.current.inputMode = value;
    persistPageState();
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
      const restoredParameters = usesMeshySettings
        ? {
            ...defaultModelParameters(
              selectedProvider.adapterType,
              selectedModel.remoteModelId
            ),
            ...existing.parameters
          }
        : existing.parameters;
      setParameters(structuredClone(restoredParameters));
      setOutputFormats([...existing.outputFormats]);
      return;
    }
    const defaults = defaultModelParameters(
      selectedProvider?.adapterType,
      selectedModel.remoteModelId
    );
    const formats: ModelOutputFormat[] =
      selectedProvider.adapterType === "tripo" ||
      selectedProvider.adapterType === "stability-3d" ||
      (selectedProvider.adapterType === "openai-compatible" && !usesMeshySettings)
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
  }, [selectedModel?.id, selectedModel?.remoteModelId, selectedProvider?.adapterType, usesMeshySettings]);

  useEffect(() => {
    if (!supportsTextInput && inputMode === "text") setInputMode("image");
  }, [inputMode, supportsTextInput]);

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
    await props.onGenerate({
      ...(inputMode === "image"
        ? { inputMode: "image" as const, imageAssetId: selectedImageId }
        : { inputMode: "text" as const, prompt: prompt.trim() }),
      ...(supportsTextureImage && selectedTextureImageId
        ? { textureImageAssetId: selectedTextureImageId }
        : {}),
      modelId: props.defaultModelId,
      outputFormats,
      parameters
    });
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
            prompt={prompt}
            provider={selectedProvider}
            model={selectedModel}
            parameters={parameters}
            outputFormats={outputFormats}
            parameterError={parameterError}
            modelsAvailable={props.models.length > 0}
            busy={props.busy}
            images={props.images}
            selectedInputImage={selectedInputImage}
            selectedTextureImage={selectedTextureImage}
            supportsTextureImage={supportsTextureImage}
            textureEnabled={textureEnabled}
            thumbnailUrl={props.thumbnailUrl}
            inputReady={inputMode === "image" ? Boolean(selectedImageId) : Boolean(prompt.trim())}
            onInputModeChange={setInputMode}
            onPromptChange={setPrompt}
            onImageSelect={selectImage}
            onTextureImageSelect={selectTextureImage}
            onClearImage={clearInputImage}
            onClearTextureImage={clearTextureImage}
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
