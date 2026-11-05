import { describe, expect, it } from "vitest";

import { requestSeoAnalysisSchema } from "@/schemas/project-seo.schema";
import { validateSeoAnalysis } from "./project-seo-operations.service";

const page = "https://example.test/page";
const request = () =>
  requestSeoAnalysisSchema.parse({
    kind: "audit_lite",
    countryCode: "US",
    languageCode: "en",
    keywords: ["ordinary search"],
    analyses: ["keyword.refresh"],
    devices: ["desktop"],
    idempotencyKey: "request-test-key",
  });

describe("SEO worker request compatibility before Task dispatch", () => {
  it("rejects keyword operators, normalized duplicates and duplicate analyses before worker intake", () => {
    const base = request();
    expect(() =>
      validateSeoAnalysis({ ...base, keywords: ["site:example.test"] }, [page]),
    ).toThrow("search operator");
    expect(() =>
      validateSeoAnalysis(
        { ...base, keywords: ["ordinary search", "ordinary  search"] },
        [page],
      ),
    ).toThrow("each keyword once");
    expect(() =>
      validateSeoAnalysis(
        { ...base, analyses: ["keyword.refresh", "keyword.refresh"] },
        [page],
      ),
    ).toThrow("each analysis once");
  });
  it("rejects duplicate external targets and budget fields that the selected worker path cannot enforce", () => {
    const base = request();
    expect(() =>
      validateSeoAnalysis(
        {
          ...base,
          kind: "links",
          analyses: undefined,
          competitorUrls: [
            "https://competitor.test",
            "https://competitor.test/",
          ],
        },
        [page],
      ),
    ).toThrow("each competitor once");
    expect(() =>
      validateSeoAnalysis(
        { ...base, fullAuditLimits: { usd: 1, seconds: 120 } },
        [page],
      ),
    ).toThrow("Full-audit limits");
    expect(() =>
      validateSeoAnalysis(
        {
          ...base,
          kind: "audit_full",
          devices: ["desktop", "mobile"],
          keywords: [],
          competitorUrls: ["https://competitor.test/"],
        },
        [page],
      ),
    ).toThrow("Full audits cannot use focused analysis options");
  });
});
