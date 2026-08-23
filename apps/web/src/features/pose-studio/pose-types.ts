export const jointIds = [
  "root",
  "spine",
  "chest",
  "neck",
  "head",
  "leftShoulder",
  "leftUpperArm",
  "leftForearm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightForearm",
  "rightHand",
  "leftThigh",
  "leftShin",
  "leftFoot",
  "rightThigh",
  "rightShin",
  "rightFoot",
  "leftThumb1",
  "leftThumb2",
  "leftThumb3",
  "leftIndex1",
  "leftIndex2",
  "leftIndex3",
  "leftMiddle1",
  "leftMiddle2",
  "leftMiddle3",
  "leftRing1",
  "leftRing2",
  "leftRing3",
  "leftPinky1",
  "leftPinky2",
  "leftPinky3",
  "rightThumb1",
  "rightThumb2",
  "rightThumb3",
  "rightIndex1",
  "rightIndex2",
  "rightIndex3",
  "rightMiddle1",
  "rightMiddle2",
  "rightMiddle3",
  "rightRing1",
  "rightRing2",
  "rightRing3",
  "rightPinky1",
  "rightPinky2",
  "rightPinky3"
] as const;

export type JointId = typeof jointIds[number];
export type Vector3Tuple = [number, number, number];
export type TransformMode = "translate" | "rotate" | "scale";
export type MannequinId = "manny" | "quinn";
export type PoseTemplateKind = "body" | "hand";

export interface EditableTransform {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface PoseSnapshot {
  version: 2;
  root: EditableTransform;
  bones: Record<JointId, EditableTransform>;
}

export interface PoseTemplate {
  id: string;
  name: string;
  pose: PoseSnapshot;
  builtIn: boolean;
  kind: PoseTemplateKind;
  sourceSide?: "left" | "right";
  previewDataUrl?: string;
}

export interface PoseTemplateTransfer {
  version: 1;
  exportedAt: string;
  templates: Array<Pick<PoseTemplate, "name" | "pose" | "kind" | "sourceSide">>;
}

export interface PoseCaptureOptions {
  aspectRatio: "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
  resolution: 1024 | 2048;
  background: "dark" | "light" | "transparent";
  showGrid: boolean;
}

export const jointLabels: Record<JointId, string> = {
  root: "整体",
  spine: "腰部",
  chest: "胸部",
  neck: "颈部",
  head: "头部",
  leftShoulder: "左肩",
  leftUpperArm: "左上臂",
  leftForearm: "左前臂",
  leftHand: "左手腕",
  rightShoulder: "右肩",
  rightUpperArm: "右上臂",
  rightForearm: "右前臂",
  rightHand: "右手腕",
  leftThigh: "左大腿",
  leftShin: "左小腿",
  leftFoot: "左脚",
  rightThigh: "右大腿",
  rightShin: "右小腿",
  rightFoot: "右脚",
  leftThumb1: "左拇指 1",
  leftThumb2: "左拇指 2",
  leftThumb3: "左拇指 3",
  leftIndex1: "左食指 1",
  leftIndex2: "左食指 2",
  leftIndex3: "左食指 3",
  leftMiddle1: "左中指 1",
  leftMiddle2: "左中指 2",
  leftMiddle3: "左中指 3",
  leftRing1: "左无名指 1",
  leftRing2: "左无名指 2",
  leftRing3: "左无名指 3",
  leftPinky1: "左小指 1",
  leftPinky2: "左小指 2",
  leftPinky3: "左小指 3",
  rightThumb1: "右拇指 1",
  rightThumb2: "右拇指 2",
  rightThumb3: "右拇指 3",
  rightIndex1: "右食指 1",
  rightIndex2: "右食指 2",
  rightIndex3: "右食指 3",
  rightMiddle1: "右中指 1",
  rightMiddle2: "右中指 2",
  rightMiddle3: "右中指 3",
  rightRing1: "右无名指 1",
  rightRing2: "右无名指 2",
  rightRing3: "右无名指 3",
  rightPinky1: "右小指 1",
  rightPinky2: "右小指 2",
  rightPinky3: "右小指 3"
};

const fingerPattern = /(Thumb|Index|Middle|Ring|Pinky)/;

export const bodyJointIds: JointId[] = jointIds.filter(
  (jointId) => !fingerPattern.test(jointId)
);

export const leftHandJointIds: JointId[] = jointIds.filter(
  (jointId) => jointId.startsWith("left") && fingerPattern.test(jointId)
);

export const rightHandJointIds: JointId[] = jointIds.filter(
  (jointId) => jointId.startsWith("right") && fingerPattern.test(jointId)
);

export function createNeutralTransform(): EditableTransform {
  return {
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1]
  };
}

export function createNeutralPose(): PoseSnapshot {
  return {
    version: 2,
    root: createNeutralTransform(),
    bones: Object.fromEntries(
      jointIds.map((jointId) => [jointId, createNeutralTransform()])
    ) as Record<JointId, EditableTransform>
  };
}

export function clonePose(pose: PoseSnapshot): PoseSnapshot {
  return {
    version: 2,
    root: cloneTransform(pose.root),
    bones: Object.fromEntries(
      jointIds.map((jointId) => [jointId, cloneTransform(pose.bones[jointId])])
    ) as Record<JointId, EditableTransform>
  };
}

export function cloneTransform(transform: EditableTransform): EditableTransform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale]
  };
}

export function selectedTransform(pose: PoseSnapshot, jointId: JointId): EditableTransform {
  return jointId === "root" ? pose.root : pose.bones[jointId];
}

export function readPoseSnapshot(value: unknown): PoseSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version === 2 && isTransform(candidate.root)) {
    const bones = candidate.bones as Record<string, unknown> | undefined;
    if (bones && jointIds.every((jointId) => isTransform(bones[jointId]))) {
      return clonePose(candidate as unknown as PoseSnapshot);
    }
  }
  if (candidate.version === 1 && Array.isArray(candidate.root)) {
    const rotations = candidate.rotations as Record<string, unknown> | undefined;
    if (!rotations) return null;
    const pose = createNeutralPose();
    const root = candidate.root;
    if (isVector3(root)) pose.root.position = [...root];
    for (const jointId of jointIds) {
      const rotation = rotations[jointId];
      if (isVector3(rotation)) pose.bones[jointId].rotation = [...rotation];
    }
    return pose;
  }
  return null;
}

export function isPoseSnapshot(value: unknown): value is PoseSnapshot {
  return readPoseSnapshot(value)?.version === 2;
}

function isTransform(value: unknown): value is EditableTransform {
  if (!value || typeof value !== "object") return false;
  const transform = value as Partial<EditableTransform>;
  return isVector3(transform.position) &&
    isVector3(transform.rotation) &&
    isVector3(transform.scale);
}

function isVector3(value: unknown): value is Vector3Tuple {
  return Array.isArray(value) &&
    value.length === 3 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item));
}
