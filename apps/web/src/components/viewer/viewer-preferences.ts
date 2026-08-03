import type {
  ViewerLighting,
  ViewerLightingSettings
} from "./model-viewer-types.js";

export type ViewerPreferences = {
  autoRotate: boolean;
  gridVisible: boolean;
  statisticsVisible: boolean;
  topologyVisible: boolean;
  textureVisible: boolean;
  fov: number;
  exposure: number;
  lightingMode: ViewerLighting;
  lighting: Record<ViewerLighting, ViewerLightingSettings>;
};

const storageKey = "lyra.modelViewerPreferences.v2";

export const defaultViewerPreferences: ViewerPreferences = {
  autoRotate: false,
  gridVisible: false,
  statisticsVisible: true,
  topologyVisible: false,
  textureVisible: true,
  fov: 35,
  exposure: 1,
  lightingMode: "daylight",
  lighting: {
    daylight: {
      mode: "daylight",
      keyIntensity: 1.35,
      ambientIntensity: 0.4,
      fillIntensity: 0,
      azimuth: 35,
      elevation: 48,
      shadowIntensity: 0.45
    },
    studio: {
      mode: "studio",
      keyIntensity: 1.8,
      ambientIntensity: 0.3,
      fillIntensity: 0.7,
      azimuth: 35,
      elevation: 42,
      shadowIntensity: 0.35
    },
    flat: {
      mode: "flat",
      keyIntensity: 0,
      ambientIntensity: 1.4,
      fillIntensity: 0,
      azimuth: 0,
      elevation: 60,
      shadowIntensity: 0
    }
  }
};

export function readViewerPreferences(): ViewerPreferences {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return structuredClone(defaultViewerPreferences);
  try {
    const value = JSON.parse(raw) as Partial<ViewerPreferences>;
    const lightingMode = isLightingMode(value.lightingMode)
      ? value.lightingMode
      : defaultViewerPreferences.lightingMode;
    return {
      autoRotate: value.autoRotate ?? defaultViewerPreferences.autoRotate,
      gridVisible: value.gridVisible ?? defaultViewerPreferences.gridVisible,
      statisticsVisible:
        value.statisticsVisible ?? defaultViewerPreferences.statisticsVisible,
      topologyVisible:
        value.topologyVisible ?? defaultViewerPreferences.topologyVisible,
      textureVisible: value.textureVisible ?? defaultViewerPreferences.textureVisible,
      fov: numberOr(value.fov, defaultViewerPreferences.fov),
      exposure: numberOr(value.exposure, defaultViewerPreferences.exposure),
      lightingMode,
      lighting: {
        daylight: mergeLighting("daylight", value.lighting?.daylight),
        studio: mergeLighting("studio", value.lighting?.studio),
        flat: mergeLighting("flat", value.lighting?.flat)
      }
    };
  } catch {
    return structuredClone(defaultViewerPreferences);
  }
}

export function saveViewerPreferences(value: ViewerPreferences): void {
  localStorage.setItem(storageKey, JSON.stringify(value));
}

function mergeLighting(
  mode: ViewerLighting,
  value: Partial<ViewerLightingSettings> | undefined
): ViewerLightingSettings {
  const fallback = defaultViewerPreferences.lighting[mode];
  return {
    mode,
    keyIntensity: numberOr(value?.keyIntensity, fallback.keyIntensity),
    ambientIntensity: numberOr(value?.ambientIntensity, fallback.ambientIntensity),
    fillIntensity: numberOr(value?.fillIntensity, fallback.fillIntensity),
    azimuth: numberOr(value?.azimuth, fallback.azimuth),
    elevation: numberOr(value?.elevation, fallback.elevation),
    shadowIntensity: numberOr(value?.shadowIntensity, fallback.shadowIntensity)
  };
}

function isLightingMode(value: unknown): value is ViewerLighting {
  return value === "daylight" || value === "studio" || value === "flat";
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
