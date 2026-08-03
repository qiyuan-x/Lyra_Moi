export interface ProviderSelectOption {
  id: string;
  name: string;
}

export interface ModelSelectOption {
  id: string;
  providerId: string;
  name: string;
}

interface ProviderModelSelectsProps {
  providers: ProviderSelectOption[];
  models: ModelSelectOption[];
  modelId: string;
  onModelChange: (modelId: string) => void;
  providerLabel?: string;
  modelLabel?: string;
  className?: string;
  disabled?: boolean;
}

export function ProviderModelSelects(
  props: ProviderModelSelectsProps
) {
  const providers = props.providers.filter((provider) =>
    props.models.some((model) => model.providerId === provider.id)
  );
  const selectedModel = props.models.find(
    (model) => model.id === props.modelId
  );
  const selectedProviderId = selectedModel?.providerId
    ?? providers[0]?.id
    ?? "";
  const providerModels = props.models.filter(
    (model) => model.providerId === selectedProviderId
  );

  function changeProvider(providerId: string) {
    const nextModel = props.models.find(
      (model) => model.providerId === providerId
    );
    props.onModelChange(nextModel?.id ?? "");
  }

  return (
    <div className={`provider-model-selects${props.className ? ` ${props.className}` : ""}`}>
      <label className="field">
        <span>{props.providerLabel ?? "供应商"}</span>
        <select
          aria-label={props.providerLabel ?? "供应商"}
          value={selectedProviderId}
          title={providers.find((provider) => provider.id === selectedProviderId)?.name}
          disabled={props.disabled || providers.length === 0}
          onChange={(event) => changeProvider(event.target.value)}
        >
          {providers.length === 0 && <option value="">暂无可用供应商</option>}
          {providers.map((provider) => (
            <option value={provider.id} key={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{props.modelLabel ?? "模型"}</span>
        <select
          aria-label={props.modelLabel ?? "模型"}
          value={providerModels.some((model) => model.id === props.modelId)
            ? props.modelId
            : ""}
          title={selectedModel?.name}
          disabled={props.disabled || providerModels.length === 0}
          onChange={(event) => props.onModelChange(event.target.value)}
        >
          {providerModels.length === 0 && <option value="">暂无可用模型</option>}
          {providerModels.length > 0 && !selectedModel && (
            <option value="">请选择模型</option>
          )}
          {providerModels.map((model) => (
            <option value={model.id} key={model.id}>
              {model.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
