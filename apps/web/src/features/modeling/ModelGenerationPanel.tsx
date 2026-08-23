import type {
  AssetSnapshot,
  ModelOutputFormat,
  ProviderModelSnapshot,
  ProviderProfileSnapshot
} from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import { modelAdapterLabel } from "./model-provider-config.js";
import { ModelProviderParameters } from "./ModelProviderParameters.js";
import { ModelImageInputs } from "./ModelImageInputs.js";

interface ModelGenerationPanelProps {
  inputMode: "image" | "text";
  supportsTextInput: boolean;
  prompt: string;
  provider: ProviderProfileSnapshot | undefined;
  model: ProviderModelSnapshot | undefined;
  parameters: Record<string, unknown>;
  outputFormats: ModelOutputFormat[];
  parameterError: string | null;
  modelsAvailable: boolean;
  busy: boolean;
  inputReady: boolean;
  images: AssetSnapshot[];
  selectedInputImage: AssetSnapshot | undefined;
  selectedTextureImage: AssetSnapshot | undefined;
  supportsTextureImage: boolean;
  textureEnabled: boolean;
  thumbnailUrl: (assetId: string) => string;
  onParametersChange: (value: Record<string, unknown>) => void;
  onOutputFormatsChange: (value: ModelOutputFormat[]) => void;
  onGenerate: () => Promise<void>;
  onOpenSettings: () => void;
  onImageSelect: (assetId: string) => void;
  onTextureImageSelect: (assetId: string) => void;
  onClearImage: () => void;
  onClearTextureImage: () => void;
  onUpload: (files: File[]) => Promise<AssetSnapshot[]>;
  onInputModeChange: (mode: "image" | "text") => void;
  onPromptChange: (value: string) => void;
}

export function ModelGenerationPanel(props: ModelGenerationPanelProps) {
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
          aria-selected={props.inputMode === "image"}
          className={props.inputMode === "image" ? "active" : ""}
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
      {props.inputMode === "text" && (
        <label className="field modeling-text-prompt">
          <span>模型描述 <em>*</em></span>
          <textarea
            rows={5}
            maxLength={1024}
            value={props.prompt}
            placeholder="描述需要生成的 3D 模型"
            onChange={(event) => props.onPromptChange(event.target.value)}
          />
          <small>{props.prompt.length}/1024</small>
        </label>
      )}
      {(props.inputMode === "image" || props.supportsTextureImage) && (
        <ModelImageInputs
          showModelInput={props.inputMode === "image"}
          images={props.images}
          selectedInputImage={props.selectedInputImage}
          selectedTextureImage={props.selectedTextureImage}
          supportsTextureImage={props.supportsTextureImage}
          textureEnabled={props.textureEnabled}
          thumbnailUrl={props.thumbnailUrl}
          onImageSelect={props.onImageSelect}
          onTextureImageSelect={props.onTextureImageSelect}
          onClearImage={props.onClearImage}
          onClearTextureImage={props.onClearTextureImage}
          onUpload={props.onUpload}
        />
      )}
      {props.provider && props.model && (
        <ModelProviderParameters
          adapter={props.provider.adapterType}
          remoteModelId={props.model.remoteModelId}
          parameters={props.parameters}
          outputFormats={props.outputFormats}
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
