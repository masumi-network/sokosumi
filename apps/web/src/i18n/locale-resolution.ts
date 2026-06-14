import {
  type AppLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
} from "@/i18n/locales";

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);
interface ParsedLanguagePreference {
  tag: string;
  quality: number;
  index: number;
}

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

function toSupportedLocale(localeTag: string): AppLocale | null {
  if (SUPPORTED_LOCALE_SET.has(localeTag)) return localeTag as AppLocale;

  const baseLanguage = localeTag.split("-").at(0);
  if (!baseLanguage) {
    return null;
  }

  if (SUPPORTED_LOCALE_SET.has(baseLanguage)) return baseLanguage as AppLocale;

  return null;
}

export function parseLocalePreference(
  value: string | null | undefined,
): AppLocale | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeLocaleTag(value);
  if (!normalized) {
    return null;
  }

  return toSupportedLocale(normalized);
}

export function resolveLocaleFromAcceptLanguage(
  acceptLanguageHeader: string | null,
): AppLocale | null {
  if (!acceptLanguageHeader) {
    return null;
  }

  const preferences = acceptLanguageHeader
    .split(",")
    .map((part, index): ParsedLanguagePreference | null => {
      const [rawTag, ...rawParams] = part.split(";");
      const normalizedTag = normalizeLocaleTag(rawTag ?? "");
      if (!normalizedTag) {
        return null;
      }

      let quality = 1;

      for (const rawParam of rawParams) {
        const [rawKey, rawValue] = rawParam.split("=");
        const key = rawKey?.trim().toLowerCase();

        if (key !== "q") {
          continue;
        }

        // A malformed quality value (missing or unparseable) is ignored rather
        // than dropping the whole language preference: keep the default quality
        // of 1 so e.g. `de;q=` or `de;q=oops` still resolves to German.
        if (!rawValue) {
          continue;
        }

        const parsedQuality = Number.parseFloat(rawValue.trim());
        if (
          Number.isNaN(parsedQuality) ||
          parsedQuality < 0 ||
          parsedQuality > 1
        ) {
          continue;
        }

        quality = parsedQuality;
        break;
      }

      if (quality === 0) {
        return null;
      }

      return {
        tag: normalizedTag,
        quality,
        index,
      };
    })
    .filter((preference): preference is ParsedLanguagePreference =>
      Boolean(preference),
    )
    .sort((a, b) => {
      if (a.quality !== b.quality) {
        return b.quality - a.quality;
      }

      return a.index - b.index;
    });

  for (const preference of preferences) {
    const resolved = toSupportedLocale(preference.tag);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

export function resolveRequestLocale({
  cookieLocale,
  acceptLanguageHeader,
  defaultLocale,
}: {
  cookieLocale: string | null | undefined;
  acceptLanguageHeader: string | null;
  defaultLocale: AppLocale;
}): AppLocale {
  const preference = parseLocalePreference(cookieLocale);
  if (preference) {
    return preference;
  }

  return resolveLocaleFromAcceptLanguage(acceptLanguageHeader) ?? defaultLocale;
}

export function serializeLocaleCookie(locale: AppLocale): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}`;
}

export function serializeLocaleCookieDelete(): string {
  return `${LOCALE_COOKIE_NAME}=; path=/; max-age=0`;
}
