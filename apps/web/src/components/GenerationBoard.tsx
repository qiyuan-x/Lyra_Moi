import { useEffect, useState } from "react";
import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import { Icon } from "./Icon.js";
import { JobElapsedTime } from "../features/jobs/JobElapsedTime.js";
import { formatImageAssetSummary } from "../features/jobs/job-display.js";
import { providerSnapshotLabel } from "../features/providers/catalog-selectors.js";

interface GenerationBoardProps {
  jobs: JobSnapshot[];
  assetsById: Map<string, AssetSnapshot>;
  attachmentOrder: Map<string, number>;
  contentUrl: (assetId: string) => string;
  thumbnailUrl: (assetId: string) => string;
  onToggleAttachment: (assetId: string) => Promise<void>;
  onPreview: (assetId: string) => void;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onEdit: (job: JobSnapshot) => void;
}

const statusText: Record<JobSnapshot["status"], string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断"
};

function formatTaskTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function FlowConnector() {
  return <span className="flow-connector" aria-hidden="true" />;
}

export function GenerationBoard(props: GenerationBoardProps) {
  const latestJobId = props.jobs.at(-1)?.id ?? null;
  const [expandedMobileJobId, setExpandedMobileJobId] = useState<string | null>(latestJobId);

  useEffect(() => {
    if (latestJobId) setExpandedMobileJobId(latestJobId);
  }, [latestJobId]);

  if (props.jobs.length === 0) {
    return (
      <section className="empty-workspace">
        <div className="empty-icon"><Icon name="image" size={30} /></div>
        <h2>当前工作区还没有生成任务</h2>
        <p>从一句描述或参考素材开始。每次生成都会形成独立的输入、任务和结果关系。</p>
      </section>
    );
  }

  const outputSourceTask = new Map<string, number>();
  props.jobs.forEach((job, index) => {
    job.outputs.forEach((output) => outputSourceTask.set(output.assetId, index + 1));
  });

  return (
    <section className="generation-grid" aria-label="当前工作区任务流">
      {props.jobs.map((job, index) => {
        const taskNumber = index + 1;
        const providerLabel = providerSnapshotLabel(
          job.providerName,
          job.remoteModelId
        );
        const hasActiveStatus = job.status === "queued" || job.status === "running";
        const canRetry = job.status === "failed" || job.status === "cancelled" || job.status === "interrupted";

        return (
          <article
            className={`generation-flow-card status-${job.status}${
              expandedMobileJobId === job.id ? " mobile-expanded" : " mobile-collapsed"
            }`}
            data-job-id={job.id}
            key={job.id}
          >
            <header className="generation-flow-header">
              <div className="generation-title">
                <div>
                  <span className="task-number">任务 {taskNumber}</span>
                  <strong title={job.title}>{job.title || "图片生成"}</strong>
                </div>
                <span>
                  {job.source === "agent" ? "Agent 对话" : "手动生成"}
                  <i aria-hidden="true">·</i>
                  {formatTaskTime(job.createdAt)}
                  <i aria-hidden="true">·</i>
                  <JobElapsedTime job={job} />
                  {job.attempt > 1 && <><i aria-hidden="true">·</i>第 {job.attempt} 次尝试</>}
                </span>
              </div>
              <div className="generation-flow-header-actions">
                <span className={`status-pill status-${job.status}`}>{statusText[job.status]}</span>
                <button
                  type="button"
                  className="icon-button mobile-task-toggle"
                  aria-label={expandedMobileJobId === job.id ? `收起任务 ${taskNumber}` : `展开任务 ${taskNumber}`}
                  aria-expanded={expandedMobileJobId === job.id}
                  onClick={() => setExpandedMobileJobId((current) => current === job.id ? null : job.id)}
                >
                  <Icon name="chevron" size={15} />
                </button>
              </div>
            </header>

            <div className="generation-flow">
              <section className="flow-column flow-input-column" aria-label={`任务 ${taskNumber} 输入素材`}>
                <div className="flow-column-heading">
                  <span>输入素材</span>
                  <small>{job.inputs.length > 0 ? `${job.inputs.length} 张` : "仅文字"}</small>
                </div>
                <div className="flow-input-list">
                  {job.inputs.length === 0 ? (
                    <div className="flow-text-input">
                      <Icon name="chat" size={21} />
                      <div>
                        <strong>文字描述</strong>
                        <span>没有引用图片</span>
                      </div>
                    </div>
                  ) : job.inputs.map((input) => {
                    const asset = props.assetsById.get(input.assetId);
                    const sourceTaskNumber = outputSourceTask.get(input.assetId);
                    const provenance = sourceTaskNumber
                      ? `来自任务 ${sourceTaskNumber}`
                      : asset?.source === "upload" ? "上传素材" : "项目素材";
                    return (
                      <button
                        type="button"
                        className="flow-input-node"
                        key={`${input.assetId}-${input.position}`}
                        title={`预览${asset?.name ?? input.label}`}
                        onClick={() => props.onPreview(input.assetId)}
                      >
                        <span className="flow-input-image">
                          <img src={props.thumbnailUrl(input.assetId)} alt={asset?.name ?? input.label} loading="lazy" />
                          <b>{input.label}</b>
                        </span>
                        <span className="flow-input-copy">
                          <strong>{asset?.name ?? input.label}</strong>
                          <small>{provenance}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <FlowConnector />

              <section className={`flow-operation-node status-${job.status}`} aria-label={`任务 ${taskNumber} 操作`}>
                <span className="flow-operation-icon">
                  <Icon name={job.source === "agent" ? "chat" : "manual"} size={20} />
                </span>
                <small>{job.source === "agent" ? "Agent 执行" : "手动执行"}</small>
                <strong>生成图片</strong>
                <span className="flow-provider-label" title={providerLabel}>
                  {providerLabel}
                </span>
                <p title={job.prompt ?? undefined}>{job.prompt || job.title || "图片生成"}</p>
                {hasActiveStatus && <span className="flow-stage">{job.stage || "准备中"}</span>}
                {job.attempt > 1 && <span className="flow-attempt">第 {job.attempt} 次尝试</span>}
                {!hasActiveStatus && (
                  <button type="button" className="flow-edit-button" onClick={() => props.onEdit(job)}>
                    <Icon name="manual" size={14} />
                    编辑并重新创建
                  </button>
                )}
              </section>

              <FlowConnector />

              <section className="flow-column flow-output-column" aria-label={`任务 ${taskNumber} 生成结果`}>
                <div className="flow-column-heading">
                  <span>生成结果</span>
                  <small>{job.outputs.length > 0 ? `${job.outputs.length} 张` : statusText[job.status]}</small>
                </div>

                {hasActiveStatus ? (
                  <div className="flow-output-placeholder" aria-live="polite">
                    <div className="placeholder-image" />
                    <div className="placeholder-copy">
                      <strong>{job.status === "queued" ? "等待可用的生成任务" : "正在生成图片"}</strong>
                      <span>{job.stage || "准备中"}</span>
                    </div>
                  </div>
                ) : job.status === "succeeded" && job.outputs.length > 0 ? (
                  <div className={`output-grid output-count-${Math.min(job.outputs.length, 4)}`}>
                    {job.outputs.map((output) => {
                      const asset = props.assetsById.get(output.assetId);
                      return (
                        <div className="output-result" key={output.assetId}>
                          <div
                            className={`output-image${props.attachmentOrder.has(output.assetId) ? " selected" : ""}`}
                            draggable
                            role="button"
                            tabIndex={0}
                            aria-label={`${props.attachmentOrder.has(output.assetId) ? "取消引用" : "引用"}生成结果`}
                            onDragStart={(event) => event.dataTransfer.setData("application/x-lyra-asset-id", output.assetId)}
                            onClick={() => void props.onToggleAttachment(output.assetId)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                void props.onToggleAttachment(output.assetId);
                              }
                            }}
                          >
                            <img src={props.contentUrl(output.assetId)} alt={`任务 ${taskNumber} 生成结果`} loading="lazy" />
                            {props.attachmentOrder.has(output.assetId) && (
                              <span className="output-reference-order">图{props.attachmentOrder.get(output.assetId)}</span>
                            )}
                            <div className="image-actions">
                              <button type="button" onClick={(event) => { event.stopPropagation(); void props.onToggleAttachment(output.assetId); }}>
                                {props.attachmentOrder.has(output.assetId) ? "取消引用" : "引用"}
                              </button>
                              <button type="button" aria-label="预览图片" onClick={(event) => { event.stopPropagation(); props.onPreview(output.assetId); }}>
                                <Icon name="expand" size={16} />
                              </button>
                            </div>
                          </div>
                          <div className="output-image-info">
                            <span>{formatImageAssetSummary(asset)}</span>
                            <small title={providerLabel}>{providerLabel}</small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="generation-error" role="alert" aria-live="assertive">
                    <strong>{statusText[job.status]}</strong>
                    <p>{job.errorMessage || "任务未产生输出。"}</p>
                    {canRetry && (
                      <div className="generation-error-actions">
                        <button type="button" className="button button-secondary" onClick={() => void props.onRetry(job.id)}>
                          <Icon name="retry" size={16} />
                          重试
                        </button>
                        <button type="button" className="button button-quiet" onClick={() => void props.onDismiss(job.id)}>
                          <Icon name="trash" size={16} />
                          移除
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          </article>
        );
      })}
    </section>
  );
}
