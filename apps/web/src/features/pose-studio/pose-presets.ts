import {
  clonePose,
  createNeutralPose,
  jointIds,
  leftHandJointIds,
  rightHandJointIds,
  type EditableTransform,
  type JointId,
  type MannequinId,
  type PoseSnapshot,
  type PoseTemplate,
  type Vector3Tuple
} from "./pose-types.js";

type PoseRotations = Partial<Record<JointId, Vector3Tuple>>;
type FingerName = typeof fingerNames[number];

const fingerNames = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;
const fingerStraighten: Record<FingerName, [number, number, number]> = {
  Thumb: [30, 23, 10],
  Index: [23, 15, 13],
  Middle: [32, 21, 10],
  Ring: [30, 19, 9],
  Pinky: [17, 21, 5]
};

export type HandPresetId = "open" | "fist" | "point" | "v" | "ok" | "grip";

export const handPresetLabels: Record<HandPresetId, string> = {
  open: "张开",
  fist: "握拳",
  point: "指向",
  v: "V 手势",
  ok: "OK",
  grip: "抓握"
};

function poseWith(rotations: PoseRotations): PoseSnapshot {
  const pose = createNeutralPose();
  for (const [jointId, rotation] of Object.entries(rotations)) {
    pose.bones[jointId as JointId].rotation = [...rotation];
  }
  return pose;
}

function openHands(source: PoseSnapshot, mannequin: MannequinId): PoseSnapshot {
  let result = clonePose(source);
  result = applyHandPreset(result, "left", "open", mannequin);
  result = applyHandPreset(result, "right", "open", mannequin);
  return result;
}

function handTemplate(id: HandPresetId, mannequin: MannequinId): PoseTemplate {
  return {
    id: `hand-${id}`,
    name: handPresetLabels[id],
    pose: applyHandPreset(createNeutralPose(), "left", id, mannequin),
    builtIn: true,
    kind: "hand",
    sourceSide: "left"
  };
}

export function getBuiltInPoseTemplates(mannequin: MannequinId = "manny"): PoseTemplate[] {
  return [
    {
      id: "t-pose",
      name: "T 形姿势",
      pose: openHands(createNeutralPose(), mannequin),
      builtIn: true,
      kind: "body"
    },
    {
      id: "a-pose",
      name: "A 形姿势",
      pose: openHands(poseWith({
        leftUpperArm: [54.7, -1.3, -1.3],
        rightUpperArm: [54.7, 1.3, 1.3],
        leftForearm: [0, 0, 0],
        rightForearm: [0, 0, 0]
      }), mannequin),
      builtIn: true,
      kind: "body"
    },
    {
      id: "relaxed",
      name: "自然站立",
      pose: poseWith({
        leftUpperArm: [78, -2, -2],
        rightUpperArm: [78, 2, 2],
        leftForearm: [0, 0, 12],
        rightForearm: [0, 0, -12]
      }),
      builtIn: true,
      kind: "body"
    },
    ...(["open", "fist", "point", "v", "ok", "grip"] as HandPresetId[])
      .map((id) => handTemplate(id, mannequin))
  ];
}

export const builtInPoseTemplates: PoseTemplate[] = getBuiltInPoseTemplates();

const sidePairs: Array<[JointId, JointId]> = [
  ["leftShoulder", "rightShoulder"],
  ["leftUpperArm", "rightUpperArm"],
  ["leftForearm", "rightForearm"],
  ["leftHand", "rightHand"],
  ["leftThigh", "rightThigh"],
  ["leftShin", "rightShin"],
  ["leftFoot", "rightFoot"],
  ["leftThumb1", "rightThumb1"],
  ["leftThumb2", "rightThumb2"],
  ["leftThumb3", "rightThumb3"],
  ["leftIndex1", "rightIndex1"],
  ["leftIndex2", "rightIndex2"],
  ["leftIndex3", "rightIndex3"],
  ["leftMiddle1", "rightMiddle1"],
  ["leftMiddle2", "rightMiddle2"],
  ["leftMiddle3", "rightMiddle3"],
  ["leftRing1", "rightRing1"],
  ["leftRing2", "rightRing2"],
  ["leftRing3", "rightRing3"],
  ["leftPinky1", "rightPinky1"],
  ["leftPinky2", "rightPinky2"],
  ["leftPinky3", "rightPinky3"]
];

