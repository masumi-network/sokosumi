export const DEFAULT_LOCALE = "en";
export const AUTO_DETECT_VALUE = "auto";

export const SUPPORTED_LOCALES = [DEFAULT_LOCALE, "de", "es"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocalePreference = AppLocale | typeof AUTO_DETECT_VALUE;

export const LOCALE_COOKIE_NAME = "sokosumi.locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const LOCALE_LOCALSTORAGE_KEY = "sokosumi.locale";
