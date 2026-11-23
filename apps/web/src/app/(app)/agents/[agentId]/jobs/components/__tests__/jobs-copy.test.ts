import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import de from "@/messages/de.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

const locales = { en, de, es };

describe.each(Object.entries(locales))(
  "jobs copy in %s",
  (locale, messages) => {
    const search = createTranslator({
      locale,
      messages,
      namespace: "Components.Jobs.JobsSearch",
    });
    const list = createTranslator({
      locale,
      messages,
      namespace: "Components.Jobs.JobsList",
    });

    it("puts the total in the singular for one job", () => {
      expect(search("resultsCount", { found: 1, total: 1 })).not.toMatch(
        /results|Ergebnissen|resultados/,
      );
      expect(search("resultsCount", { found: 1, total: 1 })).toMatch(/^1 .*1/);
    });

    it("names the missed query", () => {
      expect(list("noMatches", { query: "zebra" })).toContain("zebra");
      expect(list("clearSearch")).not.toBe("");
    });
  },
);

describe.each(Object.entries(locales))(
  "jobs loading copy in %s",
  (locale, messages) => {
    const t = createTranslator({
      locale,
      messages,
      namespace: "App.Agents.Jobs.Loading",
    });

    it("announces jobs and a job loading", () => {
      expect(t("jobs")).not.toBe("");
      expect(t("job")).not.toBe("");
    });
  },
);
