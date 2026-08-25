import { Icon } from "../../components/Icon.js";
import {
  adapterLabel,
  type ProviderPreset
} from "./provider-presets.js";

interface ProviderPickerDialogProps {
  presets: ProviderPreset[];
  onClose: () => void;
  onSelectPreset: (preset: ProviderPreset) => void;
  onSelectCustom: () => void;
}

export function ProviderPickerDialog(props: ProviderPickerDialogProps) {
  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <section
        className="form-modal provider-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong id="provider-picker-title">添加供应商</strong>
            <span>选择预设，或添加 OpenAI 兼容连接。</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="form-body provider-picker-list">
          {props.presets.map((preset) => (
            <button
              type="button"
              className="provider-picker-item"
              key={preset.id}
              onClick={() => props.onSelectPreset(preset)}
            >
              <span className={`preset-mark preset-${preset.id}`}>{preset.shortName}</span>
              <span>
                <strong>{preset.name}</strong>
                <small>{adapterLabel(preset.adapterType)}</small>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
          <button
            type="button"
            className="provider-picker-item"
            onClick={props.onSelectCustom}
          >
            <span className="preset-mark preset-custom">API</span>
            <span>
              <strong>自定义连接</strong>
              <small>OpenAI 兼容</small>
            </span>
            <Icon name="chevron" size={16} />
          </button>
        </div>
      </section>
    </div>
  );
}
