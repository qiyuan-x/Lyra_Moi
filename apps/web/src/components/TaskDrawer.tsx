import type { JobSnapshot } from "@lyra/contracts";
import { Icon } from "./Icon.js";

interface TaskDrawerProps {
  open: boolean;
  jobs: JobSnapshot[];
  onClose: () => void;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onClearFailed: () => Promise<void>;
}

const statusText: Record<JobSnapshot["status"], string> = {
  queued: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断"
};

export function TaskDrawer(props: TaskDrawerProps) {
  if (!props.open) return null;
  const failedCount = props.jobs.filter(
    (job) => job.status === "failed" || job.status === "cancelled" || job.status === "interrupted"
  ).length;
  return (
    <div className="drawer-backdrop" onMouseDown={props.onClose}>
      <aside className="task-drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <Icon name="tasks" size={19} />
            <strong>任务状态</strong>
          </div>
          <div className="drawer-header-actions">
            {failedCount > 0 && (
              <button type="button" className="button button-quiet" onClick={() => void props.onClearFailed()}>
                清理失败记录
              </button>
            )}
            <button type="button" className="icon-button" aria-label="关闭任务状态" onClick={props.onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>
        <div className="drawer-list">
          {props.jobs.length === 0 ? <p className="drawer-empty">当前没有任务</p> : props.jobs.map((job) => (
            <article className="drawer-job" data-job-id={job.id} key={job.id}>
              <div className="drawer-job-title">
                <strong title={job.title}>{job.title || "图片生成"}</strong>
                <span className={`status-pill status-${job.status}`}>{statusText[job.status]}</span>
              </div>
              <p>{job.source === "agent" ? "Agent" : "手动"} · {formatTime(job.createdAt)}</p>
              {(job.status === "queued" || job.status === "running") && (
                <button type="button" className="button button-secondary" onClick={() => void props.onCancel(job.id)}>
                  <Icon name="stop" size={14} />
                  停止
                </button>
              )}
              {(job.status === "failed" || job.status === "cancelled" || job.status === "interrupted") && (
                <>
                  {job.errorMessage && <small className="inline-error">{job.errorMessage}</small>}
                  <div className="drawer-job-actions">
                    <button type="button" className="button button-secondary" onClick={() => void props.onRetry(job.id)}>
                      <Icon name="retry" size={14} />
                      重试
                    </button>
                    <button type="button" className="button button-quiet" onClick={() => void props.onDismiss(job.id)}>
                      <Icon name="trash" size={14} />
                      移除
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      </aside>
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
