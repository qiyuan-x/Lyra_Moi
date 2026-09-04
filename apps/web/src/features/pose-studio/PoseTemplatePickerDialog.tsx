import { useEffect, useMemo, useState } from "react";
import { Icon } from "../../components/Icon.js";
import type { PoseTemplate, PoseTemplateKind } from "./pose-types.js";

interface PoseTemplatePickerDialogProps {
  kind: PoseTemplateKind;
  templates: PoseTemplate[];
  onApplyBody: (template: PoseTemplate) => void;
  onApplyHand: (template: PoseTemplate, side: "left" | "right") => void;
  onClose: () => void;
}

export function PoseTemplatePickerDialog(props: PoseTemplatePickerDialogProps) {
  const [search, setSearch] = useState("");
  const title = props.kind === "body" ? "选择身体动作" : "选择手势";
  const visibleTemplates = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return props.templates.filter((template) => (
      template.kind === props.kind &&
      (!keyword || template.name.toLocaleLowerCase("zh-CN").includes(keyword))
    ));
  }, [props.kind, props.templates, search]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [props.onClose]);

  return (
    <div className="modal-backdrop pose-template-picker-backdrop" onMouseDown={props.onClose}>
      <section
        className="pose-template-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pose-template-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong id="pose-template-picker-title">{title}</strong>
            <span>共 {props.templates.filter((template) => template.kind === props.kind).length} 个模板</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭模板选择" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <label className="pose-template-picker-search">
          <Icon name="library" size={15} />
          <input
            autoFocus
            value={search}
            placeholder="搜索模板"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className={`pose-template-picker-grid ${props.kind}`}>
          {visibleTemplates.length === 0 ? (
            <div className="pose-template-picker-empty">没有符合条件的模板</div>
          ) : visibleTemplates.map((template) => (
            props.kind === "body" ? (
              <button
                type="button"
                className="pose-template-picker-item body"
                key={template.id}
                onClick={() => {
                  props.onApplyBody(template);
                  props.onClose();
                }}
              >
                <TemplatePreview template={template} />
                <span>{template.name}</span>
              </button>
            ) : (
              <article className="pose-template-picker-item hand" key={template.id}>
                <TemplatePreview template={template} />
                <strong title={template.name}>{template.name}</strong>
                <div>
                  <button type="button" onClick={() => props.onApplyHand(template, "left")}>左手</button>
                  <button type="button" onClick={() => props.onApplyHand(template, "right")}>右手</button>
                </div>
              </article>
            )
          ))}
        </div>
      </section>
    </div>
  );
}

function TemplatePreview({ template }: { template: PoseTemplate }) {
  return template.previewDataUrl
    ? <img src={template.previewDataUrl} alt="" />
    : <span className="pose-template-picker-placeholder"><Icon name="pose" size={23} /></span>;
}
