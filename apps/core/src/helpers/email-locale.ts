/**
 * Locale resolution for auth emails, ported from the web app's
 * `src/i18n/locale-resolution.ts` + `src/i18n/locales.ts` so emails sent by
 * the core auth instance keep the exact locale semantics users get today:
 * locale cookie first (current name, then legacy `locale`), then
 * `Accept-Language`, then the default.
 */

export const DEFAULT_EMAIL_LOCALE = "en";
export const SUPPORTED_EMAIL_LOCALES = [
  DEFAULT_EMAIL_LOCALE,
  "de",
  "es",
] as const;
export type EmailLocale = (typeof SUPPORTED_EMAIL_LOCALES)[number];

export const LOCALE_COOKIE_NAME = "sokosumi.locale";
const LEGACY_LOCALE_COOKIE_NAME = "locale";

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_EMAIL_LOCALES);

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

function toSupportedLocale(localeTag: string): EmailLocale | null {
  if (SUPPORTED_LOCALE_SET.has(localeTag)) return localeTag as EmailLocale;

  const baseLanguage = localeTag.split("-").at(0);
  if (!baseLanguage) {
    return null;
  }

  if (SUPPORTED_LOCALE_SET.has(baseLanguage))
    return baseLanguage as EmailLocale;

  return null;
}

export function parseLocalePreference(
  value: string | null | undefined,
): EmailLocale | null {
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
): EmailLocale | null {
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

        if (!rawValue) {
          return null;
        }

        const parsedQuality = Number.parseFloat(rawValue.trim());
        if (
          Number.isNaN(parsedQuality) ||
          parsedQuality < 0 ||
          parsedQuality > 1
        ) {
          return null;
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

function getEmailLocaleCookieValue(
  cookieHeader?: null | string,
): null | string {
  if (!cookieHeader) {
    return null;
  }

  let legacyLocale: null | string = null;

  for (const rawCookie of cookieHeader.split(";")) {
    const separatorIndex = rawCookie.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const cookieName = rawCookie.slice(0, separatorIndex).trim();
    const cookieValue = rawCookie.slice(separatorIndex + 1).trim();

    if (!cookieValue) {
      continue;
    }

    const decoded = (() => {
      try {
        return decodeURIComponent(cookieValue);
      } catch {
        return cookieValue;
      }
    })();

    if (cookieName === LOCALE_COOKIE_NAME) {
      return decoded;
    }

    if (cookieName === LEGACY_LOCALE_COOKIE_NAME && legacyLocale === null) {
      legacyLocale = decoded;
    }
  }

  return legacyLocale;
}

/**
 * Resolves the locale for an auth email from the triggering request (or the
 * Better Auth context's fallback headers).
 */
export function getEmailLocale(
  request?: Request,
  fallbackHeaders?: Headers,
): EmailLocale {
  const cookieHeader =
    request?.headers.get("cookie") ?? fallbackHeaders?.get("cookie") ?? null;
  const acceptLanguageHeader =
    request?.headers.get("accept-language") ??
    fallbackHeaders?.get("accept-language") ??
    null;

  const preference = parseLocalePreference(
    getEmailLocaleCookieValue(cookieHeader),
  );
  if (preference) {
    return preference;
  }

  return (
    resolveLocaleFromAcceptLanguage(acceptLanguageHeader) ??
    DEFAULT_EMAIL_LOCALE
  );
}
