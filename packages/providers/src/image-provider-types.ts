export interface ProviderImageInput {
  data: Uint8Array;
  mimeType: string;
  name: string;
}

export interface ProviderAssetLoader {
  loadImage(assetId: string, projectId: string): Promise<ProviderImageInput>;
}
