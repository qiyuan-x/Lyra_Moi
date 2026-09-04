import * as THREE from "three";
import type { Ue5ReferencePose } from "./ue5-mannequin-reference.js";

export const ue5ToUniversalBoneMap: Record<string, string> = {
  pelvis: "DEF-hips",
  spine_01: "DEF-spine001",
  spine_03: "DEF-spine002",
  spine_05: "DEF-spine003",
  neck_01: "DEF-neck",
  head: "DEF-head",
  clavicle_l: "DEF-shoulderL",
  upperarm_l: "DEF-upper_armL",
  lowerarm_l: "DEF-forearmL",
  hand_l: "DEF-handL",
  clavicle_r: "DEF-shoulderR",
  upperarm_r: "DEF-upper_armR",
  lowerarm_r: "DEF-forearmR",
  hand_r: "DEF-handR",
  thigh_l: "DEF-thighL",
  calf_l: "DEF-shinL",
  foot_l: "DEF-footL",
  ball_l: "DEF-toeL",
  thigh_r: "DEF-thighR",
  calf_r: "DEF-shinR",
  foot_r: "DEF-footR",
  ball_r: "DEF-toeR",
  thumb_01_l: "DEF-thumb01L",
  thumb_02_l: "DEF-thumb02L",
  thumb_03_l: "DEF-thumb03L",
  index_01_l: "DEF-f_index01L",
  index_02_l: "DEF-f_index02L",
  index_03_l: "DEF-f_index03L",
  middle_01_l: "DEF-f_middle01L",
  middle_02_l: "DEF-f_middle02L",
  middle_03_l: "DEF-f_middle03L",
  ring_01_l: "DEF-f_ring01L",
  ring_02_l: "DEF-f_ring02L",
  ring_03_l: "DEF-f_ring03L",
  pinky_01_l: "DEF-f_pinky01L",
  pinky_02_l: "DEF-f_pinky02L",
  pinky_03_l: "DEF-f_pinky03L",
  thumb_01_r: "DEF-thumb01R",
  thumb_02_r: "DEF-thumb02R",
  thumb_03_r: "DEF-thumb03R",
  index_01_r: "DEF-f_index01R",
  index_02_r: "DEF-f_index02R",
  index_03_r: "DEF-f_index03R",
  middle_01_r: "DEF-f_middle01R",
  middle_02_r: "DEF-f_middle02R",
  middle_03_r: "DEF-f_middle03R",
  ring_01_r: "DEF-f_ring01R",
  ring_02_r: "DEF-f_ring02R",
  ring_03_r: "DEF-f_ring03R",
  pinky_01_r: "DEF-f_pinky01R",
  pinky_02_r: "DEF-f_pinky02R",
  pinky_03_r: "DEF-f_pinky03R"
};

export const ue5ToQuaterniusV2BoneMap: Record<string, string> = Object.fromEntries(
  Object.keys(ue5ToUniversalBoneMap).map((name) => [name, name])
);
ue5ToQuaterniusV2BoneMap.spine_03 = "spine_02";
ue5ToQuaterniusV2BoneMap.spine_05 = "spine_03";
ue5ToQuaterniusV2BoneMap.head = "Head";

const requiredUe5AnimationBones = [
  "pelvis",
  "spine_01",
  "head",
  "upperarm_l",
  "lowerarm_l",
  "upperarm_r",
  "lowerarm_r",
  "thigh_l",
  "calf_l",
  "thigh_r",
  "calf_r"
] as const;

export function createUe5ReferencePoseClip(
  targetRoot: THREE.Object3D,
  referencePose: Ue5ReferencePose,
  name = "A_TPose"
): THREE.AnimationClip {
  const targetMesh = findSkinnedMesh(targetRoot);
  if (!targetMesh) throw new Error("UE5 小白人缺少可用骨骼。");
  const duration = 1 / 6;
  const times = [0, duration];
  const tracks: THREE.KeyframeTrack[] = [];
  for (const bone of targetMesh.skeleton.bones) {
    const transform = referencePose.get(bone.name);
    if (!transform) continue;
    tracks.push(new THREE.VectorKeyframeTrack(
      `.bones[${bone.name}].position`,
      times,
      [...transform.position.toArray(), ...transform.position.toArray()]
    ));
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `.bones[${bone.name}].quaternion`,
      times,
      [...transform.quaternion.toArray(), ...transform.quaternion.toArray()]
    ));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

