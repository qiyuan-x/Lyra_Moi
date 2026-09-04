import type {
  ModelInputMode,
  ModelOutputFormat,
  ModelViewType
} from "@lyra/contracts";

export type ModelPageConfig = {
  parameters: Record<string, unknown>;
  outputFormats: ModelOutputFormat[];
};

export type PersistedModelingState = {
  inputMode: ModelInputMode;
  prompt: string;
  selectedImageId: string;
  selectedTextureImageId: string;
  selectedMultiViewImageIds: Partial<Record<ModelViewType, string>>;
  modelConfigs: Record<string, ModelPageConfig>;
};

export const emptyPersistedModelingState: PersistedModelingState = {
  inputMode: "image",
  prompt: "",
  selectedImageId: "",
  selectedTextureImageId: "",
  selectedMultiViewImageIds: {},
  modelConfigs: {}
};

export function readPersistedModelingState(
  projectId: string
): PersistedModelingState {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(storageKey(projectId)) ?? "null"
    );
    if (!isRecord(value)) return cloneEmptyState();
    return {
      inputMode: value.inputMode === "text" || value.inputMode === "multiview"
        ? value.inputMode
        : "image",
      prompt: readText(value.prompt),
      selectedImageId:
        readText(value.selectedImageId) ||
        readLegacySelection(value.selectedImageBySource, "generated"),
      selectedTextureImageId:
        readText(value.selectedTextureImageId) ||
        readLegacySelection(value.selectedTextureImageBySource, "generated"),
      selectedMultiViewImageIds: readMultiViewSelections(value.selectedMultiViewImageIds),
      modelConfigs: isRecord(value.modelConfigs)
        ? value.modelConfigs as Record<string, ModelPageConfig>
        : {}
    };
  } catch {
    return cloneEmptyState();
  }
}

export function savePersistedModelingState(
  projectId: string,
  value: PersistedModelingState
): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(value));
  } catch {
    // The modeling page remains usable when browser storage is unavailable.
  }
}

function storageKey(projectId: string): string {
  return `lyra.modeling.state.${projectId}`;
}

function readLegacySelection(
  value: unknown,
  preferredSource: "upload" | "generated"
): string {
  if (!isRecord(value)) return "";
  return readText(value[preferredSource]) ||
    readText(value[preferredSource === "upload" ? "generated" : "upload"]);
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readMultiViewSelections(
  value: unknown
): Partial<Record<ModelViewType, string>> {
  if (!isRecord(value)) return {};
  const result: Partial<Record<ModelViewType, string>> = {};
  for (const view of ["left", "back", "right", "top", "bottom", "leftFront", "rightFront"] as const) {
    const assetId = readText(value[view]);
    if (assetId) result[view] = assetId;
  }
  return result;
}

function cloneEmptyState(): PersistedModelingState {
  return structuredClone(emptyPersistedModelingState);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
