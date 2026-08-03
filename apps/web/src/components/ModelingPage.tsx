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
import { ModelViewer } from "./ModelViewer.js";
import { ModelGenerationPanel } from "../features/modeling/ModelGenerationPanel.js";
import { ModelAssetList } from "../features/modeling/ModelAssetList.js";
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
  defaultModelId: string;
  busy: boolean;
  thumbnailUrl: (assetId: string) => string;
  contentUrl: (assetId: string) => string;
  onDefaultModelChange: (modelId: string) => void;
  onGenerate: (input: {
    imageAssetId: string;
    textureImageAssetId?: string;
    modelId: string;
    outputFormats: ModelOutputFormat[];
    parameters: Record<string, unknown>;
  }) => Promise<void>;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onOpenSettings: () => void;
}

export function ModelingPage(props: ModelingPageProps) {
  const pageStateRef = useRef<PersistedModelingState>(
    readPersistedModelingState(props.projectId)
  );
  const [selectedImageId, setSelectedImageId] = useState(
    () => pageStateRef.current.selectedImageId
  );
  const [selectedTextureImageId, setSelectedTextureImageId] = useState(
    () => pageStateRef.current.selectedTextureImageId
  );
  const [selectedModelAssetId, setSelectedModelAssetId] = useState("");
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
  const selectedModelLabel = selectedModel
    ? `${selectedProvider?.name ?? "未配置供应商"} / ${selectedModel.displayName}`
    : undefined;
  const supportsTextureImage = selectedProvider?.adapterType === "meshy";
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

  useEffect(() => {
    if (props.images.some((asset) => asset.id === selectedImageId)) return;
    const preferred = props.images.find((asset) => asset.source === "generated")
      ?? props.images[0];
    selectImage(preferred?.id ?? "");
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
    setSelectedModelAssetId(glbAssets[0]?.id ?? "");
  }, [glbAssets, selectedModelAssetId]);

  useEffect(() => {
    if (!selectedModel || !selectedProvider) {
      setParameters({});
      setOutputFormats(["glb"]);
      return;
    }
    const existing = modelConfigsRef.current[selectedModel.id];
    if (existing) {
      setParameters(structuredClone(existing.parameters));
      setOutputFormats([...existing.outputFormats]);
      return;
    }
    const defaults = defaultModelParameters(
      selectedProvider?.adapterType,
      selectedModel.remoteModelId
    );
    const formats: ModelOutputFormat[] = selectedProvider.adapterType === "tripo"
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
  }, [selectedModel?.id, selectedModel?.remoteModelId, selectedProvider?.adapterType]);

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
    if (!selectedImageId || !props.defaultModelId || !selectedProvider) return;
    await props.onGenerate({
      imageAssetId: selectedImageId,
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
          <strong>图片生成 3D 模型</strong>
          <span>输入仅来自当前项目图片；网页用 GLB 查看，原始导出格式单独保存。</span>
        </div>
        <label className="field modeling-model-picker">
          <span>建模模型 <em>*</em></span>
          <select
            value={props.defaultModelId}
            title={selectedModelLabel}
            onChange={(event) => props.onDefaultModelChange(event.target.value)}
          >
            {props.models.length === 0 && <option value="">请先配置建模供应商</option>}
            {props.models.map((model) => (
              <option value={model.id} key={model.id}>
                {props.profiles.find((profile) => profile.id === model.providerProfileId)?.name}
                {" / "}{model.displayName}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="modeling-layout">
        <ModelAssetList
          assets={props.modelAssets}
          jobs={modelJobs}
          images={props.images}
          thumbnailUrl={props.thumbnailUrl}
          contentUrl={props.contentUrl}
          selectedAssetId={selectedModelAsset?.id ?? ""}
          onCancel={props.onCancel}
          onRetry={props.onRetry}
          onDismiss={props.onDismiss}
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
            hasInputImage={Boolean(selectedImageId)}
            onImageSelect={selectImage}
            onTextureImageSelect={selectTextureImage}
            onClearTextureImage={clearTextureImage}
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
