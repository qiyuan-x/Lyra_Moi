import { useState, type ComponentProps } from "react";
import { resolveModelGenerationAdapter, validateModelParameters, type ModelApprovalChanges, type ModelInputMode, type ModelOutputFormat } from "@lyra/contracts";
import { ModelApprovalDetails } from "./ModelApprovalDetails.js";
import { ModelProviderParameters } from "../features/modeling/ModelProviderParameters.js";
import type { ProviderCatalog } from "../lib/api-client.js";

export function ModelApprovalEditor(props: ComponentProps<typeof ModelApprovalDetails> & {
  catalog: ProviderCatalog;
  busy: boolean;
  onChange: (value: ModelApprovalChanges) => void;
}) {
  const [parameters, setParameters] = useState<Record<string, unknown>>(() => structuredClone(props.args.parameters as Record<string, unknown> ?? {}));
  const [formats, setFormats] = useState<ModelOutputFormat[]>(() => [...(props.args.outputFormats as ModelOutputFormat[] ?? ["glb"])]);
  const model = props.catalog.models.find((m) => m.id === props.args.providerModelId);
  const provider = props.catalog.profiles.find((p) => p.id === props.args.providerProfileId);
  const adapter = provider && model ? resolveModelGenerationAdapter(provider.adapterType, model.remoteModelId) : null;
  const error = validateModelParameters(adapter ?? undefined, model?.remoteModelId ?? "", parameters, formats);
  const texture = props.assets.get(String(props.args.textureImageAssetId ?? ""));
  function update(next: Record<string, unknown>, outputFormats = formats) {
    setParameters(next); setFormats(outputFormats);
    props.onChange({ parameters: structuredClone(next), outputFormats: [...outputFormats] });
  }
  return <div className="model-approval-editor">
    <ModelApprovalDetails {...props} summaryOnly args={{ ...props.args, parameters, outputFormats: formats }} />
    <p className="model-approval-note">参考图保持不变。可在下方修改生成设置，确认后按修改后的参数提交。</p>
    {provider && model && <fieldset disabled={props.busy} className="modeling-config model-approval-fields">
      <ModelProviderParameters lockSelection adapter={adapter} providerAdapter={provider.adapterType}
        remoteModelId={model.remoteModelId} inputMode={props.args.inputMode as ModelInputMode}
        parameters={parameters} outputFormats={formats} models={[model]} providerProfileId={provider.id}
        images={[]} selectedTextureImage={texture} thumbnailUrl={props.thumbnailUrl}
        onModelChange={() => {}} onTextureImageSelect={() => {}} onClearTextureImage={() => {}} onUpload={async () => []}
        onParametersChange={(next) => update(next)} onOutputFormatsChange={(next) => update(parameters, next)} />
    </fieldset>}
    {error && <p className="inline-error">{error}</p>}
  </div>;
}
