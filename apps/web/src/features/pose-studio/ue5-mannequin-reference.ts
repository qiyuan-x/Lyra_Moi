import * as THREE from "three";

export interface Ue5ReferenceTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export type Ue5ReferencePose = ReadonlyMap<string, Ue5ReferenceTransform>;

export function applyUe5MannequinReferencePose(
  root: THREE.Object3D,
  animations: readonly THREE.AnimationClip[]
): boolean {
  const clip = animations.find((item) => item.name.toLowerCase().includes("tpose"));
  if (!clip) return false;
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  mixer.setTime(0);
  root.updateMatrixWorld(true);
  return true;
}

export function captureUe5MannequinReferenceTransforms<T extends string>(
  root: THREE.Object3D,
  animations: readonly THREE.AnimationClip[],
  boneNames: Readonly<Record<T, string>>
): Map<T, Ue5ReferenceTransform> {
  const referencePose = captureUe5MannequinReferencePose(root, animations);
  const result = new Map<T, Ue5ReferenceTransform>();
  for (const [jointId, boneName] of Object.entries(boneNames) as [T, string][]) {
    const transform = referencePose.get(boneName);
    if (transform) result.set(jointId, transform);
  }
  return result;
}

export function captureUe5MannequinReferencePose(
  root: THREE.Object3D,
  animations: readonly THREE.AnimationClip[]
): Map<string, Ue5ReferenceTransform> {
  const previous = new Map<THREE.Bone, Ue5ReferenceTransform>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Bone)) return;
    previous.set(object, cloneLocalTransform(object));
  });

  if (!applyUe5MannequinReferencePose(root, animations)) {
    throw new Error("UE5 小白人缺少 TPose 参考动画。");
  }
  const result = new Map<string, Ue5ReferenceTransform>();
  for (const bone of previous.keys()) {
    result.set(bone.name, cloneLocalTransform(bone));
  }

  for (const [bone, transform] of previous) {
    bone.position.copy(transform.position);
    bone.quaternion.copy(transform.quaternion);
    bone.scale.copy(transform.scale);
  }
  root.updateMatrixWorld(true);
  return result;
}

function cloneLocalTransform(object: THREE.Object3D): Ue5ReferenceTransform {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone()
  };
}
