import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  clonePose,
  createNeutralPose,
  jointIds,
  type EditableTransform,
  type JointId,
  type MannequinId,
  type PoseCaptureOptions,
  type PoseSnapshot,
  type TransformMode,
  type Vector3Tuple
} from "./pose-types.js";
import { applyUe5MannequinReferencePose } from "./ue5-mannequin-reference.js";

const modelUrls: Record<MannequinId, string> = {
  manny: "/models/pose-studio/manny/ue5_manny.gltf",
  quinn: "/models/pose-studio/quinn/ue5_quinn.gltf"
};
const degrees = THREE.MathUtils.radToDeg;
const radians = THREE.MathUtils.degToRad;

interface PoseEditorCallbacks {
  onJointSelect: (jointId: JointId) => void;
  onPosePreview: (pose: PoseSnapshot) => void;
  onPoseCommit: (before: PoseSnapshot, after: PoseSnapshot) => void;
  onLoading: () => void;
  onReady: () => void;
  onError: (error: Error) => void;
}

interface RestTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

interface BoneVisual {
  mesh: THREE.Mesh;
  fill: THREE.MeshBasicMaterial;
  outline: THREE.LineBasicMaterial;
}

export const ue5PoseBoneNames: Record<Exclude<JointId, "root">, string> = {
  pelvis: "pelvis",
  spine: "spine_01",
  chest: "spine_03",
  neck: "neck_01",
  head: "head",
  leftShoulder: "clavicle_l",
  leftUpperArm: "upperarm_l",
  leftForearm: "lowerarm_l",
  leftHand: "hand_l",
  rightShoulder: "clavicle_r",
  rightUpperArm: "upperarm_r",
  rightForearm: "lowerarm_r",
  rightHand: "hand_r",
  leftThigh: "thigh_l",
  leftShin: "calf_l",
  leftFoot: "foot_l",
  rightThigh: "thigh_r",
  rightShin: "calf_r",
  rightFoot: "foot_r",
  leftThumb1: "thumb_01_l",
  leftThumb2: "thumb_02_l",
  leftThumb3: "thumb_03_l",
  leftIndex1: "index_01_l",
  leftIndex2: "index_02_l",
  leftIndex3: "index_03_l",
  leftMiddle1: "middle_01_l",
  leftMiddle2: "middle_02_l",
  leftMiddle3: "middle_03_l",
  leftRing1: "ring_01_l",
  leftRing2: "ring_02_l",
  leftRing3: "ring_03_l",
  leftPinky1: "pinky_01_l",
  leftPinky2: "pinky_02_l",
  leftPinky3: "pinky_03_l",
  rightThumb1: "thumb_01_r",
  rightThumb2: "thumb_02_r",
  rightThumb3: "thumb_03_r",
  rightIndex1: "index_01_r",
  rightIndex2: "index_02_r",
  rightIndex3: "index_03_r",
  rightMiddle1: "middle_01_r",
  rightMiddle2: "middle_02_r",
  rightMiddle3: "middle_03_r",
  rightRing1: "ring_01_r",
  rightRing2: "ring_02_r",
  rightRing3: "ring_03_r",
  rightPinky1: "pinky_01_r",
  rightPinky2: "pinky_02_r",
  rightPinky3: "pinky_03_r"
};

const boneTipJoints: Partial<Record<JointId, JointId>> = {
  root: "pelvis",
  pelvis: "spine",
  spine: "chest",
  chest: "neck",
  neck: "head",
  leftShoulder: "leftUpperArm",
  leftUpperArm: "leftForearm",
  leftForearm: "leftHand",
  leftHand: "leftMiddle1",
  rightShoulder: "rightUpperArm",
  rightUpperArm: "rightForearm",
  rightForearm: "rightHand",
  rightHand: "rightMiddle1",
  leftThigh: "leftShin",
  leftShin: "leftFoot",
  rightThigh: "rightShin",
  rightShin: "rightFoot",
  leftThumb1: "leftThumb2",
  leftThumb2: "leftThumb3",
  leftIndex1: "leftIndex2",
  leftIndex2: "leftIndex3",
  leftMiddle1: "leftMiddle2",
  leftMiddle2: "leftMiddle3",
  leftRing1: "leftRing2",
  leftRing2: "leftRing3",
  leftPinky1: "leftPinky2",
  leftPinky2: "leftPinky3",
  rightThumb1: "rightThumb2",
  rightThumb2: "rightThumb3",
  rightIndex1: "rightIndex2",
  rightIndex2: "rightIndex3",
  rightMiddle1: "rightMiddle2",
  rightMiddle2: "rightMiddle3",
  rightRing1: "rightRing2",
  rightRing2: "rightRing3",
  rightPinky1: "rightPinky2",
  rightPinky2: "rightPinky3"
};

