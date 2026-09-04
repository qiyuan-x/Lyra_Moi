import type { AgentMessage } from "@lyra/agent-engine";
import { ProviderConnectionError } from "./provider-errors.js";

export interface LlmProviderAsset {
  data: Uint8Array;
  mimeType: string;
  name: string;
}

export interface LlmProviderAssetLoader {
  loadAsset(assetId: string, projectId: string): Promise<LlmProviderAsset>;
}

export interface LoadedLlmAttachment extends LlmProviderAsset {
  assetId: string;
  label: string;
  position: number;
}

export type LoadedAgentMessage = Omit<AgentMessage, "attachments"> & {
  attachments: LoadedLlmAttachment[];
};

export async function loadLlmMessages(
  messages: readonly AgentMessage[],
  projectId: string | undefined,
  loader: LlmProviderAssetLoader | undefined
): Promise<LoadedAgentMessage[]> {
  const hasAttachments = messages.some((message) => Boolean(message.attachments?.length));
  if (hasAttachments && (!projectId || !loader)) {
    throw new ProviderConnectionError(
      "INVALID_CONFIGURATION",
      "LLM attachment loader is not configured."
    );
  }
  return Promise.all(messages.map(async (message) => ({
    ...message,
    attachments: await Promise.all((message.attachments ?? []).map(async (attachment) => ({
      ...attachment,
      ...await loader!.loadAsset(attachment.assetId, projectId!)
    })))
  })));
}

export function attachmentDataUrl(attachment: LlmProviderAsset): string {
  return `data:${attachment.mimeType};base64,${Buffer.from(attachment.data).toString("base64")}`;
}
