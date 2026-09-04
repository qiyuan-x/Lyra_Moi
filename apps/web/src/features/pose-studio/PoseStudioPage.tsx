import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import type { ApiClient } from "../../lib/api-client.js";
import {
  applyBodyTemplate,
  applyHandTemplate,
  getBuiltInPoseTemplates,
  mirrorPose
} from "./pose-presets.js";
import { posesEqual } from "./pose-editor-adapter.js";
import { PoseTemplateManagerDialog } from "./PoseTemplateManagerDialog.js";
import { PoseTemplatePickerDialog } from "./PoseTemplatePickerDialog.js";
import { PoseViewport, type PoseViewportHandle } from "./PoseViewport.js";
import { AnimationModelWorkspace } from "./AnimationModelWorkspace.js";
import type { ImportedPoseTemplate } from "./pose-template-transfer.js";
import { createPreviewDataUrl } from "../templates/template-archive.js";
import {
  clonePose,
  createNeutralPose,
  createNeutralTransform,
  jointLabels,
  readPoseSnapshot,
  type JointId,
  type MannequinId,
  type PoseCaptureOptions,
  type PoseSnapshot,
  type PoseTemplate,
  type PoseTemplateKind,
  type TransformMode
} from "./pose-types.js";

interface PoseStudioPageProps {
  projectId: string;
  api: ApiClient;
  onSaveScreenshot: (file: File) => Promise<void>;
}

const customTemplateStorageKey = "lyra.poseStudio.customTemplates.v2";
const mannequinStorageKey = "lyra.poseStudio.mannequin";
const skeletonStorageKey = "lyra.poseStudio.skeleton";
const transformLabels: Record<TransformMode, string> = {
  translate: "移动",
  rotate: "旋转",
  scale: "缩放"
};