export class PoseEditorAdapter {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 1, .01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly orbit: OrbitControls;
  private readonly transform: TransformControls;
  private readonly transformHelper: THREE.Object3D;
  private readonly modelRoot = new THREE.Group();
  private readonly bones = new Map<JointId, THREE.Bone>();
  private readonly restTransforms = new Map<JointId, RestTransform>();
  private readonly boneVisuals = new Map<JointId, BoneVisual>();
  private readonly boneVisualRoot = new THREE.Group();
  private readonly boneGeometry = createBoneGeometry();
  private readonly orientationScene = new THREE.Scene();
  private readonly orientationCamera = new THREE.OrthographicCamera(-1.3, 1.3, 1.3, -1.3, .1, 10);
  private readonly orientationRoot = new THREE.Group();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly grid: THREE.GridHelper;
  private readonly resizeObserver: ResizeObserver;
  private readonly previewResizeObserver: ResizeObserver;
  private readonly previewRenderer: THREE.WebGLRenderer;
  private animationFrame = 0;
  private loadVersion = 0;
  private selectedJoint: JointId = "root";
  private transformMode: TransformMode = "rotate";
  private mannequin: MannequinId;
  private skeletonVisible = true;
  private skeletonInFront = true;
  private previewVisible = true;
  private previewOptions: PoseCaptureOptions = {
    aspectRatio: "1:1",
    resolution: 1024,
    background: "dark",
    showGrid: false
  };
  private dragStartPose: PoseSnapshot | null = null;
  private pendingPose = createNeutralPose();
  private modelContent: THREE.Object3D | null = null;
  private disposed = false;
  private ready = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly previewContainer: HTMLElement,
    mannequin: MannequinId,
    private readonly callbacks: PoseEditorCallbacks
  ) {
    this.mannequin = mannequin;
    this.scene.background = new THREE.Color(0x1b1e24);
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = "pose-editor-canvas";
    this.container.append(this.renderer.domElement);

    this.previewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.previewRenderer.toneMappingExposure = 1.05;
    this.previewRenderer.setPixelRatio(1);
    this.previewRenderer.domElement.className = "pose-camera-preview-canvas";
    this.previewContainer.append(this.previewRenderer.domElement);

    this.camera.position.set(0, 2.25, 4.2);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 1.05, 0);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = .08;
    this.orbit.minDistance = .8;
    this.orbit.maxDistance = 12;
    this.orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.orbit.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
    this.orbit.mouseButtons.RIGHT = null;

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(.72);
    this.transform.setRotationSnap(radians(1));
    this.transformHelper = this.transform.getHelper();
    this.scene.add(this.transformHelper);
    this.transform.addEventListener("dragging-changed", (event) => {
      this.orbit.enabled = !Boolean(event.value);
    });
    this.transform.addEventListener("mouseDown", () => {
      this.dragStartPose = this.getPose();
    });
    this.transform.addEventListener("objectChange", () => {
      this.callbacks.onPosePreview(this.getPose());
    });
    this.transform.addEventListener("mouseUp", () => {
      const before = this.dragStartPose;
      this.dragStartPose = null;
      if (before) this.callbacks.onPoseCommit(before, this.getPose());
    });

    this.grid = new THREE.GridHelper(8, 32, 0x626a76, 0x343943);
    this.scene.add(this.grid);
    this.addLighting();
    this.createOrientationWidget();
    this.scene.add(this.modelRoot, this.boneVisualRoot);

    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.handleCameraPointerDownCapture,
      true
    );
    this.renderer.domElement.addEventListener("pointerdown", this.handlePointerDown);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.previewResizeObserver = new ResizeObserver(() => this.resizePreview());
    this.previewResizeObserver.observe(this.previewContainer);
    this.resize();
    this.resizePreview();
    this.animate();
    void this.loadMannequin(mannequin);
  }

  setPose(pose: PoseSnapshot) {
    this.pendingPose = clonePose(pose);
    if (!this.ready) return;
    applyTransform(this.modelRoot, pose.root, null);
    for (const jointId of jointIds) {
      if (jointId === "root") continue;
      const bone = this.bones.get(jointId);
      const rest = this.restTransforms.get(jointId);
      if (bone && rest) applyTransform(bone, pose.bones[jointId], rest);
    }
    this.modelRoot.updateMatrixWorld(true);
    this.updateBoneVisuals();
  }

  getPose(): PoseSnapshot {
    if (!this.ready) return clonePose(this.pendingPose);
    const pose = createNeutralPose();
    pose.root = readTransform(this.modelRoot, null);
    for (const jointId of jointIds) {
      if (jointId === "root") continue;
      const bone = this.bones.get(jointId);
      const rest = this.restTransforms.get(jointId);
      if (bone && rest) pose.bones[jointId] = readTransform(bone, rest);
    }
    return pose;
  }

  selectJoint(jointId: JointId) {
    this.selectedJoint = jointId;
    if (!this.ready) return;
    const target = jointId === "root" ? this.modelRoot : this.bones.get(jointId);
    if (!target) return;
    this.transform.attach(target);
    this.updateTransformMode();
    for (const [id, visual] of this.boneVisuals) {
      const selected = id === jointId;
      visual.fill.color.setHex(selected ? 0xf2a93b : 0x4f8cff);
      visual.fill.opacity = selected ? .5 : .24;
      visual.outline.color.setHex(selected ? 0xffc15b : 0x8eb6ff);
    }
    this.callbacks.onJointSelect(jointId);
  }

  setTransformMode(mode: TransformMode) {
    this.transformMode = mode;
    this.updateTransformMode();
  }

  setMannequin(mannequin: MannequinId) {
    if (this.mannequin === mannequin) return;
    this.mannequin = mannequin;
    void this.loadMannequin(mannequin);
  }

  setSkeletonOptions(options: { visible: boolean; inFront: boolean }) {
    this.skeletonVisible = options.visible;
    this.skeletonInFront = options.inFront;
    this.boneVisualRoot.visible = options.visible;
    for (const visual of this.boneVisuals.values()) {
      visual.fill.depthTest = !options.inFront;
      visual.outline.depthTest = !options.inFront;
      visual.mesh.renderOrder = options.inFront ? 40 : 1;
      const outline = visual.mesh.children[0];
      if (outline) outline.renderOrder = options.inFront ? 41 : 2;
    }
  }

  setPreviewOptions(options: PoseCaptureOptions, visible: boolean) {
    this.previewOptions = { ...options };
    this.previewVisible = visible;
    this.previewRenderer.domElement.style.display = visible ? "block" : "none";
    if (visible) this.resizePreview();
  }

  setCameraView(view: "front" | "back" | "left" | "right" | "perspective") {
    const target = this.orbit.target.clone();
    const distance = Math.max(2.8, this.camera.position.distanceTo(target));
    const directions: Record<typeof view, THREE.Vector3> = {
      front: new THREE.Vector3(0, 0, 1),
      back: new THREE.Vector3(0, 0, -1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
      perspective: new THREE.Vector3(.72, .28, 1).normalize()
    };
    this.camera.position.copy(target).add(directions[view].multiplyScalar(distance));
    if (view !== "perspective") this.camera.position.y = target.y;
    this.orbit.update();
  }

  resetCamera() {
    this.frameModel();
  }

  async capture(options: PoseCaptureOptions): Promise<Blob> {
    if (!this.ready) throw new Error("小白人模型尚未加载完成。");
    const [ratioWidth, ratioHeight] = captureRatios[options.aspectRatio];
    const landscape = ratioWidth >= ratioHeight;
    const width = landscape
      ? options.resolution
      : Math.round(options.resolution * ratioWidth / ratioHeight);
    const height = landscape
      ? Math.round(options.resolution * ratioHeight / ratioWidth)
      : options.resolution;
    const previousSize = this.renderer.getSize(new THREE.Vector2());
    const previousPixelRatio = this.renderer.getPixelRatio();
    const previousAspect = this.camera.aspect;
    const previousBackground = this.scene.background;
    const transformVisible = this.transformHelper.visible;
    const skeletonVisible = this.boneVisualRoot.visible;
    const gridVisible = this.grid.visible;

    try {
      this.transformHelper.visible = false;
      this.boneVisualRoot.visible = false;
      this.grid.visible = options.showGrid;
      this.scene.background = options.background === "transparent"
        ? null
        : new THREE.Color(options.background === "light" ? 0xf2f3f5 : 0x1b1e24);
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.render(this.scene, this.camera);

      return await new Promise<Blob>((resolve, reject) => {
        this.renderer.domElement.toBlob((value) => {
          if (value) resolve(value);
          else reject(new Error("无法生成动作截图。"));
        }, "image/png");
      });
    } finally {
      this.transformHelper.visible = transformVisible;
      this.boneVisualRoot.visible = skeletonVisible;
      this.grid.visible = gridVisible;
      this.scene.background = previousBackground;
      this.renderer.setPixelRatio(previousPixelRatio);
      this.renderer.setSize(previousSize.x, previousSize.y, false);
      this.camera.aspect = previousAspect;
      this.camera.updateProjectionMatrix();
    }
  }

  async capturePose(pose: PoseSnapshot, options: PoseCaptureOptions): Promise<Blob> {
    const previous = this.getPose();
    try {
      this.setPose(pose);
      return await this.capture(options);
    } finally {
      this.setPose(previous);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.loadVersion += 1;
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.previewResizeObserver.disconnect();
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.handleCameraPointerDownCapture,
      true
    );
    this.renderer.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.transform.detach();
    this.transform.dispose();
    this.orbit.dispose();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const items = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of items) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.previewRenderer.dispose();
    this.previewRenderer.domElement.remove();
    disposeObjectTree(this.orientationScene);
  }

  private async loadMannequin(mannequin: MannequinId) {
    const version = ++this.loadVersion;
    if (this.ready) this.pendingPose = this.getPose();
    this.ready = false;
    this.callbacks.onLoading();
    this.transform.detach();
    this.clearCharacter();
    this.modelRoot.position.set(0, 0, 0);
    this.modelRoot.quaternion.identity();
    this.modelRoot.scale.set(1, 1, 1);
    try {
      const gltf = await new GLTFLoader().loadAsync(modelUrls[mannequin]);
      if (this.disposed || version !== this.loadVersion) {
        disposeObjectTree(gltf.scene);
        return;
      }
      this.modelContent = gltf.scene;
      this.modelContent.name = mannequin === "manny" ? "UE5_Manny" : "UE5_Quinn";
      applyUe5MannequinReferencePose(this.modelContent, gltf.animations);
      this.modelContent.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) {
          object.frustumCulled = false;
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      this.modelRoot.add(this.modelContent);
      this.normalizeModelOrigin();
      this.modelRoot.updateMatrixWorld(true);
      this.mapBones();
      this.createBoneVisuals();
      this.frameModel();
      this.ready = true;
      this.setPose(this.pendingPose);
      this.selectJoint(this.selectedJoint);
      this.setSkeletonOptions({ visible: this.skeletonVisible, inFront: this.skeletonInFront });
      this.callbacks.onReady();
    } catch (error) {
      if (version !== this.loadVersion) return;
      this.callbacks.onError(error instanceof Error ? error : new Error("小白人模型加载失败。"));
    }
  }

  private normalizeModelOrigin() {
    if (!this.modelContent) return;
    this.modelContent.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.modelContent);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3());
    this.modelContent.position.add(new THREE.Vector3(-center.x, -bounds.min.y, -center.z));
    this.modelContent.updateMatrixWorld(true);
  }

  private clearCharacter() {
    this.bones.clear();
    this.restTransforms.clear();
    this.clearBoneVisuals();
    if (!this.modelContent) return;
    this.modelRoot.remove(this.modelContent);
    disposeObjectTree(this.modelContent);
    this.modelContent = null;
  }

  private mapBones() {
    const missing: string[] = [];
    for (const jointId of jointIds) {
      if (jointId === "root") continue;
      const boneName = ue5PoseBoneNames[jointId];
      const object = this.modelContent?.getObjectByName(boneName);
      if (!(object instanceof THREE.Bone)) {
        missing.push(boneName);
        continue;
      }
      this.bones.set(jointId, object);
      this.restTransforms.set(jointId, {
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone()
      });
    }
    if (missing.length > 0) {
      throw new Error(`模型缺少骨骼：${missing.join("、")}`);
    }
  }

  private createBoneVisuals() {
    for (const jointId of jointIds) {
      const fill = new THREE.MeshBasicMaterial({
        color: 0x4f8cff,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: .24,
        side: THREE.DoubleSide
      });
      const outline = new THREE.LineBasicMaterial({
        color: 0x8eb6ff,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: .96
      });
      const mesh = new THREE.Mesh(this.boneGeometry, fill);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.boneGeometry), outline);
      mesh.add(edges);
      mesh.userData.jointId = jointId;
      mesh.renderOrder = 40;
      edges.renderOrder = 41;
      this.boneVisualRoot.add(mesh);
      this.boneVisuals.set(jointId, { mesh, fill, outline });
    }
    this.updateBoneVisuals();
  }

  private clearBoneVisuals() {
    for (const visual of this.boneVisuals.values()) {
      const edges = visual.mesh.children[0];
      if (edges instanceof THREE.LineSegments) edges.geometry.dispose();
      visual.fill.dispose();
      visual.outline.dispose();
      visual.mesh.removeFromParent();
    }
    this.boneVisuals.clear();
  }

  private updateBoneVisuals() {
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    for (const [jointId, visual] of this.boneVisuals) {
      const target = jointId === "root" ? this.modelRoot : this.bones.get(jointId);
      if (!target) continue;
      target.getWorldPosition(start);
      const tipJoint = boneTipJoints[jointId];
      const tipTarget = tipJoint ? this.bones.get(tipJoint) : undefined;
      if (tipTarget) {
        tipTarget.getWorldPosition(end);
      } else {
        target.getWorldQuaternion(quaternion);
        const terminalLength = /(Thumb|Index|Middle|Ring|Pinky)/.test(jointId)
          ? .022
          : jointId === "head" || jointId.endsWith("Foot") ? .16 : .1;
        end.copy(start).add(new THREE.Vector3(0, terminalLength, 0).applyQuaternion(quaternion));
      }
      direction.copy(end).sub(start);
      const length = Math.max(direction.length(), .008);
      visual.mesh.position.copy(start);
      visual.mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.normalize()
      );
      const width = boneVisualWidth(jointId, length);
      visual.mesh.scale.set(width, length, width);
    }
  }

  private frameModel() {
    const bounds = new THREE.Box3().setFromObject(this.modelRoot);
    if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const height = Math.max(size.y, 1);
    const verticalFov = radians(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, .5));
    const fitHeight = size.y / (2 * Math.tan(verticalFov / 2));
    const fitWidth = size.x / (2 * Math.tan(horizontalFov / 2));
    const distance = Math.max(fitHeight, fitWidth) * 1.12;
    this.orbit.target.copy(center);
    this.camera.position.copy(center).add(
      new THREE.Vector3(0, 0, 1).multiplyScalar(distance)
    );
    this.camera.near = Math.max(.005, height / 500);
    this.camera.far = Math.max(50, height * 20);
    this.camera.updateProjectionMatrix();
    this.orbit.minDistance = height * .4;
    this.orbit.maxDistance = height * 6;
    this.orbit.update();
  }

  private addLighting() {
    this.scene.add(new THREE.HemisphereLight(0xf5f7ff, 0x252832, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(3.5, 5, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9eb8ff, 1.4);
    fill.position.set(-4, 2.5, 2);
    this.scene.add(fill);
  }

  private createOrientationWidget() {
    this.orientationCamera.position.set(0, 0, 4);
    const background = new THREE.Mesh(
      new THREE.CircleGeometry(1.22, 48),
      new THREE.MeshBasicMaterial({ color: 0x151820, transparent: true, opacity: .78 })
    );
    background.position.z = -.45;
    this.orientationScene.add(background);
    this.orientationRoot.add(new THREE.AxesHelper(.82));
    this.orientationRoot.add(createAxisLabel("X", 0xff6b6b, [1.05, 0, 0]));
    this.orientationRoot.add(createAxisLabel("Y", 0x62d986, [0, 1.05, 0]));
    this.orientationRoot.add(createAxisLabel("Z", 0x6794ff, [0, 0, 1.05]));
    this.orientationScene.add(this.orientationRoot);
  }

  private updateTransformMode() {
    if (!this.ready) return;
    this.transform.setMode(this.transformMode);
    this.transform.setSpace(this.selectedJoint === "root" ? "world" : "local");
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.ready || this.transform.dragging) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(
      [...this.boneVisuals.values()].map((visual) => visual.mesh),
      false
    )[0];
    const jointId = hit?.object.userData.jointId as JointId | undefined;
    if (jointId) this.selectJoint(jointId);
  };

  private handleCameraPointerDownCapture = (event: PointerEvent) => {
    if (event.button !== 1) return;
    this.orbit.mouseButtons.MIDDLE = event.shiftKey
      // OrbitControls converts a modified ROTATE action into PAN.
      ? THREE.MOUSE.ROTATE
      : THREE.MOUSE.DOLLY;
  };

  private resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private resizePreview() {
    if (!this.previewVisible) return;
    const width = Math.max(1, this.previewContainer.clientWidth);
    const height = Math.max(1, this.previewContainer.clientHeight);
    this.previewRenderer.setSize(width, height, false);
  }

  private renderMain() {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.autoClear = true;
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.x, size.y);
    this.renderer.render(this.scene, this.camera);

    const widgetSize = Math.max(70, Math.min(104, size.x * .2, size.y * .2));
    const inset = 12;
    this.orientationRoot.quaternion.copy(this.camera.quaternion).invert();
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.setScissorTest(true);
    this.renderer.setScissor(
      size.x - widgetSize - inset,
      size.y - widgetSize - inset,
      widgetSize,
      widgetSize
    );
    this.renderer.setViewport(
      size.x - widgetSize - inset,
      size.y - widgetSize - inset,
      widgetSize,
      widgetSize
    );
    this.renderer.render(this.orientationScene, this.orientationCamera);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, size.x, size.y);
    this.renderer.autoClear = true;
  }

  private renderPreview() {
    if (!this.previewVisible || !this.ready) return;
    const width = this.previewContainer.clientWidth;
    const height = this.previewContainer.clientHeight;
    if (width <= 0 || height <= 0) return;
    const previousAspect = this.camera.aspect;
    const previousBackground = this.scene.background;
    const transformVisible = this.transformHelper.visible;
    const skeletonVisible = this.boneVisualRoot.visible;
    const gridVisible = this.grid.visible;
    this.transformHelper.visible = false;
    this.boneVisualRoot.visible = false;
    this.grid.visible = this.previewOptions.showGrid;
    this.scene.background = this.previewOptions.background === "transparent"
      ? null
      : new THREE.Color(this.previewOptions.background === "light" ? 0xf2f3f5 : 0x1b1e24);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.previewRenderer.render(this.scene, this.camera);
    this.camera.aspect = previousAspect;
    this.camera.updateProjectionMatrix();
    this.scene.background = previousBackground;
    this.transformHelper.visible = transformVisible;
    this.boneVisualRoot.visible = skeletonVisible;
    this.grid.visible = gridVisible;
  }

  private animate = () => {
    if (this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.animate);
    this.orbit.update();
    if (this.ready) this.updateBoneVisuals();
    this.renderMain();
    this.renderPreview();
  };
}

