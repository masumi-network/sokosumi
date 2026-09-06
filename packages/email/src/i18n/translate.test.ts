import { describe, expect, it } from "vitest";
import { EMAIL_LOCALES, EMAIL_MESSAGES } from "../locales/index.js";
import { createEmailTranslator } from "./translate.js";

function flattenKeys(
  messages: Record<string, string | Record<string, unknown>>,
  prefix = "",
): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const nextKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string") {
      return [nextKey];
    }

    return flattenKeys(
      value as Record<string, string | Record<string, unknown>>,
      nextKey,
    );
  });
}

describe("email translator", () => {
  it("uses exact locale matches when available", () => {
    const { locale, t } = createEmailTranslator("es");

    expect(locale).toBe("es");
    expect(t("auth.resetPassword.subject")).toBe(
      "Sokosumi - Restablecer contraseña",
    );
  });

  it("falls back to the base locale when only the language matches", () => {
    const { locale, t } = createEmailTranslator("de-AT");

    expect(locale).toBe("de");
    expect(t("auth.resetPassword.subject")).toBe(
      "Sokosumi - Passwort zurücksetzen",
    );
  });

  it("falls back to English when the locale is unsupported", () => {
    const { locale, t } = createEmailTranslator("sv-SE");

    expect(locale).toBe("en");
    expect(t("auth.magicLink.subject")).toBe(
      "Sokosumi - Sign in to your account",
    );
  });

  it("normalizes locale tags before checking locale support", () => {
    const { locale } = createEmailTranslator("es_MX");

    expect(locale).toBe("es");
  });

  it("keeps every raw locale catalog aligned with the English key shape", () => {
    const englishKeys = flattenKeys(
      EMAIL_MESSAGES.en as Record<string, string | Record<string, unknown>>,
    ).sort();

    for (const locale of EMAIL_LOCALES) {
      expect(
        flattenKeys(
          EMAIL_MESSAGES[locale] as Record<
            string,
            string | Record<string, unknown>
          >,
        ).sort(),
      ).toEqual(englishKeys);
    }
  });
});
