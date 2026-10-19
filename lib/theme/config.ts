/**
 * Visual themes. A theme is a skin over the same screens and logic:
 * `<html data-theme>` scopes its CSS (`styles/themes/<id>/*.css`), and the few
 * places whose layout differs read the id from `useTheme()` (client) or
 * `getTheme()` (server). "classic" is the original look and stays the default.
 *
 * The choice lives in a cookie so the server renders the right theme on the
 * first byte (no flash) and server components can branch on it.
 */
export const THEMES = ["classic", "forest"] as const;
export type ThemeId = (typeof THEMES)[number];

export const DEFAULT_THEME: ThemeId = "classic";
export const THEME_COOKIE = "pt_theme";
/** One year: the theme is a preference, not a session. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

export function resolveTheme(value: unknown): ThemeId {
  return isThemeId(value) ? value : DEFAULT_THEME;
}

/** Browser chrome colour (mobile address bar) per theme. */
export const THEME_COLOR: Record<ThemeId, string> = {
  classic: "#FAFCFF",
  forest: "#F6F5F0",
};

/** Two swatches per theme for the picker: page background, accent. */
export const THEME_SWATCH: Record<ThemeId, [string, string]> = {
  classic: ["#E0F2FE", "#0EA5E9"],
  forest: ["#F6F5F0", "#1F5C4A"],
};

/**
 * The live interview room starts (or resumes) the interview on the server
 * render, so a refresh there would count a new attempt and reconnect the
 * voice session. Theme changes never refresh it and never apply mid-room.
 */
export function isLiveRoomPath(pathname: string): boolean {
  return /^\/(he|en)\/student\/interviews\/[^/]+\/?$/.test(pathname);
}
