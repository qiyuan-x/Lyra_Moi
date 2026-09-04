import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  createNeutralPose,
  jointIds,
  type EditableTransform,
  type JointId,
  type MannequinId,
  type PoseCaptureOptions,
  type PoseSnapshot,
  type Vector3Tuple
} from "./pose-types.js";
import { ue5PoseBoneNames } from "./pose-editor-adapter.js";
import {
  captureUe5MannequinReferencePose,
  captureUe5MannequinReferenceTransforms
} from "./ue5-mannequin-reference.js";
import {
  createUe5ReferencePoseClip,
  retargetQuaterniusV2ClipsToUe5,
  retargetUe5ClipsToUe5,
  retargetUniversalClipsToUe5
} from "./ue5-animation-retarget.js";

export interface AnimationClipInfo {
  id: string;
  name: string;
  duration: number;
}

export interface AnimationModelInfo {
  fileName: string;
  clips: AnimationClipInfo[];
  boneCount: number;
  meshCount: number;
}

interface AnimationModelViewerCallbacks {
  onLoading: () => void;
  onLoaded: (info: AnimationModelInfo) => void;
  onTimeUpdate: (time: number) => void;
  onPlaybackChange: (playing: boolean) => void;
  onError: (error: Error) => void;
}

interface RestTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

const captureRatios: Record<PoseCaptureOptions["aspectRatio"], [number, number]> = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "16:9": [16, 9],
  "9:16": [9, 16]
};

