"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import "./design-system.css";

type PreviewTheme = "light" | "dark";

interface DesignSystemPreviewProps {
  children: ReactNode;
}

/**
 * Scopes the Masumi Family tokens to its children and lets the viewer flip
 * them between light and dark, independent of the app's own theme.
 */
export function DesignSystemPreview({ children }: DesignSystemPreviewProps) {
  const t = useTranslations("App.Admin.DesignSystem.Theme");
  const [theme, setTheme] = useState<PreviewTheme>("light");

  return (
    <div className="space-y-4">
      <Tabs
        value={theme}
        onValueChange={(value) => setTheme(value === "dark" ? "dark" : "light")}
      >
        <TabsList aria-label={t("label")}>
          <TabsTrigger value="light">{t("light")}</TabsTrigger>
          <TabsTrigger value="dark">{t("dark")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div
        data-design-system={theme}
        className="space-y-16 rounded-2xl p-4 md:p-8"
      >
        {children}
      </div>
    </div>
  );
}

/** A busy primary button. `loading` attaches a click guard, so it renders here. */
export function LoadingButtonDemo({ label }: { label: string }) {
  return (
    <Button variant="primary" loading>
      {label}
    </Button>
  );
}
