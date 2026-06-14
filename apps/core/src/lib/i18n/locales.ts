export const DEFAULT_LOCALE = "en";

export const SUPPORTED_LOCALES = [DEFAULT_LOCALE, "de", "es"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const LOCALE_COOKIE_NAME = "sokosumi.locale";
