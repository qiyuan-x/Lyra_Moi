import { useState } from "react";
import type { AssetSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";

export function DownloadAssetsButton(props: {
  assets: AssetSnapshot[];
  contentUrl: (assetId: string) => string;
  label?: string;
  archiveName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="button button-secondary"
        disabled={busy || props.assets.length === 0}
        title={props.assets.length > 1 ? "下载此模型的全部输出文件（ZIP）" : "下载原始文件"}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const { prepareAssetDownload, saveDownload } = await import("./asset-download.js");
            const result = await prepareAssetDownload(props.assets, props.contentUrl, props.archiveName);
            saveDownload(result.blob, result.name);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "下载失败，请重试。");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="download" size={14} />{busy ? "正在准备…" : props.label ?? "下载"}
      </button>
      {error && <small className="asset-download-error field-error" role="alert">{error}</small>}
    </>
  );
}
