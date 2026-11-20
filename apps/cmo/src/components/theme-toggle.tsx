"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { THEME_COOKIE, type Theme } from "../lib/theme";

const themeListeners = new Set<() => void>();

function subscribeTheme(onStoreChange: () => void): () => void {
  themeListeners.add(onStoreChange);
  return () => {
    themeListeners.delete(onStoreChange);
  };
}

function notifyThemeChange(): void {
  for (const listener of themeListeners) listener();
}

function getServerTheme(): Theme | null {
  return null;
}

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
  const theme = useSyncExternalStore(
    subscribeTheme,
    currentTheme,
    getServerTheme,
  );
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
        notifyThemeChange();
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
