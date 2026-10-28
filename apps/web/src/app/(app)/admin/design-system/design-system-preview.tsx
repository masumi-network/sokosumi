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
 * Components style dark mode through `dark:` utilities, which match any
 * descendant of `.dark`. The wrapper adds that class in the dark preview so
 * they follow the toggle. The reverse cannot be scoped: with the app itself in
 * dark mode, those utilities still fire inside the light preview, so judge the
 * light preview with the app in light mode.
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
