"use client";

import { parseLocalePreference, SUPPORTED_LOCALES } from "@sokosumi/utils";
import { Clock, Languages, Monitor, Moon, Sun } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import useIsClient from "@/hooks/use-is-client";
import {
  AUTO_DETECT_VALUE,
  LOCALE_LOCALSTORAGE_KEY,
  type LocalePreference,
  serializeLocaleCookie,
  serializeLocaleCookieDelete,
} from "@/i18n/locales";
import {
  detectBrowserTimeFormat,
  parseTimeFormat,
  serializeTimeFormatCookie,
  serializeTimeFormatCookieDelete,
  TIME_FORMATS,
  type TimeFormatPreference,
} from "@/i18n/time-format";

interface PreferencesSectionProps {
  /** Cookie value from the account page. `document.cookie` is empty during SSR. */
  initialTimeFormat?: TimeFormatPreference;
}

export function PreferencesSection({
  initialTimeFormat = AUTO_DETECT_VALUE,
}: PreferencesSectionProps) {
  const isClient = useIsClient();
  const themeTranslations = useTranslations("App.Account.Theme");
  const languageTranslations = useTranslations("App.Account.Language");
  const timeFormatTranslations = useTranslations("App.Account.TimeFormat");
  const currentLocale = useLocale();
  const { theme, setTheme } = useTheme();
  const [selectedLanguage, setSelectedLanguage] = useState<LocalePreference>(
    () =>
      parseLocalePreference(
        typeof window === "undefined"
          ? null
          : window.localStorage.getItem(LOCALE_LOCALSTORAGE_KEY),
      ) ?? AUTO_DETECT_VALUE,
  );
  const [selectedTimeFormat, setSelectedTimeFormat] =
    useState<TimeFormatPreference>(initialTimeFormat);

  const selectedTheme = useMemo(() => {
    if (!isClient) {
      return "system";
    }

    if (theme === "light" || theme === "dark" || theme === "system") {
      return theme;
    }

    return "system";
  }, [isClient, theme]);

  const handleThemeChange = (nextTheme: string) => {
    if (
      nextTheme === "light" ||
      nextTheme === "dark" ||
      nextTheme === "system"
    ) {
      setTheme(nextTheme);
    }
  };

  const handleLanguageChange = (nextValue: string) => {
    if (nextValue === AUTO_DETECT_VALUE) {
      window.localStorage.removeItem(LOCALE_LOCALSTORAGE_KEY);
      document.cookie = serializeLocaleCookieDelete();
      setSelectedLanguage(AUTO_DETECT_VALUE);
      window.location.reload();
      return;
    }

    const parsedLocale = parseLocalePreference(nextValue);
    if (!parsedLocale) {
      return;
    }

    window.localStorage.setItem(LOCALE_LOCALSTORAGE_KEY, parsedLocale);
    document.cookie = serializeLocaleCookie(parsedLocale);
    setSelectedLanguage(parsedLocale);
    window.location.reload();
  };

  const handleTimeFormatChange = (nextValue: string) => {
    if (nextValue === AUTO_DETECT_VALUE) {
      document.cookie = serializeTimeFormatCookieDelete();
      setSelectedTimeFormat(AUTO_DETECT_VALUE);
      window.location.reload();
      return;
    }

    const timeFormat = parseTimeFormat(nextValue);
    if (!timeFormat) {
      return;
    }

    document.cookie = serializeTimeFormatCookie(timeFormat);
    setSelectedTimeFormat(timeFormat);
    window.location.reload();
  };

  // Auto shows what it resolves to here. Only the browser knows, and the
  // option text only renders client-side, so the server keeps plain "Auto".
  const autoTimeFormat = isClient ? detectBrowserTimeFormat() : null;

  const visibleLanguageValue =
    selectedLanguage === AUTO_DETECT_VALUE
      ? AUTO_DETECT_VALUE
      : selectedLanguage || currentLocale;

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
          <Select
            value={visibleLanguageValue}
            onValueChange={handleLanguageChange}
          >
            <SelectTrigger
              aria-label={languageTranslations("selectAriaLabel")}
              className="w-full md:w-72"
            >
              <div className="flex items-center gap-2">
                <Languages className="text-muted-foreground size-4" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_DETECT_VALUE}>
                {languageTranslations("autoDetect")}
              </SelectItem>
              <SelectSeparator />
              {SUPPORTED_LOCALES.map((locale) => (
                <SelectItem key={locale} value={locale}>
                  {languageTranslations(`options.${locale}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle>{timeFormatTranslations("title")}</CardTitle>
            <CardDescription>
              {timeFormatTranslations("description")}
            </CardDescription>
          </div>
          <Select
            value={selectedTimeFormat}
            onValueChange={handleTimeFormatChange}
          >
            <SelectTrigger
              aria-label={timeFormatTranslations("selectAriaLabel")}
              className="w-full md:w-72"
            >
              <div className="flex items-center gap-2">
                <Clock className="text-muted-foreground size-4" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO_DETECT_VALUE}>
                {autoTimeFormat
                  ? timeFormatTranslations("autoResolved", {
                      timeFormat: timeFormatTranslations(
                        `options.${autoTimeFormat}`,
                      ),
                    })
                  : timeFormatTranslations("auto")}
              </SelectItem>
              <SelectSeparator />
              {TIME_FORMATS.map((timeFormat) => (
                <SelectItem key={timeFormat} value={timeFormat}>
                  {timeFormatTranslations(`options.${timeFormat}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>
    </div>
  );
}
