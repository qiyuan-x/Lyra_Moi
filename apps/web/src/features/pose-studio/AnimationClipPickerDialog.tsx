import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../components/Icon.js";
import type { AnimationClipInfo } from "./animation-model-viewer-adapter.js";

interface AnimationClipPickerDialogProps {
  clips: AnimationClipInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

type ClipCategory = "base" | "dance" | "locomotion" | "seated" | "combat" | "interaction" | "other";

const categoryOrder: ClipCategory[] = ["base", "dance", "seated", "locomotion", "interaction", "combat", "other"];
const categoryLabels: Record<ClipCategory, string> = {
  base: "基础与站立",
  dance: "舞蹈",
  locomotion: "移动",
  seated: "坐姿与跪姿",
  combat: "战斗",
  interaction: "互动",
  other: "其他"
};

const clipLabels: Record<string, string> = {
  A_TPose: "A/T 基础姿势",
  Crouch_Fwd_Loop: "蹲伏前进",
  Crouch_Idle_Loop: "蹲伏待机",
  Dance_Loop: "舞蹈",
  Death01: "倒地",
  Driving_Loop: "驾驶",
  Fixing_Kneeling: "跪姿维修",
  Hit_Chest: "胸部受击",
  Hit_Head: "头部受击",
  Idle_Loop: "自然站立",
  Idle_Talking_Loop: "站立交谈",
  Idle_Torch_Loop: "举火把待机",
  Interact: "交互",
  Jog_Fwd_Loop: "慢跑",
  Jump_Land: "跳跃落地",
  Jump_Loop: "跳跃滞空",
  Jump_Start: "起跳",
  PickUp_Table: "桌面拾取",
  Pistol_Aim_Down: "手枪向下瞄准",
  Pistol_Aim_Neutral: "手枪平视瞄准",
  Pistol_Aim_Up: "手枪向上瞄准",
  Pistol_Idle_Loop: "持枪待机",
  Pistol_Reload: "手枪换弹",
  Pistol_Shoot: "手枪射击",
  Punch_Cross: "交叉拳",
  Punch_Enter: "拳击起手",
  Punch_Jab: "刺拳",
  Push_Loop: "推动",
  Roll: "翻滚",
  Roll_RM: "翻滚（根运动）",
  Sitting_Enter: "坐下",
  Sitting_Exit: "起身",
  Sitting_Idle_Loop: "坐姿待机",
  Sitting_Talking_Loop: "坐姿交谈",
  Spell_Simple_Enter: "施法起手",
  Spell_Simple_Exit: "施法结束",
  Spell_Simple_Idle_Loop: "施法待机",
  Spell_Simple_Shoot: "释放法术",
  Sprint_Loop: "冲刺",
  Swim_Fwd_Loop: "向前游泳",
  Swim_Idle_Loop: "游泳待机",
  Sword_Attack: "挥剑攻击",
  Sword_Attack_RM: "挥剑攻击（根运动）",
  Sword_Idle: "持剑待机",
  Walk_Formal_Loop: "正式行走",
  Walk_Loop: "自然行走",
  Chest_Open: "舒展胸肩",
  ClimbUp_1m_RM: "攀上一米平台",
  Consume: "进食",
  Farm_Harvest: "收获",
  Farm_PlantSeed: "播种",
  Farm_Watering: "浇水",
  Hit_Knockback: "击退受击",
  Hit_Knockback_RM: "击退受击（根运动）",
  Idle_FoldArms_Loop: "抱臂待机",
  Idle_Lantern_Loop: "提灯待机",
  Idle_No_Loop: "站立拒绝",
  Idle_Rail_Call: "扶栏呼喊",
  Idle_Rail_Loop: "扶栏待机",
  Idle_Shield_Break: "盾牌破防",
  Idle_Shield_Loop: "持盾待机",
  Idle_TalkingPhone_Loop: "通话待机",
  LayToIdle: "躺下待机",
  Melee_Hook: "近战勾拳",
  Melee_Hook_Rec: "近战勾拳收势",
  NinjaJump_Idle_Loop: "忍者跳滞空",
  NinjaJump_Land: "忍者跳落地",
  NinjaJump_Start: "忍者跳起步",
  OverhandThrow: "过肩投掷",
  Shield_Dash_RM: "持盾冲刺",
  Shield_OneShot: "盾牌攻击",
  Slide_Exit: "滑铲结束",
  Slide_Loop: "滑铲",
  Slide_Start: "滑铲起步",
  Sword_Block: "剑格挡",
  Sword_Dash_RM: "持剑冲刺",
  Sword_Regular_A: "剑术连击一",
  Sword_Regular_A_Rec: "剑术连击一收势",
  Sword_Regular_B: "剑术连击二",
  Sword_Regular_B_Rec: "剑术连击二收势",
  Sword_Regular_C: "剑术连击三",
  Sword_Regular_Combo: "剑术完整连击",
  TreeChopping_Loop: "砍树",
  Walk_Carry_Loop: "搬运行走",
  Yes: "点头确认",
  Zombie_Idle_Loop: "僵尸待机",
  Zombie_Scratch: "僵尸抓挠",
  Zombie_Walk_Fwd_Loop: "僵尸前行",
};

export function AnimationClipPickerDialog(props: AnimationClipPickerDialogProps) {
  const [search, setSearch] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedButtonRef = useRef<HTMLButtonElement>(null);
  const groups = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    const visible = props.clips
      .map((clip, index) => ({ clip, index, label: animationClipDisplayName(clip.name) }))
      .filter(({ clip, label }) => !keyword || `${label} ${clip.name}`.toLocaleLowerCase("zh-CN").includes(keyword));
    return categoryOrder
      .map((category) => ({
        category,
        items: visible.filter(({ clip }) => animationClipCategory(clip.name) === category)
      }))
      .filter(({ items }) => items.length > 0);
  }, [props.clips, search]);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [props.onClose]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      const selected = selectedButtonRef.current;
      if (!content || !selected) return;
      const contentRect = content.getBoundingClientRect();
      const selectedRect = selected.getBoundingClientRect();
      content.scrollTop += selectedRect.top - contentRect.top
        - (content.clientHeight - selectedRect.height) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [groups, props.selectedIndex]);

  return (
    <div className="modal-backdrop animation-clip-picker-backdrop" onMouseDown={props.onClose}>
      <section
        className="animation-clip-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="animation-clip-picker-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <strong id="animation-clip-picker-title">选择动作</strong>
            <span>共 {props.clips.length} 个动画片段</span>
          </div>
          <button type="button" className="icon-button" aria-label="关闭动作选择" onClick={props.onClose}>
            <Icon name="close" size={18} />
          </button>
        </header>
        <label className="animation-clip-picker-search">
          <Icon name="library" size={15} />
          <input
            autoFocus
            value={search}
            placeholder="搜索动作"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="animation-clip-picker-content" ref={contentRef}>
          {groups.length === 0 ? (
            <div className="animation-clip-picker-empty">没有符合条件的动作</div>
          ) : groups.map(({ category, items }) => (
            <section key={category}>
              <header><strong>{categoryLabels[category]}</strong><span>{items.length}</span></header>
              <div>
                {items.map(({ clip, index, label }) => (
                  <button
                    type="button"
                    className={props.selectedIndex === index ? "active" : ""}
                    aria-current={props.selectedIndex === index ? "true" : undefined}
                    ref={props.selectedIndex === index ? selectedButtonRef : undefined}
                    key={clip.id}
                    onClick={() => {
                      props.onSelect(index);
                      props.onClose();
                    }}
                  >
                    <Icon name="pose" size={19} />
                    <span><strong>{label}</strong><small>{clip.name}</small></span>
                    <time>{formatClipTime(clip.duration)}</time>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

export function animationClipDisplayName(name: string): string {
  return clipLabels[name] ?? name.replaceAll("_", " ");
}

function animationClipCategory(name: string): ClipCategory {
  const value = name.toLowerCase();
  if (/dance/u.test(value)) return "dance";
  if (/(sitting|kneel)/u.test(value)) return "seated";
  if (/(walk|jog|sprint|crouch|jump|roll|swim|climb|slide)/u.test(value)) return "locomotion";
  if (/(pistol|punch|sword|spell|hit|death|melee|shield)/u.test(value)) return "combat";
  if (/(talk|interact|pickup|push|driving|fixing|farm|consume|throw|chopping|rail|phone)/u.test(value)) return "interaction";
  if (/(idle|pose)/u.test(value)) return "base";
  return "other";
}

function formatClipTime(value: number): string {
  return `${Math.max(0, value).toFixed(1)} 秒`;
}
