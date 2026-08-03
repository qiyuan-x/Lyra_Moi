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
  provider: ProviderProfileSnapshot | undefined;
  model: ProviderModelSnapshot | undefined;
  parameters: Record<string, unknown>;
  outputFormats: ModelOutputFormat[];
  parameterError: string | null;
  modelsAvailable: boolean;
  busy: boolean;
  hasInputImage: boolean;
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
  onClearTextureImage: () => void;
}

export function ModelGenerationPanel(props: ModelGenerationPanelProps) {
  return (
    <section className="modeling-config">
      <header>
        <strong>生成设置</strong>
        <span>{modelAdapterLabel(props.provider?.adapterType)}</span>
      </header>
      <ModelImageInputs
        images={props.images}
        selectedInputImage={props.selectedInputImage}
        selectedTextureImage={props.selectedTextureImage}
        supportsTextureImage={props.supportsTextureImage}
        textureEnabled={props.textureEnabled}
        thumbnailUrl={props.thumbnailUrl}
        onImageSelect={props.onImageSelect}
        onTextureImageSelect={props.onTextureImageSelect}
        onClearTextureImage={props.onClearTextureImage}
      />
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
            !props.hasInputImage ||
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
