import { useRef, useState, type ChangeEvent } from "react";
import { Icon } from "../../components/Icon.js";
import {
  createPoseTemplateArchive,
  createPoseTemplateExport,
  parsePoseTemplateFile,
  type ImportedPoseTemplate
} from "./pose-template-transfer.js";
import type { PoseTemplate } from "./pose-types.js";
import { downloadBlob } from "../templates/template-archive.js";

interface PoseTemplateManagerDialogProps {
  templates: PoseTemplate[];
  onClose: () => void;
  onImport: (templates: ImportedPoseTemplate[]) => Promise<void>;
  onDelete: (templateId: string) => void;
  onCapturePreview: (template: PoseTemplate) => Promise<Blob>;
}

export function PoseTemplateManagerDialog(props: PoseTemplateManagerDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState("");
  const [includePreviews, setIncludePreviews] = useState(true);
  const [busy, setBusy] = useState(false);
  const allSelected = props.templates.length > 0 &&
    props.templates.every((template) => selectedIds.has(template.id));

  function toggle(templateId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(templateId)) next.delete(templateId);
      else next.add(templateId);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds(allSelected
      ? new Set()
      : new Set(props.templates.map((template) => template.id)));
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const templates = await parsePoseTemplateFile(file);
      await props.onImport(templates);
      setFeedback(`已导入 ${templates.length} 个动作模板。`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "动作模板导入失败。");
    } finally {
      setBusy(false);
    }
  }

  async function exportSelected() {
    const payload = createPoseTemplateExport(props.templates, selectedIds);
    if (!payload.templates.length) return;
    setBusy(true);
    setFeedback("");
    try {
      if (!includePreviews) {
        downloadBlob(new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json;charset=utf-8"
        }), "lyra-pose-templates.json");
      } else {
        const previews = new Map<string, Blob>();
        for (const template of props.templates) {
          if (selectedIds.has(template.id)) {
            previews.set(template.id, await props.onCapturePreview(template));
          }
        }
        downloadBlob(
          await createPoseTemplateArchive(props.templates, selectedIds, previews),
          "lyra-pose-templates.lyra-template.zip"
        );
      }
      setFeedback(`已导出 ${payload.templates.length} 个动作模板。`);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "动作模板导出失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={props.onClose}>
      <div
        className="form-modal pose-template-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pose-template-manager-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong id="pose-template-manager-title">管理动作模板</strong>
            <span>导入、选择导出或删除自定义模板</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="pose-template-manager-actions">
          <input
            ref={inputRef}
            hidden
            type="file"
            accept="application/json,application/zip,.json,.zip"
            onChange={(event) => void importFile(event)}
          />
          <button type="button" className="button button-secondary" disabled={busy} onClick={() => inputRef.current?.click()}>
            导入
          </button>
          <button type="button" className="button button-secondary" disabled={!selectedIds.size || busy} onClick={() => void exportSelected()}>
            <Icon name="download" size={15} />
            导出{selectedIds.size ? ` (${selectedIds.size})` : ""}
          </button>
          <button type="button" className="button button-quiet" onClick={toggleAll}>
            {allSelected ? "取消全选" : "全选"}
          </button>
          <label className="pose-template-preview-option">
            <input
              type="checkbox"
              checked={includePreviews}
              disabled={busy}
              onChange={(event) => setIncludePreviews(event.target.checked)}
            />
            包含效果图
          </label>
        </div>
        {feedback && <p className="pose-template-feedback">{feedback}</p>}
        <div className="pose-template-manager-list">
          {props.templates.map((template) => (
            <article key={template.id}>
              {template.previewDataUrl && (
                <img src={template.previewDataUrl} alt={`${template.name} 效果图`} />
              )}
              <label>
                <input
                  type="checkbox"
                  checked={selectedIds.has(template.id)}
                  onChange={() => toggle(template.id)}
                />
                <span title={template.name}>{template.name}</span>
              </label>
              <small>{template.kind === "hand" ? "手势" : "身体"} · {template.builtIn ? "内置" : "自定义"}</small>
              {!template.builtIn && (
                <button
                  type="button"
                  className="icon-button danger-button"
                  title="删除模板"
                  aria-label={`删除 ${template.name}`}
                  onClick={() => {
                    props.onDelete(template.id);
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      next.delete(template.id);
                      return next;
                    });
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              )}
            </article>
          ))}
        </div>
        <footer>
          <button type="button" className="button button-primary" onClick={props.onClose}>完成</button>
        </footer>
      </div>
    </div>
  );
}
