import type {
  DiscoveredProviderModel,
  ProviderAdapterType
} from "@lyra/contracts";
import type { StoredProviderProfile } from "@lyra/storage";

export interface ProviderDiscoveryInput {
  profile: StoredProviderProfile;
  apiKey: string | null;
  secondaryApiKey: string | null;
  signal: AbortSignal | undefined;
}

export interface ProviderDiscoveryAdapter {
  readonly adapterType: ProviderAdapterType;
  discoverModels(input: ProviderDiscoveryInput): Promise<DiscoveredProviderModel[]>;
}

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;
