import { useEffect, useMemo, useState } from "react";
import type { AssetSnapshot } from "@lyra/contracts";
import { Icon } from "./Icon.js";

export interface AssetPickerDialogProps {
  assets: AssetSnapshot[];
  attachmentOrder: Map<string, number>;
  thumbnailUrl: (assetId: string) => string;
  onToggleAttachment: (asset: AssetSnapshot) => void;
  onPreview?: (asset: AssetSnapshot) => void;
  onClose: () => void;
  onUploadClick?: () => void;
  title?: string;
  description?: string;
  submitLabel?: string;
  selectionMode?: "multiple" | "single";
}

export function AssetPickerDialog({
  assets,
  attachmentOrder,
  thumbnailUrl,
  onToggleAttachment,
  onPreview,
  onClose,
  onUploadClick,
  title = "选择引用图片",
  description = "可多选，选择后会按图片顺序发送给模型",
  submitLabel = "完成选择",
  selectionMode = "multiple"
}: AssetPickerDialogProps) {
  const [source, setSource] = useState<"all" | "upload" | "generated">("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    return assets.filter((asset) => {
      if (source !== "all" && asset.source !== source) return false;
      return !needle || `${asset.name} ${asset.originalName ?? ""} ${asset.tags.join(" ")}`
        .toLocaleLowerCase("zh-CN")
        .includes(needle);
    });
  }, [assets, search, source]);

  return (
    <div
      className="modal-backdrop asset-picker-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <section
        className="asset-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="asset-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong id="asset-picker-title">{title}</strong>
            <span>{description}</span>
          </div>
          <div className="asset-picker-header-actions">
            {onUploadClick && (
              <button type="button" className="button button-secondary" onClick={onUploadClick}>
                <Icon name="plus" size={14} />上传素材
              </button>
            )}
            <button type="button" className="icon-button" aria-label="关闭图片选择器" onClick={onClose}>
              <Icon name="close" size={18} />
            </button>
          </div>
        </header>
        <div className="asset-picker-toolbar">
          <div className="asset-picker-tabs" role="tablist" aria-label="图片来源">
            {([
              ["all", "全部"],
              ["upload", "上传素材"],
              ["generated", "生成图片"]
            ] as const).map(([value, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={source === value}
                className={source === value ? "active" : ""}
                key={value}
                onClick={() => setSource(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="asset-picker-search">
            <span>搜索</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="名称、标签或原文件名"
            />
          </label>
        </div>
        <div className="asset-picker-grid">
          {visible.length === 0 ? (
            <div className="asset-picker-empty">没有符合条件的图片</div>
          ) : visible.map((asset) => {
            const order = attachmentOrder.get(asset.id);
            return (
              <article className={`asset-picker-item${order ? " selected" : ""}`} key={asset.id}>
                <button
                  type="button"
                  title={`${order ? "取消选择" : "选择"} ${asset.name}`}
                  onClick={() => onToggleAttachment(asset)}
                >
                  <img src={thumbnailUrl(asset.id)} alt={asset.name} loading="lazy" />
                  {order && (
                    <span>
                      {selectionMode === "single"
                        ? <Icon name="confirm" size={13} />
                        : `图${order}`}
                    </span>
                  )}
                </button>
                <div>
                  <strong title={asset.name}>{asset.name}</strong>
                  <small>{asset.source === "upload" ? "上传素材" : "生成图片"}</small>
                </div>
                {onPreview && (
                  <button
                    type="button"
                    className="asset-picker-preview"
                    aria-label={`预览 ${asset.name}`}
                    onClick={() => onPreview(asset)}
                  >
                    <Icon name="expand" size={13} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
        <footer>
          <span>已选择 {attachmentOrder.size} 张</span>
          <button type="button" className="button button-primary" onClick={onClose}>
            {submitLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
