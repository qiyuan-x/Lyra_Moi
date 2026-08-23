import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import { JobElapsedTime } from "../jobs/JobElapsedTime.js";

export function ModelJobCard(props: {
  job: JobSnapshot;
  source: AssetSnapshot | undefined;
  textureSource: AssetSnapshot | undefined;
  outputs: AssetSnapshot[];
  selectedAssetId: string;
  thumbnailUrl: (assetId: string) => string;
  contentUrl: (assetId: string) => string;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onDelete: () => void;
  onSelectOutput: (assetId: string) => void;
}) {
  const active = props.job.status === "queued" || props.job.status === "running";
  const viewableOutput = props.outputs.find((asset) => asset.mimeType === "model/gltf-binary");
  const selected = Boolean(viewableOutput && viewableOutput.id === props.selectedAssetId);
  return (
    <article className={`model-job-card status-${props.job.status}${selected ? " selected" : ""}`}>
      <div
        className={`model-job-main${viewableOutput ? " clickable" : ""}`}
        role={viewableOutput ? "button" : undefined}
        tabIndex={viewableOutput ? 0 : undefined}
        title={viewableOutput ? "点击查看 GLB" : undefined}
        onClick={() => {
          if (viewableOutput) props.onSelectOutput(viewableOutput.id);
        }}
        onKeyDown={(event) => {
          if (viewableOutput && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            props.onSelectOutput(viewableOutput.id);
          }
        }}
      >
        <div className="model-job-inputs">
          {props.source
            ? <img src={props.thumbnailUrl(props.source.id)} alt={`模型输入图：${props.source.name}`} />
            : <span><Icon name={props.job.prompt ? "prompt" : "image"} size={20} /></span>}
          {props.textureSource && (
            <img
              src={props.thumbnailUrl(props.textureSource.id)}
              alt={`纹理输入图：${props.textureSource.name}`}
              title={`纹理输入图：${props.textureSource.name}`}
            />
          )}
        </div>
        <div>
          <strong title={props.source?.name ?? props.job.prompt ?? props.job.title}>
            {props.source?.name ?? props.job.prompt ?? props.job.title}
          </strong>
          <small>
            {props.job.prompt ? "文字生成 · " : ""}
            {props.textureSource ? `纹理：${props.textureSource.name} · ` : ""}
            {jobStatusLabel(props.job)} · {" "}
            <JobElapsedTime job={props.job} />
          </small>
        </div>
        <b>{active ? `${props.job.progress}%` : jobStatusShort(props.job.status)}</b>
      </div>
      {active && (
        <div className="model-job-progress"><span style={{ width: `${Math.max(2, props.job.progress)}%` }} /></div>
      )}
      {props.job.errorMessage && <p>{props.job.errorMessage}</p>}
      <footer>
        {props.outputs.map((asset) => asset.mimeType === "model/gltf-binary" ? (
          <button type="button" className={`button button-secondary${asset.id === props.selectedAssetId ? " active" : ""}`} key={asset.id} onClick={() => props.onSelectOutput(asset.id)}>查看 GLB</button>
        ) : (
          <a className="button button-secondary" key={asset.id} href={props.contentUrl(asset.id)} download={asset.name}>
            下载 {formatFromAsset(asset)}
          </a>
        ))}
        {active && <button type="button" className="button button-secondary" onClick={() => void props.onCancel(props.job.id)}>停止本地等待</button>}
        {(props.job.status === "failed" || props.job.status === "cancelled" || props.job.status === "interrupted") && (
          <>
            <button type="button" className="button button-secondary" onClick={() => void props.onRetry(props.job.id)}><Icon name="retry" size={14} />重试</button>
            <button type="button" className="icon-button danger-button" title="移除记录" onClick={() => void props.onDismiss(props.job.id)}><Icon name="trash" size={14} /></button>
          </>
        )}
        {props.job.status === "succeeded" && props.outputs.length > 0 && (
          <button type="button" className="icon-button danger-button" title="删除模型" aria-label="删除模型" onClick={props.onDelete}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </footer>
    </article>
  );
}

function formatFromAsset(asset: AssetSnapshot): string {
  if (asset.mimeType === "model/gltf-binary") return "GLB";
  const tagged = asset.tags.find((tag) =>
    ["OBJ", "FBX", "STL", "USDZ", "3MF"].includes(tag.toUpperCase())
  );
  if (tagged) return asset.mimeType === "application/zip"
    ? `${tagged.toUpperCase()} 压缩包`
    : tagged.toUpperCase();
  const match = asset.name.match(/\.([A-Za-z0-9]+)$/u);
  return match?.[1]?.toUpperCase() ?? "MODEL";
}

function jobStatusLabel(job: JobSnapshot): string {
  if (job.status === "queued") return job.stage === "resuming" ? "等待恢复" : "等待执行";
  if (job.status === "running") {
    if (job.stage === "provider_queued") return "供应商排队中";
    if (job.stage === "downloading") return "正在保存模型文件";
    return "正在生成";
  }
  if (job.status === "succeeded") return "已完成";
  if (job.status === "cancelled") return "已停止本地等待";
  if (job.status === "interrupted") return "已中断";
  return "失败";
}

function jobStatusShort(status: JobSnapshot["status"]): string {
  if (status === "succeeded") return "完成";
  if (status === "cancelled") return "停止";
  if (status === "interrupted") return "中断";
  return "失败";
}