function applyTransform(
  object: THREE.Object3D,
  transform: EditableTransform,
  rest: RestTransform | null
) {
  const deltaRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    radians(transform.rotation[0]),
    radians(transform.rotation[1]),
    radians(transform.rotation[2]),
    "XYZ"
  ));
  if (rest) {
    object.position.copy(rest.position).add(new THREE.Vector3(...transform.position));
    object.quaternion.copy(rest.quaternion).multiply(deltaRotation);
    object.scale.copy(rest.scale).multiply(new THREE.Vector3(...transform.scale));
  } else {
    object.position.set(...transform.position);
    object.quaternion.copy(deltaRotation);
    object.scale.set(...transform.scale);
  }
}

function readTransform(object: THREE.Object3D, rest: RestTransform | null): EditableTransform {
  const position = rest
    ? object.position.clone().sub(rest.position)
    : object.position.clone();
  const deltaQuaternion = rest
    ? rest.quaternion.clone().invert().multiply(object.quaternion)
    : object.quaternion.clone();
  const rotation = new THREE.Euler().setFromQuaternion(deltaQuaternion, "XYZ");
  const scale = rest
    ? new THREE.Vector3(
        safeRatio(object.scale.x, rest.scale.x),
        safeRatio(object.scale.y, rest.scale.y),
        safeRatio(object.scale.z, rest.scale.z)
      )
    : object.scale.clone();
  return {
    position: roundVector(position.toArray() as Vector3Tuple, 4),
    rotation: roundVector([
      degrees(rotation.x),
      degrees(rotation.y),
      degrees(rotation.z)
    ], 2),
    scale: roundVector(scale.toArray() as Vector3Tuple, 4)
  };
}

