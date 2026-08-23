import type { IconName } from "../components/Icon.js";

export type Page =
  | "generation"
  | "model"
  | "pose"
  | "community"
  | "conversation"
  | "assets"
  | "prompts"
  | "settings";

export interface NavigationItem {
  page: Page;
  label: string;
  icon: IconName;
}

export interface NavigationGroup {
  id: "creation" | "conversation" | "library";
  position: "top" | "middle" | "bottom";
  items: NavigationItem[];
}

export const navigationGroups: NavigationGroup[] = [
  {
    id: "creation",
    position: "top",
    items: [
      { page: "generation", label: "图片生成", icon: "image" },
      { page: "model", label: "AI 建模", icon: "cube" }
    ]
  },
  {
    id: "conversation",
    position: "middle",
    items: [
      { page: "conversation", label: "对话", icon: "chat" }
    ]
  },
  {
    id: "library",
    position: "bottom",
    items: [
      { page: "assets", label: "素材库", icon: "library" },
      { page: "prompts", label: "提示词库", icon: "prompt" },
      { page: "settings", label: "设置", icon: "settings" }
    ]
  }
];

export const toolNavigation = {
  label: "其他功能",
  icon: "pose" as IconName,
  items: [
    { page: "pose", label: "动作参考", icon: "pose" },
    { page: "community", label: "社区", icon: "community" }
  ] satisfies NavigationItem[]
};

export const navigation = [
  ...navigationGroups.flatMap((group) => group.items),
  ...toolNavigation.items
];
