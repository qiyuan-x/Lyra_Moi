import type { IconName } from "../components/Icon.js";

export type Page =
  | "generation"
  | "model"
  | "assets"
  | "prompts"
  | "settings";

export const navigation: Array<{
  page: Page;
  label: string;
  icon: IconName;
}> = [
  { page: "generation", label: "图片生成", icon: "image" },
  { page: "model", label: "AI 建模", icon: "cube" },
  { page: "assets", label: "素材库", icon: "library" },
  { page: "prompts", label: "提示词库", icon: "prompt" },
  { page: "settings", label: "设置", icon: "settings" }
];