export function PoseStudioPage(props: PoseStudioPageProps) {
  const viewportRef = useRef<PoseViewportHandle>(null);
  const [studioMode, setStudioMode] = useState<"mannequin" | "ue5Actions" | "animation">("mannequin");
  const [pose, setPose] = useState<PoseSnapshot>(() => readProjectPose(props.projectId));
  const [selectedJoint, setSelectedJoint] = useState<JointId>("root");
  const [transformMode, setTransformMode] = useState<TransformMode>("rotate");
  const [mannequin, setMannequin] = useState<MannequinId>(readMannequin);
  const [skeletonOptions, setSkeletonOptions] = useState(readSkeletonOptions);
  const [history, setHistory] = useState<PoseSnapshot[]>([]);
  const [future, setFuture] = useState<PoseSnapshot[]>([]);
  const [customTemplates, setCustomTemplates] = useState<PoseTemplate[]>(readCustomTemplates);
  const [templateName, setTemplateName] = useState("");
  const [templateKind, setTemplateKind] = useState<PoseTemplateKind>("body");
  const [templateSide, setTemplateSide] = useState<"left" | "right">("left");
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [managingTemplates, setManagingTemplates] = useState(false);
  const [pickingTemplateKind, setPickingTemplateKind] = useState<PoseTemplateKind | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [modelError, setModelError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [previewOpen, setPreviewOpen] = useState(
    () => !window.matchMedia("(max-width: 40rem)").matches
  );
  const [controlsOpen, setControlsOpen] = useState(
    () => !window.matchMedia("(max-width: 40rem)").matches
  );
  const [templatesOpen, setTemplatesOpen] = useState(
    () => !window.matchMedia("(max-width: 40rem)").matches
  );
  const [captureOptions, setCaptureOptions] = useState<PoseCaptureOptions>({
    aspectRatio: "1:1",
    resolution: 1024,
    background: "dark",
    showGrid: false
  });

  const templates = useMemo(
    () => [...getBuiltInPoseTemplates(mannequin), ...customTemplates],
    [customTemplates, mannequin]
  );
  const bodyTemplates = templates.filter((template) => template.kind === "body");
  const handTemplates = templates.filter((template) => template.kind === "hand");

  useEffect(() => {
    setPose(readProjectPose(props.projectId));
    setHistory([]);
    setFuture([]);
  }, [props.projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(projectPoseStorageKey(props.projectId), JSON.stringify(pose));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [pose, props.projectId]);

  useEffect(() => {
    localStorage.setItem(mannequinStorageKey, mannequin);
  }, [mannequin]);

  useEffect(() => {
    localStorage.setItem(skeletonStorageKey, JSON.stringify(skeletonOptions));
  }, [skeletonOptions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
        } else if (key === "y") {
          event.preventDefault();
          redo();
        }
        return;
      }
      if (key === "w") setTransformMode("translate");
      else if (key === "r") setTransformMode("rotate");
      else if (key === "s") setTransformMode("scale");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function commitPose(nextPose: PoseSnapshot) {
    if (posesEqual(pose, nextPose)) return;
    setHistory((current) => [...current.slice(-59), clonePose(pose)]);
    setFuture([]);
    setPose(clonePose(nextPose));
  }

  function commitViewportPose(before: PoseSnapshot, after: PoseSnapshot) {
    if (posesEqual(before, after)) return;
    setHistory((current) => [...current.slice(-59), clonePose(before)]);
    setFuture([]);
    setPose(clonePose(after));
  }

  function undo() {
    setHistory((current) => {
      const previous = current.at(-1);
      if (!previous) return current;
      setFuture((items) => [clonePose(pose), ...items].slice(0, 60));
      setPose(clonePose(previous));
      return current.slice(0, -1);
    });
  }

  function redo() {
    setFuture((current) => {
      const next = current[0];
      if (!next) return current;
      setHistory((items) => [...items.slice(-59), clonePose(pose)]);
      setPose(clonePose(next));
      return current.slice(1);
    });
  }

  function resetSelectedBone() {
    const next = clonePose(pose);
    if (selectedJoint === "root") next.root = createNeutralTransform();
    else next.bones[selectedJoint] = createNeutralTransform();
    commitPose(next);
  }

  function resetPoseAndCamera() {
    const neutralPose = createNeutralPose();
    commitPose(neutralPose);
    viewportRef.current?.reset(neutralPose);
  }

  function editAnimationFrame(nextPose: PoseSnapshot, nextMannequin: MannequinId) {
    if (!posesEqual(pose, nextPose)) {
      setHistory((current) => [...current.slice(-59), clonePose(pose)]);
    }
    setFuture([]);
    setMannequin(nextMannequin);
    setPose(clonePose(nextPose));
    setSelectedJoint("pelvis");
    setStudioMode("mannequin");
  }

  function saveCustomTemplate() {
    const name = templateName.trim();
    if (!name) return;
    void addCustomTemplates([{
      name,
      pose,
      kind: templateKind,
      ...(templateKind === "hand" ? { sourceSide: templateSide } : {})
    }]);
    setTemplateName("");
    setCreatingTemplate(false);
  }

  async function addCustomTemplates(imported: ImportedPoseTemplate[]) {
    const prepared = await Promise.all(imported.map(async (item) => ({
      ...item,
      ...(item.preview ? { previewDataUrl: await createPreviewDataUrl(item.preview) } : {})
    })));
    setCustomTemplates((current) => {
      const next = [...current];
      for (const item of prepared) {
        next.push({
          id: `custom-${Date.now()}-${crypto.randomUUID()}`,
          name: uniqueTemplateName(item.name, next),
          pose: clonePose(item.pose),
          builtIn: false,
          kind: item.kind,
          ...(item.previewDataUrl ? { previewDataUrl: item.previewDataUrl } : {}),
          ...(item.kind === "hand" ? { sourceSide: item.sourceSide ?? "left" } : {})
        });
      }
      persistCustomTemplates(next);
      return next;
    });
  }

  function deleteCustomTemplate(templateId: string) {
    setCustomTemplates((current) => {
      const next = current.filter((template) => template.id !== templateId);
      persistCustomTemplates(next);
      return next;
    });
  }

  async function saveScreenshot() {
    if (saving || !modelReady) return;
    setSaving(true);
    setSaveState("");
    try {
      const blob = await viewportRef.current?.capture(captureOptions);
      if (!blob) throw new Error("动作编辑器尚未就绪。");
      const now = new Date();
      const stamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
        "-",
        String(now.getHours()).padStart(2, "0"),
        String(now.getMinutes()).padStart(2, "0"),
        String(now.getSeconds()).padStart(2, "0")
      ].join("");
      await props.onSaveScreenshot(new File([blob], `动作参考-${stamp}.png`, { type: "image/png" }));
      setSaveState("已保存到当前项目素材库");
    } catch (error) {
      setSaveState(error instanceof Error ? error.message : "保存截图失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="pose-studio-page">
      <header className="pose-studio-toolbar">
        <div>
          <strong>动作参考</strong>
          <span>{studioMode === "mannequin"
            ? "编辑 UE5 小白人骨骼并保存动作。"
            : studioMode === "ue5Actions"
              ? "导入或查看 UE5 骨架动画。"
              : "直接查看导入模型原有骨骼和动画帧。"}</span>
          <nav className="pose-workspace-tabs" aria-label="动作参考模式">
            <button
              type="button"
              className={studioMode === "mannequin" ? "active" : ""}
              onClick={() => setStudioMode("mannequin")}
            >
              动作编辑
            </button>
            <button
              type="button"
              className={studioMode === "ue5Actions" ? "active" : ""}
              onClick={() => setStudioMode("ue5Actions")}
            >
              UE5 动画
            </button>
            <button
              type="button"
              className={studioMode === "animation" ? "active" : ""}
              onClick={() => setStudioMode("animation")}
            >
              其他骨骼动画
            </button>
          </nav>
        </div>
        {studioMode === "mannequin" && <div className="pose-toolbar-actions">
          <button type="button" className="button button-secondary" disabled={!history.length} onClick={undo}>撤销</button>
          <button type="button" className="button button-secondary" disabled={!future.length} onClick={redo}>重做</button>
          <button type="button" className="button button-secondary" onClick={() => commitPose(mirrorPose(pose))}>镜像</button>
          <button type="button" className="button button-secondary" onClick={resetPoseAndCamera}>复位</button>
          <button type="button" className="button button-primary" disabled={saving || !modelReady} onClick={() => void saveScreenshot()}>
            <Icon name="image" size={17} />
            {saving ? "正在保存" : "保存截图"}
          </button>
        </div>}
      </header>

      {studioMode !== "mannequin" ? (
        <AnimationModelWorkspace
          key={studioMode}
          mode={studioMode === "ue5Actions" ? "ue5" : "direct"}
          projectId={props.projectId}
          api={props.api}
          onSaveScreenshot={props.onSaveScreenshot}
          {...(studioMode === "ue5Actions" ? { onSendPoseToEditor: editAnimationFrame } : {})}
        />
      ) : <>
        <div className="pose-studio-layout">
        <aside className={`pose-template-panel${templatesOpen ? " open" : ""}`}>
          <button type="button" className="pose-mobile-panel-toggle" onClick={() => setTemplatesOpen((open) => !open)}>
            <strong>动作模板</strong>
            <Icon name="chevron" size={16} />
          </button>
          <div className="pose-panel-content">
            <header>
              <div><strong>动作模板</strong><span>{templates.length}</span></div>
              <div className="pose-template-header-actions">
                <button type="button" title="新建模板" aria-label="新建模板" onClick={() => setCreatingTemplate((open) => !open)}><Icon name="plus" size={15} /></button>
                <button type="button" title="管理模板" aria-label="管理模板" onClick={() => setManagingTemplates(true)}><Icon name="settings" size={15} /></button>
              </div>
            </header>
            {creatingTemplate && (
              <div className="pose-template-create">
                <input autoFocus value={templateName} placeholder="模板名称" onChange={(event) => setTemplateName(event.target.value)} />
                <select value={templateKind} onChange={(event) => setTemplateKind(event.target.value as PoseTemplateKind)}>
                  <option value="body">身体动作</option>
                  <option value="hand">手势</option>
                </select>
                {templateKind === "hand" && (
                  <select value={templateSide} onChange={(event) => setTemplateSide(event.target.value as "left" | "right")}>
                    <option value="left">采集左手</option>
                    <option value="right">采集右手</option>
                  </select>
                )}
                <div>
                  <button type="button" className="button button-quiet" onClick={() => setCreatingTemplate(false)}>取消</button>
                  <button type="button" className="button button-secondary" disabled={!templateName.trim()} onClick={saveCustomTemplate}>保存当前动作</button>
                </div>
              </div>
            )}
            <TemplateSection title="身体动作" count={bodyTemplates.length} onPick={() => setPickingTemplateKind("body")}>
              {bodyTemplates.slice(0, 3).map((template) => (
                <button type="button" className="pose-body-template" key={template.id} onClick={() => commitPose(applyBodyTemplate(pose, template.pose))}>
                  {template.previewDataUrl && <img src={template.previewDataUrl} alt="" />}
                  {template.name}
                </button>
              ))}
            </TemplateSection>
            <TemplateSection title="手势" count={handTemplates.length} onPick={() => setPickingTemplateKind("hand")}>
              {handTemplates.slice(0, 6).map((template) => (
                <div className="pose-hand-template" key={template.id}>
                  {template.previewDataUrl && <img src={template.previewDataUrl} alt="" />}
                  <span title={template.name}>{template.name}</span>
                  <button type="button" onClick={() => commitPose(applyHandTemplate(pose, template, "left"))}>左手</button>
                  <button type="button" onClick={() => commitPose(applyHandTemplate(pose, template, "right"))}>右手</button>
                </div>
              ))}
            </TemplateSection>
          </div>
        </aside>

        <div className="pose-stage-column">
          <PoseViewport
            ref={viewportRef}
            pose={pose}
            selectedJoint={selectedJoint}
            transformMode={transformMode}
            mannequin={mannequin}
            skeletonVisible={skeletonOptions.visible}
            skeletonInFront={skeletonOptions.inFront}
            previewOpen={previewOpen}
            captureOptions={captureOptions}
            onTogglePreview={() => setPreviewOpen((open) => !open)}
            onJointSelect={setSelectedJoint}
            onPosePreview={setPose}
            onPoseCommit={commitViewportPose}
            onLoading={() => {
              setModelReady(false);
              setModelError("");
            }}
            onReady={() => {
              setModelReady(true);
              setModelError("");
            }}
            onError={(error) => setModelError(error.message)}
          />
          <div className="pose-transform-tools pose-transform-tools-bottom" aria-label="变换工具">
            {(["translate", "rotate", "scale"] as const).map((mode) => (
              <button
                type="button"
                className={transformMode === mode ? "active" : ""}
                aria-pressed={transformMode === mode}
                title={`${transformLabels[mode]}（${mode === "translate" ? "W" : mode === "rotate" ? "R" : "S"}）`}
                key={mode}
                onClick={() => setTransformMode(mode)}
              >
                <kbd>{mode === "translate" ? "W" : mode === "rotate" ? "R" : "S"}</kbd>
                {transformLabels[mode]}
              </button>
            ))}
          </div>
          {!modelReady && (
            <div className={`pose-model-state${modelError ? " error" : ""}`}>
              <strong>{modelError ? "模型加载失败" : `正在加载 ${mannequin === "manny" ? "Manny" : "Quinn"}`}</strong>
              {modelError && <span>{modelError}</span>}
            </div>
          )}
          <footer className="pose-stage-help">
            <span>点击蓝色骨骼选择；W 移动、R 旋转、S 缩放；左键旋转，滚轮缩放，Shift + 中键平移。</span>
            {saveState && <strong>{saveState}</strong>}
          </footer>
        </div>

        <aside className={`pose-control-panel${controlsOpen ? " open" : ""}`}>
          <button type="button" className="pose-mobile-panel-toggle" onClick={() => setControlsOpen((open) => !open)}>
            <strong>模型与显示</strong>
            <Icon name="chevron" size={16} />
          </button>
          <div className="pose-panel-content">
            <ControlSection title="小白人模板">
              <label className="pose-field">
                <span>模型</span>
                <select value={mannequin} onChange={(event) => setMannequin(event.target.value as MannequinId)}>
                  <option value="manny">Manny（男性）</option>
                  <option value="quinn">Quinn（女性）</option>
                </select>
              </label>
            </ControlSection>

            <ControlSection title="骨骼显示">
              <div className="pose-selected-bone">
                <span>当前骨骼</span>
                <strong>{jointLabels[selectedJoint]}</strong>
              </div>
              <label className="pose-switch-field">
                <span>显示骨骼</span>
                <input type="checkbox" checked={skeletonOptions.visible} onChange={(event) => setSkeletonOptions((current) => ({ ...current, visible: event.target.checked }))} />
              </label>
              <label className="pose-switch-field">
                <span>骨骼置前</span>
                <input type="checkbox" checked={skeletonOptions.inFront} disabled={!skeletonOptions.visible} onChange={(event) => setSkeletonOptions((current) => ({ ...current, inFront: event.target.checked }))} />
              </label>
              <button type="button" className="button button-secondary" onClick={resetSelectedBone}>重置所选骨骼</button>
            </ControlSection>

            <ControlSection title="截图设置">
              <div className="pose-capture-grid">
                <label className="pose-field"><span>比例</span><select value={captureOptions.aspectRatio} onChange={(event) => setCaptureOptions((current) => ({ ...current, aspectRatio: event.target.value as PoseCaptureOptions["aspectRatio"] }))}>
                  <option value="1:1">1:1</option><option value="4:3">4:3</option><option value="3:4">3:4</option><option value="16:9">16:9</option><option value="9:16">9:16</option>
                </select></label>
                <label className="pose-field"><span>分辨率</span><select value={captureOptions.resolution} onChange={(event) => setCaptureOptions((current) => ({ ...current, resolution: Number(event.target.value) as 1024 | 2048 }))}>
                  <option value="1024">1024</option><option value="2048">2048</option>
                </select></label>
                <label className="pose-field"><span>背景</span><select value={captureOptions.background} onChange={(event) => setCaptureOptions((current) => ({ ...current, background: event.target.value as PoseCaptureOptions["background"] }))}>
                  <option value="dark">深色</option><option value="light">浅色</option><option value="transparent">透明</option>
                </select></label>
                <label className="pose-check-field"><input type="checkbox" checked={captureOptions.showGrid} onChange={(event) => setCaptureOptions((current) => ({ ...current, showGrid: event.target.checked }))} /><span>截图显示地面网格</span></label>
              </div>
            </ControlSection>
          </div>
        </aside>
        </div>

        {managingTemplates && (
        <PoseTemplateManagerDialog
          templates={templates}
          onClose={() => setManagingTemplates(false)}
          onImport={addCustomTemplates}
          onDelete={deleteCustomTemplate}
          onCapturePreview={(template) => {
            const viewport = viewportRef.current;
            if (!viewport || !modelReady) {
              return Promise.reject(new Error("动作编辑器尚未就绪。"));
            }
            return viewport.capturePose(template.pose, {
              ...captureOptions,
              resolution: 1024
            });
          }}
        />
        )}
        {pickingTemplateKind && (
        <PoseTemplatePickerDialog
          kind={pickingTemplateKind}
          templates={templates}
          onClose={() => setPickingTemplateKind(null)}
          onApplyBody={(template) => commitPose(applyBodyTemplate(pose, template.pose))}
          onApplyHand={(template, side) => commitPose(applyHandTemplate(pose, template, side))}
        />
        )}
      </>}
    </section>
  );
}

function ControlSection(props: { title: string; children: React.ReactNode }) {
  return <section className="pose-control-section"><header>{props.title}</header>{props.children}</section>;
}

function TemplateSection(props: {
  title: string;
  count: number;
  children: React.ReactNode;
  onPick: () => void;
}) {
  return (
    <section className="pose-template-section">
      <header>
        <div><strong>{props.title}</strong><span>{props.count}</span></div>
        <button
          type="button"
          className="icon-button pose-template-pick-button"
          title={`选择${props.title}模板`}
          aria-label={`选择${props.title}模板`}
          onClick={props.onPick}
        >
          <Icon name="library" size={15} />
        </button>
      </header>
      <div>{props.children}</div>
    </section>
  );
}

function uniqueTemplateName(name: string, templates: PoseTemplate[]): string {
  const names = new Set(templates.map((template) => template.name));
  if (!names.has(name)) return name;
  let index = 2;
  while (names.has(`${name} (${index})`)) index += 1;
  return `${name} (${index})`;
}

function projectPoseStorageKey(projectId: string) {
  return `lyra.poseStudio.project.v2.${projectId}`;
}

function readProjectPose(projectId: string): PoseSnapshot {
  try {
    const value = JSON.parse(localStorage.getItem(projectPoseStorageKey(projectId)) ?? "null") as unknown;
    return readPoseSnapshot(value) ?? createNeutralPose();
  } catch {
    return createNeutralPose();
  }
}

function readMannequin(): MannequinId {
  return localStorage.getItem(mannequinStorageKey) === "quinn" ? "quinn" : "manny";
}

function readSkeletonOptions(): { visible: boolean; inFront: boolean } {
  try {
    const value = JSON.parse(localStorage.getItem(skeletonStorageKey) ?? "null") as unknown;
    if (value && typeof value === "object") {
      const options = value as { visible?: unknown; inFront?: unknown };
      return {
        visible: options.visible !== false,
        inFront: options.inFront !== false
      };
    }
  } catch {
    // Use defaults.
  }
  return { visible: true, inFront: true };
}

function readCustomTemplates(): PoseTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(customTemplateStorageKey) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const template = item as Partial<PoseTemplate>;
      const pose = readPoseSnapshot(template.pose);
      if (typeof template.id !== "string" || typeof template.name !== "string" || !pose) return [];
      const kind: PoseTemplateKind = template.kind === "hand" ? "hand" : "body";
      return [{
        id: template.id,
        name: template.name,
        pose,
        builtIn: false,
        kind,
        ...(typeof template.previewDataUrl === "string" && template.previewDataUrl.startsWith("data:image/")
          ? { previewDataUrl: template.previewDataUrl }
          : {}),
        ...(kind === "hand" ? { sourceSide: template.sourceSide === "right" ? "right" as const : "left" as const } : {})
      }];
    });
  } catch {
    return [];
  }
}

function persistCustomTemplates(templates: PoseTemplate[]) {
  localStorage.setItem(customTemplateStorageKey, JSON.stringify(templates));
}
