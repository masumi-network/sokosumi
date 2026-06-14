import { resolveRequestLocale } from "@/lib/i18n/locale-resolution";
import {
  type AppLocale,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
} from "@/lib/i18n/locales";

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

    if (cookieName === "locale" && legacyLocale === null) {
      legacyLocale = decoded;
    }
  }

  return legacyLocale;
}

export function getEmailLocale(
  request?: Request,
  fallbackHeaders?: Headers,
): AppLocale {
  const cookieHeader =
    request?.headers.get("cookie") ?? fallbackHeaders?.get("cookie") ?? null;
  const acceptLanguageHeader =
    request?.headers.get("accept-language") ??
    fallbackHeaders?.get("accept-language") ??
    null;

  return resolveRequestLocale({
    cookieLocale: getEmailLocaleCookieValue(cookieHeader),
    acceptLanguageHeader,
    defaultLocale: DEFAULT_LOCALE,
  });
}
