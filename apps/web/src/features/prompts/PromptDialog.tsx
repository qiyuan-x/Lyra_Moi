import { useState, type FormEvent } from "react";
import type {
  AssetSnapshot,
  CreatePromptTemplateRequestBody,
  PromptTemplateSnapshot
} from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import { PromptPreviewPickerDialog } from "./PromptPreviewPickerDialog.js";

interface PromptDialogProps {
  prompt: PromptTemplateSnapshot | null;
  busy: boolean;
  onClose: () => void;
  generatedImages: AssetSnapshot[];
  thumbnailUrl: (assetId: string) => string;
  previewUrl: (promptId: string) => string;
  onSave: (
    value: CreatePromptTemplateRequestBody,
    preview: PromptPreviewSelection
  ) => Promise<void>;
}

export type PromptPreviewSelection =
  | { type: "keep" }
  | { type: "remove" }
  | { type: "asset"; assetId: string };

export function PromptDialog(props: PromptDialogProps) {
  const [name, setName] = useState(props.prompt?.name ?? "");
  const [category, setCategory] = useState(props.prompt?.category ?? "");
  const [note, setNote] = useState(props.prompt?.note ?? "");
  const [content, setContent] = useState(props.prompt?.content ?? "");
  const [favorite, setFavorite] = useState(props.prompt?.favorite ?? false);
  const [previewChoice, setPreviewChoice] = useState(
    props.prompt?.previewMimeType ? "__keep" : "__none"
  );
  const [previewPickerOpen, setPreviewPickerOpen] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !content.trim()) return;
    const preview: PromptPreviewSelection = previewChoice === "__keep"
      ? { type: "keep" }
      : previewChoice === "__none"
        ? { type: "remove" }
        : { type: "asset", assetId: previewChoice };
    void props.onSave({
      name: name.trim(),
      category: category.trim(),
      note: note.trim() || null,
      content: content.trim(),
      favorite
    }, preview);
  }

  const selectedImage = props.generatedImages.find((item) => item.id === previewChoice);
  const currentPreview = props.prompt?.previewMimeType
    ? {
        name: `${props.prompt.name} 当前效果图`,
        url: versionedUrl(props.previewUrl(props.prompt.id), props.prompt.updatedAt)
      }
    : null;
  const selectedPreview = selectedImage
    ? { name: selectedImage.name, url: props.thumbnailUrl(selectedImage.id) }
    : previewChoice === "__keep" && currentPreview
      ? currentPreview
      : null;

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <form
        className="form-modal prompt-form-modal"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong>{props.prompt ? "编辑提示词" : "新建提示词"}</strong>
            <span>保存后可以在生图输入框中快速填充。</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="form-body form-grid">
          <label className="field">
            <span>名称</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              autoFocus
            />
          </label>
          <label className="field">
            <span>分类</span>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              maxLength={80}
              placeholder="例如：角色设计"
            />
          </label>
          <label className="field form-wide">
            <span>建议模型</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              placeholder="例如：Nano Banana 效果更好"
            />
          </label>
          <div className="field form-wide prompt-preview-field">
            <span>效果图（可选）</span>
            <button
              type="button"
              className="prompt-preview-trigger"
              aria-label="选择效果图"
              onClick={() => setPreviewPickerOpen(true)}
            >
              {selectedPreview ? (
                <img src={selectedPreview.url} alt="" />
              ) : (
                <span className="prompt-preview-trigger-placeholder"><Icon name="image" size={24} /></span>
              )}
              <span>
                <strong>{selectedPreview?.name ?? "不使用效果图"}</strong>
                <small>点击打开图片选择窗口</small>
              </span>
              <Icon name="chevron" size={17} />
            </button>
            <small>可从当前项目已经生成的图片中选择。</small>
          </div>
          <label className="field form-wide">
            <span>提示词内容</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={10000}
              rows={8}
            />
          </label>
          <label className="checkbox-field form-wide">
            <input
              type="checkbox"
              checked={favorite}
              onChange={(event) => setFavorite(event.target.checked)}
            />
            加入收藏
          </label>
        </div>
        <footer>
          <button type="button" className="button button-secondary" onClick={props.onClose}>
            取消
          </button>
          <button
            type="submit"
            className="button button-primary"
            disabled={props.busy || !name.trim() || !content.trim()}
          >
            {props.busy ? "保存中…" : "保存"}
          </button>
        </footer>
        {previewPickerOpen && (
          <PromptPreviewPickerDialog
            images={props.generatedImages}
            selectedId={previewChoice}
            currentPreview={currentPreview}
            thumbnailUrl={props.thumbnailUrl}
            onClose={() => setPreviewPickerOpen(false)}
            onConfirm={(selectedId) => {
              setPreviewChoice(selectedId);
              setPreviewPickerOpen(false);
            }}
          />
        )}
      </form>
    </div>
  );
}

function versionedUrl(url: string, version: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}