export function boneVisualWidth(jointId: JointId, length: number): number {
  if (jointId === "root") return .014;
  if (/(Thumb|Index|Middle|Ring|Pinky)/u.test(jointId)) {
    return THREE.MathUtils.clamp(length * .12, .003, .006);
  }
  if (jointId === "pelvis" || jointId === "spine" || jointId === "chest") {
    return THREE.MathUtils.clamp(length * .24, .024, .042);
  }
  if (jointId === "neck" || jointId === "head") {
    return THREE.MathUtils.clamp(length * .14, .014, .03);
  }
  if (jointId.endsWith("Shoulder")) {
    return THREE.MathUtils.clamp(length * .14, .016, .026);
  }
  if (jointId.endsWith("Hand") || jointId.endsWith("Foot")) {
    return THREE.MathUtils.clamp(length * .12, .012, .024);
  }
  return THREE.MathUtils.clamp(length * .1, .012, .03);
}

function safeRatio(value: number, base: number): number {
  return Math.abs(base) < 1e-6 ? 1 : value / base;
}

function roundVector(value: Vector3Tuple, precision: number): Vector3Tuple {
  const factor = 10 ** precision;
  return value.map((item) => Math.round(item * factor) / factor) as Vector3Tuple;
}

function createAxisLabel(text: string, color: number, position: Vector3Tuple): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (context) {
    context.font = "700 38px Segoe UI";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    context.fillText(text, 32, 32);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.position.set(...position);
  sprite.scale.setScalar(.24);
  sprite.renderOrder = 30;
  return sprite;
}

function createBoneGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, .32, 0,
    0, .32, 1,
    -1, .32, 0,
    0, .32, -1,
    0, 1, 0
  ], 3));
  geometry.setIndex([
    0, 2, 1,
    0, 3, 2,
    0, 4, 3,
    0, 1, 4,
    5, 1, 2,
    5, 2, 3,
    5, 3, 4,
    5, 4, 1
  ]);
  geometry.computeVertexNormals();
  return geometry;
}

function disposeObjectTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments || object instanceof THREE.Sprite)) return;
    if ("geometry" in object && object.geometry instanceof THREE.BufferGeometry) geometries.add(object.geometry);
    const rawMaterial = object.material;
    const items = Array.isArray(rawMaterial) ? rawMaterial : [rawMaterial];
    for (const material of items) {
      if (!(material instanceof THREE.Material)) continue;
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

const captureRatios: Record<PoseCaptureOptions["aspectRatio"], [number, number]> = {
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:4": [3, 4],
  "16:9": [16, 9],
  "9:16": [9, 16]
};

export function posesEqual(left: PoseSnapshot, right: PoseSnapshot): boolean {
  return JSON.stringify(clonePose(left)) === JSON.stringify(clonePose(right));
}
