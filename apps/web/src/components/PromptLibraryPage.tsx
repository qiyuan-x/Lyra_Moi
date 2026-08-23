import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type {
  AssetSnapshot,
  CreatePromptTemplateRequestBody,
  PromptTemplateSnapshot,
  UpdatePromptTemplateRequestBody
} from "@lyra/contracts";
import { ConfirmDialog } from "./ConfirmDialog.js";
import {
  PromptDialog,
  type PromptPreviewSelection
} from "../features/prompts/PromptDialog.js";
import {
  createPromptArchive,
  createPromptExportPayload,
  parsePromptImportFile
} from "../features/prompts/prompt-transfer.js";
import { downloadBlob } from "../features/templates/template-archive.js";
import { Icon } from "./Icon.js";

interface PromptLibraryPageProps {
  prompts: PromptTemplateSnapshot[];
  generatedImages: AssetSnapshot[];
  thumbnailUrl: (assetId: string) => string;
  contentUrl: (assetId: string) => string;
  previewUrl: (promptId: string) => string;
  onCreate: (value: CreatePromptTemplateRequestBody) => Promise<PromptTemplateSnapshot>;
  onUpdate: (promptId: string, value: UpdatePromptTemplateRequestBody) => Promise<PromptTemplateSnapshot>;
  onDelete: (promptId: string) => Promise<void>;
  onSetPreview: (promptId: string, file: Blob) => Promise<PromptTemplateSnapshot>;
  onDeletePreview: (promptId: string) => Promise<PromptTemplateSnapshot>;
}

type Feedback = { type: "error" | "success"; text: string } | null;

