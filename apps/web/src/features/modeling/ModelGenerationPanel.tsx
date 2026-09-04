import type {
  AssetSnapshot,
  ModelInputMode,
  ModelGenerationAdapterType,
  ModelOutputFormat,
  ModelViewType,
  ProviderModelSnapshot,
  ProviderProfileSnapshot
} from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import { modelAdapterLabel } from "./model-provider-config.js";
import { ModelProviderParameters } from "./ModelProviderParameters.js";
import { ModelImageInputs } from "./ModelImageInputs.js";
import {
  ModelMultiViewInputs,
  type ModelViewOption
} from "./ModelMultiViewInputs.js";

interface ModelGenerationPanelProps {
  inputMode: ModelInputMode;
  supportsTextInput: boolean;
  supportsMultiView: boolean;
  minimumMultiViewImages: number;
  multiViewOptions: ModelViewOption[];
  prompt: string;
  provider: ProviderProfileSnapshot | undefined;
  generationAdapter: ModelGenerationAdapterType | null;
  model: ProviderModelSnapshot | undefined;
  models: ProviderModelSnapshot[];
  providerProfileId: string | undefined;
  onModelChange: (modelId: string) => void;
  parameters: Record<string, unknown>;
  outputFormats: ModelOutputFormat[];
  parameterError: string | null;
  modelsAvailable: boolean;
  busy: boolean;
  inputReady: boolean;
  images: AssetSnapshot[];
  selectedInputImage: AssetSnapshot | undefined;
  selectedTextureImage: AssetSnapshot | undefined;
  selectedMultiViewImages: Partial<Record<ModelViewType, AssetSnapshot>>;
  thumbnailUrl: (assetId: string) => string;
  onParametersChange: (value: Record<string, unknown>) => void;
  onOutputFormatsChange: (value: ModelOutputFormat[]) => void;
  onGenerate: () => Promise<void>;
  onOpenSettings: () => void;
  onImageSelect: (assetId: string) => void;
  onTextureImageSelect: (assetId: string) => void;
  onClearImage: () => void;
  onClearTextureImage: () => void;
  onMultiViewImageSelect: (view: ModelViewType, assetId: string) => void;
  onClearMultiViewImage: (view: ModelViewType) => void;
  onUpload: (files: File[]) => Promise<AssetSnapshot[]>;
  onInputModeChange: (mode: ModelInputMode) => void;
  onPromptChange: (value: string) => void;
}

export function ModelGenerationPanel(props: ModelGenerationPanelProps) {
  const promptLimit = props.generationAdapter === "meshy" ? 600 : 1024;
  const imageMode = props.inputMode === "image" || props.inputMode === "multiview";
  return (
    <section className="modeling-config">
      <header>
        <strong>生成设置</strong>
        <span>{modelAdapterLabel(props.provider?.adapterType)}</span>
      </header>
      <div className="modeling-input-mode" role="tablist" aria-label="建模输入方式">
        <button
          type="button"
          role="tab"
          aria-selected={imageMode}
          className={imageMode ? "active" : ""}
          onClick={() => props.onInputModeChange("image")}
        >
          图片生成
        </button>
        {props.supportsTextInput && (
          <button
            type="button"
            role="tab"
            aria-selected={props.inputMode === "text"}
            className={props.inputMode === "text" ? "active" : ""}
            onClick={() => props.onInputModeChange("text")}
          >
            文字生成
          </button>
        )}
      </div>
      {imageMode && props.supportsMultiView && (
        <div className="modeling-input-mode modeling-input-mode-secondary" role="tablist" aria-label="图片生成方式">
          <button
            type="button"
            role="tab"
            aria-selected={props.inputMode === "image"}
            className={props.inputMode === "image" ? "active" : ""}
            onClick={() => props.onInputModeChange("image")}
          >
            单参考图生成
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={props.inputMode === "multiview"}
            className={props.inputMode === "multiview" ? "active" : ""}
            onClick={() => props.onInputModeChange("multiview")}
          >
            多参考图生成
          </button>
        </div>
      )}
      {props.inputMode === "text" && (
        <label className="field modeling-text-prompt">
          <span>模型描述 <em>*</em></span>
          <textarea
            rows={5}
            maxLength={promptLimit}
            value={props.prompt}
            placeholder="描述需要生成的 3D 模型"
            onChange={(event) => props.onPromptChange(event.target.value)}
          />
          <small>{props.prompt.length}/{promptLimit}</small>
        </label>
      )}
      {props.inputMode === "image" && (
        <ModelImageInputs
          showModelInput
          images={props.images}
          selectedInputImage={props.selectedInputImage}
          selectedTextureImage={undefined}
          supportsTextureImage={false}
          textureEnabled={false}
          thumbnailUrl={props.thumbnailUrl}
          onImageSelect={props.onImageSelect}
          onTextureImageSelect={() => undefined}
          onClearImage={props.onClearImage}
          onClearTextureImage={() => undefined}
          onUpload={props.onUpload}
        />
      )}
      {props.inputMode === "multiview" && (
        <ModelMultiViewInputs
          views={props.multiViewOptions}
          minimumImages={props.minimumMultiViewImages}
          images={props.images}
          selected={props.selectedMultiViewImages}
          thumbnailUrl={props.thumbnailUrl}
          onSelect={props.onMultiViewImageSelect}
          onClear={props.onClearMultiViewImage}
          onUpload={props.onUpload}
        />
      )}
      {props.provider && props.model && (
        <ModelProviderParameters
          adapter={props.generationAdapter}
          providerAdapter={props.provider.adapterType}
          remoteModelId={props.model.remoteModelId}
          inputMode={props.inputMode}
          parameters={props.parameters}
          outputFormats={props.outputFormats}
          models={props.models}
          providerProfileId={props.providerProfileId}
          images={props.images}
          selectedTextureImage={props.selectedTextureImage}
          thumbnailUrl={props.thumbnailUrl}
          onModelChange={props.onModelChange}
          onTextureImageSelect={props.onTextureImageSelect}
          onClearTextureImage={props.onClearTextureImage}
          onUpload={props.onUpload}
          onParametersChange={props.onParametersChange}
          onOutputFormatsChange={props.onOutputFormatsChange}
        />
      )}
      {props.parameterError && (
        <p className="modeling-config-error">{props.parameterError}</p>
      )}
      {!props.modelsAvailable ? (
        <button
          type="button"
          className="button button-primary"
          onClick={props.onOpenSettings}
        >
          前往 AI 建模设置
        </button>
      ) : (
        <button
          type="button"
          className="button button-primary"
          disabled={
            props.busy ||
            !props.inputReady ||
            Boolean(props.parameterError)
          }
          onClick={() => void props.onGenerate()}
        >
          <Icon name="cube" size={16} />
          {props.busy ? "正在提交" : "生成模型"}
        </button>
      )}
    </section>
  );
}