export function retargetUe5ClipsToUe5(
  targetRoot: THREE.Object3D,
  sourceRoot: THREE.Object3D,
  clips: readonly THREE.AnimationClip[]
): THREE.AnimationClip[] {
  if (clips.length < 1) throw new Error("文件中没有动画片段。");
  const targetMesh = findSkinnedMesh(targetRoot);
  const sourceMesh = findSkinnedMesh(sourceRoot);
  if (!targetMesh) throw new Error("UE5 小白人缺少可用骨骼。");
  targetMesh.skeleton.pose();
  sourceMesh?.skeleton.pose();
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);

  const targetBones = normalizedSkeletonBoneMap(targetMesh.skeleton);
  const sourceBones = sourceMesh
    ? normalizedSkeletonBoneMap(sourceMesh.skeleton)
    : normalizedBoneMap(sourceRoot);
  const missing = requiredUe5AnimationBones.filter((name) => !sourceBones.has(name));
  if (missing.length > 0) {
    throw new Error(`不是可识别的 UE 骨架动画，缺少骨骼：${missing.join("、")}`);
  }
  const pairs = [...targetBones.entries()]
    .map(([name, target]) => createBonePair(target, sourceBones.get(name)))
    .filter((pair): pair is BonePair => pair !== null)
    .sort((left, right) => boneDepth(left.target) - boneDepth(right.target));
  const targetPelvis = targetBones.get("pelvis");
  const sourcePelvis = sourceBones.get("pelvis");
  const sourceMotionRoot = sourceBones.get("root");
  const sourceMotionRootRestWorld = sourceMotionRoot?.getWorldQuaternion(new THREE.Quaternion());
  const scale = ueSkeletonScale(targetBones, sourceBones);
  const targetHipRestWorld = targetPelvis?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const sourceHipRestWorld = sourcePelvis?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const mixer = new THREE.AnimationMixer(sourceRoot);
  const converted = clips.map((clip) => bakeRetargetedClip({
    clip,
    mixer,
    pairs,
    scale,
    sourceHip: sourcePelvis,
    sourceHipRestWorld,
    sourceMotionRoot,
    sourceMotionRootRestWorld,
    targetHip: targetPelvis,
    targetHipRestWorld,
    sourceRoot,
    targetRoot,
    targetMesh,
    normalizeUniformSourceAxis: true
  }));
  mixer.stopAllAction();
  targetMesh.skeleton.pose();
  sourceMesh?.skeleton.pose();
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);
  return converted;
}

function normalizedBoneMap(root: THREE.Object3D): Map<string, THREE.Bone> {
  const result = new Map<string, THREE.Bone>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    const normalized = normalizeUe5BoneName(object.name);
    if (!result.has(normalized)) result.set(normalized, object);
  });
  return result;
}

function normalizeUe5BoneName(value: string): string {
  return (value.split(":").at(-1) ?? value).trim().toLowerCase();
}

function ueSkeletonScale(
  target: Map<string, THREE.Bone>,
  source: Map<string, THREE.Bone>
): number {
  const targetLength = mappedLegLength(target);
  const sourceLength = mappedLegLength(source);
  return targetLength > 0 && sourceLength > 0 ? targetLength / sourceLength : 1;
}

function mappedLegLength(bones: Map<string, THREE.Bone>): number {
  const pelvis = bones.get("pelvis");
  const foot = bones.get("foot_l");
  if (!pelvis || !foot) return 0;
  return pelvis.getWorldPosition(new THREE.Vector3())
    .distanceTo(foot.getWorldPosition(new THREE.Vector3()));
}

export function retargetUniversalClipsToUe5(
  targetRoot: THREE.Object3D,
  sourceRoot: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  targetReferencePose: Ue5ReferencePose
): THREE.AnimationClip[] {
  return retargetMappedClipsToUe5(
    targetRoot,
    sourceRoot,
    clips,
    ue5ToUniversalBoneMap,
    targetReferencePose
  );
}

export function retargetQuaterniusV2ClipsToUe5(
  targetRoot: THREE.Object3D,
  sourceRoot: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  targetReferencePose: Ue5ReferencePose
): THREE.AnimationClip[] {
  return retargetMappedClipsToUe5(
    targetRoot,
    sourceRoot,
    clips,
    ue5ToQuaterniusV2BoneMap,
    targetReferencePose
  );
}

