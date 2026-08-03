import { useEffect, useRef, useState } from "react";
import type { AssetSnapshot, JobSnapshot, PromptTemplateSnapshot } from "@lyra/contracts";
import type { ManualImageTaskInput } from "../features/generation/task-input.js";
import { ProviderModelSelects } from "../features/providers/ProviderModelSelects.js";
import { AssetPickerDialog } from "./AssetPickerDialog.js";
import { Icon } from "./Icon.js";

export type TaskEditorInput = ManualImageTaskInput;

interface TaskEditorProps {
  job: JobSnapshot | null;
  assets: AssetSnapshot[];
  initialAttachments: AssetSnapshot[];
  promptTemplates: PromptTemplateSnapshot[];
  providers: Array<{ id: string; name: string }>;
  models: Array<{ id: string; providerId: string; name: string }>;
  defaultModelId: string;
  busy: boolean;
  thumbnailUrl: (assetId: string) => string;
  onClose: () => void;
  onPreview: (asset: AssetSnapshot) => void;
  onUploadClick: () => void;
  onSubmit: (input: TaskEditorInput) => Promise<void>;
}

export function TaskEditor(props: TaskEditorProps) {
  const initialJobAssets = props.job?.inputs
    .map((input) => props.assets.find((asset) => asset.id === input.assetId))
    .filter((asset): asset is AssetSnapshot => Boolean(asset)) ?? [];
  const initialRatio = props.job?.parameters.aspectRatio;
  const [prompt, setPrompt] = useState(props.job?.prompt ?? "");
  const [attachments, setAttachments] = useState<AssetSnapshot[]>(
    props.job ? initialJobAssets : props.initialAttachments
  );
  const [modelId, setModelId] = useState(props.job?.providerModelId ?? props.defaultModelId);
  const [count, setCount] = useState(props.job?.count ?? 1);
  const [aspectRatio, setAspectRatio] = useState(typeof initialRatio === "string" ? initialRatio : "auto");
  const [pickerOpen, setPickerOpen] = useState(false);
  const promptMenuRef = useRef<HTMLDetailsElement>(null);
  const selectedModelLabel = props.models.find(
    (model) => model.id === modelId
  )?.name;
  const selectedProviderName = props.providers.find(
    (provider) =>
      provider.id === props.models.find((model) => model.id === modelId)?.providerId
  )?.name;
  const selectedProviderModelLabel = selectedModelLabel
    ? selectedProviderName
      ? `${selectedProviderName} / ${selectedModelLabel}`
      : selectedModelLabel
    : undefined;

  useEffect(() => {
    const closePromptMenu = (event: PointerEvent) => {
      const menu = promptMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("pointerdown", closePromptMenu);
    return () => document.removeEventListener("pointerdown", closePromptMenu);
  }, []);

  function selectPrompt(value: string) {
    setPrompt(value);
    if (promptMenuRef.current) promptMenuRef.current.open = false;
  }

  const availableAssets = props.assets.filter(
    (asset) => !attachments.some((item) => item.id === asset.id)
  );

  function moveAttachment(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= attachments.length) return;
    setAttachments((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <form
        className="task-editor"
        role="dialog"
        aria-modal="true"
        aria-label={props.job ? "重新创建任务" : "新建任务"}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!prompt.trim() || !modelId) return;
          void props.onSubmit({
            prompt: prompt.trim(),
            attachments,
            modelId,
            count,
            aspectRatio
          });
        }}
      >
        <header>
          <div>
            <strong>{props.job ? "基于已有任务重新创建" : "新建生图任务"}</strong>
            <span>{props.job ? `原任务：${props.job.title}` : "任务会添加到当前对话工作区"}</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭任务配置" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>

        <div className="task-editor-body">
          <section className="task-editor-main">
            <label className="field">
              <span>提示词</span>
              <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={6} autoFocus />
              <small>手动创建的任务会将提示词原样发送给生图接口。</small>
            </label>
            <details ref={promptMenuRef} className="prompt-menu task-editor-prompt-menu">
              <summary className="button button-secondary">提示词库</summary>
              <div className="prompt-menu-list">
                {props.promptTemplates.length === 0 ? (
                  <span>提示词库中暂无模板</span>
                ) : props.promptTemplates.map((template) => (
                  <button type="button" key={template.id} onClick={() => selectPrompt(template.content)} title={template.content}>
                    <strong>{template.name}</strong>
                    <span>{template.content}</span>
                  </button>
                ))}
              </div>
            </details>
            <div className="task-editor-fields">
              <ProviderModelSelects
                className="task-editor-provider-model"
                providers={props.providers}
                models={props.models}
                modelId={modelId}
                providerLabel="图片供应商"
                modelLabel="图片模型"
                onModelChange={setModelId}
              />
              <label className="field">
                <span>数量</span>
                <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
                  {[1, 2, 3, 4, 6, 8].map((value) => <option value={value} key={value}>{value} 张</option>)}
                </select>
              </label>
              <label className="field">
                <span>比例（可选）</span>
                <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
                  <option value="auto">自动（按参考图）</option>
                  {["1:1", "3:4", "4:3", "9:16", "16:9"].map((value) => <option value={value} key={value}>{value}</option>)}
                </select>
              </label>
              {selectedModelLabel && (
                <output className="task-editor-model-name" title={selectedProviderModelLabel}>
                  <span>当前模型：</span>
                  <strong>{selectedProviderModelLabel}</strong>
                </output>
              )}
            </div>
            <small className="task-editor-ratio-hint">选择“自动”时不强制指定比例，接口会按参考图或模型默认值处理。</small>

            <div className="task-attachment-section">
              <div className="task-section-heading">
                <strong>输入素材</strong>
                <span>{attachments.length} 张</span>
              </div>
              {attachments.length === 0 ? (
                <div className="task-attachment-empty">当前任务没有引用图片，将仅使用文字生成。</div>
              ) : (
                <div className="task-attachment-list">
                  {attachments.map((asset, index) => (
                    <article key={asset.id}>
                      <button type="button" className="task-attachment-preview" onClick={() => props.onPreview(asset)}>
                        <img src={props.thumbnailUrl(asset.id)} alt={asset.name} />
                        <b>图{index + 1}</b>
                      </button>
                      <div>
                        <strong title={asset.name}>{asset.name}</strong>
                        <span>{asset.source === "upload" ? "上传素材" : "生成图片"}</span>
                      </div>
                      <div className="task-attachment-actions">
                        <button type="button" disabled={index === 0} aria-label={`上移 ${asset.name}`} onClick={() => moveAttachment(index, -1)}>↑</button>
                        <button type="button" disabled={index === attachments.length - 1} aria-label={`下移 ${asset.name}`} onClick={() => moveAttachment(index, 1)}>↓</button>
                        <button type="button" aria-label={`移除 ${asset.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== asset.id))}>
                          <Icon name="close" size={14} />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <aside className="task-asset-picker">
            <div className="task-section-heading">
              <strong>添加项目图片</strong>
              <span>{availableAssets.length} 张可用</span>
            </div>
            <p>上传素材和生成图片统一保存在当前项目的素材库中。</p>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPickerOpen(true)}
            >
              <Icon name="library" size={15} />打开素材库选择
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={props.onUploadClick}
            >
              <Icon name="plus" size={15} />上传新素材
            </button>
          </aside>
        </div>

        <footer>
          <button type="button" className="button button-secondary" onClick={props.onClose}>取消</button>
          <button type="submit" className="button button-primary" disabled={props.busy || !prompt.trim() || !modelId}>
            {props.busy ? "创建中" : props.job ? "重新创建任务" : "创建任务"}
          </button>
        </footer>
      </form>
      {pickerOpen && (
        <AssetPickerDialog
          assets={props.assets}
          attachmentOrder={new Map(attachments.map((asset, index) => [asset.id, index + 1]))}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={(asset) => {
            setAttachments((current) =>
              current.some((item) => item.id === asset.id)
                ? current.filter((item) => item.id !== asset.id)
                : [...current, asset]
            );
          }}
          onPreview={props.onPreview}
          onClose={() => setPickerOpen(false)}
          onUploadClick={props.onUploadClick}
          title="选择任务输入图片"
          description="上传素材和生成图片使用同一个项目素材库"
        />
      )}
    </div>
  );
}
