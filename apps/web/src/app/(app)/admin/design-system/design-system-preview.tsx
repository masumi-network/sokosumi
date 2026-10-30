"use client";

import { useTranslations } from "next-intl";
import { type CSSProperties, type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { DESIGN_SYSTEM_VARS } from "./tokens";

import "./design-system.css";

type PreviewTheme = "light" | "dark";

interface DesignSystemPreviewProps {
  children: ReactNode;
}

/**
 * Scopes the Masumi Family tokens to its children and lets the viewer flip
 * them between light and dark, independent of the app's own theme.
 *
 * Limits (also on Theme.limitsNote and in docs/agents/web-ui.md): dialogs and
 * toasts portal outside this wrapper, so the page shows static specimens;
 * components' `dark:` utilities match any `.dark` ancestor, so the light
 * preview is only reliable when the app itself is in light mode. The dark
 * preview adds `.dark` so those utilities follow the toggle.
 */
export function DesignSystemPreview({ children }: DesignSystemPreviewProps) {
  const t = useTranslations("App.Admin.DesignSystem.Theme");
  const [theme, setTheme] = useState<PreviewTheme>("light");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          value={theme}
          onValueChange={(value) =>
            setTheme(value === "dark" ? "dark" : "light")
          }
        >
          <TabsList aria-label={t("label")}>
            <TabsTrigger value="light">{t("light")}</TabsTrigger>
            <TabsTrigger value="dark">{t("dark")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-muted-foreground text-sm">{t("limitsNote")}</p>
        {theme === "dark" ? (
          <p className="text-muted-foreground text-sm">{t("darkNote")}</p>
        ) : null}
      </div>
      <div
        data-design-system={theme}
        style={DESIGN_SYSTEM_VARS as CSSProperties}
        className={cn(
          "space-y-16 rounded-2xl p-4 md:p-8",
          theme === "dark" && "dark",
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface LoadingButtonDemoProps {
  label: string;
}

/** A busy primary button. `loading` attaches a click guard, so it renders here. */
export function LoadingButtonDemo({ label }: LoadingButtonDemoProps) {
  return (
    <Button variant="primary" loading>
      {label}
    </Button>
  );
}
