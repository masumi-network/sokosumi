import { DEFAULT_LOCALE } from "@/i18n/locales";
import {
  parseLocalePreference,
  resolveLocaleFromAcceptLanguage,
  resolveRequestLocale,
} from "@/i18n/locale-resolution";

describe("parseLocalePreference", () => {
  it("returns exact locale match when supported", () => {
    expect(parseLocalePreference("pt-BR")).toBe("pt-BR");
  });

  it("maps normalized values to supported locales", () => {
    expect(parseLocalePreference("pt_br")).toBe("pt-BR");
    expect(parseLocalePreference("fr-CA")).toBe("fr");
    expect(parseLocalePreference("zh")).toBe("zh-Hans");
  });

  it("returns null for unsupported values", () => {
    expect(parseLocalePreference("xx")).toBeNull();
    expect(parseLocalePreference(null)).toBeNull();
  });
});

describe("resolveLocaleFromAcceptLanguage", () => {
  it("resolves first supported locale from header", () => {
    expect(
      resolveLocaleFromAcceptLanguage("fr-CA,fr;q=0.9,en-US;q=0.8,en;q=0.7"),
    ).toBe("fr");
  });

  it("prefers the locale with higher q-value", () => {
    expect(resolveLocaleFromAcceptLanguage("de;q=0.1,en;q=0.9")).toBe("en");
  });

  it("ignores locales with q=0", () => {
    expect(resolveLocaleFromAcceptLanguage("fr;q=0,de;q=0.8")).toBe("de");
  });

  it("ignores entries with malformed q-values", () => {
    expect(resolveLocaleFromAcceptLanguage("fr;q=oops,en;q=0.8")).toBe("en");
  });

  it("maps base language to default variant", () => {
    expect(resolveLocaleFromAcceptLanguage("zh,ja;q=0.8")).toBe("zh-Hans");
  });
});

describe("resolveRequestLocale", () => {
  it("prefers cookie locale over accept-language header", () => {
    expect(
      resolveRequestLocale({
        cookieLocale: "pt-BR",
        acceptLanguageHeader: "de-DE,de;q=0.8",
        defaultLocale: DEFAULT_LOCALE,
      }),
    ).toBe("pt-BR");
  });

  it("falls back to default locale when nothing matches", () => {
    expect(
      resolveRequestLocale({
        cookieLocale: null,
        acceptLanguageHeader: "xx-ZZ",
        defaultLocale: DEFAULT_LOCALE,
      }),
    ).toBe(DEFAULT_LOCALE);
  });
});
