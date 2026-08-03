import { describe, expect, it } from "vitest";
import { collectModelStats } from "../../apps/web/src/components/viewer/model-viewer-stats.js";
import {
  formatBytes,
  formatCount
} from "../../apps/web/src/components/viewer/ModelViewerChrome.js";

describe("model viewer stats", () => {
  it("counts rendered faces and deduplicates shared geometry vertices", () => {
    const geometry = {
      uuid: "geometry",
      index: { count: 6 },
      getAttribute(name: string) {
        return name === "position" ? { count: 4 } : undefined;
      }
    };
    const meshes = [
      { isMesh: true, geometry, material: { uuid: "material-1" } },
      { isMesh: true, geometry, material: { uuid: "material-2" } }
    ];
    const root = {
      traverse(visitor: (value: unknown) => void) {
        for (const mesh of meshes) visitor(mesh);
      }
    } as Parameters<typeof collectModelStats>[0];

    expect(collectModelStats(root, 1)).toEqual({
      topology: "triangle",
      meshes: 2,
      materials: 2,
      vertices: 4,
      faces: 4,
      animations: 1
    });
  });

  it("formats viewer statistics for the Chinese interface", () => {
    expect(formatCount(170922.9)).toBe("170,922");
    expect(formatCount(-1)).toBe("0");
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(52.9 * 1024 * 1024)).toBe("52.9 MB");
  });
});
