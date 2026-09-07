import { useMemo, useRef, useState } from "react";
import type { ProjectAnimationSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import { useDialogKeyboard } from "../../lib/use-dialog-keyboard.js";
import { animationClipDisplayName } from "./AnimationClipPickerDialog.js";

interface ProjectAnimationPickerDialogProps {
  animations: ProjectAnimationSnapshot[];
  selectedId: string;
  loading: boolean;
  busy: boolean;
  error: string;
  onSelect: (animation: ProjectAnimationSnapshot) => Promise<boolean>;
  onClose: () => void;
}

export function ProjectAnimationPickerDialog(props: ProjectAnimationPickerDialogProps) {
  const [search, setSearch] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  useDialogKeyboard(dialogRef, props.onClose);
  const visible = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return props.animations.filter((animation) => !keyword || [
      animation.name, animation.originalName,
      ...animation.clips.flatMap((clip) => [clip.name, animationClipDisplayName(clip.name)])
    ].join(" ").toLocaleLowerCase("zh-CN").includes(keyword));
  }, [props.animations, search]);

  return (
    <div className="modal-backdrop animation-clip-picker-backdrop" onMouseDown={props.onClose}>
      <section
        ref={dialogRef}
        className="animation-clip-picker-dialog project-animation-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-animation-picker-title"
        aria-busy={props.loading || props.busy}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong id="project-animation-picker-title">项目动作库</strong>
            <span>{visible.length} / {props.animations.length} 个动画文件 · 点击加载预览</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭项目动作库" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <label className="animation-clip-picker-search">
          <Icon name="library" size={15} />
          <input
            aria-label="搜索项目动作"
            value={search}
            placeholder="搜索名称、文件名或动画片段"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {props.error && <p className="project-animation-picker-message field-error" role="alert">{props.error}</p>}
        {props.busy && <p className="project-animation-picker-message" role="status">正在加载动画…</p>}
        <div className="animation-clip-picker-content">
          {props.loading ? (
            <div className="animation-clip-picker-empty" role="status">正在加载项目动作库…</div>
          ) : visible.length === 0 ? (
            <div className="animation-clip-picker-empty">
              {props.animations.length === 0 ? "暂无导入动作，请在“模型与导入”中导入 UE5 动画。" : "没有符合条件的项目动作"}
            </div>
          ) : (
            <section><div>
              {visible.map((animation) => (
                <button
                  type="button"
                  key={animation.id}
                  className={props.selectedId === animation.id ? "active" : ""}
                  aria-current={props.selectedId === animation.id ? "true" : undefined}
                  disabled={props.busy}
                  title={`${animation.name}\n${animation.originalName}\n${animation.clips.map((clip) => animationClipDisplayName(clip.name)).join("、")}`}
                  onClick={async () => {
                    if (await props.onSelect(animation)) props.onClose();
                  }}
                >
                  <Icon name="pose" size={19} />
                  <span><strong>{animation.name}</strong><small>{animation.originalName}</small></span>
                  <span className="project-animation-picker-meta"><small>{animation.format.toUpperCase()}</small><small>{animation.clips.length} 个片段</small></span>
                </button>
              ))}
            </div></section>
          )}
        </div>
      </section>
    </div>
  );
}
