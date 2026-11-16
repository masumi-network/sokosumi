import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "../../../../../messages/de.json";
import en from "../../../../../messages/en.json";
import es from "../../../../../messages/es.json";

describe("SEO chat credit receipts", () => {
  it.each([
    ["en", en, "0.1234 credits used"],
    ["de", de, "0,1234 Credits verwendet"],
    ["es", es, "0,1234 créditos usados"],
  ] as const)(
    "keeps the fractional ledger charge in %s",
    (locale, messages, expected) => {
      const t = createTranslator({
        locale,
        messages,
        namespace: "App.Seo.chat",
      });
      expect(t("creditsCharged", { credits: 0.1234 })).toBe(expected);
      expect(t("creditsCharged", { credits: 0.0000000001 })).toContain(
        locale === "en" ? "0.0000000001" : "0,0000000001",
      );
    },
  );
});
