import { describe, expect, it } from "vitest";
import {
  applyHandPreset,
  builtInPoseTemplates,
  getBuiltInPoseTemplates,
  mirrorPose
} from "../../apps/web/src/features/pose-studio/pose-presets.js";
import {
  createPoseTemplateArchive,
  createPoseTemplateExport,
  parsePoseTemplateFile,
  parsePoseTemplateImport
} from "../../apps/web/src/features/pose-studio/pose-template-transfer.js";
import {
  clonePose,
  createNeutralPose,
  isPoseSnapshot,
  readPoseSnapshot,
  type PoseTemplate
} from "../../apps/web/src/features/pose-studio/pose-types.js";

describe("pose studio", () => {
  it("creates an independent neutral pose", () => {
    const first = createNeutralPose();
    const second = clonePose(first);
    second.bones.leftUpperArm.rotation[2] = 45;
    second.bones.leftUpperArm.position[0] = .2;
    second.bones.leftUpperArm.scale[1] = 1.2;
    expect(first.bones.leftUpperArm.rotation[2]).toBe(0);
    expect(first.bones.leftUpperArm.position[0]).toBe(0);
    expect(first.bones.leftUpperArm.scale[1]).toBe(1);
    expect(isPoseSnapshot(second)).toBe(true);
  });

  it("mirrors both body sides and can mirror back", () => {
    const pose = createNeutralPose();
    pose.bones.leftUpperArm.rotation = [12, 24, 36];
    pose.bones.leftUpperArm.position = [.1, .2, .3];
    pose.bones.rightUpperArm.rotation = [-8, 16, -32];
    const mirrored = mirrorPose(pose);
    expect(mirrored.bones.leftUpperArm.rotation).toEqual([-8, -16, 32]);
    expect(mirrorPose(mirrored)).toEqual(pose);
  });

  it("applies a hand preset without changing the body pose", () => {
    const pose = createNeutralPose();
    pose.bones.chest.rotation = [10, 0, 0];
    const fist = applyHandPreset(pose, "left", "fist");
    expect(fist.bones.leftIndex1.rotation[2]).toBe(-35);
    expect(fist.bones.leftIndex2.rotation[2]).toBe(-57);
    expect(fist.bones.rightIndex1.rotation).toEqual([0, 0, 0]);
    expect(fist.bones.chest.rotation).toEqual([10, 0, 0]);
  });

  it("keeps A-pose elbows straight and uses open hands for T and A poses", () => {
    const tPose = builtInPoseTemplates.find((item) => item.id === "t-pose")!;
    const aPose = builtInPoseTemplates.find((item) => item.id === "a-pose")!;
    expect(aPose.pose.bones.leftForearm.rotation).toEqual([0, 0, 0]);
    expect(aPose.pose.bones.rightForearm.rotation).toEqual([0, 0, 0]);
    expect(tPose.pose.bones.leftIndex1.rotation).toEqual([0, 0, 23]);
    expect(tPose.pose.bones.rightIndex1.rotation).toEqual([0, 0, -23]);
    expect(aPose.pose.bones.leftThumb1.rotation).toEqual([0, 0, 30]);
  });

  it("keeps the mannequin default finger pose when standing naturally", () => {
    const relaxed = builtInPoseTemplates.find((item) => item.id === "relaxed")!;
    expect(relaxed.pose.bones.leftThumb1.rotation).toEqual([0, 0, 0]);
    expect(relaxed.pose.bones.leftIndex2.rotation).toEqual([0, 0, 0]);
    expect(relaxed.pose.bones.rightPinky3.rotation).toEqual([0, 0, 0]);
  });

  it("uses full finger rotations for V and OK gestures", () => {
    const neutral = createNeutralPose();
    const v = applyHandPreset(neutral, "left", "v");
    expect(v.bones.leftIndex1.rotation).toEqual([25, 0, 23]);
    expect(v.bones.leftMiddle1.rotation).toEqual([-25, 0, 32]);
    const ok = applyHandPreset(neutral, "left", "ok");
    expect(ok.bones.leftThumb1.rotation).toEqual([0, 25, 6]);
    expect(ok.bones.leftIndex2.rotation).toEqual([0, 0, -33.4]);
    const quinnOk = getBuiltInPoseTemplates("quinn").find((item) => item.id === "hand-ok")!;
    expect(quinnOk.pose.bones.leftThumb1.rotation).toEqual([-0.4, -4.6, 20.7]);
    expect(quinnOk.pose.bones.leftIndex3.rotation).toEqual([-0.1, 0, -42.5]);
  });

  it("migrates version 1 project poses", () => {
    const migrated = readPoseSnapshot({
      version: 1,
      root: [1, 2, 3],
      rotations: { leftUpperArm: [4, 5, 6] }
    });
    expect(migrated?.root.position).toEqual([1, 2, 3]);
    expect(migrated?.bones.leftUpperArm.rotation).toEqual([4, 5, 6]);
  });

  it("exports selected templates and imports them", () => {
    const templates: PoseTemplate[] = [
      { id: "a", name: "动作 A", builtIn: true, kind: "body", pose: createNeutralPose() },
      { id: "b", name: "动作 B", builtIn: false, kind: "hand", sourceSide: "left", pose: createNeutralPose() }
    ];
    const payload = createPoseTemplateExport(templates, new Set(["b"]));
    expect(payload.templates.map((item) => item.name)).toEqual(["动作 B"]);
    const imported = parsePoseTemplateImport(JSON.stringify(payload));
    expect(imported).toHaveLength(1);
    expect(imported[0]?.name).toBe("动作 B");
    expect(imported[0]?.kind).toBe("hand");
    expect(imported[0]?.pose.version).toBe(2);
  });

  it("round-trips action previews in a template archive", async () => {
    const template: PoseTemplate = {
      id: "pose-preview",
      name: "带效果图动作",
      builtIn: false,
      kind: "body",
      pose: createNeutralPose()
    };
    const preview = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const archive = await createPoseTemplateArchive(
      [template],
      new Set([template.id]),
      new Map([[template.id, preview]])
    );
    const imported = await parsePoseTemplateFile(new File(
      [archive],
      "actions.lyra-template.zip",
      { type: "application/zip" }
    ));
    expect(imported).toHaveLength(1);
    expect(imported[0]?.name).toBe("带效果图动作");
    expect(imported[0]?.preview?.type).toBe("image/png");
    await expect(imported[0]?.preview?.arrayBuffer()).resolves.toEqual(
      new Uint8Array([1, 2, 3]).buffer
    );
  });
});
