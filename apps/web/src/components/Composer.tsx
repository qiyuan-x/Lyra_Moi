import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import type { AssetSnapshot, PromptTemplateSnapshot } from "@lyra/contracts";
import { Icon } from "./Icon.js";

interface ComposerProps {
  attachments: AssetSnapshot[];
  prompt: string;
  promptTemplates: PromptTemplateSnapshot[];
  busy: boolean;
  thumbnailUrl: (assetId: string) => string;
  onPromptChange: (value: string) => void;
  onInsertPrompt: (value: string) => void;
  onRemove: (index: number) => void;
  onReorder: (from: number, to: number) => void;
  onPreview: (asset: AssetSnapshot) => void;
  onUpload: (files: File[]) => Promise<void>;
  onSubmit: () => Promise<void>;
}

export function Composer(props: ComposerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const promptMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closePromptMenu = (event: PointerEvent) => {
      const menu = promptMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    };
    document.addEventListener("pointerdown", closePromptMenu);
    return () => document.removeEventListener("pointerdown", closePromptMenu);
  }, []);

  function selectPrompt(value: string) {
    props.onInsertPrompt(value);
    if (promptMenuRef.current) promptMenuRef.current.open = false;
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (props.busy || (!props.prompt.trim() && props.attachments.length === 0)) return;
    await props.onSubmit();
  }

  async function uploadFiles(files: FileList | File[]) {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length) await props.onUpload(images);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    event.preventDefault();
    if (event.dataTransfer.files.length) void uploadFiles(event.dataTransfer.files);
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => void submit(event)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {props.attachments.length > 0 && (
        <div className="attachment-row" aria-label="已引用素材">
          {props.attachments.map((asset, index) => (
            <div
              className="attachment-chip"
              draggable
              key={`${asset.id}-${index}`}
              onDragStart={() => setDragIndex(index)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.stopPropagation();
                if (dragIndex !== null && dragIndex !== index) props.onReorder(dragIndex, index);
                setDragIndex(null);
              }}
            >
              <button type="button" className="attachment-preview" onClick={() => props.onPreview(asset)}>
                <img src={props.thumbnailUrl(asset.id)} alt={asset.name} />
                <span>图{index + 1}</span>
              </button>
              <button
                type="button"
                className="icon-button attachment-remove"
                aria-label={`移除图${index + 1}`}
                onClick={() => props.onRemove(index)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={props.prompt}
        onChange={(event) => props.onPromptChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void submit();
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.items)
            .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
            .map((item) => item.getAsFile())
            .filter((file): file is File => file !== null);
          if (files.length) {
            event.preventDefault();
            void props.onUpload(files);
          }
        }}
        placeholder="输入你想生成或修改的内容。可粘贴、拖入图片，或从工作区点击图片引用。"
        aria-label="生成提示词"
      />

      <div className="composer-footer">
        <div className="composer-tools">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              if (event.target.files) void uploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button type="button" className="button button-quiet" onClick={() => inputRef.current?.click()}>
            <Icon name="plus" size={16} />
            添加图片
          </button>
          <details ref={promptMenuRef} className="prompt-menu">
            <summary className="button button-quiet">
              <Icon name="prompt" size={16} />提示词库</summary>
            <div className="prompt-menu-panel">
              {props.promptTemplates.length > 0 ? (
                <>
                  <strong>模板</strong>
                  {props.promptTemplates.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      title={item.content}
                      onClick={() => selectPrompt(item.content)}
                    >
                      <span>{item.name}</span>
                      <small>{item.category || "未分类"}</small>
                    </button>
                  ))}
                </>
              ) : (
                <span className="muted">提示词库为空</span>
              )}
            </div>
          </details>
        </div>
        <div className="composer-actions">
          <span className="key-hint">Ctrl + Enter</span>
          <button
            type="submit"
            className="button button-primary"
            disabled={props.busy || (!props.prompt.trim() && props.attachments.length === 0)}
          >
            <Icon name="send" size={16} />
            {props.busy ? "发送中" : "发送"}
          </button>
        </div>
      </div>
    </form>
  );
}