function retargetMappedClipsToUe5(
  targetRoot: THREE.Object3D,
  sourceRoot: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
  boneMap: Readonly<Record<string, string>>,
  targetReferencePose: Ue5ReferencePose
): THREE.AnimationClip[] {
  const targetMesh = findSkinnedMesh(targetRoot);
  const sourceMesh = findSkinnedMesh(sourceRoot);
  if (!targetMesh || !sourceMesh) throw new Error("动作库或 UE5 小白人缺少可用骨骼。");

  applyTargetReferencePose(targetMesh.skeleton, targetReferencePose);
  sourceMesh.skeleton.pose();
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);
  const scale = characterLegScale(
    targetMesh.skeleton,
    sourceMesh.skeleton,
    boneMap
  );
  const pairs = createBonePairs(
    targetMesh.skeleton,
    sourceMesh.skeleton,
    boneMap
  );
  const targetHip = targetMesh.skeleton.getBoneByName("pelvis");
  const sourceHip = sourceMesh.skeleton.getBoneByName(boneMap.pelvis ?? "");
  const targetHipRestWorld = targetHip?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const sourceHipRestWorld = sourceHip?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const mixer = new THREE.AnimationMixer(sourceRoot);
  const converted = clips.map((clip) => bakeRetargetedClip({
    clip,
    mixer,
    pairs,
    scale,
    sourceHip,
    sourceHipRestWorld,
    sourceRoot,
    targetHip,
    targetHipRestWorld,
    targetMesh,
    targetRoot,
    targetReferencePose
  }));
  mixer.stopAllAction();
  targetMesh.skeleton.pose();
  sourceMesh.skeleton.pose();
  targetRoot.updateMatrixWorld(true);
  sourceRoot.updateMatrixWorld(true);
  return converted;
}

interface BonePair {
  target: THREE.Bone;
  source: THREE.Bone;
  targetRestWorld: THREE.Quaternion;
  sourceRestWorld: THREE.Quaternion;
  sourceRestWorldInverse: THREE.Quaternion;
}

function normalizedSkeletonBoneMap(skeleton: THREE.Skeleton): Map<string, THREE.Bone> {
  const result = new Map<string, THREE.Bone>();
  for (const bone of skeleton.bones) {
    const normalized = normalizeUe5BoneName(bone.name);
    if (!result.has(normalized)) result.set(normalized, bone);
  }
  return result;
}

interface BakeOptions {
  clip: THREE.AnimationClip;
  mixer: THREE.AnimationMixer;
  pairs: BonePair[];
  scale: number;
  sourceHip: THREE.Bone | undefined;
  sourceHipRestWorld: THREE.Vector3;
  sourceMotionRoot?: THREE.Bone | undefined;
  sourceMotionRootRestWorld?: THREE.Quaternion | undefined;
  sourceRoot: THREE.Object3D;
  targetHip: THREE.Bone | undefined;
  targetHipRestWorld: THREE.Vector3;
  targetMesh: THREE.SkinnedMesh;
  targetRoot: THREE.Object3D;
  targetReferencePose?: Ue5ReferencePose;
  normalizeUniformSourceAxis?: boolean;
}

function createBonePairs(
  target: THREE.Skeleton,
  source: THREE.Skeleton,
  boneMap: Readonly<Record<string, string>>
): BonePair[] {
  const pairs: BonePair[] = [];
  for (const [targetName, sourceName] of Object.entries(boneMap)) {
    const targetBone = target.getBoneByName(targetName);
    const sourceBone = source.getBoneByName(sourceName);
    const pair = createBonePair(targetBone, sourceBone);
    if (pair) pairs.push(pair);
  }
  return pairs.sort((left, right) => boneDepth(left.target) - boneDepth(right.target));
}

function createBonePair(
  target: THREE.Bone | undefined,
  source: THREE.Bone | undefined
): BonePair | null {
  if (!target || !source) return null;
  const targetRestWorld = target.getWorldQuaternion(new THREE.Quaternion());
  const sourceRestWorld = source.getWorldQuaternion(new THREE.Quaternion());
  return {
    target,
    source,
    targetRestWorld,
    sourceRestWorld: sourceRestWorld.clone(),
    sourceRestWorldInverse: sourceRestWorld.invert()
  };
}

export function composeRetargetedWorldRotation(
  sourceWorld: THREE.Quaternion,
  sourceRestWorldInverse: THREE.Quaternion,
  targetRestWorld: THREE.Quaternion,
  target = new THREE.Quaternion()
): THREE.Quaternion {
  return target.copy(sourceWorld)
    .multiply(sourceRestWorldInverse)
    .multiply(targetRestWorld)
    .normalize();
}

