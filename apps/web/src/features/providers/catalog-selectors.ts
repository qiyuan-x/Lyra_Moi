import type {
  ProviderModelSnapshot,
  ProviderServiceType
} from "@lyra/contracts";
import type { ProviderCatalog } from "../../lib/api-client.js";

export function listEnabledModels(
  catalog: ProviderCatalog,
  serviceType: ProviderServiceType
): ProviderModelSnapshot[] {
  const enabledProfiles = new Set(
    catalog.profiles
      .filter((profile) =>
        profile.serviceType === serviceType &&
        profile.enabled
      )
      .map((profile) => profile.id)
  );
  return catalog.models.filter((model) =>
    model.serviceType === serviceType &&
    model.enabled &&
    enabledProfiles.has(model.providerProfileId)
  );
}

export function findEnabledModel(
  catalog: ProviderCatalog,
  serviceType: ProviderServiceType,
  modelId: string
): ProviderModelSnapshot | undefined {
  return listEnabledModels(catalog, serviceType)
    .find((model) => model.id === modelId);
}

export function isDefaultServiceReady(
  catalog: ProviderCatalog,
  serviceType: ProviderServiceType
): boolean {
  const defaultId = catalog.defaults[serviceType];
  return Boolean(
    defaultId &&
    listEnabledModels(catalog, serviceType)
      .some((model) => model.id === defaultId)
  );
}

export function providerModelLabel(
  catalog: ProviderCatalog,
  model: ProviderModelSnapshot
): string {
  const providerName = catalog.profiles.find(
    (profile) => profile.id === model.providerProfileId
  )?.name ?? "供应商";
  return `${providerName} / ${providerModelDisplayName(model)}`;
}

export function providerModelDisplayName(
  model: ProviderModelSnapshot
): string {
  const alias = model.serviceType === "image"
    ? geminiImageModelAlias(model.remoteModelId)
    : null;
  if (!alias) return model.displayName;
  const officialModelId = model.remoteModelId.replace(/^models\//u, "");
  return `${officialModelId} (${alias})`;
}

export function providerSnapshotLabel(
  providerName: string,
  remoteModelId: string
): string {
  const officialModelId = remoteModelId.replace(/^models\//u, "");
  const alias = geminiImageModelAlias(officialModelId);
  return `${providerName} / ${officialModelId}${alias ? ` (${alias})` : ""}`;
}

export function geminiImageModelAlias(
  remoteModelId: string
): string | null {
  const id = remoteModelId
    .toLocaleLowerCase("en-US")
    .replace(/^models\//u, "");
  if (id.startsWith("gemini-3.1-flash-lite-image")) {
    return "Nano Banana 2 Lite";
  }
  if (id.startsWith("gemini-3.1-flash-image")) {
    return "Nano Banana 2";
  }
  if (id.startsWith("gemini-3-pro-image")) {
    return "Nano Banana Pro";
  }
  if (id.startsWith("gemini-2.5-flash-image")) {
    return "Nano Banana";
  }
  return null;
}
