import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  getEmailLocale,
  parseLocalePreference,
  resolveLocaleFromAcceptLanguage,
  resolveRequestLocale,
} from "../locale.js";

describe("parseLocalePreference", () => {
  it("returns exact locale match when supported", () => {
    expect(parseLocalePreference("es")).toBe("es");
  });

  it("maps normalized values to supported locales", () => {
    expect(parseLocalePreference("de_de")).toBe("de");
    expect(parseLocalePreference("es-MX")).toBe("es");
  });

  it("returns null for unsupported values", () => {
    expect(parseLocalePreference("pt-BR")).toBeNull();
    expect(parseLocalePreference("xx")).toBeNull();
    expect(parseLocalePreference(null)).toBeNull();
  });
});

describe("resolveLocaleFromAcceptLanguage", () => {
  it("resolves first supported locale from header", () => {
    expect(
      resolveLocaleFromAcceptLanguage("fr-CA,fr;q=0.9,en-US;q=0.8,en;q=0.7"),
    ).toBe("en");
  });

  it("prefers the locale with higher q-value", () => {
    expect(resolveLocaleFromAcceptLanguage("de;q=0.1,en;q=0.9")).toBe("en");
  });

  it("ignores locales with q=0", () => {
    expect(resolveLocaleFromAcceptLanguage("fr;q=0,de;q=0.8")).toBe("de");
  });

  it("keeps a supported locale whose q-value is malformed at default quality", () => {
    // Regression: a garbled or empty q must not drop the language entirely.
    expect(resolveLocaleFromAcceptLanguage("de;q=oops,en;q=0.8")).toBe("de");
    expect(resolveLocaleFromAcceptLanguage("de;q=,en;q=0.8")).toBe("de");
  });

  it("maps regional language tags to supported base locale", () => {
    expect(resolveLocaleFromAcceptLanguage("es-MX,fr;q=0.8")).toBe("es");
  });
});

describe("resolveRequestLocale", () => {
  it("prefers cookie locale over accept-language header", () => {
    expect(
      resolveRequestLocale({
        cookieLocale: "de",
        acceptLanguageHeader: "es-ES,es;q=0.8",
        defaultLocale: DEFAULT_LOCALE,
      }),
    ).toBe("de");
  });

  it("ignores unsupported cookie locale and uses accept-language fallback", () => {
    expect(
      resolveRequestLocale({
        cookieLocale: "pt-BR",
        acceptLanguageHeader: "de-DE,de;q=0.8",
        defaultLocale: DEFAULT_LOCALE,
      }),
    ).toBe("de");
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

describe("getEmailLocale", () => {
  it("prefers the locale cookie over accept-language", () => {
    const request = new Request("https://example.com", {
      headers: {
        cookie: "sokosumi.locale=de",
        "accept-language": "es-ES,es;q=0.9",
      },
    });

    expect(getEmailLocale(request)).toBe("de");
  });

  it("falls back to the legacy locale cookie", () => {
    const request = new Request("https://example.com", {
      headers: { cookie: "locale=es" },
    });

    expect(getEmailLocale(request)).toBe("es");
  });

  it("uses accept-language when no cookie is present", () => {
    const request = new Request("https://example.com", {
      headers: { "accept-language": "de-DE,de;q=0.8" },
    });

    expect(getEmailLocale(request)).toBe("de");
  });

  it("reads headers from the fallback when no request is given", () => {
    const headers = new Headers({ cookie: "sokosumi.locale=es" });

    expect(getEmailLocale(undefined, headers)).toBe("es");
  });

  it("defaults to the default locale when nothing matches", () => {
    expect(getEmailLocale()).toBe(DEFAULT_LOCALE);
  });
});
