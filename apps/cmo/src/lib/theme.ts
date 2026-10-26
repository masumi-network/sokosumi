export const THEME_COOKIE = "cmo-theme";

export type Theme = "light" | "dark";

/** The theme the person chose, or null to follow their system. */
export function readTheme(value: string | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}
