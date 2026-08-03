import type * as THREE from "three";
import type { ModelStats } from "./model-viewer-types.js";

export function collectModelStats(
  root: THREE.Object3D,
  animationCount: number
): ModelStats {
  const geometries = new Set<string>();
  const materials = new Set<string>();
  let meshes = 0;
  let vertices = 0;
  let faces = 0;

  root.traverse((object) => {
    if (!isMesh(object)) return;
    meshes += 1;
    const geometry = object.geometry;
    const position = geometry.getAttribute("position");
    const indexCount = geometry.index?.count ?? position?.count ?? 0;
    faces += Math.floor(indexCount / 3);
    if (!geometries.has(geometry.uuid)) {
      geometries.add(geometry.uuid);
      vertices += position?.count ?? 0;
    }
    for (const material of toMaterials(object.material)) {
      materials.add(material.uuid);
    }
  });

  return {
    topology: "triangle",
    meshes,
    materials: materials.size,
    vertices,
    faces,
    animations: Math.max(0, animationCount)
  };
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return "isMesh" in object && object.isMesh === true;
}

export function toMaterials(
  value: THREE.Material | THREE.Material[]
): THREE.Material[] {
  return Array.isArray(value) ? value : [value];
}
