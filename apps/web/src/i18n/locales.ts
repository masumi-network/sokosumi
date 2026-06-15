import { type AppLocale, LOCALE_COOKIE_NAME } from "@sokosumi/utils";

export const AUTO_DETECT_VALUE = "auto";

export type LocalePreference = AppLocale | typeof AUTO_DETECT_VALUE;

export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const LOCALE_LOCALSTORAGE_KEY = "sokosumi.locale";

export function serializeLocaleCookie(locale: AppLocale): string {
  return `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}`;
}

export function serializeLocaleCookieDelete(): string {
  return `${LOCALE_COOKIE_NAME}=; path=/; max-age=0`;
}
