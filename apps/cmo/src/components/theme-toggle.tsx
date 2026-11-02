"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { THEME_COOKIE, type Theme } from "../lib/theme";

function currentTheme(): Theme {
  const chosen = document.documentElement.dataset.theme;
  if (chosen === "light" || chosen === "dark") return chosen;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/**
 * Switches between light and dark. The choice lives in a cookie, so the
 * server renders the same theme on the next visit without a flash.
 */
export function ThemeToggle({
  className,
  withLabel = false,
  role,
}: {
  className?: string;
  withLabel?: boolean;
  role?: "menuitem";
}) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => setTheme(currentTheme()), []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = `${next === "dark" ? "Dark" : "Light"} mode`;

  return (
    <button
      type="button"
      role={role}
      className={className}
      aria-label={withLabel ? undefined : label}
      title={withLabel ? undefined : label}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
        setTheme(next);
      }}
    >
      {next === "dark" ? (
        <Moon size={14} aria-hidden="true" />
      ) : (
        <Sun size={14} aria-hidden="true" />
      )}
      {withLabel ? label : null}
    </button>
  );
}
