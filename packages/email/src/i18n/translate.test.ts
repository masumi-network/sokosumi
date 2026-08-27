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
    const { locale, t } = createEmailTranslator("pt-BR");

    expect(locale).toBe("pt-BR");
    expect(t("auth.resetPassword.subject")).toBe(
      "Sokosumi - Redefinir sua senha",
    );
  });

  it("falls back to the base locale when only the language matches", () => {
    const { locale, t } = createEmailTranslator("pt-PT");

    expect(locale).toBe("pt");
    expect(t("auth.resetPassword.subject")).toBe(
      "Sokosumi - Repor a sua palavra-passe",
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
    const { locale } = createEmailTranslator("pt_br");

    expect(locale).toBe("pt-BR");
  });

  it.each(["zh-CN", "zh-SG", "zh-Hans-CN"])(
    "maps common Simplified Chinese tags to zh-Hans (%s)",
    (value) => {
      const { locale, t } = createEmailTranslator(value);

      expect(locale).toBe("zh-Hans");
      expect(t("auth.magicLink.subject")).toBe("Sokosumi - 登录您的账户");
    },
  );

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
