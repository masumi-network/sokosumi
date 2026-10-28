import type { CmoBrandBrain } from "@sokosumi/soko-bot";
import { describe, expect, it } from "vitest";

import { cmoCompetitorPages, cmoOwnPages } from "./cmo-brand-media.service";

const finding = (sourceUrl: string) => ({
  point: "A finding.",
  evidence: "fact" as const,
  confidence: "high" as const,
  sourceUrl,
});

function brain(extra: Partial<CmoBrandBrain>): CmoBrandBrain {
  return {
    summary: "Acme sells rockets.",
    voice: { tone: "Direct", do: [], dont: [], examples: [] },
    audience: [],
    products: [],
    offers: [],
    competitors: [],
    alternatives: [],
    channels: [],
    profile: {},
    questions: [],
    ...extra,
  };
}

describe("cmoOwnPages", () => {
  it("takes the homepage, then one cited pricing, product and customers page", () => {
    const pages = cmoOwnPages(
      "https://www.acme.io/start",
      brain({
        offers: [
          {
            name: "Pro",
            what: "A rocket",
            price: "$49",
            url: "https://acme.io/pricing?plan=pro",
          },
        ],
        profile: {
          company: {
            answer: "Rockets.",
            findings: [
              finding("https://acme.io/about"),
              finding("https://acme.io/features/launch"),
              finding("https://acme.io/customers"),
              finding("https://elsewhere.example/pricing"),
              finding("https://acme.io/blog/post"),
            ],
            openQuestions: [],
          },
        },
      }),
    );
    expect(pages).toEqual([
      { label: "Home", url: "https://www.acme.io/" },
      { label: "Pricing", url: "https://acme.io/pricing" },
      { label: "Product", url: "https://acme.io/features/launch" },
      { label: "Customers", url: "https://acme.io/customers" },
    ]);
  });

  it("never reads an about page as pricing, and tries /pricing when none was cited", () => {
    const pages = cmoOwnPages(
      "https://acme.io",
      brain({
        profile: {
          company: {
            answer: "Rockets.",
            findings: [finding("https://acme.io/about")],
            openQuestions: [],
          },
        },
      }),
    );
    expect(pages).toEqual([
      { label: "Home", url: "https://acme.io/" },
      { label: "Pricing", url: "https://acme.io/pricing" },
      { label: "About", url: "https://acme.io/about" },
    ]);
  });
});

describe("cmoCompetitorPages", () => {
  it("captures each competitor's homepage, at most eight", () => {
    const pages = cmoCompetitorPages(
      brain({
        competitors: [
          { name: "No link" },
          ...Array.from({ length: 10 }, (_, index) => ({
            name: `Rival ${index}`,
            url: `https://rival${index}.example/product?ref=x`,
          })),
        ],
      }),
    );
    expect(pages).toHaveLength(8);
    expect(pages[0]).toEqual({
      name: "Rival 0",
      url: "https://rival0.example/",
    });
  });
});
