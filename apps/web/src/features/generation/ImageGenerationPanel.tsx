import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent
} from "react";
import type {
  AssetSnapshot,
  JobSnapshot,
  PromptTemplateSnapshot
} from "@lyra/contracts";
import { AssetPickerDialog } from "../../components/AssetPickerDialog.js";
import { Icon } from "../../components/Icon.js";
import { PromptTemplatePicker } from "../../components/PromptTemplatePicker.js";
import {
  IMAGE_RESOLUTIONS,
  isImageResolution,
  type ImageResolution
} from "./image-resolution.js";
import type { ManualImageTaskInput } from "./task-input.js";

interface ImageGenerationPanelProps {
  projectId: string;
  editingJob: JobSnapshot | null;
  assets: AssetSnapshot[];
  attachments: AssetSnapshot[];
  promptTemplates: PromptTemplateSnapshot[];
  modelId: string;
  onModelChange: (modelId: string) => void;
  busy: boolean;
  thumbnailUrl: (assetId: string) => string;
  onAttachmentsChange: (assets: AssetSnapshot[]) => void;
  onPreview: (asset: AssetSnapshot) => void;
  onUpload: (files: File[]) => Promise<void>;
  onCancelEdit: () => void;
  onSubmit: (input: ManualImageTaskInput) => Promise<void>;
}

