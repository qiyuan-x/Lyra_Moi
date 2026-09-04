import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from "react";
import { Icon } from "../../components/Icon.js";
import {
  AnimationModelViewerAdapter,
  type AnimationModelInfo
} from "./animation-model-viewer-adapter.js";
import type { MannequinId, PoseCaptureOptions } from "./pose-types.js";
import type { PoseSnapshot } from "./pose-types.js";

export interface AnimationModelViewportHandle {
  load: (files: readonly File[]) => Promise<void>;
  loadUe5ActionLibrary: (mannequin: MannequinId) => Promise<void>;
  loadUe5Animation: (files: readonly File[], mannequin: MannequinId) => Promise<AnimationModelInfo>;
  selectClip: (index: number) => void;
  setPlaying: (playing: boolean) => void;
  seek: (time: number) => void;
  capture: (options: PoseCaptureOptions) => Promise<Blob>;
  resetCamera: () => void;
  setCameraView: (view: "front" | "back" | "left" | "right" | "perspective") => void;
  exportCurrentUe5Pose: () => { pose: PoseSnapshot; mannequin: MannequinId };
}

interface AnimationModelViewportProps {
  ue5Mannequin?: MannequinId | undefined;
  skeletonVisible: boolean;
  previewOpen: boolean;
  captureOptions: PoseCaptureOptions;
  onTogglePreview: () => void;
  onLoading: () => void;
  onLoaded: (info: AnimationModelInfo) => void;
  onTimeUpdate: (time: number) => void;
  onPlaybackChange: (playing: boolean) => void;
  onError: (error: Error) => void;
}

const previewRatios: Record<PoseCaptureOptions["aspectRatio"], string> = {
  "1:1": "1 / 1",
  "4:3": "4 / 3",
  "3:4": "3 / 4",
  "16:9": "16 / 9",
  "9:16": "9 / 16"
};

export const AnimationModelViewport = forwardRef<
  AnimationModelViewportHandle,
  AnimationModelViewportProps
>(function AnimationModelViewport(props, forwardedRef) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<AnimationModelViewerAdapter | null>(null);
  const callbacksRef = useRef(props);
  callbacksRef.current = props;

  useEffect(() => {
    const container = containerRef.current;
    const preview = previewRef.current;
    if (!container || !preview) return;
    const adapter = new AnimationModelViewerAdapter(container, preview, {
      onLoading: () => callbacksRef.current.onLoading(),
      onLoaded: (info) => callbacksRef.current.onLoaded(info),
      onTimeUpdate: (time) => callbacksRef.current.onTimeUpdate(time),
      onPlaybackChange: (playing) => callbacksRef.current.onPlaybackChange(playing),
      onError: (error) => callbacksRef.current.onError(error)
    });
    adapterRef.current = adapter;
    adapter.setSkeletonVisible(callbacksRef.current.skeletonVisible);
    adapter.setPreviewOptions(
      callbacksRef.current.captureOptions,
      callbacksRef.current.previewOpen
    );
    return () => {
      adapterRef.current = null;
      adapter.dispose();
    };
  }, []);

  useEffect(() => {
    adapterRef.current?.setSkeletonVisible(props.skeletonVisible);
  }, [props.skeletonVisible]);

  useEffect(() => {
    if (props.ue5Mannequin) {
      void adapterRef.current?.loadUe5ActionLibrary(props.ue5Mannequin);
    }
  }, [props.ue5Mannequin]);

  useEffect(() => {
    adapterRef.current?.setPreviewOptions(props.captureOptions, props.previewOpen);
  }, [props.captureOptions, props.previewOpen]);

  useImperativeHandle(forwardedRef, () => ({
    load: (files) => {
      const adapter = adapterRef.current;
      if (!adapter) return Promise.reject(new Error("动画查看器尚未就绪。"));
      return adapter.load(files);
    },
    loadUe5ActionLibrary: (mannequin) => {
      const adapter = adapterRef.current;
      if (!adapter) return Promise.reject(new Error("动画查看器尚未就绪。"));
      return adapter.loadUe5ActionLibrary(mannequin);
    },
    loadUe5Animation: (files, mannequin) => {
      const adapter = adapterRef.current;
      if (!adapter) return Promise.reject(new Error("动画查看器尚未就绪。"));
      return adapter.loadUe5Animation(files, mannequin);
    },
    selectClip: (index) => adapterRef.current?.selectClip(index),
    setPlaying: (playing) => adapterRef.current?.setPlaying(playing),
    seek: (time) => adapterRef.current?.seek(time),
    capture: (options) => {
      const adapter = adapterRef.current;
      if (!adapter) return Promise.reject(new Error("动画查看器尚未就绪。"));
      return adapter.capture(options);
    },
    resetCamera: () => adapterRef.current?.resetCamera(),
    setCameraView: (view) => adapterRef.current?.setCameraView(view),
    exportCurrentUe5Pose: () => {
      const adapter = adapterRef.current;
      if (!adapter) throw new Error("动画查看器尚未就绪。");
      return adapter.exportCurrentUe5Pose();
    }
  }), []);

  return (
    <div className="animation-model-viewport" ref={containerRef}>
      <section
        className={`pose-camera-preview${props.previewOpen ? " open" : " collapsed"}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="pose-camera-preview-toggle"
          aria-expanded={props.previewOpen}
          onClick={props.onTogglePreview}
        >
          <span>摄像机预览</span>
          <Icon name="chevron" size={14} />
        </button>
        <div
          className="pose-camera-preview-frame"
          ref={previewRef}
          style={{ aspectRatio: previewRatios[props.captureOptions.aspectRatio] }}
        />
        <div className="pose-camera-preview-views">
          {(["front", "back", "left", "right", "perspective"] as const).map((view) => (
            <button type="button" key={view} onClick={() => adapterRef.current?.setCameraView(view)}>
              {{ front: "正", back: "背", left: "左", right: "右", perspective: "透视" }[view]}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
});
