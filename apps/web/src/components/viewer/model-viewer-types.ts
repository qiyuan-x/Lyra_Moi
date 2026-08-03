export type ViewerLighting = "daylight" | "studio" | "flat";
export type ViewerStatus = "idle" | "loading" | "ready" | "error";
export type ViewerLightingSettings = {
  mode: ViewerLighting;
  keyIntensity: number;
  ambientIntensity: number;
  fillIntensity: number;
  azimuth: number;
  elevation: number;
  shadowIntensity: number;
};

export type ModelStats = {
  topology: "triangle";
  meshes: number;
  materials: number;
  vertices: number;
  faces: number;
  animations: number;
};

export type ModelViewerAdapter = {
  load(sourceUrl: string, signal: AbortSignal): Promise<ModelStats>;
  dispose(): void;
  setAutoRotate(enabled: boolean): void;
  setGridVisible(visible: boolean): void;
  setWireframeVisible(visible: boolean): void;
  setTextureVisible(visible: boolean): void;
  setLighting(settings: ViewerLightingSettings): void;
  setExposure(value: number): void;
  setFov(value: number): void;
  resetCamera(): void;
};
