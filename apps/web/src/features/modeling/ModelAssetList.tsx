import { useEffect, useMemo, useRef, useState } from "react";
import type { AssetSnapshot, JobSnapshot } from "@lyra/contracts";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { Icon } from "../../components/Icon.js";
import { ModelJobCard } from "./ModelJobCard.js";

interface ModelAssetListProps {
  assets: AssetSnapshot[];
  jobs: JobSnapshot[];
  images: AssetSnapshot[];
  selectedAssetId: string;
  expanded: boolean;
  thumbnailUrl: (assetId: string) => string;
  onCancel: (jobId: string) => Promise<void>;
  onRetry: (jobId: string) => Promise<void>;
  onDismiss: (jobId: string) => Promise<void>;
  onDeleteModel: (assetIds: string[]) => Promise<void>;
  onExpandedChange: (expanded: boolean) => void;
  onSelect: (assetId: string) => void;
}

interface PendingModelDelete {
  title: string;
  assetIds: string[];
}

/** Generated models and in-progress model jobs share one compact list. */
export function ModelAssetList(props: ModelAssetListProps) {
  const [deleting, setDeleting] = useState<PendingModelDelete | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogStatus, setDialogStatus] = useState<ModelJobFilter>("all");
  const [dialogSearch, setDialogSearch] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const imagesById = useMemo(
    () => new Map(props.images.map((asset) => [asset.id, asset])),
    [props.images]
  );
  const modelAssetsById = useMemo(
    () => new Map(props.assets.map((asset) => [asset.id, asset])),
    [props.assets]
  );
  const jobs = useMemo(
    () => [...props.jobs]
      .filter((job) => job.status !== "succeeded" || job.outputs.some((output) => modelAssetsById.has(output.assetId)))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [modelAssetsById, props.jobs]
  );
  const jobOutputIds = useMemo(
    () => new Set(props.jobs.flatMap((job) => job.outputs.map((output) => output.assetId))),
    [props.jobs]
  );
  const orphanAssets = useMemo(
    () => props.assets.filter((asset) => !jobOutputIds.has(asset.id)),
    [jobOutputIds, props.assets]
  );
  const completedModelCount = new Set([
    ...jobs.filter((job) => job.status === "succeeded").flatMap((job) => job.outputs.map((output) => output.assetId)),
    ...orphanAssets.map((asset) => asset.id)
  ]).size;
  const dialogJobs = useMemo(() => {
    const needle = dialogSearch.trim().toLocaleLowerCase("zh-CN");
    return jobs.filter((job) => {
      if (!matchesStatus(job, dialogStatus)) return false;
      if (!needle) return true;
      const sourceId = job.inputs.find((input) => input.label === "模型输入图")?.assetId ?? "";
      const textureId = job.inputs.find((input) => input.label === "纹理输入图")?.assetId ?? "";
      return [
        job.title,
        job.prompt,
        job.providerName,
        job.remoteModelId,
        imagesById.get(sourceId)?.name,
        imagesById.get(textureId)?.name,
        ...job.outputs.map((output) => modelAssetsById.get(output.assetId)?.name)
      ].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN").includes(needle);
    });
  }, [dialogSearch, dialogStatus, imagesById, jobs, modelAssetsById]);

  useEffect(() => {
    if (!dialogOpen) return;
    const previousFocus = document.activeElement;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
      if (event.key === "Tab") {
        const elements = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
        );
        const first = elements?.[0];
        const last = elements?.[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [dialogOpen]);

  function renderJob(job: JobSnapshot, previewOnly = false) {
    const outputs = job.outputs.flatMap((output) => {
      const asset = modelAssetsById.get(output.assetId);
      return asset ? [asset] : [];
    });
    return (
      <ModelJobCard
        key={job.id}
        job={job}
        source={imagesById.get(
          job.inputs.find((input) => input.label === "模型输入图")?.assetId ?? ""
        )}
        textureSource={imagesById.get(
          job.inputs.find((input) => input.label === "纹理输入图")?.assetId ?? ""
        )}
        outputs={outputs}
        previewOnly={previewOnly}
        selectedAssetId={props.selectedAssetId}
        thumbnailUrl={props.thumbnailUrl}
        onCancel={props.onCancel}
        onRetry={props.onRetry}
        onDismiss={props.onDismiss}
        onDelete={() => {
          setDeleting({
            title: job.prompt || job.title || "AI 模型",
            assetIds: outputs.map((asset) => asset.id)
          });
        }}
        onSelectOutput={(assetId) => {
          props.onSelect(assetId);
          if (previewOnly) setDialogOpen(false);
        }}
      />
    );
  }

  function renderOrphan(asset: AssetSnapshot, previewOnly = false) {
    const selected = asset.id === props.selectedAssetId;
    return (
      <article className={`model-job-card status-succeeded${selected ? " selected" : ""}`} key={`asset-${asset.id}`}>
        <div
          className="model-job-main clickable"
          role="button"
          tabIndex={0}
          title="点击查看模型"
          onClick={() => props.onSelect(asset.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              props.onSelect(asset.id);
            }
          }}
        >
          <div className="model-job-inputs"><span><Icon name="cube" size={20} /></span></div>
          <div><strong title={asset.name}>{asset.name}</strong><small>已恢复模型文件 · {formatBytes(asset.byteSize)}</small></div>
          <b>完成</b>
        </div>
        {!previewOnly && <footer>
          <button type="button" className="button button-secondary" onClick={() => props.onSelect(asset.id)}>查看模型</button>
          <button type="button" className="icon-button danger-button" title="删除模型" aria-label="删除模型" onClick={() => setDeleting({ title: asset.name, assetIds: [asset.id] })}><Icon name="trash" size={14} /></button>
        </footer>}
      </article>
    );
  }

  return (
    <>
      <aside className={`modeling-model-list-panel ${props.expanded ? "list-expanded" : "list-collapsed"}`}>
        <header>
          <div>
            <strong>AI 模型</strong>
            <span>{completedModelCount} 个模型</span>
          </div>
          <div className="modeling-model-list-actions">
            <button
              type="button"
              className="icon-button"
              title="查看全部 AI 模型"
              aria-label="查看全部 AI 模型"
              onClick={() => setDialogOpen(true)}
            >
              <Icon name="library" size={16} />
            </button>
            <button
              type="button"
              className="icon-button modeling-model-list-toggle"
              aria-label={props.expanded ? "收起 AI 模型" : "展开 AI 模型"}
              aria-expanded={props.expanded}
              onClick={() => props.onExpandedChange(!props.expanded)}
            >
              <Icon name="chevron" size={16} />
            </button>
          </div>
        </header>
        <div className="modeling-model-list">
          {jobs.map((job) => renderJob(job))}
          {orphanAssets.map((asset) => renderOrphan(asset))}
          {jobs.length === 0 && orphanAssets.length === 0 && (
            <div className="modeling-model-empty">
              <Icon name="cube" size={25} />
              <span>创建建模任务后会显示在这里</span>
            </div>
          )}
        </div>
      </aside>

      {dialogOpen && (
        <div className="modal-backdrop model-list-dialog-backdrop" onMouseDown={() => setDialogOpen(false)}>
          <section
            className="model-list-dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-list-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <strong id="model-list-dialog-title">全部 AI 模型</strong>
                <span>{completedModelCount} 个模型 · {jobs.length} 个任务</span>
              </div>
              <button type="button" className="icon-button" aria-label="关闭 AI 模型列表" onClick={() => setDialogOpen(false)}>
                <Icon name="close" size={18} />
              </button>
            </header>
            <div className="model-list-dialog-toolbar">
              <div className="asset-picker-tabs" role="tablist" aria-label="模型任务状态">
                {MODEL_JOB_FILTERS.map(([value, label]) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={dialogStatus === value}
                    className={dialogStatus === value ? "active" : ""}
                    key={value}
                    onClick={() => setDialogStatus(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="asset-picker-search">
                <span>搜索</span>
                <input
                  value={dialogSearch}
                  onChange={(event) => setDialogSearch(event.target.value)}
                  placeholder="名称、供应商或模型"
                  autoFocus
                />
              </label>
            </div>
            <div className="model-list-dialog-content">
              {dialogJobs.map((job) => renderJob(job, true))}
              {dialogStatus !== "failed" && dialogStatus !== "active" && orphanAssets.map((asset) => renderOrphan(asset, true))}
              {dialogJobs.length === 0 && (dialogStatus === "failed" || dialogStatus === "active" || orphanAssets.length === 0) && (
                <div className="modeling-model-empty">
                  <Icon name="cube" size={25} />
                  <span>没有符合条件的模型任务</span>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="删除模型"
          text={`确认删除“${deleting.title}”？该模型的所有输出格式文件都会从项目中移除。`}
          confirmText="确认删除"
          busy={deleteBusy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setDeleteBusy(true);
            try {
              await props.onDeleteModel(deleting.assetIds);
              setDeleting(null);
            } finally {
              setDeleteBusy(false);
            }
          }}
        />
      )}
    </>
  );
}

type ModelJobFilter = "all" | "active" | "succeeded" | "failed";

const MODEL_JOB_FILTERS: ReadonlyArray<readonly [ModelJobFilter, string]> = [
  ["all", "全部"],
  ["active", "生成中"],
  ["succeeded", "已完成"],
  ["failed", "失败"]
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function matchesStatus(job: JobSnapshot, filter: ModelJobFilter): boolean {
  if (filter === "all") return true;
  if (filter === "active") return job.status === "queued" || job.status === "running";
  if (filter === "succeeded") return job.status === "succeeded";
  return job.status === "failed" || job.status === "cancelled" || job.status === "interrupted";
}
