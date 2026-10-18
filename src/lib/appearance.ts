import type { BranchAppearance } from "@/components/types";

const GLOBAL_THEME_KEY = "bahaban:theme:v1";
const branchKey = (branchId: string) => `bahaban:appearance:v1:${branchId}`;

export const DEFAULT_BRANCH_APPEARANCE: BranchAppearance = {
  mode: "light",
  accentColor: "#0b8b83",
  fontFamily: "vazirmatn",
};

function normalize(value: unknown): BranchAppearance | null {
  if (!value || typeof value !== "object") return null;
  const appearance = value as Record<string, unknown>;
  return {
    mode: appearance.mode === "dark" ? "dark" : "light",
    accentColor:
      typeof appearance.accentColor === "string" && /^#[\da-f]{6}$/i.test(appearance.accentColor)
        ? appearance.accentColor
        : DEFAULT_BRANCH_APPEARANCE.accentColor,
    fontFamily: appearance.fontFamily === "system" ? "system" : "vazirmatn",
  };
}

function read(key: string): unknown {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function loadGlobalTheme(): BranchAppearance["mode"] {
  return read(GLOBAL_THEME_KEY) === "dark" ? "dark" : "light";
}

export function saveGlobalTheme(mode: BranchAppearance["mode"]): void {
  try {
    window.localStorage.setItem(GLOBAL_THEME_KEY, JSON.stringify(mode));
  } catch {
    // The active session still uses the in-memory preference when storage is unavailable.
  }
}

export function loadBranchAppearance(branchId: string): BranchAppearance {
  const saved = normalize(read(branchKey(branchId)));
  return saved ?? { ...DEFAULT_BRANCH_APPEARANCE, mode: loadGlobalTheme() };
}

export function saveBranchAppearance(branchId: string, value: BranchAppearance): void {
  try {
    const appearance = normalize(value) ?? DEFAULT_BRANCH_APPEARANCE;
    window.localStorage.setItem(branchKey(branchId), JSON.stringify(appearance));
  } catch {
    // The active session still uses the in-memory preference when storage is unavailable.
  }
}
