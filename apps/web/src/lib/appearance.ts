export type AppearanceMode = "light" | "dark" | "system";

const storageKey = "lyra.appearanceMode";

export function readAppearanceMode(): AppearanceMode {
  const value = localStorage.getItem(storageKey);
  return value === "dark" || value === "system" ? value : "light";
}

export function saveAppearanceMode(mode: AppearanceMode): void {
  localStorage.setItem(storageKey, mode);
}

export function applyAppearanceMode(mode: AppearanceMode): void {
  const resolved = mode === "system"
    ? window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}
