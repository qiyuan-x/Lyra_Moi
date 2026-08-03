import type { AssetSnapshot } from "@lyra/contracts";
import type { ModelStats } from "./model-viewer-types.js";
import { Icon } from "../Icon.js";

interface ModelViewerHeaderProps {
  asset: AssetSnapshot | null;
  stats: ModelStats | null;
  contentUrl: string;
  onResetCamera: () => void;
  onFullscreen: () => void;
}

export function ModelViewerHeader(props: ModelViewerHeaderProps) {
  return (
    <header>
      <div>
        <strong>{props.asset?.name ?? "模型查看器"}</strong>
        <span>
          {props.asset
            ? `${formatBytes(props.asset.byteSize)} · GLB${
                props.stats
                  ? ` · ${formatCount(props.stats.faces)} 面`
                  : ""
              }`
            : "旋转、缩放、检查网格和模型统计"}
        </span>
      </div>
      {props.asset && (
        <div className="model-viewer-header-actions">
          <button
            type="button"
            className="icon-button"
            title="重置视角"
            onClick={props.onResetCamera}
          >
            <Icon name="retry" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="全屏"
            onClick={props.onFullscreen}
          >
            <Icon name="expand" size={16} />
          </button>
          <a
            className="icon-button"
            title="下载 GLB"
            href={props.contentUrl}
            download={props.asset.name}
          >
            <Icon name="download" size={16} />
          </a>
        </div>
      )}
    </header>
  );
}

export function ViewerStatistics(props: { stats: ModelStats }) {
  return (
    <dl className="model-viewer-statistics-card">
      <div><dt>拓扑</dt><dd>三角面</dd></div>
      <div><dt>面数</dt><dd>{formatCount(props.stats.faces)}</dd></div>
      <div><dt>顶点数</dt><dd>{formatCount(props.stats.vertices)}</dd></div>
    </dl>
  );
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("zh-CN")
    .format(Math.max(0, Math.floor(value)));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
