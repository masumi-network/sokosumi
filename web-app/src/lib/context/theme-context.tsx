"use client";

import { useEffect } from "react";

function getSystemTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "light";
  return window?.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      const root = window.document.documentElement;
      const systemTheme = getSystemTheme();
      root.classList.remove("light", "dark");
      root.classList.add(systemTheme);
    };

    handleChange();

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return children;
}
