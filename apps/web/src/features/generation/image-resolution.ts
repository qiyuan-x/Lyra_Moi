export const IMAGE_RESOLUTIONS = ["auto", "1K", "2K", "4K"] as const;

export type ImageResolution = typeof IMAGE_RESOLUTIONS[number];

export function isImageResolution(value: unknown): value is ImageResolution {
  return typeof value === "string" && IMAGE_RESOLUTIONS.includes(value as ImageResolution);
}
