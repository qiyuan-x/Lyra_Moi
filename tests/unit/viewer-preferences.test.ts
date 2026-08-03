import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultViewerPreferences,
  readViewerPreferences,
  saveViewerPreferences
} from "../../apps/web/src/components/viewer/viewer-preferences.js";

describe("viewer preferences", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves independent settings for every lighting mode", () => {
    const preferences = structuredClone(defaultViewerPreferences);
    preferences.lightingMode = "studio";
    preferences.exposure = 1.2;
    preferences.lighting.daylight.azimuth = 72;
    preferences.lighting.studio.azimuth = -35;
    preferences.lighting.studio.fillIntensity = 1.8;

    saveViewerPreferences(preferences);
    const restored = readViewerPreferences();

    expect(restored.lightingMode).toBe("studio");
    expect(restored.exposure).toBe(1.2);
    expect(restored.lighting.daylight.azimuth).toBe(72);
    expect(restored.lighting.studio.azimuth).toBe(-35);
    expect(restored.lighting.studio.fillIntensity).toBe(1.8);
  });
});
