import type { ProviderPreset } from "./provider-presets.js";
import { Icon } from "../../components/Icon.js";

interface ProviderRowProps {
  menuOpen: boolean;
  name: string;
  shortName: string;
  presetId: ProviderPreset["id"];
  interfaceLabel: string;
  enabled: boolean;
  configured: boolean;
  modelCount: number;
  busy: boolean;
  onMenuToggle: () => void;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: (() => void) | undefined;
}

export function ProviderRow(props: ProviderRowProps) {
  return (
    <article className={props.configured ? "configured" : ""}>
      <div className="settings-provider-name">
        <span className={`preset-mark preset-${props.presetId}`}>{props.shortName}</span>
        <div>
          <strong title={props.name}>{props.name}</strong>
          <small>{props.configured ? "已配置" : "尚未配置"}</small>
        </div>
      </div>
      <span>{props.interfaceLabel}</span>
      <span>{props.modelCount} 个</span>
      <label className="switch">
        <input
          type="checkbox"
          checked={props.enabled}
          disabled={props.busy}
          onChange={props.onToggle}
        />
        <span />
      </label>
      <div className={`settings-provider-menu${props.menuOpen ? " open" : ""}`}>
        <button
          type="button"
          className="icon-button settings-provider-menu-trigger"
          aria-label={`管理 ${props.name}`}
          aria-expanded={props.menuOpen}
          title="供应商操作"
          onClick={props.onMenuToggle}
        >
          <Icon name="more" size={17} />
        </button>
        {props.menuOpen && (
          <div>
            <button type="button" onClick={props.onOpen}>
              {props.configured ? "修改配置" : "配置"}
            </button>
            {props.onDelete && (
              <button
                type="button"
                className="danger-menu-item"
                onClick={props.onDelete}
              >
                删除供应商
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