export function ImageGenerationPanel(props: ImageGenerationPanelProps) {
  const persistedRef = useRef(readFormState(props.projectId));
  const [prompt, setPrompt] = useState(() => persistedRef.current.prompt);
  const [count, setCount] = useState(() => persistedRef.current.count);
  const [aspectRatio, setAspectRatio] = useState(
    () => persistedRef.current.aspectRatio
  );
  const [resolution, setResolution] = useState(
    () => persistedRef.current.resolution
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const job = props.editingJob;
    if (!job) return;
    setPrompt(job?.prompt ?? "");
    props.onModelChange(job.providerModelId);
    setCount(job?.count ?? 1);
    const ratio = job?.parameters.aspectRatio;
    setAspectRatio(typeof ratio === "string" ? ratio : "auto");
    const nextResolution = job?.parameters.resolution;
    setResolution(isImageResolution(nextResolution) ? nextResolution : "auto");
  }, [props.editingJob?.id]);

  useEffect(() => {
    try {
      localStorage.setItem(
        formStorageKey(props.projectId),
        JSON.stringify({ prompt, count, aspectRatio, resolution })
      );
    } catch {
      // The form remains usable when browser storage is unavailable.
    }
  }, [props.projectId, prompt, count, aspectRatio, resolution]);

  function moveAttachment(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= props.attachments.length) return;
    const next = [...props.attachments];
    [next[index], next[target]] = [next[target]!, next[index]!];
    props.onAttachmentsChange(next);
  }

  function resetForm() {
    setPrompt("");
    setCount(1);
    setAspectRatio("auto");
    setResolution("auto");
    props.onAttachmentsChange([]);
    props.onCancelEdit();
  }

  async function submit() {
    if (!prompt.trim() || !props.modelId || props.busy || submitting) return;
    setSubmitting(true);
    try {
      await props.onSubmit({
        prompt: prompt.trim(),
        attachments: props.attachments,
        modelId: props.modelId,
        count,
        aspectRatio,
        resolution
      });
      resetForm();
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadImages(files: FileList | File[]) {
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (images.length === 0 || uploading) return;
    setUploading(true);
    try {
      await props.onUpload(images);
    } catch {
      // The workspace upload handler reports the error.
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files.length > 0) {
      void uploadImages(event.dataTransfer.files);
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLElement>) {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadImages(files);
  }

  return (
    <aside className="image-generation-panel" onPaste={handlePaste}>
      <header>
        <div>
          <strong>{props.editingJob ? "编辑并重新生成" : "生成设置"}</strong>
        </div>
        {props.editingJob && (
          <button
            type="button"
            className="button button-quiet"
            onClick={resetForm}
          >
            新建
          </button>
        )}
      </header>

      <div className="image-generation-panel-body">
        <label className="field image-generation-prompt">
          <span>提示词 <em>*</em></span>
          <textarea
            value={prompt}
            rows={7}
            placeholder="描述要生成或修改的图片"
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>

        <PromptTemplatePicker
          templates={props.promptTemplates}
          buttonClassName="button button-secondary image-generation-prompt-picker"
          onSelect={setPrompt}
        />

        <div className="image-generation-compact-fields">
          <label className="field">
            <span>数量</span>
            <select value={count} onChange={(event) => setCount(Number(event.target.value))}>
              {[1, 2, 3, 4, 6, 8].map((value) => (
                <option value={value} key={value}>{value} 张</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>比例</span>
            <select value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value)}>
              <option value="auto">自动</option>
              {["1:1", "3:4", "4:3", "9:16", "16:9"].map((value) => (
                <option value={value} key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>分辨率</span>
            <select
              value={resolution}
              onChange={(event) => {
                const next = event.target.value;
                if (!isImageResolution(next)) return;
                setResolution(next);
                if (next !== "auto" && aspectRatio === "auto") {
                  setAspectRatio("1:1");
                }
              }}
            >
              {IMAGE_RESOLUTIONS.map((value) => (
                <option value={value} key={value}>
                  {value === "auto" ? "模型默认" : value}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="image-generation-ratio-note">
          具体分辨率由当前图片供应商转换，选择 2K 或 4K 会增加生成时间和费用。
        </p>

        <section
          className={`image-generation-inputs${dragActive ? " drag-active" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (
              !(event.relatedTarget instanceof Node) ||
              !event.currentTarget.contains(event.relatedTarget)
            ) {
              setDragActive(false);
            }
          }}
          onDrop={handleDrop}
        >
          <header>
            <strong>输入图片</strong>
            <span>{props.attachments.length} 张</span>
          </header>
          {props.attachments.length === 0 ? (
            <button
              type="button"
              className="image-generation-input-empty"
              onClick={() => setPickerOpen(true)}
            >
              <Icon name="image" size={20} />
              <span>未选择参考图片</span>
              <small>拖入、粘贴或选择图片，也可以仅使用文字生成</small>
            </button>
          ) : (
            <div className="image-generation-input-list">
              {props.attachments.map((asset, index) => (
                <article key={asset.id}>
                  <button type="button" onClick={() => props.onPreview(asset)}>
                    <img src={props.thumbnailUrl(asset.id)} alt={asset.name} />
                    <b>图{index + 1}</b>
                  </button>
                  <div>
                    <strong title={asset.name}>{asset.name}</strong>
                    <small>{asset.source === "upload" ? "上传素材" : "生成图片"}</small>
                  </div>
                  <div>
                    <button type="button" disabled={index === 0} aria-label={`上移 ${asset.name}`} onClick={() => moveAttachment(index, -1)}>↑</button>
                    <button type="button" disabled={index === props.attachments.length - 1} aria-label={`下移 ${asset.name}`} onClick={() => moveAttachment(index, 1)}>↓</button>
                    <button
                      type="button"
                      aria-label={`移除 ${asset.name}`}
                      onClick={() => props.onAttachmentsChange(
                        props.attachments.filter((item) => item.id !== asset.id)
                      )}
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          <div className="image-generation-input-actions">
            <button type="button" className="button button-secondary" onClick={() => setPickerOpen(true)}>
              <Icon name="library" size={15} />选择项目图片
            </button>
            <input
              ref={uploadRef}
              hidden
              type="file"
              accept="image/*"
              multiple
              onChange={(event) => {
                if (event.target.files) void uploadImages(event.target.files);
                event.target.value = "";
              }}
            />
            <button type="button" className="button button-quiet" disabled={uploading} onClick={() => uploadRef.current?.click()}>
              <Icon name="plus" size={15} />{uploading ? "上传中" : "上传图片"}
            </button>
          </div>
        </section>
      </div>

      <footer>
        <button
          type="button"
          className="button button-primary"
          disabled={!prompt.trim() || !props.modelId || props.busy || submitting}
          onClick={() => void submit()}
        >
          <Icon name="image" size={16} />
          {props.busy || submitting ? "正在提交" : props.editingJob ? "重新生成" : "生成图片"}
        </button>
      </footer>

      {pickerOpen && (
        <AssetPickerDialog
          assets={props.assets}
          attachmentOrder={new Map(
            props.attachments.map((asset, index) => [asset.id, index + 1])
          )}
          thumbnailUrl={props.thumbnailUrl}
          onToggleAttachment={(asset) => props.onAttachmentsChange(
            props.attachments.some((item) => item.id === asset.id)
              ? props.attachments.filter((item) => item.id !== asset.id)
              : [...props.attachments, asset]
          )}
          onPreview={props.onPreview}
          onClose={() => setPickerOpen(false)}
          title="选择输入图片"
          description="可选择当前项目中的上传素材或生成图片"
        />
      )}
    </aside>
  );
}

interface PersistedImageFormState {
  prompt: string;
  count: number;
  aspectRatio: string;
  resolution: ImageResolution;
}

function readFormState(projectId: string): PersistedImageFormState {
  const fallback: PersistedImageFormState = {
    prompt: "",
    count: 1,
    aspectRatio: "auto",
    resolution: "auto"
  };
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(formStorageKey(projectId)) ?? "null"
    );
    if (!isRecord(value)) return fallback;
    return {
      prompt: typeof value.prompt === "string" ? value.prompt : "",
      count: typeof value.count === "number" && [1, 2, 3, 4, 6, 8].includes(value.count)
        ? value.count
        : 1,
      aspectRatio: typeof value.aspectRatio === "string" ? value.aspectRatio : "auto",
      resolution: isImageResolution(value.resolution) ? value.resolution : "auto"
    };
  } catch {
    return fallback;
  }
}

function formStorageKey(projectId: string): string {
  return `lyra.image-generation.form.${projectId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
