import type { ProviderProtocol } from "./provider.js";

export function isImageGenerationModelId(
  remoteModelId: string,
  protocol: ProviderProtocol
): boolean {
  const id = remoteModelId.trim().toLowerCase().replace(/^models\//u, "");
  if (!id || /(embedding|moderation|rerank|vision-only)/u.test(id)) return false;
  if (protocol === "gemini") {
    return /^gemini-[a-z0-9.]+-[a-z0-9.-]*image(?:[-.]|$)/u.test(id) ||
      /^imagen(?:[-.]|$)/u.test(id);
  }
  return /(?:^|[-_.])(gpt-image|dall-e|imagen|imagegen|image-generation|nano-banana|flux|stable-image|stable-diffusion|sd3|sdxl|recraft|ideogram|midjourney|seedream|qwen-image|wan[0-9]|kolors|hidream|jimeng|cogview|glm-image|hunyuan-image)(?:[-_.]|$)/u.test(id) ||
    /^gemini-[a-z0-9.]+-[a-z0-9.-]*image(?:[-.]|$)/u.test(id) ||
    /(?:^|[-_.])image(?:[-_.]|$)/u.test(id);
}