function applyTargetReferencePose(
  skeleton: THREE.Skeleton,
  referencePose?: Ue5ReferencePose
): void {
  skeleton.pose();
  if (!referencePose) return;
  for (const bone of skeleton.bones) {
    const transform = referencePose.get(bone.name);
    if (!transform) continue;
    bone.position.copy(transform.position);
    bone.quaternion.copy(transform.quaternion);
    bone.scale.copy(transform.scale);
  }
}

function bakeRetargetedClip(options: BakeOptions): THREE.AnimationClip {
  const fps = 30;
  const duration = Math.max(options.clip.duration, 1 / fps);
  const frameCount = Math.max(2, Math.round(duration * fps) + 1);
  const times = new Float32Array(frameCount);
  const rotations = new Map<THREE.Bone, Float32Array>();
  for (const pair of options.pairs) rotations.set(pair.target, new Float32Array(frameCount * 4));
  const hipPositions = options.targetHip && options.sourceHip
    ? new Float32Array(frameCount * 3)
    : null;
  const action = options.mixer.clipAction(options.clip);
  options.mixer.stopAllAction();
  action.reset().play();

  let sourceAxisCalibration: SourceAxisCalibration | null = null;
  if (options.normalizeUniformSourceAxis) {
    options.mixer.setTime(0);
    options.sourceRoot.updateMatrixWorld(true);
    sourceAxisCalibration = detectUniformSourceAxisCalibration(
      options.pairs,
      options.sourceHip,
      options.sourceHipRestWorld,
      options.sourceRoot,
      options.sourceMotionRoot,
      options.sourceMotionRootRestWorld
    );
  }

  const sourceWorld = new THREE.Quaternion();
  const desiredWorld = new THREE.Quaternion();
  const parentWorldInverse = new THREE.Quaternion();
  const sourcePosition = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = Math.min(duration, frame / fps);
    times[frame] = time;
    options.mixer.setTime(time === duration ? Math.max(0, duration - 1e-6) : time);
    options.sourceRoot.updateMatrixWorld(true);
    applyTargetReferencePose(options.targetMesh.skeleton, options.targetReferencePose);
    options.targetRoot.updateMatrixWorld(true);

    for (const pair of options.pairs) {
      pair.source.getWorldQuaternion(sourceWorld);
      if (sourceAxisCalibration) {
        desiredWorld.copy(sourceWorld)
          .multiply(pair.sourceRestWorldInverse)
          .multiply(sourceAxisCalibration.rotationInverse)
          .multiply(pair.targetRestWorld)
          .normalize();
      } else {
        composeRetargetedWorldRotation(
          sourceWorld,
          pair.sourceRestWorldInverse,
          pair.targetRestWorld,
          desiredWorld
        );
      }
      if (pair.target.parent) {
        pair.target.parent.getWorldQuaternion(parentWorldInverse).invert();
        pair.target.quaternion.copy(parentWorldInverse.multiply(desiredWorld)).normalize();
      } else {
        pair.target.quaternion.copy(desiredWorld).normalize();
      }
      pair.target.updateMatrixWorld(true);
      pair.target.quaternion.toArray(rotations.get(pair.target)!, frame * 4);
    }

    if (hipPositions && options.sourceHip && options.targetHip) {
      options.sourceHip.getWorldPosition(sourcePosition);
      desiredPosition.copy(sourcePosition)
        .sub(sourceAxisCalibration?.sourcePositionOrigin ?? options.sourceHipRestWorld)
        .multiplyScalar(options.scale);
      desiredPosition.add(options.targetHipRestWorld);
      if (options.targetHip.parent) options.targetHip.parent.worldToLocal(desiredPosition);
      options.targetHip.position.copy(desiredPosition);
      options.targetHip.position.toArray(hipPositions, frame * 3);
      options.targetHip.updateMatrixWorld(true);
    }
  }

  action.stop();
  options.mixer.uncacheAction(options.clip);
  const tracks: THREE.KeyframeTrack[] = [];
  if (hipPositions && options.targetHip) {
    tracks.push(new THREE.VectorKeyframeTrack(
      `.bones[${options.targetHip.name}].position`,
      times,
      hipPositions
    ));
  }
  for (const pair of options.pairs) {
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `.bones[${pair.target.name}].quaternion`,
      times,
      rotations.get(pair.target)!
    ));
  }
  return new THREE.AnimationClip(options.clip.name, duration, tracks);
}

interface SourceAxisCalibration {
  rotationInverse: THREE.Quaternion;
  sourcePositionOrigin: THREE.Vector3;
}

