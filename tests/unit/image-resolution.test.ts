import { describe, expect, it } from "vitest";
import {
  IMAGE_RESOLUTIONS,
  imageResolutionLabel,
  isImageResolution
} from "../../apps/web/src/features/generation/image-resolution.js";

describe("image resolution options", () => {
  it("provides the same choices for every image model", () => {
    expect(IMAGE_RESOLUTIONS).toEqual(["auto", "1K", "2K", "4K"]);
    expect(IMAGE_RESOLUTIONS.map(imageResolutionLabel)).toEqual(["自动", "1K", "2K", "4K"]);
  });

  it("validates stored resolution values", () => {
    expect(isImageResolution("4K")).toBe(true);
    expect(isImageResolution("4k")).toBe(false);
    expect(isImageResolution("8K")).toBe(false);
  });
});
