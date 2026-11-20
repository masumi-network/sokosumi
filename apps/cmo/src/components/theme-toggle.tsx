"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useMediaQuery } from "../hooks/effects/use-media-query";
import { THEME_COOKIE, type Theme } from "../lib/theme";

const themeListeners = new Set<() => void>();

function subscribeThemeOverride(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
  };
}

function getThemeOverride(): Theme | null {
  const chosen = document.documentElement.dataset.theme;
  return chosen === "light" || chosen === "dark" ? chosen : null;
}

function getServerThemeOverride(): null {
  return null;
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
  const override = useSyncExternalStore(
    subscribeThemeOverride,
    getThemeOverride,
    getServerThemeOverride,
  );
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)", null);
  const theme: Theme | null =
    override ?? (prefersDark === null ? null : prefersDark ? "dark" : "light");
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
        for (const listener of themeListeners) listener();
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