export class AnimationModelViewerAdapter {
  readonly #scene = new THREE.Scene();
  readonly #camera = new THREE.PerspectiveCamera(34, 1, .01, 1_000);
  readonly #renderer: THREE.WebGLRenderer;
  readonly #previewRenderer: THREE.WebGLRenderer;
  readonly #orbit: OrbitControls;
  readonly #grid = new THREE.GridHelper(8, 32, 0x59616e, 0x353b45);
  readonly #root = new THREE.Group();
  readonly #resizeObserver: ResizeObserver;
  readonly #previewResizeObserver: ResizeObserver;
  readonly #clock = new THREE.Clock();
  #content: THREE.Object3D | null = null;
  #skeletonHelper: THREE.SkeletonHelper | null = null;
  #mixer: THREE.AnimationMixer | null = null;
  #mixerRoot: THREE.Object3D | null = null;
  #clips: THREE.AnimationClip[] = [];
  #action: THREE.AnimationAction | null = null;
  #selectedClipIndex = -1;
  #playing = false;
  #animationFrame = 0;
  #loadVersion = 0;
  #lastReportedTime = -1;
  #previewVisible = true;
  #ue5Mannequin: MannequinId | null = null;
  #ue5RestTransforms = new Map<JointId, RestTransform>();
  #previewOptions: PoseCaptureOptions = {
    aspectRatio: "1:1",
    resolution: 1024,
    background: "dark",
    showGrid: false
  };
  #disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly previewContainer: HTMLElement,
    private readonly callbacks: AnimationModelViewerCallbacks
  ) {
    this.#scene.background = new THREE.Color(0x1b1e24);
    this.#renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    this.#renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#renderer.toneMappingExposure = 1.05;
    this.#renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.#renderer.domElement.className = "pose-editor-canvas";
    this.container.append(this.#renderer.domElement);

    this.#previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.#previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.#previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.#previewRenderer.toneMappingExposure = 1.05;
    this.#previewRenderer.setPixelRatio(1);
    this.#previewRenderer.domElement.className = "pose-camera-preview-canvas";
    this.previewContainer.append(this.#previewRenderer.domElement);

    this.#camera.position.set(2.7, 1.55, 3.2);
    this.#orbit = new OrbitControls(this.#camera, this.#renderer.domElement);
    this.#orbit.enableDamping = true;
    this.#orbit.dampingFactor = .075;
    this.#orbit.target.set(0, .9, 0);
    this.#orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.#orbit.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.#orbit.mouseButtons.RIGHT = THREE.MOUSE.PAN;

    this.#grid.position.y = 0;
    this.#scene.add(this.#grid, this.#root);
    this.#scene.add(new THREE.HemisphereLight(0xffffff, 0x4b5566, 2.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3, 5, 4);
    this.#scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x9bb8ff, 1.6);
    fillLight.position.set(-4, 2, 2);
    this.#scene.add(fillLight);

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this.container);
    this.#previewResizeObserver = new ResizeObserver(() => this.#resizePreview());
    this.#previewResizeObserver.observe(this.previewContainer);
    this.#resize();
    this.#resizePreview();
    this.#animate();
  }

  async load(files: readonly File[]): Promise<void> {
    const version = ++this.#loadVersion;
    this.callbacks.onLoading();
    this.#clearModel();
    try {
      const { content, clips, fileName } = await loadAnimationFiles(files);
      if (this.#disposed || version !== this.#loadVersion) {
        disposeObjectTree(content);
        return;
      }
      this.#installModel(content, clips, fileName);
    } catch (error) {
      if (version !== this.#loadVersion) return;
      this.callbacks.onError(error instanceof Error ? error : new Error("动画模型加载失败。"));
    }
  }

  async loadUe5Animation(
    files: readonly File[],
    mannequin: MannequinId
  ): Promise<AnimationModelInfo> {
    const version = ++this.#loadVersion;
    this.callbacks.onLoading();
    this.#clearModel();
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    let target: THREE.Object3D | null = null;
    let source: THREE.Object3D | null = null;
    try {
      const [targetGltf, sourceResult] = await Promise.all([
        loader.loadAsync(`/models/pose-studio/${mannequin}/ue5_${mannequin}.gltf`),
        loadAnimationFiles(files, ["fbx", "glb"])
      ]);
      target = targetGltf.scene;
      source = sourceResult.content;
      if (this.#disposed || version !== this.#loadVersion) {
        throw new Error("UE5 动画加载已取消。");
      }
      const clips = retargetUe5ClipsToUe5(target, source, sourceResult.clips);
      if (this.#disposed || version !== this.#loadVersion) {
        throw new Error("UE5 动画加载已取消。");
      }
      const info = this.#installModel(
        target,
        clips,
        sourceResult.fileName,
        findFirstSkinnedMesh(target) ?? target,
        mannequin,
        targetGltf.animations
      );
      target = null;
      return info;
    } catch (error) {
      if (version === this.#loadVersion && !this.#disposed) {
        this.callbacks.onError(error instanceof Error ? error : new Error("UE5 动画加载失败。"));
      }
      throw error;
    } finally {
      draco.dispose();
      if (target) disposeObjectTree(target);
      if (source) disposeObjectTree(source);
    }
  }

  async loadUe5ActionLibrary(mannequin: MannequinId): Promise<void> {
    const version = ++this.#loadVersion;
    this.callbacks.onLoading();
    this.#clearModel();
    const draco = new DRACOLoader();
    draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    let target: THREE.Object3D | null = null;
    let universalSource: THREE.Object3D | null = null;
    let ual2Source: THREE.Object3D | null = null;
    try {
      const [targetGltf, universalGltf, ual2Gltf] = await Promise.all([
        loader.loadAsync(`/models/pose-studio/${mannequin}/ue5_${mannequin}.gltf`),
        loader.loadAsync("/models/pose-studio/quaternius-ual/AnimationLibrary_Standard.gltf"),
        loader.loadAsync("/models/pose-studio/quaternius-ual2/UAL2_Standard.glb")
      ]);
      target = targetGltf.scene;
      universalSource = universalGltf.scene;
      ual2Source = ual2Gltf.scene;
      if (this.#disposed || version !== this.#loadVersion) return;
      const targetReferencePose = captureUe5MannequinReferencePose(
        target,
        targetGltf.animations
      );
      const clips = [
        createUe5ReferencePoseClip(target, targetReferencePose),
        ...retargetUniversalClipsToUe5(
          target,
          universalSource,
          universalGltf.animations.filter(
            (clip) => clip.name !== "A_TPose" && clip.name !== "Dance_Loop"
          ),
          targetReferencePose
        )
      ];
      const clipNames = new Set(clips.map((clip) => clip.name));
      for (const clip of retargetQuaterniusV2ClipsToUe5(
        target,
        ual2Source,
        ual2Gltf.animations.filter((item) => item.name !== "A_TPose"),
        targetReferencePose
      )) {
        if (clipNames.has(clip.name)) continue;
        clips.push(clip);
        clipNames.add(clip.name);
      }
      if (this.#disposed || version !== this.#loadVersion) return;
      this.#installModel(
        target,
        clips,
        mannequin === "manny" ? "UE5 Manny 扩展动作库" : "UE5 Quinn 扩展动作库",
        findFirstSkinnedMesh(target) ?? target,
        mannequin,
        targetGltf.animations
      );
      target = null;
    } catch (error) {
      if (version !== this.#loadVersion) return;
      this.callbacks.onError(error instanceof Error ? error : new Error("UE5 动作库加载失败。"));
    } finally {
      draco.dispose();
      if (target) disposeObjectTree(target);
      if (universalSource) disposeObjectTree(universalSource);
      if (ual2Source) disposeObjectTree(ual2Source);
    }
  }

  selectClip(index: number): void {
    const clip = this.#clips[index];
    if (!clip || !this.#mixer) return;
    this.#action?.stop();
    this.#mixer.stopAllAction();
    this.#mixer.setTime(0);
    this.#action = this.#mixer.clipAction(clip);
    this.#action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
    this.#action.clampWhenFinished = false;
    this.#action.reset().play();
    this.#selectedClipIndex = index;
    this.#playing = false;
    this.#action.paused = true;
    this.#mixer.update(0);
    this.#reportTime(true);
    this.callbacks.onPlaybackChange(false);
  }

  setPlaying(playing: boolean): void {
    if (!this.#action) return;
    this.#playing = playing;
    this.#action.paused = !playing;
    this.#clock.getDelta();
    this.callbacks.onPlaybackChange(playing);
  }

  seek(time: number): void {
    const clip = this.#clips[this.#selectedClipIndex];
    if (!clip || !this.#action || !this.#mixer) return;
    const duration = Math.max(0, clip.duration);
    const next = THREE.MathUtils.clamp(time, 0, duration);
    this.#action.time = duration > 0 && next === duration
      ? Math.max(0, duration - 1e-6)
      : next;
    this.#mixer.update(0);
    this.#reportTime(true);
  }

  setSkeletonVisible(visible: boolean): void {
    if (this.#skeletonHelper) this.#skeletonHelper.visible = visible;
  }

  exportCurrentUe5Pose(): { pose: PoseSnapshot; mannequin: MannequinId } {
    if (!this.#content || !this.#ue5Mannequin || this.#ue5RestTransforms.size < 1) {
      throw new Error("当前动画没有可发送的 UE5 姿势。");
    }
    this.#content.updateMatrixWorld(true);
    const pose = createNeutralPose();
    for (const jointId of jointIds) {
      if (jointId === "root") continue;
      const boneName = ue5PoseBoneNames[jointId];
      const bone = this.#content.getObjectByName(boneName);
      const rest = this.#ue5RestTransforms.get(jointId);
      if (bone && rest) pose.bones[jointId] = readRelativeTransform(bone, rest);
    }
    return { pose, mannequin: this.#ue5Mannequin };
  }

  setPreviewOptions(options: PoseCaptureOptions, visible: boolean): void {
    this.#previewOptions = { ...options };
    this.#previewVisible = visible;
    this.#previewRenderer.domElement.style.display = visible ? "block" : "none";
    if (visible) this.#resizePreview();
  }

  setCameraView(view: "front" | "back" | "left" | "right" | "perspective"): void {
    const target = this.#orbit.target.clone();
    const distance = Math.max(2.8, this.#camera.position.distanceTo(target));
    const direction = {
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      perspective: new THREE.Vector3(.72, .28, 1).normalize()
    }[view];
    this.#camera.position.copy(target).add(direction.multiplyScalar(distance));
    if (view !== "perspective") this.#camera.position.y = target.y;
    this.#orbit.update();
  }

  resetCamera(): void {
    this.#frameModel();
  }

  async capture(options: PoseCaptureOptions): Promise<Blob> {
    if (!this.#content) throw new Error("请先导入动画模型。");
    const [ratioWidth, ratioHeight] = captureRatios[options.aspectRatio];
    const landscape = ratioWidth >= ratioHeight;
    const width = landscape
      ? options.resolution
      : Math.round(options.resolution * ratioWidth / ratioHeight);
    const height = landscape
      ? Math.round(options.resolution * ratioHeight / ratioWidth)
      : options.resolution;
    const previousSize = this.#renderer.getSize(new THREE.Vector2());
    const previousPixelRatio = this.#renderer.getPixelRatio();
    const previousAspect = this.#camera.aspect;
    const previousBackground = this.#scene.background;
    const previousSkeletonVisible = this.#skeletonHelper?.visible ?? false;
    const previousGridVisible = this.#grid.visible;
    try {
      if (this.#skeletonHelper) this.#skeletonHelper.visible = false;
      this.#grid.visible = options.showGrid;
      this.#scene.background = options.background === "transparent"
        ? null
        : new THREE.Color(options.background === "light" ? 0xf2f3f5 : 0x1b1e24);
      this.#renderer.setPixelRatio(1);
      this.#renderer.setSize(width, height, false);
      this.#camera.aspect = width / height;
      this.#camera.updateProjectionMatrix();
      this.#renderer.render(this.#scene, this.#camera);
      return await new Promise<Blob>((resolve, reject) => {
        this.#renderer.domElement.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("无法生成动画截图。"));
        }, "image/png");
      });
    } finally {
      if (this.#skeletonHelper) this.#skeletonHelper.visible = previousSkeletonVisible;
      this.#grid.visible = previousGridVisible;
      this.#scene.background = previousBackground;
      this.#renderer.setPixelRatio(previousPixelRatio);
      this.#renderer.setSize(previousSize.x, previousSize.y, false);
      this.#camera.aspect = previousAspect;
      this.#camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#loadVersion += 1;
    cancelAnimationFrame(this.#animationFrame);
    this.#resizeObserver.disconnect();
    this.#previewResizeObserver.disconnect();
    this.#clearModel();
    this.#orbit.dispose();
    this.#renderer.dispose();
    this.#renderer.domElement.remove();
    this.#previewRenderer.dispose();
    this.#previewRenderer.domElement.remove();
  }

  #installModel(
    content: THREE.Object3D,
    clips: readonly THREE.AnimationClip[],
    fileName: string,
    mixerRoot: THREE.Object3D = content,
    ue5Mannequin: MannequinId | null = null,
    ue5ReferenceAnimations: readonly THREE.AnimationClip[] = []
  ): AnimationModelInfo {
    this.#content = content;
    this.#clips = clips.map((clip, index) => {
      const name = clip.name.trim() || `动画 ${index + 1}`;
      clip.name = name;
      return clip;
    });
    this.#root.add(content);
    const counts = prepareModel(content);
    this.#createSkeletonHelper(content, counts.boneCount);
    this.#mixerRoot = mixerRoot;
    this.#mixer = new THREE.AnimationMixer(mixerRoot);
    this.#ue5Mannequin = ue5Mannequin;
    if (ue5Mannequin) this.#captureUe5RestTransforms(content, ue5ReferenceAnimations);
    this.#frameModel();
    if (this.#clips.length > 0) this.selectClip(0);
    const info: AnimationModelInfo = {
      fileName,
      clips: this.#clips.map((clip, index) => ({
        id: `${index}:${clip.name}`,
        name: clip.name,
        duration: Math.max(0, clip.duration)
      })),
      boneCount: counts.boneCount,
      meshCount: counts.meshCount
    };
    this.callbacks.onLoaded(info);
    return info;
  }

  #captureUe5RestTransforms(
    content: THREE.Object3D,
    animations: readonly THREE.AnimationClip[]
  ): void {
    this.#ue5RestTransforms = captureUe5MannequinReferenceTransforms(
      content,
      animations,
      ue5PoseBoneNames
    );
  }

  #createSkeletonHelper(content: THREE.Object3D, boneCount: number): void {
    if (boneCount < 1) return;
    const helper = new THREE.SkeletonHelper(content);
    helper.name = "AnimationSkeletonHelper";
    helper.renderOrder = 50;
    for (const material of materialList(helper.material)) {
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      material.opacity = .95;
    }
    this.#skeletonHelper = helper;
    this.#scene.add(helper);
  }

  #clearModel(): void {
    this.#playing = false;
    this.#selectedClipIndex = -1;
    this.#lastReportedTime = -1;
    this.#action?.stop();
    this.#action = null;
    this.#mixer?.stopAllAction();
    if (this.#mixerRoot && this.#mixer) this.#mixer.uncacheRoot(this.#mixerRoot);
    this.#mixer = null;
    this.#mixerRoot = null;
    this.#clips = [];
    this.#ue5Mannequin = null;
    this.#ue5RestTransforms.clear();
    if (this.#skeletonHelper) {
      this.#scene.remove(this.#skeletonHelper);
      this.#skeletonHelper.geometry.dispose();
      for (const material of materialList(this.#skeletonHelper.material)) material.dispose();
      this.#skeletonHelper = null;
    }
    if (this.#content) {
      this.#root.remove(this.#content);
      disposeObjectTree(this.#content);
      this.#content = null;
    }
    this.callbacks.onPlaybackChange(false);
  }

  #frameModel(): void {
    if (!this.#content) return;
    this.#content.updateMatrixWorld(true);
    const bounds = objectBounds(this.#content);
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * .5, .5);
    this.#orbit.target.copy(center);
    this.#camera.near = Math.max(.001, radius / 100);
    this.#camera.far = Math.max(100, radius * 100);
    this.#camera.position.copy(center).add(new THREE.Vector3(0, 0, radius * 2.7));
    this.#camera.updateProjectionMatrix();
    this.#orbit.minDistance = Math.max(.05, radius * .15);
    this.#orbit.maxDistance = radius * 15;
    this.#orbit.update();
  }

  #resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.#renderer.setSize(width, height, false);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
  }

  #resizePreview(): void {
    if (!this.#previewVisible) return;
    const width = Math.max(1, this.previewContainer.clientWidth);
    const height = Math.max(1, this.previewContainer.clientHeight);
    this.#previewRenderer.setSize(width, height, false);
  }

  #renderPreview(): void {
    if (!this.#previewVisible || !this.#content) return;
    const width = this.previewContainer.clientWidth;
    const height = this.previewContainer.clientHeight;
    if (width <= 0 || height <= 0) return;
    const previousAspect = this.#camera.aspect;
    const previousBackground = this.#scene.background;
    const previousSkeletonVisible = this.#skeletonHelper?.visible ?? false;
    const previousGridVisible = this.#grid.visible;
    if (this.#skeletonHelper) this.#skeletonHelper.visible = false;
    this.#grid.visible = this.#previewOptions.showGrid;
    this.#scene.background = this.#previewOptions.background === "transparent"
      ? null
      : new THREE.Color(this.#previewOptions.background === "light" ? 0xf2f3f5 : 0x1b1e24);
    this.#camera.aspect = width / height;
    this.#camera.updateProjectionMatrix();
    this.#previewRenderer.render(this.#scene, this.#camera);
    this.#camera.aspect = previousAspect;
    this.#camera.updateProjectionMatrix();
    this.#scene.background = previousBackground;
    if (this.#skeletonHelper) this.#skeletonHelper.visible = previousSkeletonVisible;
    this.#grid.visible = previousGridVisible;
  }

  #reportTime(force = false): void {
    const time = this.#action?.time ?? 0;
    if (!force && Math.abs(time - this.#lastReportedTime) < 1 / 60) return;
    this.#lastReportedTime = time;
    this.callbacks.onTimeUpdate(time);
  }

  #animate = () => {
    if (this.#disposed) return;
    this.#animationFrame = requestAnimationFrame(this.#animate);
    const delta = Math.min(this.#clock.getDelta(), .1);
    if (this.#playing && this.#mixer) {
      this.#mixer.update(delta);
      this.#reportTime();
    }
    this.#orbit.update();
    this.#renderer.render(this.#scene, this.#camera);
    this.#renderPreview();
  };
}

function prepareModel(content: THREE.Object3D): { boneCount: number; meshCount: number } {
  let boneCount = 0;
  let meshCount = 0;
  content.traverse((object) => {
    if (object instanceof THREE.Bone) boneCount += 1;
    if (object instanceof THREE.Mesh) {
      meshCount += 1;
      object.frustumCulled = false;
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return { boneCount, meshCount };
}

function findFirstSkinnedMesh(content: THREE.Object3D): THREE.SkinnedMesh | null {
  let result: THREE.SkinnedMesh | null = null;
  content.traverse((object) => {
    if (!result && object instanceof THREE.SkinnedMesh) result = object;
  });
  return result;
}

function objectBounds(content: THREE.Object3D): THREE.Box3 {
  const bounds = new THREE.Box3().setFromObject(content);
  const point = new THREE.Vector3();
  content.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    object.getWorldPosition(point);
    bounds.expandByPoint(point);
  });
  return bounds;
}

async function loadAnimationFiles(
  files: readonly File[],
  allowedExtensions: readonly string[] = ["glb", "gltf", "fbx"]
): Promise<{ content: THREE.Object3D; clips: THREE.AnimationClip[]; fileName: string }> {
  const primary = selectPrimaryModelFile(files, allowedExtensions);
  if (!primary) {
    throw new Error(`请选择 ${allowedExtensions.map((item) => item.toUpperCase()).join("、")} 动画文件。`);
  }
  const fileUrls = new Map<string, string>();
  for (const file of files) {
    const url = URL.createObjectURL(file);
    fileUrls.set(normalizeFileKey(file.name), url);
    fileUrls.set(normalizeFileKey(file.webkitRelativePath || file.name), url);
  }
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((value) => {
    const key = normalizeFileKey(decodeURIComponent(stripUrlQuery(value)));
    return fileUrls.get(key) ?? fileUrls.get(fileNameFromPath(key)) ?? value;
  });
  try {
    const primaryUrl = fileUrls.get(normalizeFileKey(primary.name));
    if (!primaryUrl) throw new Error("无法读取动画文件。");
    if (fileExtension(primary.name) === "fbx") {
      const content = await new FBXLoader(manager).loadAsync(primaryUrl);
      return { content, clips: content.animations, fileName: primary.name };
    }
    const draco = new DRACOLoader(manager);
    draco.setDecoderPath("/draco/");
    const loader = new GLTFLoader(manager);
    loader.setDRACOLoader(draco);
    loader.setMeshoptDecoder(MeshoptDecoder);
    try {
      const gltf = await loader.loadAsync(primaryUrl);
      return { content: gltf.scene, clips: gltf.animations, fileName: primary.name };
    } finally {
      draco.dispose();
    }
  } finally {
    for (const url of new Set(fileUrls.values())) URL.revokeObjectURL(url);
  }
}

function selectPrimaryModelFile(
  files: readonly File[],
  allowedExtensions: readonly string[]
): File | null {
  return files.find((file) => allowedExtensions.includes(fileExtension(file.name))) ?? null;
}

function fileExtension(name: string): string {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}

function normalizeFileKey(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").toLowerCase();
}

function fileNameFromPath(value: string): string {
  return value.split("/").at(-1) ?? value;
}

function stripUrlQuery(value: string): string {
  return value.split(/[?#]/u, 1)[0] ?? value;
}

function disposeObjectTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) {
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function materialList(value: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(value) ? value : [value];
}

function readRelativeTransform(
  object: THREE.Object3D,
  rest: RestTransform
): EditableTransform {
  const position = object.position.clone().sub(rest.position);
  const deltaQuaternion = rest.quaternion.clone().invert().multiply(object.quaternion);
  const rotation = new THREE.Euler().setFromQuaternion(deltaQuaternion, "XYZ");
  const scale = new THREE.Vector3(
    safeRatio(object.scale.x, rest.scale.x),
    safeRatio(object.scale.y, rest.scale.y),
    safeRatio(object.scale.z, rest.scale.z)
  );
  return {
    position: roundVector(position.toArray() as Vector3Tuple, 4),
    rotation: roundVector([
      THREE.MathUtils.radToDeg(rotation.x),
      THREE.MathUtils.radToDeg(rotation.y),
      THREE.MathUtils.radToDeg(rotation.z)
    ], 2),
    scale: roundVector(scale.toArray() as Vector3Tuple, 4)
  };
}

function safeRatio(value: number, base: number): number {
  return Math.abs(base) < 1e-6 ? 1 : value / base;
}

function roundVector(value: Vector3Tuple, precision: number): Vector3Tuple {
  const factor = 10 ** precision;
  return value.map((item) => Math.round(item * factor) / factor) as Vector3Tuple;
}