export function mirrorPose(source: PoseSnapshot): PoseSnapshot {
  const result = clonePose(source);
  result.root = mirrorTransform(source.root);
  const paired = new Set<JointId>();
  for (const [left, right] of sidePairs) {
    result.bones[left] = mirrorTransform(source.bones[right]);
    result.bones[right] = mirrorTransform(source.bones[left]);
    paired.add(left);
    paired.add(right);
  }
  for (const jointId of jointIds) {
    if (!paired.has(jointId)) result.bones[jointId] = mirrorTransform(source.bones[jointId]);
  }
  return result;
}

export function applyBodyTemplate(source: PoseSnapshot, template: PoseSnapshot): PoseSnapshot {
  void source;
  return clonePose(template);
}

export function applyHandTemplate(
  source: PoseSnapshot,
  template: PoseTemplate,
  targetSide: "left" | "right"
): PoseSnapshot {
  const sourceSide = template.sourceSide ?? "left";
  const templatePose = sourceSide === targetSide ? template.pose : mirrorPose(template.pose);
  const result = clonePose(source);
  const targetJoints = targetSide === "left" ? leftHandJointIds : rightHandJointIds;
  for (const jointId of targetJoints) {
    result.bones[jointId] = cloneTransform(templatePose.bones[jointId]);
  }
  return result;
}

export function applyHandPreset(
  source: PoseSnapshot,
  side: "left" | "right",
  presetId: HandPresetId,
  mannequin: MannequinId = "manny"
): PoseSnapshot {
  const result = clonePose(source);
  for (const finger of fingerNames) {
    const bend = presetBend(presetId, finger);
    const straighten = fingerStraighten[finger];
    for (const segment of [1, 2, 3] as const) {
      const index = (segment - 1) as 0 | 1 | 2;
      const jointId = `${side}${finger}${segment}` as JointId;
      const direction = side === "left" ? 1 : -1;
      result.bones[jointId].rotation = [
        0,
        0,
        direction * (straighten[index] - bend[index])
      ];
    }
  }
  if (presetId === "v") {
    setFingerPose(result, side, "Index", [25, 0, 23], [0, 0, 15], [0, 0, 13]);
    setFingerPose(result, side, "Middle", [-25, 0, 32], [0, 0, 21], [0, 0, 10]);
  }
  if (presetId === "ok") {
    if (mannequin === "quinn") {
      setFingerPose(result, side, "Thumb", [-0.4, -4.6, 20.7], [4.6, 4.7, -30.5], [-0.2, 0, -26.6]);
      setFingerPose(result, side, "Index", [-23.1, -19.7, -41.4], [-0.2, -0.1, -36.6], [-0.1, 0, -42.5]);
    } else {
      setFingerPose(result, side, "Thumb", [0, 25, 6], [0, 0, -27.4], [0, 0, -25]);
      setFingerPose(result, side, "Index", [-30.2, -30.9, -42.2], [0, 0, -33.4], [0, 0, -30]);
    }
  }
  return result;
}

function setFingerPose(
  pose: PoseSnapshot,
  side: "left" | "right",
  finger: FingerName,
  first: Vector3Tuple,
  second: Vector3Tuple,
  third: Vector3Tuple
): void {
  const rotations = [first, second, third];
  for (const segment of [1, 2, 3] as const) {
    const [x, y, z] = rotations[segment - 1]!;
    pose.bones[`${side}${finger}${segment}` as JointId].rotation = side === "left"
      ? [x, y, z]
      : [x, -y, -z];
  }
}

function presetBend(presetId: HandPresetId, finger: FingerName): [number, number, number] {
  const open: [number, number, number] = [0, 0, 0];
  const fist: [number, number, number] = [58, 72, 62];
  if (presetId === "open") return open;
  if (presetId === "fist") return fist;
  if (presetId === "grip") return [36, 48, 40];
  if (presetId === "point") return finger === "Index" ? open : fist;
  if (presetId === "v") return finger === "Index" || finger === "Middle" ? open : fist;
  if (presetId === "ok") {
    if (finger === "Thumb") return [32, 38, 24];
    if (finger === "Index") return [48, 58, 42];
    return open;
  }
  return open;
}

function mirrorTransform(transform: EditableTransform): EditableTransform {
  return {
    position: [-transform.position[0], transform.position[1], transform.position[2]],
    rotation: [transform.rotation[0], -transform.rotation[1], -transform.rotation[2]],
    scale: [...transform.scale]
  };
}

function cloneTransform(transform: EditableTransform): EditableTransform {
  return {
    position: [...transform.position],
    rotation: [...transform.rotation],
    scale: [...transform.scale]
  };
}
