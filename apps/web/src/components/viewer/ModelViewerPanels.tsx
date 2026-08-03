import type {
  ViewerLighting,
  ViewerLightingSettings
} from "./model-viewer-types.js";
import {
  defaultViewerPreferences,
  type ViewerPreferences
} from "./viewer-preferences.js";
import { Icon } from "../Icon.js";

interface ViewerDisplayPanelProps {
  preferences: ViewerPreferences;
  onUpdate: (patch: Partial<ViewerPreferences>) => void;
}

export function ViewerDisplayPanel(props: ViewerDisplayPanelProps) {
  return (
    <>
      <header>显示设置</header>
      <ViewerToggle
        label="网格"
        checked={props.preferences.gridVisible}
        onChange={(value) => props.onUpdate({ gridVisible: value })}
      />
      <ViewerToggle
        label="统计信息"
        checked={props.preferences.statisticsVisible}
        onChange={(value) => props.onUpdate({ statisticsVisible: value })}
      />
      <ViewerToggle
        label="自动旋转"
        checked={props.preferences.autoRotate}
        onChange={(value) => props.onUpdate({ autoRotate: value })}
      />
      <ViewerToggle
        label="贴图"
        checked={props.preferences.textureVisible}
        onChange={(value) => props.onUpdate({ textureVisible: value })}
      />
      <ViewerRange
        label="垂直 FOV"
        value={props.preferences.fov}
        min={15}
        max={80}
        step={1}
        display={`${props.preferences.fov}°`}
        onChange={(value) => props.onUpdate({ fov: value })}
        onReset={() => props.onUpdate({
          fov: defaultViewerPreferences.fov
        })}
      />
      <ViewerRange
        label="整体曝光（画面后处理）"
        value={props.preferences.exposure}
        min={0.5}
        max={1.8}
        step={0.1}
        display={props.preferences.exposure.toFixed(1)}
        onChange={(value) => props.onUpdate({ exposure: value })}
        onReset={() => props.onUpdate({
          exposure: defaultViewerPreferences.exposure
        })}
      />
    </>
  );
}

interface ViewerLightingPanelProps {
  preferences: ViewerPreferences;
  lighting: ViewerLightingSettings;
  onModeChange: (mode: ViewerLighting) => void;
  onUpdate: (patch: Partial<ViewerLightingSettings>) => void;
}

export function ViewerLightingPanel(props: ViewerLightingPanelProps) {
  const lighting = props.lighting;
  const intensity = lighting.mode === "flat"
    ? lighting.ambientIntensity
    : lighting.keyIntensity;
  return (
    <>
      <header>光照设置</header>
      <label className="model-viewer-panel-select">
        <span>光照模式</span>
        <select
          value={props.preferences.lightingMode}
          onChange={(event) =>
            props.onModeChange(event.target.value as ViewerLighting)}
        >
          <option value="daylight">日光</option>
          <option value="studio">摄影棚</option>
          <option value="flat">均匀检查</option>
        </select>
      </label>
      <ViewerRange
        label={
          lighting.mode === "daylight"
            ? "太阳强度"
            : lighting.mode === "studio"
              ? "主光强度"
              : "均匀光强度"
        }
        value={intensity}
        min={0}
        max={5}
        step={0.1}
        display={intensity.toFixed(1)}
        onChange={(value) => props.onUpdate(
          lighting.mode === "flat"
            ? { ambientIntensity: value }
            : { keyIntensity: value }
        )}
        onReset={() => props.onUpdate(
          lighting.mode === "flat"
            ? {
                ambientIntensity:
                  defaultViewerPreferences.lighting.flat.ambientIntensity
              }
            : {
                keyIntensity:
                  defaultViewerPreferences.lighting[lighting.mode].keyIntensity
              }
        )}
      />
      {lighting.mode !== "flat" && (
        <>
          <ViewerRange
            label={
              lighting.mode === "daylight"
                ? "天空光强度"
                : "环境光强度"
            }
            value={lighting.ambientIntensity}
            min={0}
            max={2}
            step={0.05}
            display={lighting.ambientIntensity.toFixed(2)}
            onChange={(value) =>
              props.onUpdate({ ambientIntensity: value })}
            onReset={() => props.onUpdate({
              ambientIntensity:
                defaultViewerPreferences.lighting[lighting.mode]
                  .ambientIntensity
            })}
          />
          {lighting.mode === "studio" && (
            <ViewerRange
              label="补光强度"
              value={lighting.fillIntensity}
              min={0}
              max={3}
              step={0.1}
              display={lighting.fillIntensity.toFixed(1)}
              onChange={(value) =>
                props.onUpdate({ fillIntensity: value })}
              onReset={() => props.onUpdate({
                fillIntensity:
                  defaultViewerPreferences.lighting.studio.fillIntensity
              })}
            />
          )}
          <ViewerRange
            label="水平方向"
            value={lighting.azimuth}
            min={-180}
            max={180}
            step={1}
            display={`${lighting.azimuth}°`}
            onChange={(value) => props.onUpdate({ azimuth: value })}
            onReset={() => props.onUpdate({
              azimuth:
                defaultViewerPreferences.lighting[lighting.mode].azimuth
            })}
          />
          <ViewerRange
            label={
              lighting.mode === "daylight"
                ? "太阳高度"
                : "主光高度"
            }
            value={lighting.elevation}
            min={5}
            max={85}
            step={1}
            display={`${lighting.elevation}°`}
            onChange={(value) => props.onUpdate({ elevation: value })}
            onReset={() => props.onUpdate({
              elevation:
                defaultViewerPreferences.lighting[lighting.mode].elevation
            })}
          />
          <ViewerRange
            label="阴影强度"
            value={lighting.shadowIntensity}
            min={0}
            max={1}
            step={0.05}
            display={lighting.shadowIntensity.toFixed(2)}
            onChange={(value) =>
              props.onUpdate({ shadowIntensity: value })}
            onReset={() => props.onUpdate({
              shadowIntensity:
                defaultViewerPreferences.lighting[lighting.mode]
                  .shadowIntensity
            })}
          />
        </>
      )}
    </>
  );
}

function ViewerToggle(props: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="model-viewer-panel-toggle">
      <span>{props.label}</span>
      <span className="switch">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(event) => props.onChange(event.target.checked)}
        />
        <span />
      </span>
    </label>
  );
}

function ViewerRange(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
  onReset?: () => void;
}) {
  return (
    <label
      className={`model-viewer-panel-range${
        props.onReset ? " has-reset" : ""
      }`}
    >
      <span>{props.label}</span>
      <output>{props.display}</output>
      <input
        type="range"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(event) =>
          props.onChange(Number(event.target.value))}
      />
      {props.onReset && (
        <button
          type="button"
          title={`重置${props.label}`}
          onClick={props.onReset}
        >
          <Icon name="retry" size={13} />
        </button>
      )}
    </label>
  );
}
