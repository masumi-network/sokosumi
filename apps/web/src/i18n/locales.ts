import { type AppLocale, LOCALE_COOKIE_NAME } from "@sokosumi/utils";

export const AUTO_DETECT_VALUE = "auto";

export type LocalePreference = AppLocale | typeof AUTO_DETECT_VALUE;

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const LOCALE_LOCALSTORAGE_KEY = "sokosumi.locale";

function isSecureLocaleCookieHost(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const { protocol, hostname } = window.location;
  if (protocol !== "https:") {
    return false;
  }

  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

function localeCookieFlags(maxAge: number): string {
  const parts = [`path=/`, `max-age=${maxAge}`, "SameSite=Lax"];
  if (isSecureLocaleCookieHost()) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function serializeLocaleCookie(locale: AppLocale): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; ${localeCookieFlags(LOCALE_COOKIE_MAX_AGE)}`;
}

export function serializeLocaleCookieDelete(): string {
  return `${LOCALE_COOKIE_NAME}=; ${localeCookieFlags(0)}`;
}
