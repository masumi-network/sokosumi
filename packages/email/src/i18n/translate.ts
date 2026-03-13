import {
  type AbstractIntlMessages,
  createTranslator,
  type TranslationValues,
} from "use-intl/core";

import {
  EMAIL_LOCALES,
  EMAIL_MESSAGES,
  type EmailLocale,
} from "../locales/index.js";

const DEFAULT_EMAIL_LOCALE: EmailLocale = "en";
const EMAIL_LOCALE_SET = new Set<string>(EMAIL_LOCALES);
const SIMPLIFIED_CHINESE_REGIONS = new Set(["CN", "MY", "SG"]);

function normalizeLocaleTag(
  rawLocale: null | string | undefined,
): null | string {
  if (!rawLocale) {
    return null;
  }

  const trimmedLocale = rawLocale.trim();

  if (!trimmedLocale || trimmedLocale === "*") {
    return null;
  }

  try {
    return (
      Intl.getCanonicalLocales(trimmedLocale.replaceAll("_", "-")).at(0) ?? null
    );
  } catch {
    return null;
  }
}

function resolveSupportedEmailLocale(
  locale: null | string | undefined,
): EmailLocale {
  const normalizedLocale = normalizeLocaleTag(locale);

  if (!normalizedLocale) {
    return DEFAULT_EMAIL_LOCALE;
  }

  if (EMAIL_LOCALE_SET.has(normalizedLocale)) {
    return normalizedLocale as EmailLocale;
  }

  try {
    const parsedLocale = new Intl.Locale(normalizedLocale);

    if (parsedLocale.language === "zh") {
      if (parsedLocale.script === "Hans") {
        return "zh-Hans";
      }

      if (
        parsedLocale.region &&
        SIMPLIFIED_CHINESE_REGIONS.has(parsedLocale.region)
      ) {
        return "zh-Hans";
      }
    }
  } catch {
    // Fall through to generic locale matching.
  }

  const baseLanguage = normalizedLocale.split("-").at(0);

  if (baseLanguage && EMAIL_LOCALE_SET.has(baseLanguage)) {
    return baseLanguage as EmailLocale;
  }

  return DEFAULT_EMAIL_LOCALE;
}

export function getEmailMessages(locale?: null | string): AbstractIntlMessages {
  const resolvedLocale = resolveSupportedEmailLocale(locale);

  return EMAIL_MESSAGES[resolvedLocale];
}

export function createEmailTranslator(locale?: null | string) {
  const resolvedLocale = resolveSupportedEmailLocale(locale);
  const translator = createTranslator({
    locale: resolvedLocale,
    messages: getEmailMessages(resolvedLocale),
  });

  return {
    locale: resolvedLocale,
    t: (key: string, values?: TranslationValues) =>
      translator(key as never, values as never),
  };
}