function detectUniformSourceAxisCalibration(
  pairs: readonly BonePair[],
  sourceHip: THREE.Bone | undefined,
  sourceHipRestWorld: THREE.Vector3,
  sourceRoot: THREE.Object3D,
  sourceMotionRoot?: THREE.Bone,
  sourceMotionRootRestWorld?: THREE.Quaternion
): SourceAxisCalibration | null {
  if (sourceMotionRoot && sourceMotionRootRestWorld) {
    const rootDelta = sourceMotionRoot
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(sourceMotionRootRestWorld.clone().invert());
    if (isFbxQuarterTurn(sourceRoot.quaternion) && isFbxQuarterTurn(rootDelta)) {
      return createSourceAxisCalibration(rootDelta, sourceHip, sourceHipRestWorld);
    }
  }

  const bodyPairs = pairs.filter((pair) => requiredUe5AnimationBones.includes(
    pair.target.name as (typeof requiredUe5AnimationBones)[number]
  ));
  const referencePair = bodyPairs.find((pair) => pair.target.name === "pelvis") ?? bodyPairs[0];
  if (!referencePair || bodyPairs.length < 6) return null;

  const referenceDelta = referencePair.source
    .getWorldQuaternion(new THREE.Quaternion())
    .multiply(referencePair.sourceRestWorldInverse);
  if (THREE.MathUtils.radToDeg(referenceDelta.angleTo(new THREE.Quaternion())) < 10) {
    return null;
  }

  let matching = 0;
  for (const pair of bodyPairs) {
    const delta = pair.source
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(pair.sourceRestWorldInverse);
    if (THREE.MathUtils.radToDeg(delta.angleTo(referenceDelta)) <= 1) matching += 1;
  }
  if (matching / bodyPairs.length < .8) return null;

  return createSourceAxisCalibration(referenceDelta, sourceHip, sourceHipRestWorld);
}

function isFbxQuarterTurn(value: THREE.Quaternion): boolean {
  const normalized = value.clone().normalize();
  if (normalized.w < 0) {
    normalized.set(-normalized.x, -normalized.y, -normalized.z, -normalized.w);
  }
  const angle = 2 * Math.acos(THREE.MathUtils.clamp(normalized.w, -1, 1));
  const sinHalf = Math.sin(angle / 2);
  if (sinHalf < 1e-6) return false;
  const axisX = Math.abs(normalized.x / sinHalf);
  const axisY = Math.abs(normalized.y / sinHalf);
  const axisZ = Math.abs(normalized.z / sinHalf);
  return Math.abs(angle - Math.PI / 2) <= THREE.MathUtils.degToRad(3)
    && axisX >= .995
    && axisY <= .08
    && axisZ <= .08;
}

function createSourceAxisCalibration(
  rotation: THREE.Quaternion,
  sourceHip: THREE.Bone | undefined,
  sourceHipRestWorld: THREE.Vector3
): SourceAxisCalibration {
  const rotationInverse = rotation.clone().invert();
  const sourcePositionOrigin = sourceHip
    ? sourceHip.getWorldPosition(new THREE.Vector3())
    : sourceHipRestWorld.clone();
  return { rotationInverse, sourcePositionOrigin };
}

function boneDepth(bone: THREE.Bone): number {
  let depth = 0;
  let current: THREE.Object3D | null = bone.parent;
  while (current) {
    depth += 1;
    current = current.parent;
  }
  return depth;
}

function findSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh | null {
  let result: THREE.SkinnedMesh | null = null;
  root.traverse((object) => {
    if (!result && object instanceof THREE.SkinnedMesh) result = object;
  });
  return result;
}

function characterLegScale(
  target: THREE.Skeleton,
  source: THREE.Skeleton,
  boneMap: Readonly<Record<string, string>>
): number {
  const targetLength = legLength(target, "pelvis", "foot_l");
  const sourceLength = legLength(source, boneMap.pelvis ?? "", boneMap.foot_l ?? "");
  if (targetLength <= 0 || sourceLength <= 0) return 1;
  return targetLength / sourceLength;
}

function legLength(skeleton: THREE.Skeleton, hipName: string, footName: string): number {
  const hip = skeleton.getBoneByName(hipName);
  const foot = skeleton.getBoneByName(footName);
  if (!hip || !foot) return 0;
  const hipPosition = hip.getWorldPosition(new THREE.Vector3());
  const footPosition = foot.getWorldPosition(new THREE.Vector3());
  return hipPosition.distanceTo(footPosition);
}
