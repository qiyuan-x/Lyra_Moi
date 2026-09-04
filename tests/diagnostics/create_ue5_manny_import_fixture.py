from __future__ import annotations

import math
import sys
from pathlib import Path

import bpy


def key_rotation(armature: bpy.types.Object, bone_name: str, frame: int, xyz: tuple[float, float, float]) -> None:
    bone = armature.pose.bones.get(bone_name)
    if bone is None:
        raise RuntimeError(f"missing UE5 bone: {bone_name}")
    bone.rotation_mode = "XYZ"
    bone.rotation_euler = tuple(math.radians(value) for value in xyz)
    bone.keyframe_insert(data_path="rotation_euler", frame=frame)


def main() -> None:
    if "--" not in sys.argv:
        raise RuntimeError("expected output path after --")
    output = Path(sys.argv[sys.argv.index("--") + 1]).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    armature = bpy.data.objects.get("root")
    mesh = bpy.data.objects.get("SKM_Manny_LOD0")
    if armature is None or armature.type != "ARMATURE" or mesh is None:
        raise RuntimeError("public Manny template is missing its export skeleton or mesh")

    action = bpy.data.actions.new("Manny_Import_Test")
    armature.animation_data_create()
    armature.animation_data.action = action
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 31
    bpy.context.scene.render.fps = 30

    poses = {
        1: {
            "spine_03": (0, 0, 0),
            "upperarm_l": (0, 0, 0),
            "upperarm_r": (0, 0, 0),
            "thigh_l": (0, 0, 0),
            "thigh_r": (0, 0, 0),
        },
        16: {
            "spine_03": (0, 0, 8),
            "upperarm_l": (22, -8, -10),
            "upperarm_r": (-18, 6, 12),
            "thigh_l": (-12, 0, 0),
            "thigh_r": (12, 0, 0),
        },
        31: {
            "spine_03": (0, 0, 0),
            "upperarm_l": (0, 0, 0),
            "upperarm_r": (0, 0, 0),
            "thigh_l": (0, 0, 0),
            "thigh_r": (0, 0, 0),
        },
    }
    for frame, transforms in poses.items():
        for bone_name, rotation in transforms.items():
            key_rotation(armature, bone_name, frame, rotation)

    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.fbx(
        filepath=str(output),
        use_selection=True,
        object_types={"ARMATURE", "MESH"},
        add_leaf_bones=False,
        use_armature_deform_only=False,
        bake_anim=True,
        bake_anim_use_all_bones=True,
        bake_anim_use_nla_strips=False,
        bake_anim_use_all_actions=False,
        bake_anim_force_startend_keying=True,
        path_mode="AUTO",
    )
    print(f"created {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
