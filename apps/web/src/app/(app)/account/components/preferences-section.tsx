"use client";

import { Languages, Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function PreferencesSection() {
  const themeTranslations = useTranslations("App.Account.Theme");
  const languageTranslations = useTranslations("App.Account.Language");
  const { theme, setTheme } = useTheme();

  const selectedTheme = useMemo(() => {
    if (theme === "light" || theme === "dark" || theme === "system") {
      return theme;
    }

    return "system";
  }, [theme]);

  const handleThemeChange = (nextTheme: string) => {
    if (
      nextTheme === "light" ||
      nextTheme === "dark" ||
      nextTheme === "system"
    ) {
      setTheme(nextTheme);
    }
  };

  return (
    <div className="w-full space-y-4">
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle>{themeTranslations("title")}</CardTitle>
            <CardDescription>
              {themeTranslations("description")}
            </CardDescription>
          </div>
          <ToggleGroup
            type="single"
            value={selectedTheme}
            onValueChange={handleThemeChange}
            className="bg-background grid grid-cols-3 rounded-md border"
          >
            <ToggleGroupItem
              value="light"
              aria-label={themeTranslations("light")}
              className="gap-2"
            >
              <Sun className="size-4" />
              {themeTranslations("light")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="dark"
              aria-label={themeTranslations("dark")}
              className="gap-2"
            >
              <Moon className="size-4" />
              {themeTranslations("dark")}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="system"
              aria-label={themeTranslations("system")}
              className="gap-2"
            >
              <Monitor className="size-4" />
              {themeTranslations("system")}
            </ToggleGroupItem>
          </ToggleGroup>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle>{languageTranslations("title")}</CardTitle>
            <CardDescription>
              {languageTranslations("description")}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <Languages className="text-muted-foreground size-4" />
            <p className="text-sm font-medium">
              {languageTranslations("currentLanguage")}
            </p>
            <span className="text-muted-foreground text-sm">
              {languageTranslations("comingSoon")}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
