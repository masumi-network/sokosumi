import { headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

const DEFAULT_LOCALE = "en";
const SUPPORTED_LOCALES = new Set<string>([DEFAULT_LOCALE]);

function normalizeLocaleTag(rawTag: string): string | null {
  const trimmed = rawTag.trim();
  if (!trimmed || trimmed === "*") {
    return null;
  }

  const normalized = trimmed.replaceAll("_", "-");
  try {
    return Intl.getCanonicalLocales(normalized).at(0) ?? null;
  } catch {
    return null;
  }
}

function getRequestLocale(acceptLanguageHeader: string | null): string {
  const languages =
    acceptLanguageHeader
      ?.split(",")
      .map((part) => part.split(";").at(0) ?? "")
      .map(normalizeLocaleTag)
      .filter((tag): tag is string => Boolean(tag)) ?? [];

  for (const languageTag of languages) {
    if (SUPPORTED_LOCALES.has(languageTag)) {
      return languageTag;
    }

    const baseLanguage = languageTag.split("-").at(0);
    if (baseLanguage && SUPPORTED_LOCALES.has(baseLanguage)) {
      return baseLanguage;
    }
  }

  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const headersList = await headers();
  const locale = getRequestLocale(headersList.get("accept-language"));
  let messages: Record<string, unknown>;

  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch {
    messages = (await import("../../messages/en.json")).default;
  }

  return {
    locale,
    messages,
  };
});
