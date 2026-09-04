import { useEffect, useRef, useState } from "react";
import type { ProjectAnimationSnapshot } from "@lyra/contracts";
import { Icon } from "../../components/Icon.js";
import type { ApiClient } from "../../lib/api-client.js";
import {
  AnimationModelViewport,
  type AnimationModelViewportHandle
} from "./AnimationModelViewport.js";
import {
  AnimationClipPickerDialog,
  animationClipDisplayName
} from "./AnimationClipPickerDialog.js";
import type {
  AnimationClipInfo,
  AnimationModelInfo
} from "./animation-model-viewer-adapter.js";
import type { MannequinId, PoseCaptureOptions, PoseSnapshot } from "./pose-types.js";

interface AnimationModelWorkspaceProps {
  mode: "ue5" | "direct";
  projectId: string;
  api: ApiClient;
  onSaveScreenshot: (file: File) => Promise<void>;
  onSendPoseToEditor?: ((pose: PoseSnapshot, mannequin: MannequinId) => void) | undefined;
}

interface FrameBookmark {
  id: string;
  time: number;
  frame: number;
}

export function AnimationModelWorkspace(props: AnimationModelWorkspaceProps) {
  const viewportRef = useRef<AnimationModelViewportHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ue5FileInputRef = useRef<HTMLInputElement>(null);
  const [modelInfo, setModelInfo] = useState<AnimationModelInfo | null>(null);
  const [selectedClipIndex, setSelectedClipIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [skeletonVisible, setSkeletonVisible] = useState(true);
  const [mannequin, setMannequin] = useState<MannequinId>("manny");
  const [previewOpen, setPreviewOpen] = useState(
    () => !window.matchMedia("(max-width: 40rem)").matches
  );
  const [frameRate, setFrameRate] = useState<24 | 30 | 60>(30);
  const [bookmarks, setBookmarks] = useState<FrameBookmark[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [clipPickerOpen, setClipPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState("");
  const [captureOptions, setCaptureOptions] = useState<PoseCaptureOptions>({
    aspectRatio: "1:1",
    resolution: 1024,
    background: "dark",
    showGrid: false
  });
  const [projectAnimations, setProjectAnimations] = useState<ProjectAnimationSnapshot[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(props.mode === "ue5");
  const [importSectionOpen, setImportSectionOpen] = useState(props.mode !== "ue5");
  const [projectLibraryOpen, setProjectLibraryOpen] = useState(false);

  useEffect(() => {
    if (props.mode !== "ue5") return;
    let active = true;
    setLibraryLoading(true);
    void props.api.listProjectAnimations(props.projectId).then((items) => {
      if (active) setProjectAnimations(items);
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "项目动作库加载失败。");
    }).finally(() => {
      if (active) setLibraryLoading(false);
    });
    return () => { active = false; };
  }, [props.api, props.mode, props.projectId]);

  const selectedClip = modelInfo?.clips[selectedClipIndex] ?? null;
  const duration = selectedClip?.duration ?? 0;
  const currentFrame = Math.max(0, Math.round(time * frameRate));
  const totalFrames = Math.max(0, Math.ceil(duration * frameRate));

  useEffect(() => {
    if (clipPickerOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || loading || !selectedClip) return;
      if (isInteractiveKeyboardTarget(event.target)) return;
      event.preventDefault();
      const next = !playing;
      viewportRef.current?.setPlaying(next);
      setPlaying(next);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [clipPickerOpen, loading, playing, selectedClip]);

  async function loadFiles(fileList: FileList | readonly File[]) {
    const files = Array.from(fileList);
    if (files.length < 1) return;
    setModelInfo(null);
    setSelectedClipIndex(0);
    setTime(0);
    setPlaying(false);
    setBookmarks([]);
    setSaveState("");
    setError("");
    setLoading(true);
    try {
      await viewportRef.current?.load(files);
    } catch (loadError) {
      setLoading(false);
      setImportSectionOpen(true);
      setError(loadError instanceof Error ? loadError.message : "动画模型加载失败。");
    }
  }

  async function reloadUe5ActionLibrary() {
    if (loading) return;
    try {
      await viewportRef.current?.loadUe5ActionLibrary(mannequin);
    } catch (loadError) {
      setLoading(false);
      setImportSectionOpen(true);
      setError(loadError instanceof Error ? loadError.message : "UE5 动作库加载失败。");
    }
  }

  async function importUe5Animation(fileList: FileList | readonly File[]) {
    const files = Array.from(fileList).filter((item) => /\.(?:fbx|glb)$/iu.test(item.name));
    if (files.length < 1 || loading) return;
    setLoading(true);
    setError("");
    setSaveState("");
    const imported: ProjectAnimationSnapshot[] = [];
    const failures: string[] = [];
    try {
      for (const [index, file] of files.entries()) {
        try {
          const info = await viewportRef.current?.loadUe5Animation([file], mannequin);
          if (!info) throw new Error("动画查看器尚未就绪。");
          setLoading(true);
          const saved = await props.api.uploadProjectAnimation(
            props.projectId,
            file,
            info.clips.map((clip) => ({ name: clip.name, duration: clip.duration }))
          );
          imported.push(saved);
          setSaveState(`正在导入 ${index + 1} / ${files.length}`);
        } catch (loadError) {
          failures.push(`${file.name}：${loadError instanceof Error ? loadError.message : "导入失败"}`);
        }
      }
      if (imported.length > 0) {
        setProjectAnimations((current) => [
          ...imported.reverse(),
          ...current.filter((item) => !imported.some((saved) => saved.id === item.id))
        ]);
      }
      setSaveState(`已加入 ${imported.length} 个动作到当前项目动作库`);
      setError(failures.join("\n"));
    } finally {
      setLoading(false);
    }
  }

  async function openProjectAnimation(animation: ProjectAnimationSnapshot) {
    if (loading) return;
    setLoading(true);
    setError("");
    setSaveState("");
    try {
      const file = await props.api.downloadProjectAnimation(props.projectId, animation);
      await viewportRef.current?.loadUe5Animation([file], mannequin);
    } catch (loadError) {
      setLoading(false);
      setError(loadError instanceof Error ? loadError.message : "UE5 动画加载失败。");
    }
  }

  async function deleteProjectAnimation(animation: ProjectAnimationSnapshot) {
    try {
      await props.api.deleteProjectAnimation(props.projectId, animation.id);
      setProjectAnimations((current) => current.filter((item) => item.id !== animation.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除动作失败。");
    }
  }

  function sendCurrentFrameToEditor() {
    try {
      const value = viewportRef.current?.exportCurrentUe5Pose();
      if (!value) throw new Error("动画查看器尚未就绪。");
      props.onSendPoseToEditor?.(value.pose, value.mannequin);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "当前帧发送失败。");
    }
  }

  function selectClip(index: number) {
    setSelectedClipIndex(index);
    setTime(0);
    setPlaying(false);
    setBookmarks([]);
    viewportRef.current?.selectClip(index);
  }

  function changeTime(nextTime: number) {
    const next = Math.max(0, Math.min(duration, nextTime));
    setTime(next);
    viewportRef.current?.seek(next);
  }

  function stepFrame(direction: -1 | 1) {
    viewportRef.current?.setPlaying(false);
    setPlaying(false);
    changeTime(time + direction / frameRate);
  }

  function togglePlayback() {
    if (!selectedClip) return;
    const next = !playing;
    viewportRef.current?.setPlaying(next);
    setPlaying(next);
  }

  function addBookmark() {
    if (!selectedClip) return;
    setBookmarks((current) => {
      if (current.some((bookmark) => bookmark.frame === currentFrame)) return current;
      return [...current, {
        id: crypto.randomUUID(),
        time,
        frame: currentFrame
      }].sort((left, right) => left.time - right.time);
    });
  }

  async function saveScreenshot() {
    if (!modelInfo || saving) return;
    setSaving(true);
    setSaveState("");
    try {
      const blob = await viewportRef.current?.capture(captureOptions);
      if (!blob) throw new Error("动画查看器尚未就绪。");
      const clipName = sanitizeFileName(selectedClip?.name ?? "静态模型");
      const modelName = sanitizeFileName(modelInfo.fileName.replace(/\.[^.]+$/u, ""));
      await props.onSaveScreenshot(new File(
        [blob],
        `${modelName}-${clipName}-帧${currentFrame}.png`,
        { type: "image/png" }
      ));
      setSaveState("已保存到当前项目素材库");
    } catch (saveError) {
      setSaveState(saveError instanceof Error ? saveError.message : "保存截图失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animation-model-layout">
      <aside className="animation-model-sidebar">
        <section className={`animation-import-section animation-sidebar-collapsible${importSectionOpen ? " open" : ""}`}>
          <header>
            <button
              type="button"
              className="animation-sidebar-section-toggle"
              aria-expanded={importSectionOpen}
              onClick={() => setImportSectionOpen((open) => !open)}
            >
              <strong>模型与导入</strong>
              <span>{modelInfo?.fileName ?? (props.mode === "ue5" ? mannequinName(mannequin) : "")}</span>
              <Icon name="chevron" size={15} />
            </button>
          </header>
          {importSectionOpen && <div className="animation-sidebar-section-content">
          {props.mode === "ue5" ? (
            <>
              <input
                ref={ue5FileInputRef}
                type="file"
                accept=".fbx,.glb"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files) void importUe5Animation(event.target.files);
                  event.target.value = "";
                }}
              />
              <label className="pose-field">
                <span>小白人</span>
                <select value={mannequin} onChange={(event) => setMannequin(event.target.value as MannequinId)}>
                  <option value="manny">Manny</option>
                  <option value="quinn">Quinn</option>
                </select>
              </label>
              <button
                type="button"
                className="button button-secondary animation-library-button"
                disabled={loading}
                onClick={() => void reloadUe5ActionLibrary()}
              >
                <Icon name="retry" size={17} />
                内置动作库
              </button>
              <button
                type="button"
                className="animation-import-dropzone animation-ue5-import"
                disabled={loading}
                onClick={() => ue5FileInputRef.current?.click()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  void importUe5Animation(event.dataTransfer.files);
                }}
              >
                <Icon name="plus" size={22} />
                <strong>导入 UE5 动画</strong>
                <span>FBX、GLB</span>
              </button>
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,.gltf,.fbx,.bin,image/*"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files) void loadFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className={`animation-import-dropzone${dragging ? " dragging" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void loadFiles(event.dataTransfer.files);
                }}
              >
                <Icon name="cube" size={28} />
                <strong>导入动画模型</strong>
                <span>GLB、glTF、FBX</span>
              </button>
            </>
          )}
          {modelInfo && (
            <dl className="animation-model-summary">
              <div><dt>文件</dt><dd title={modelInfo.fileName}>{modelInfo.fileName}</dd></div>
              <div><dt>动画</dt><dd>{modelInfo.clips.length}</dd></div>
              <div><dt>骨骼</dt><dd>{modelInfo.boneCount}</dd></div>
              <div><dt>网格</dt><dd>{modelInfo.meshCount}</dd></div>
            </dl>
          )}
          {error && <strong className="animation-workspace-error">{error}</strong>}
          </div>}
        </section>

        {props.mode === "ue5" && (
          <section className={`animation-project-library animation-sidebar-collapsible${projectLibraryOpen ? " open" : ""}`}>
            <header>
              <button
                type="button"
                className="animation-sidebar-section-toggle"
                aria-expanded={projectLibraryOpen}
                onClick={() => setProjectLibraryOpen((open) => !open)}
              >
                <strong>项目动作库</strong>
                <span>{projectAnimations.length}</span>
                <Icon name="chevron" size={15} />
              </button>
            </header>
            {projectLibraryOpen && <div className="animation-project-list">
              {libraryLoading && <span className="animation-library-empty">正在加载</span>}
              {!libraryLoading && projectAnimations.length === 0 && (
                <span className="animation-library-empty">暂无导入动作</span>
              )}
              {projectAnimations.map((animation) => (
                <div key={animation.id} className="animation-project-item">
                  <button type="button" disabled={loading} onClick={() => void openProjectAnimation(animation)}>
                    <span title={animation.name}>{animation.name}</span>
                    <small>{animation.clips.length} 个片段</small>
                  </button>
                  <button
                    type="button"
                    className="animation-project-delete"
                    aria-label={`删除 ${animation.name}`}
                    title="删除"
                    onClick={() => void deleteProjectAnimation(animation)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>}
          </section>
        )}

        <section className="animation-clip-section">
          <header><strong>动画片段</strong><span>{modelInfo?.clips.length ?? 0}</span></header>
          <div className="animation-clip-list">
            {selectedClip && (
              <button
                type="button"
                className="active animation-selected-clip"
                onClick={() => setClipPickerOpen(true)}
              >
                <span>{animationClipDisplayName(selectedClip.name)}</span>
                <small>{formatTime(selectedClip.duration)}</small>
              </button>
            )}
            {modelInfo && modelInfo.clips.length > 0 && (
              <button type="button" className="animation-pick-clip-button" onClick={() => setClipPickerOpen(true)}>
                <Icon name="library" size={16} />
                <span>选择动作</span>
              </button>
            )}
            {modelInfo && modelInfo.clips.length === 0 && (
              <p>模型中没有动画片段</p>
            )}
          </div>
        </section>
      </aside>

      <main className="animation-model-stage">
        <AnimationModelViewport
          ref={viewportRef}
          ue5Mannequin={props.mode === "ue5" ? mannequin : undefined}
          skeletonVisible={skeletonVisible}
          previewOpen={previewOpen}
          captureOptions={captureOptions}
          onTogglePreview={() => setPreviewOpen((open) => !open)}
          onLoading={() => {
            setModelInfo(null);
            setSelectedClipIndex(0);
            setTime(0);
            setPlaying(false);
            setLoading(true);
            setError("");
          }}
          onLoaded={(info) => {
            const initialClipIndex = findInitialClipIndex(info.clips);
            setModelInfo(info);
            setSelectedClipIndex(initialClipIndex);
            setTime(0);
            setLoading(false);
            setError("");
            if (initialClipIndex > 0) {
              requestAnimationFrame(() => viewportRef.current?.selectClip(initialClipIndex));
            }
          }}
          onTimeUpdate={setTime}
          onPlaybackChange={setPlaying}
          onError={(nextError) => {
            setLoading(false);
            setError(nextError.message);
          }}
        />
        {!modelInfo && (
          <div className={`animation-model-empty${error ? " error" : ""}`}>
            {loading ? (
              <><span className="spinner" /><strong>正在加载动画模型</strong></>
            ) : error ? (
              <><strong>模型加载失败</strong><span>{error}</span></>
            ) : props.mode === "ue5" ? (
              <><Icon name="pose" size={38} /><strong>正在准备 UE5 小白人动作</strong></>
            ) : (
              <><Icon name="pose" size={38} /><strong>导入带骨骼动画的模型</strong></>
            )}
          </div>
        )}
        <section className="animation-timeline">
          <div className="animation-playback-controls">
            <button type="button" disabled={!selectedClip} onClick={() => stepFrame(-1)} aria-label="上一帧">‹</button>
            <button type="button" className="play" disabled={!selectedClip} onClick={togglePlayback}>
              {playing ? "暂停" : "播放"}
            </button>
            <button type="button" disabled={!selectedClip} onClick={() => stepFrame(1)} aria-label="下一帧">›</button>
            <output>{currentFrame} / {totalFrames}</output>
            <time>{formatTime(time)} / {formatTime(duration)}</time>
          </div>
          <input
            type="range"
            min={0}
            max={Math.max(duration, .001)}
            step={1 / frameRate}
            value={Math.min(time, duration)}
            disabled={!selectedClip}
            onPointerDown={() => viewportRef.current?.setPlaying(false)}
            onChange={(event) => changeTime(Number(event.target.value))}
          />
        </section>
      </main>

      <aside className="animation-model-controls">
        <section>
          <header><strong>显示</strong></header>
          <label className="pose-switch-field">
            <span>显示骨骼</span>
            <input
              type="checkbox"
              checked={skeletonVisible}
              onChange={(event) => setSkeletonVisible(event.target.checked)}
            />
          </label>
          <button type="button" className="button button-secondary" disabled={!modelInfo} onClick={() => viewportRef.current?.resetCamera()}>
            复位镜头
          </button>
        </section>

        <section>
          <header><strong>帧设置</strong></header>
          <label className="pose-field">
            <span>帧率</span>
            <select value={frameRate} onChange={(event) => setFrameRate(Number(event.target.value) as 24 | 30 | 60)}>
              <option value="24">24 FPS</option>
              <option value="30">30 FPS</option>
              <option value="60">60 FPS</option>
            </select>
          </label>
          <button type="button" className="button button-secondary" disabled={!selectedClip} onClick={addBookmark}>
            保存当前帧位置
          </button>
          {props.mode === "ue5" && (
            <button
              type="button"
              className="button button-primary"
              disabled={!selectedClip || !props.onSendPoseToEditor}
              onClick={sendCurrentFrameToEditor}
            >
              发送当前帧到动作编辑
            </button>
          )}
          {bookmarks.length > 0 && (
            <div className="animation-frame-bookmarks">
              {bookmarks.map((bookmark) => (
                <button type="button" key={bookmark.id} onClick={() => changeTime(bookmark.time)}>
                  帧 {bookmark.frame}
                </button>
              ))}
            </div>
          )}
        </section>

        <section>
          <header><strong>截图设置</strong></header>
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
            <label className="pose-check-field"><input type="checkbox" checked={captureOptions.showGrid} onChange={(event) => setCaptureOptions((current) => ({ ...current, showGrid: event.target.checked }))} /><span>显示地面网格</span></label>
          </div>
          <button type="button" className="button button-primary" disabled={!modelInfo || saving} onClick={() => void saveScreenshot()}>
            <Icon name="image" size={17} />
            {saving ? "正在保存" : "保存当前帧截图"}
          </button>
          {saveState && <strong className="animation-save-state">{saveState}</strong>}
        </section>
      </aside>
      {clipPickerOpen && modelInfo && modelInfo.clips.length > 0 && (
        <AnimationClipPickerDialog
          clips={modelInfo.clips}
          selectedIndex={selectedClipIndex}
          onSelect={selectClip}
          onClose={() => setClipPickerOpen(false)}
        />
      )}
    </div>
  );
}

function findInitialClipIndex(clips: AnimationClipInfo[]): number {
  const exact = clips.findIndex((clip) => clip.name === "Idle_Loop");
  if (exact >= 0) return exact;
  const idle = clips.findIndex((clip) => /(^|[_\s-])idle([_\s-]|$)/iu.test(clip.name));
  return Math.max(0, idle);
}

function mannequinName(value: MannequinId): string {
  return value === "manny" ? "Manny" : "Quinn";
}

function isInteractiveKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, button, [contenteditable='true'], [role='dialog']"
  ));
}

function formatTime(value: number): string {
  const seconds = Number.isFinite(value) ? Math.max(0, value) : 0;
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "-").trim() || "动画";
}
