import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type BrandBrain, openQuestions } from "../lib/brand-sections";
import { cmoOverview } from "../test-fixtures/cmo";
import { accountFromLink, Offers, ownerFinding } from "./brand-profile";
import { BrandStep } from "./onboarding/brand-step";

const brain = (extra: Partial<BrandBrain>): BrandBrain => ({
  summary: "Acme sells rockets to founders. It ships them fast.",
  voice: {
    tone: "Direct",
    do: ["Name the rocket"],
    dont: ["Promise orbit"],
    examples: ["Launch on Tuesday."],
  },
  audience: ["Founders"],
  products: ["Rockets"],
  competitors: [],
  channels: [{ name: "LinkedIn", url: "https://linkedin.com/company/acme" }],
  profile: {},
  ...extra,
});

const overview = (brandBrain: BrandBrain) =>
  cmoOverview({
    businessName: "acme.io",
    websiteUrl: "https://acme.io",
    projectLogo: null,
    brandVisual: {
      logoUrl: null,
      colors: ["#15142e", "#6349ea"],
      fonts: ["Inter"],
      siteName: "Acme",
      designMdUrl: null,
      images: [],
    },
    brandBrain,
  });

const _render = (brandBrain: BrandBrain) =>
  renderToStaticMarkup(
    <BrandStep
      overview={overview(brandBrain)}
      messages={[]}
      onCorrect={async () => {}}
      onSave={async () => {}}
    />,
  );

describe("Brand Brain reveal", () => {
  it("shows what the business sells and what it costs", () => {
    const html = renderToStaticMarkup(
      <Offers
        onSave={async () => {}}
        brain={brain({
          offers: [
            {
              name: "Rocket Pro",
              what: "A reusable rocket for small payloads",
              price: "From $49,000",
              forWhom: "Founders shipping satellites",
              url: "https://acme.io/pro",
            },
          ],
        })}
      />,
    );
    expect(html).toContain('href="https://acme.io/pro"');
    expect(html).toContain("From $49,000");
    expect(html).toContain("A reusable rocket for small payloads");
    expect(html).toContain("For founders shipping satellites");
  });

  it("shows every product line, the main one first, each removable", () => {
    const line = (name: string, price: string) => ({
      name,
      what: `The ${name}`,
      price,
    });
    const html = renderToStaticMarkup(
      <Offers
        onSave={async () => {}}
        brain={brain({
          offers: [
            line("iPhone", "From $799"),
            line("Mac", "From $999"),
            line("iPad", "From $349"),
          ],
        })}
      />,
    );
    expect(html).toContain("bb-offers-grid");
    expect(html).toContain("Main offer");
    for (const name of ["iPhone", "Mac", "iPad"]) {
      expect(html).toContain(`aria-label="Remove ${name}"`);
    }
    expect(html).toContain("From $349");
  });

  it("turns a pasted profile link into an account", () => {
    expect(accountFromLink("x.com/acme")).toEqual({
      name: "X",
      url: "https://x.com/acme",
    });
    expect(accountFromLink("https://www.instagram.com/acme/")).toMatchObject({
      name: "Instagram",
    });
    expect(accountFromLink("not a link")).toBeNull();
    expect(accountFromLink("")).toBeNull();
  });

  it("lists open questions in profile order", () => {
    expect(
      openQuestions({
        competition: { answer: "a", findings: [], openQuestions: ["Q2"] },
        company: { answer: "b", findings: [], openQuestions: ["Q1"] },
      }),
    ).toEqual([
      { key: "company", question: "Q1" },
      { key: "competition", question: "Q2" },
    ]);
  });

  it("counts what the owner writes as a confirmed fact", () => {
    const finding = ownerFinding(
      {
        point: "We sell to founders.",
        evidence: "inference",
        confidence: "low",
        sourceUrl: "https://acme.io",
        implication: "Talk to founders.",
      },
      "We sell to CTOs.",
    );
    expect(finding).toMatchObject({
      point: "We sell to CTOs.",
      evidence: "fact",
      confidence: "high",
      sourceUrl: undefined,
      implication: "Talk to founders.",
    });
    expect(finding.asOf).toMatch(/^\d{4}-\d{2}$/);
  });
});
