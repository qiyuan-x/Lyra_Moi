import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef
} from "react";
import { Icon } from "../../components/Icon.js";
import { PoseEditorAdapter } from "./pose-editor-adapter.js";
import type {
  JointId,
  MannequinId,
  PoseCaptureOptions,
  PoseSnapshot,
  TransformMode
} from "./pose-types.js";

export interface PoseViewportHandle {
  capture: (options: PoseCaptureOptions) => Promise<Blob>;
  capturePose: (pose: PoseSnapshot, options: PoseCaptureOptions) => Promise<Blob>;
  setCameraView: (view: "front" | "back" | "left" | "right" | "perspective") => void;
}

interface PoseViewportProps {
  pose: PoseSnapshot;
  selectedJoint: JointId;
  transformMode: TransformMode;
  mannequin: MannequinId;
  skeletonVisible: boolean;
  skeletonInFront: boolean;
  previewOpen: boolean;
  captureOptions: PoseCaptureOptions;
  onTogglePreview: () => void;
  onJointSelect: (jointId: JointId) => void;
  onPosePreview: (pose: PoseSnapshot) => void;
  onPoseCommit: (before: PoseSnapshot, after: PoseSnapshot) => void;
  onLoading: () => void;
  onReady: () => void;
  onError: (error: Error) => void;
}

const previewRatios: Record<PoseCaptureOptions["aspectRatio"], string> = {
  "1:1": "1 / 1",
  "4:3": "4 / 3",
  "3:4": "3 / 4",
  "16:9": "16 / 9",
  "9:16": "9 / 16"
};

export const PoseViewport = forwardRef<PoseViewportHandle, PoseViewportProps>(
  function PoseViewport(props, forwardedRef) {
    const containerRef = useRef<HTMLDivElement>(null);
    const previewRef = useRef<HTMLDivElement>(null);
    const adapterRef = useRef<PoseEditorAdapter | null>(null);
    const callbacksRef = useRef(props);
    callbacksRef.current = props;

    useEffect(() => {
      const container = containerRef.current;
      const preview = previewRef.current;
      if (!container || !preview) return;
      const adapter = new PoseEditorAdapter(container, preview, callbacksRef.current.mannequin, {
        onJointSelect: (jointId) => callbacksRef.current.onJointSelect(jointId),
        onPosePreview: (pose) => callbacksRef.current.onPosePreview(pose),
        onPoseCommit: (before, after) => callbacksRef.current.onPoseCommit(before, after),
        onLoading: () => callbacksRef.current.onLoading(),
        onReady: () => callbacksRef.current.onReady(),
        onError: (error) => callbacksRef.current.onError(error)
      });
      adapterRef.current = adapter;
      adapter.setPose(callbacksRef.current.pose);
      adapter.selectJoint(callbacksRef.current.selectedJoint);
      adapter.setTransformMode(callbacksRef.current.transformMode);
      adapter.setSkeletonOptions({
        visible: callbacksRef.current.skeletonVisible,
        inFront: callbacksRef.current.skeletonInFront
      });
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
      adapterRef.current?.setPose(props.pose);
    }, [props.pose]);

    useEffect(() => {
      adapterRef.current?.selectJoint(props.selectedJoint);
    }, [props.selectedJoint]);

    useEffect(() => {
      adapterRef.current?.setTransformMode(props.transformMode);
    }, [props.transformMode]);

    useEffect(() => {
      adapterRef.current?.setMannequin(props.mannequin);
    }, [props.mannequin]);

    useEffect(() => {
      adapterRef.current?.setSkeletonOptions({
        visible: props.skeletonVisible,
        inFront: props.skeletonInFront
      });
    }, [props.skeletonInFront, props.skeletonVisible]);

    useEffect(() => {
      adapterRef.current?.setPreviewOptions(props.captureOptions, props.previewOpen);
    }, [props.captureOptions, props.previewOpen]);

    useImperativeHandle(forwardedRef, () => ({
      capture: (options) => {
        const adapter = adapterRef.current;
        if (!adapter) return Promise.reject(new Error("动作编辑器尚未就绪。"));
        return adapter.capture(options);
      },
      capturePose: (pose, options) => {
        const adapter = adapterRef.current;
        if (!adapter) return Promise.reject(new Error("动作编辑器尚未就绪。"));
        return adapter.capturePose(pose, options);
      },
      setCameraView: (view) => adapterRef.current?.setCameraView(view)
    }), []);

    return (
      <div className="pose-viewport" ref={containerRef}>
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
  }
);
