import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction
} from "react";
import type { AssetSnapshot } from "@lyra/contracts";
import type { ApiClient } from "../lib/api-client.js";

interface UseAssetWorkspaceOptions {
  api: ApiClient;
  projectId: string;
  assets: AssetSnapshot[];
  setAssets: Dispatch<SetStateAction<AssetSnapshot[]>>;
  onNotice: (text: string) => void;
  onError: (error: unknown) => void;
}

export function useAssetWorkspace(options: UseAssetWorkspaceOptions) {
  const [attachments, setAttachments] = useState<AssetSnapshot[]>([]);
  const assetsById = useMemo(
    () => new Map(options.assets.map((asset) => [asset.id, asset])),
    [options.assets]
  );
  const attachmentOrder = useMemo(
    () => new Map(
      attachments.map((asset, index) => [asset.id, index + 1])
    ),
    [attachments]
  );

  useEffect(() => {
    setAttachments([]);
  }, [options.projectId]);

  function addAttachment(asset: AssetSnapshot) {
    setAttachments((current) => addUniqueAsset(current, asset));
  }

  function toggleAttachment(asset: AssetSnapshot) {
    setAttachments((current) => toggleSelectedAsset(current, asset));
  }

  async function attachGenerated(assetId: string) {
    let asset = assetsById.get(assetId);
    if (!asset && options.projectId) {
      asset = await options.api.getAsset(assetId);
      options.setAssets((current) => addUniqueAsset(current, asset!));
    }
    if (!asset) {
      throw new Error("生成素材尚未写入素材库，请稍后重试。");
    }
    addAttachment(asset);
  }

  async function toggleGeneratedAttachment(assetId: string) {
    const attached = attachments.find((asset) => asset.id === assetId);
    if (attached) {
      toggleAttachment(attached);
      return;
    }
    await attachGenerated(assetId);
  }

  async function upload(files: File[]) {
    if (!options.projectId) return;
    try {
      const uploaded: AssetSnapshot[] = [];
      const knownIds = new Set(options.assets.map((asset) => asset.id));
      let reusedCount = 0;
      let renamedCount = 0;
      for (const file of files) {
        const asset = await options.api.uploadAsset(options.projectId, file);
        if (knownIds.has(asset.id)) {
          reusedCount += 1;
        } else {
          knownIds.add(asset.id);
        }
        const extensionIndex = file.name.lastIndexOf(".");
        const baseName = extensionIndex > 0
          ? file.name.slice(0, extensionIndex)
          : file.name;
        if (asset.name !== baseName && !options.assets.some((item) => item.id === asset.id)) {
          renamedCount += 1;
        }
        uploaded.push(asset);
      }
      options.setAssets((current) => prependUniqueAssets(current, uploaded));
      setAttachments((current) => appendUniqueAssets(current, uploaded));
      const messages = [`已处理 ${uploaded.length} 张图片`];
      if (reusedCount > 0) messages.push(`复用 ${reusedCount} 张`);
      if (renamedCount > 0) messages.push(`自动改名 ${renamedCount} 张`);
      options.onNotice(messages.join("，"));
    } catch (error) {
      options.onError(error);
    }
  }

  async function updateAsset(
    assetId: string,
    value: { name: string; tags: string[] }
  ) {
    try {
      const updated = await options.api.updateAsset(assetId, value);
      options.setAssets((current) => replaceAsset(current, updated));
      setAttachments((current) => replaceAsset(current, updated));
    } catch (error) {
      options.onError(error);
      throw error;
    }
  }

  async function deleteAsset(assetId: string) {
    try {
      await options.api.deleteAsset(assetId);
      options.setAssets((current) => removeAsset(current, assetId));
      setAttachments((current) => removeAsset(current, assetId));
    } catch (error) {
      options.onError(error);
      throw error;
    }
  }

  return {
    attachments,
    setAttachments,
    assetsById,
    attachmentOrder,
    addAttachment,
    toggleAttachment,
    attachGenerated,
    toggleGeneratedAttachment,
    upload,
    updateAsset,
    deleteAsset
  };
}

export function addUniqueAsset(
  assets: AssetSnapshot[],
  asset: AssetSnapshot
): AssetSnapshot[] {
  return assets.some((item) => item.id === asset.id)
    ? assets
    : [...assets, asset];
}

export function appendUniqueAssets(
  assets: AssetSnapshot[],
  additions: AssetSnapshot[]
): AssetSnapshot[] {
  return additions.reduce(addUniqueAsset, assets);
}

export function prependUniqueAssets(
  assets: AssetSnapshot[],
  additions: AssetSnapshot[]
): AssetSnapshot[] {
  const uniqueAdditions = appendUniqueAssets([], additions);
  const additionIds = new Set(uniqueAdditions.map((asset) => asset.id));
  return [
    ...uniqueAdditions,
    ...assets.filter((asset) => !additionIds.has(asset.id))
  ];
}

export function toggleSelectedAsset(
  assets: AssetSnapshot[],
  asset: AssetSnapshot
): AssetSnapshot[] {
  return assets.some((item) => item.id === asset.id)
    ? assets.filter((item) => item.id !== asset.id)
    : [...assets, asset];
}

export function replaceAsset(
  assets: AssetSnapshot[],
  replacement: AssetSnapshot
): AssetSnapshot[] {
  return assets.map((asset) =>
    asset.id === replacement.id ? replacement : asset
  );
}

export function removeAsset(
  assets: AssetSnapshot[],
  assetId: string
): AssetSnapshot[] {
  return assets.filter((asset) => asset.id !== assetId);
}
