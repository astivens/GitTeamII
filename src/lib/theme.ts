/**
 * Theme selection.
 *
 * Every design token lives in `src/index.css` under a `[data-theme="…"]`
 * selector, so all the app has to do is put the chosen name on `<html>`. The
 * choice is a local preference of the machine: it is remembered in
 * `localStorage`, never in the repository and never in a ticket.
 */

export const THEMES = ["default", "light", "obsidian"] as const;

export type Theme = (typeof THEMES)[number];

/** The token set that applies when nobody has chosen one yet. */
export const DEFAULT_THEME: Theme = "default";

/** Human label for each theme, used by the picker and by tooltips. */
export const THEME_LABELS: Record<Theme, string> = {
  default: "Dark",
  light: "Light",
  obsidian: "Obsidian",
};

const STORAGE_KEY = "gitteam.theme";

export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "string" && (THEMES as readonly string[]).includes(value)
  );
}

/**
 * Reads the remembered theme. Anything unexpected — a stale name from an older
 * build, blocked storage, corrupt JSON — falls back to the default theme rather
 * than leaving the document without tokens.
 */
export function readStoredTheme(): Theme {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/** Puts the theme on the document so its token set applies. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Remembers the theme for the next launch. Best effort. */
export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable; the choice still applies for this session.
  }
}
