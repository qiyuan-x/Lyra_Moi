import { useMemo, useState, type FormEvent } from "react";
import type {
  ProviderModelSnapshot,
  ProviderServiceType
} from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import { providerModelDisplayName } from "../providers/catalog-selectors.js";
import { serviceSettings } from "./provider-presets.js";

interface ModelListProps {
  models: ProviderModelSnapshot[];
  defaultId: string | null;
  onToggle: (model: ProviderModelSnapshot) => void;
  onEdit: (model: ProviderModelSnapshot) => void;
  onDelete: (model: ProviderModelSnapshot) => void;
}

export function ModelList(props: ModelListProps) {
  if (props.models.length === 0) {
    return <div className="model-list-empty">还没有配置此类模型。</div>;
  }
  return (
    <div className="service-model-list">
      {props.models.map((model) => (
        <div className="model-row" key={model.id}>
          <div>
            <strong title={providerModelDisplayName(model)}>
              {providerModelDisplayName(model)}
            </strong>
            <small title={model.remoteModelId}>
              {model.remoteModelId}
              {props.defaultId === model.id ? " · 默认" : ""}
            </small>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={model.enabled}
              onChange={() => props.onToggle(model)}
            />
            <span />
          </label>
          <button
            type="button"
            className="icon-button"
            onClick={() => props.onEdit(model)}
          >
            <Icon name="manual" size={14} />
          </button>
          <button
            type="button"
            className="icon-button danger-button"
            onClick={() => props.onDelete(model)}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export interface ModelFormValue {
  remoteModelId: string;
  displayName: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

interface ModelDialogProps {
  serviceType: ProviderServiceType;
  model: ProviderModelSnapshot;
  busy: boolean;
  onClose: () => void;
  onSave: (value: ModelFormValue) => Promise<void>;
}

export function ModelDialog(props: ModelDialogProps) {
  const [remoteModelId, setRemoteModelId] = useState(props.model.remoteModelId);
  const [displayName, setDisplayName] = useState(props.model.displayName);
  const [enabled, setEnabled] = useState(props.model.enabled);
  const [settingsText, setSettingsText] = useState(
    JSON.stringify(props.model.settings, null, 2)
  );
  const settings = useMemo(() => {
    try {
      const value: unknown = JSON.parse(settingsText);
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }, [settingsText]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!remoteModelId.trim() || !displayName.trim() || !settings) return;
    void props.onSave({
      remoteModelId: remoteModelId.trim(),
      displayName: displayName.trim(),
      enabled,
      settings
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <form
        className="form-modal provider-form-modal"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>编辑模型</strong>
            <span>{serviceSettings[props.serviceType].label}</span>
          </div>
          <button type="button" className="icon-button" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="form-body form-grid">
          <label className="field">
            <span>显示名称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label className="field">
            <span>远程模型 ID</span>
            <input
              value={remoteModelId}
              disabled
              onChange={(event) => setRemoteModelId(event.target.value)}
            />
          </label>
          <details className="advanced-settings form-wide">
            <summary>高级参数</summary>
            <label className="field">
              <span>JSON</span>
              <textarea
                value={settingsText}
                onChange={(event) => setSettingsText(event.target.value)}
                rows={5}
                className={settings ? "" : "invalid"}
              />
            </label>
          </details>
          <label className="checkbox-field form-wide">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            启用此模型
          </label>
        </div>
        <footer>
          <button
            type="button"
            className="button button-secondary"
            onClick={props.onClose}
          >
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={
              props.busy ||
              !remoteModelId.trim() ||
              !displayName.trim() ||
              !settings
            }
          >
            {props.busy ? "保存中" : "保存"}
          </button>
        </footer>
      </form>
    </div>
  );
}
