import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import type {
  ModelSelectOption,
  ProviderSelectOption
} from "./ProviderModelSelects.js";

type ServiceType = "image" | "model";

interface ServiceModelOptions {
  providers: ProviderSelectOption[];
  models: ModelSelectOption[];
  modelId: string;
  onModelChange: (modelId: string) => void;
}

interface ConversationModelSelectorsProps {
  image: ServiceModelOptions;
  model: ServiceModelOptions;
}

export function ConversationModelSelectors(
  props: ConversationModelSelectorsProps
) {
  const [openService, setOpenService] = useState<ServiceType | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openService) return;
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !containerRef.current?.contains(event.target)
      ) {
        setOpenService(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenService(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openService]);

  return (
    <div className="conversation-model-selectors" ref={containerRef}>
      <ServiceModelPicker
        service="image"
        label="生图"
        icon="image"
        options={props.image}
        open={openService === "image"}
        onToggle={() => setOpenService((current) => current === "image" ? null : "image")}
      />
      <ServiceModelPicker
        service="model"
        label="建模"
        icon="cube"
        options={props.model}
        open={openService === "model"}
        onToggle={() => setOpenService((current) => current === "model" ? null : "model")}
      />
    </div>
  );
}

function ServiceModelPicker(props: {
  service: ServiceType;
  label: string;
  icon: "image" | "cube";
  options: ServiceModelOptions;
  open: boolean;
  onToggle: () => void;
}) {
  const providers = props.options.providers.filter((provider) =>
    props.options.models.some((model) => model.providerId === provider.id)
  );
  const selectedModel = props.options.models.find(
    (model) => model.id === props.options.modelId
  );
  const selectedProviderId = selectedModel?.providerId ?? providers[0]?.id ?? "";
  const selectedProvider = providers.find(
    (provider) => provider.id === selectedProviderId
  );
  const providerModels = props.options.models.filter(
    (model) => model.providerId === selectedProviderId
  );
  const available = providers.length > 0;

  function changeProvider(providerId: string) {
    const firstModel = props.options.models.find(
      (model) => model.providerId === providerId
    );
    props.options.onModelChange(firstModel?.id ?? "");
  }

  return (
    <div className="conversation-service-picker">
      <button
        type="button"
        className="conversation-service-trigger"
        aria-haspopup="dialog"
        aria-expanded={props.open}
        aria-label={`选择${props.label}供应商和模型`}
        title={`${selectedProvider?.name ?? "未配置供应商"} / ${selectedModel?.name ?? "未配置模型"}`}
        onClick={props.onToggle}
      >
        <Icon name={props.icon} size={15} />
        <span>
          <small>{props.label}</small>
          <strong>{selectedModel?.name ?? "未配置模型"}</strong>
        </span>
        <Icon name="chevron" size={13} />
      </button>

      {props.open && (
        <div
          className="conversation-service-menu"
          role="dialog"
          aria-label={`${props.label}供应商和模型`}
        >
          <header>
            <Icon name={props.icon} size={15} />
            <strong>{props.label}设置</strong>
          </header>
          <label className="field">
            <span>供应商</span>
            <select
              aria-label={`${props.label}供应商`}
              value={selectedProviderId}
              disabled={!available}
              onChange={(event) => changeProvider(event.target.value)}
            >
              {!available && <option value="">暂无可用供应商</option>}
              {providers.map((provider) => (
                <option value={provider.id} key={provider.id}>{provider.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>模型</span>
            <select
              aria-label={`${props.label}模型`}
              value={providerModels.some((model) => model.id === props.options.modelId)
                ? props.options.modelId
                : ""}
              disabled={providerModels.length === 0}
              onChange={(event) => props.options.onModelChange(event.target.value)}
            >
              {providerModels.length === 0 && <option value="">暂无可用模型</option>}
              {providerModels.length > 0 && !selectedModel && (
                <option value="">请选择模型</option>
              )}
              {providerModels.map((model) => (
                <option value={model.id} key={model.id}>{model.name}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
