import { useEffect } from "react";
import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import { GenerationBoard } from "../../components/GenerationBoard.js";
import { Icon } from "../../components/Icon.js";
import { JobElapsedTime } from "../jobs/JobElapsedTime.js";
import { providerSnapshotLabel } from "../providers/catalog-selectors.js";

interface ConversationTaskDialogProps {
  open: boolean;
  imageJobs: JobSnapshot[];
  modelJobs: JobSnapshot[];
  assetsById: Map<string, AssetSnapshot>;
  modelAssetsById: Map<string, AssetSnapshot>;
  attachmentOrder: Map<string, number>;
  contentUrl: (assetId: string) => string;
  thumbnailUrl: (assetId: string) => string;
  onToggleAttachment: (assetId: string) => Promise<void>;
  onPreview: (assetId: string) => void;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onEdit: (job: JobSnapshot) => void;
  onViewModel: (assetId: string) => void;
  onClose: () => void;
}

export function ConversationTaskDialog(props: ConversationTaskDialogProps) {
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [props.open, props.onClose]);

  if (!props.open) return null;
  const taskCount = props.imageJobs.length + props.modelJobs.length;

  return (
    <div className="conversation-task-backdrop" role="presentation" onMouseDown={props.onClose}>
      <section
        className="conversation-task-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="当前对话任务"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>当前对话任务</strong>
            <span>{taskCount} 个任务</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭任务列表" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="conversation-task-content">
          {taskCount === 0 && (
            <div className="conversation-task-empty">
              <Icon name="library" size={28} />
              <span>当前对话还没有生成任务</span>
            </div>
          )}
          {props.imageJobs.length > 0 && (
            <section className="conversation-task-section">
              <header><Icon name="image" size={17} /><strong>图片生成</strong><span>{props.imageJobs.length}</span></header>
              <GenerationBoard
                jobs={props.imageJobs}
                assetsById={props.assetsById}
                attachmentOrder={props.attachmentOrder}
                contentUrl={props.contentUrl}
                thumbnailUrl={props.thumbnailUrl}
                onToggleAttachment={props.onToggleAttachment}
                onPreview={props.onPreview}
                onRetry={props.onRetry}
                onDismiss={props.onDismiss}
                onEdit={props.onEdit}
              />
            </section>
          )}
          {props.modelJobs.length > 0 && (
            <section className="conversation-task-section">
              <header><Icon name="cube" size={17} /><strong>AI 建模</strong><span>{props.modelJobs.length}</span></header>
              <div className="conversation-model-task-list">
                {[...props.modelJobs].reverse().map((job) => (
                  <ConversationModelTask
                    key={job.id}
                    job={job}
                    modelAssetsById={props.modelAssetsById}
                    contentUrl={props.contentUrl}
                    onViewModel={(assetId) => {
                      props.onViewModel(assetId);
                      props.onClose();
                    }}
                    onRetry={props.onRetry}
                    onDismiss={props.onDismiss}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function ConversationModelTask(props: {
  job: JobSnapshot;
  modelAssetsById: Map<string, AssetSnapshot>;
  contentUrl: (assetId: string) => string;
  onViewModel: (assetId: string) => void;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
}) {
  const active = props.job.status === "queued" || props.job.status === "running";
  const outputs = props.job.outputs.flatMap((output) => {
    const asset = props.modelAssetsById.get(output.assetId);
    return asset ? [asset] : [];
  });
  return (
    <article className={`conversation-model-task status-${props.job.status}`}>
      <header>
        <div>
          <strong>{props.job.prompt || props.job.title || "AI 建模"}</strong>
          <span>{providerSnapshotLabel(props.job.providerName, props.job.remoteModelId)} · <JobElapsedTime job={props.job} /></span>
        </div>
        <b>{jobStatusText(props.job)}</b>
      </header>
      {active && <div className="conversation-model-task-progress"><span style={{ width: `${Math.max(2, props.job.progress)}%` }} /></div>}
      {props.job.errorMessage && <p>{props.job.errorMessage}</p>}
      {(outputs.length > 0 || ["failed", "cancelled", "interrupted"].includes(props.job.status)) && (
        <footer>
          {outputs.map((asset) => asset.mimeType === "model/gltf-binary" ? (
            <button type="button" className="button button-secondary" key={asset.id} onClick={() => props.onViewModel(asset.id)}>查看模型</button>
          ) : (
            <a className="button button-secondary" key={asset.id} href={props.contentUrl(asset.id)} download={asset.name}>下载文件</a>
          ))}
          {["failed", "cancelled", "interrupted"].includes(props.job.status) && (
            <>
              <button type="button" className="button button-secondary" onClick={() => void props.onRetry(props.job.id)}><Icon name="retry" size={14} />重试</button>
              <button type="button" className="icon-button danger-button" aria-label="移除任务" onClick={() => void props.onDismiss(props.job.id)}><Icon name="trash" size={14} /></button>
            </>
          )}
        </footer>
      )}
    </article>
  );
}

function jobStatusText(job: JobSnapshot): string {
  if (job.status === "queued") return "排队中";
  if (job.status === "running") return `${job.progress}%`;
  if (job.status === "succeeded") return "已完成";
  if (job.status === "cancelled") return "已取消";
  if (job.status === "interrupted") return "已中断";
  return "失败";
}