export function PromptLibraryPage(props: PromptLibraryPageProps) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [editing, setEditing] = useState<PromptTemplateSnapshot | "new" | null>(null);
  const [deleting, setDeleting] = useState<PromptTemplateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [favoriteBusyId, setFavoriteBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [selectedExportIds, setSelectedExportIds] = useState<Set<string>>(new Set());
  const [includePreviews, setIncludePreviews] = useState(true);
  const importInputRef = useRef<HTMLInputElement>(null);

  const categories = useMemo(
    () => [...new Set(props.prompts.map((prompt) => prompt.category).filter(Boolean))].sort(),
    [props.prompts]
  );
  const visible = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    return props.prompts.filter((prompt) => {
      if (category && prompt.category !== category) return false;
      if (favoritesOnly && !prompt.favorite) return false;
      return (
        !needle ||
        `${prompt.name} ${prompt.category} ${prompt.note ?? ""} ${prompt.content}`
          .toLocaleLowerCase("zh-CN")
          .includes(needle)
      );
    });
  }, [category, favoritesOnly, props.prompts, search]);
  const visibleExportable = visible;
  const allVisibleSelected =
    visibleExportable.length > 0 &&
    visibleExportable.every((item) => selectedExportIds.has(item.id));

  useEffect(() => {
    const ids = new Set(props.prompts.map((item) => item.id));
    setSelectedExportIds((current) => new Set([...current].filter((id) => ids.has(id))));
  }, [props.prompts]);

  function toggleExportSelection(promptId: string) {
    setSelectedExportIds((current) => {
      const next = new Set(current);
      if (next.has(promptId)) next.delete(promptId);
      else next.add(promptId);
      return next;
    });
  }

  function toggleVisibleSelection() {
    const visibleIds = visibleExportable.map((item) => item.id);
    setSelectedExportIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleIds.forEach((id) => next.delete(id));
      } else {
        visibleIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedExportIds(new Set());
  }

  async function exportPrompts() {
    const payload = createPromptExportPayload(props.prompts, selectedExportIds);
    if (!payload.prompts.length) return;
    setBusy(true);
    setFeedback(null);
    try {
      if (!includePreviews) {
        downloadBlob(new Blob(
          [JSON.stringify(payload, null, 2)],
          { type: "application/json;charset=utf-8" }
        ), "lyra-prompts.json");
      } else {
        const previews = new Map<string, Blob>();
        for (const prompt of props.prompts) {
          if (!selectedExportIds.has(prompt.id) || !prompt.previewMimeType) continue;
          const response = await fetch(props.previewUrl(prompt.id), { cache: "no-store" });
          if (!response.ok) throw new Error(`无法读取“${prompt.name}”的效果图。`);
          previews.set(prompt.id, await response.blob());
        }
        downloadBlob(
          await createPromptArchive(props.prompts, selectedExportIds, previews),
          "lyra-prompts.lyra-template.zip"
        );
      }
      setFeedback({ type: "success", text: `已导出 ${payload.prompts.length} 条提示词。` });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "提示词导出失败。"
      });
    } finally {
      setBusy(false);
    }
  }

  async function importPrompts(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFeedback(null);
    setBusy(true);
    try {
      const records = await parsePromptImportFile(file);
      // The parent prepends new records. Reverse the input to preserve JSON order.
      for (const record of [...records].reverse()) {
        const created = await props.onCreate(record.value);
        if (record.preview) await props.onSetPreview(created.id, record.preview);
      }
      setFeedback({ type: "success", text: `已导入 ${records.length} 条提示词。` });
    } catch (error) {
      setFeedback({
        type: "error",
        text: error instanceof Error ? error.message : "导入失败，请检查 JSON 文件。"
      });
    } finally {
      setBusy(false);
    }
  }

  async function toggleFavorite(prompt: PromptTemplateSnapshot) {
    if (favoriteBusyId) return;
    setFavoriteBusyId(prompt.id);
    try {
      await props.onUpdate(prompt.id, { favorite: !prompt.favorite });
    } catch {
      // The parent displays the API error.
    } finally {
      setFavoriteBusyId(null);
    }
  }

  return (
    <section className="library-page prompt-library-page">
      <header className="page-heading prompt-library-heading">
        <div className="prompt-library-heading-left">
          <div>
            <h1>提示词库</h1>
            <p>创建、导入、导出和管理提示词模板，生图时可以快速填充。</p>
          </div>
        </div>
        <div className="page-heading-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => setEditing("new")}
          >
            <Icon name="plus" size={16} />
            新建模板
          </button>
          <input
            ref={importInputRef}
            hidden
            type="file"
            accept="application/json,application/zip,.json,.zip"
            onChange={(event) => void importPrompts(event)}
          />
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => importInputRef.current?.click()}
          >
            导入
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={selectedExportIds.size === 0}
            onClick={() => void exportPrompts()}
          >
            <Icon name="download" size={15} />
            导出{selectedExportIds.size > 0 ? ` (${selectedExportIds.size})` : ""}
          </button>
        </div>
      </header>

      {feedback && (
        <p className={`prompt-feedback prompt-feedback-${feedback.type}`}>{feedback.text}</p>
      )}

      <div className="library-filters">
        <label className="search-field">
          <span>搜索</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="名称、建议模型或内容"
          />
        </label>
        <label>
          <span>分类</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">全部分类</option>
            {categories.map((item) => (
              <option value={item} key={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(event) => setFavoritesOnly(event.target.checked)}
          />
          只看收藏
        </label>
        <span className="filter-count">{visible.length} 项</span>
      </div>

      <div className="prompt-selection-bar">
        <div>
          <strong>提示词列表</strong>
          <span>选择需要导出的提示词</span>
        </div>
        <div className="prompt-selection-actions">
          <label className="checkbox-field prompt-export-preview-option">
            <input
              type="checkbox"
              checked={includePreviews}
              onChange={(event) => setIncludePreviews(event.target.checked)}
            />
            包含效果图
          </label>
          <span>
            已选择 <b>{selectedExportIds.size}</b> 项
          </span>
          <button
            type="button"
            className="button button-quiet"
            disabled={visibleExportable.length === 0}
            onClick={toggleVisibleSelection}
          >
            {allVisibleSelected ? "取消全选" : "全选当前"}
          </button>
          <button
            type="button"
            className="button button-quiet"
            disabled={selectedExportIds.size === 0}
            onClick={clearSelection}
          >
            清空选择
          </button>
        </div>
      </div>

      <div className="prompt-list" role="list">
        {visible.map((item) => (
          <article className="prompt-list-row" key={item.id}>
            <label className="prompt-row-select" title="选择导出">
              <input
                type="checkbox"
                checked={selectedExportIds.has(item.id)}
                onChange={() => toggleExportSelection(item.id)}
                aria-label={`选择导出 ${item.name}`}
              />
            </label>
            {item.previewMimeType && (
              <img
                className="prompt-row-preview"
                src={versionedUrl(props.previewUrl(item.id), item.updatedAt)}
                alt={`${item.name} 效果图`}
              />
            )}
            <div className="prompt-row-main">
              <div className="prompt-row-title">
                <h2 title={item.name}>{item.name}</h2>
                <span className="prompt-tag">{item.category || "未分类"}</span>
              </div>
              <p>{item.content}</p>
              <div className="prompt-row-meta">
                {item.note && (
                  <span className="prompt-model-note" title={item.note}>
                    <b>建议模型</b>
                    {item.note}
                  </span>
                )}
                <time dateTime={item.updatedAt}>
                  更新于 {new Date(item.updatedAt).toLocaleDateString("zh-CN")}
                </time>
              </div>
            </div>
            <div className="prompt-row-actions">
              <button
                type="button"
                className={`favorite-button${item.favorite ? " active" : ""}`}
                aria-label={item.favorite ? "取消收藏" : "收藏"}
                aria-pressed={item.favorite}
                title={item.favorite ? "取消收藏" : "收藏"}
                disabled={favoriteBusyId === item.id}
                onClick={() => void toggleFavorite(item)}
              >
                <Icon name="star" size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`编辑 ${item.name}`}
                title="编辑"
                onClick={() => setEditing(item)}
              >
                <Icon name="manual" size={16} />
              </button>
              <button
                type="button"
                className="icon-button danger-button"
                aria-label={`删除 ${item.name}`}
                title="删除"
                onClick={() => setDeleting(item)}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>

      {visible.length === 0 && (
        <div className="library-empty">
          <Icon name="prompt" size={28} />
          <strong>没有符合条件的模板</strong>
        </div>
      )}

      {editing && (
        <PromptDialog
          prompt={editing === "new" ? null : editing}
          busy={busy}
          generatedImages={props.generatedImages}
          thumbnailUrl={props.thumbnailUrl}
          previewUrl={props.previewUrl}
          onClose={() => setEditing(null)}
          onSave={async (value, preview) => {
            setBusy(true);
            try {
              const saved = editing === "new"
                ? await props.onCreate(value)
                : await props.onUpdate(editing.id, value);
              await applyPreviewSelection(saved, preview, props);
              setEditing(null);
            } catch {
              // The parent displays the API error.
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="删除提示词模板"
          text={`确认删除“${deleting.name}”吗？`}
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await props.onDelete(deleting.id);
              setDeleting(null);
            } catch {
              // The parent displays the API error.
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}

async function applyPreviewSelection(
  prompt: PromptTemplateSnapshot,
  selection: PromptPreviewSelection,
  props: PromptLibraryPageProps
): Promise<void> {
  if (selection.type === "keep") return;
  if (selection.type === "remove") {
    if (prompt.previewMimeType) await props.onDeletePreview(prompt.id);
    return;
  }
  const response = await fetch(props.contentUrl(selection.assetId));
  if (!response.ok) throw new Error("无法读取选择的生成图片。");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("选择的素材不是图片。");
  await props.onSetPreview(prompt.id, blob);
}

function versionedUrl(url: string, version: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}
