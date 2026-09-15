import { type AppLocale, LOCALE_COOKIE_NAME } from "@sokosumi/utils";

export const AUTO_DETECT_VALUE = "auto";

export type LocalePreference = AppLocale | typeof AUTO_DETECT_VALUE;

const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const LOCALE_LOCALSTORAGE_KEY = "sokosumi.locale";

function isSecureCookieHost(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const { protocol, hostname } = window.location;
  if (protocol !== "https:") {
    return false;
  }

  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

/** Flags for a browser-written preference cookie: `Secure` on real HTTPS hosts. */
export function browserCookieFlags(maxAge: number): string {
  const parts = [`path=/`, `max-age=${maxAge}`, "SameSite=Lax"];
  if (isSecureCookieHost()) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

export function serializeLocaleCookie(locale: AppLocale): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; ${browserCookieFlags(LOCALE_COOKIE_MAX_AGE)}`;
}

export function serializeLocaleCookieDelete(): string {
  return `${LOCALE_COOKIE_NAME}=; ${browserCookieFlags(0)}`;
}
