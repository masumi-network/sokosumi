import type { CmoOverview } from "@sokosumi/core-client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type BrandBrain, openQuestions } from "../lib/brand-sections";
import { accountFromLink, BrandReveal, ownerFinding } from "./brand-profile";

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
  ({
    businessName: "acme.io",
    websiteUrl: "https://acme.io",
    projectLogo: null,
    brandVisual: {
      logoUrl: null,
      colors: ["#15142e", "#6349ea"],
      fonts: ["Inter"],
      siteName: "Acme",
      designMdUrl: null,
    },
    brandBrain,
  }) as unknown as CmoOverview;

const render = (brandBrain: BrandBrain) =>
  renderToStaticMarkup(
    <BrandReveal
      overview={overview(brandBrain)}
      onSave={async () => {}}
      onAsk={async () => {}}
    />,
  );

describe("Brand Brain reveal", () => {
  it("opens on the positioning, what Cuso noticed, the map and the buyers", () => {
    const html = render(
      brain({
        reveal: {
          positioning: "Rockets for founders who cannot wait",
          insights: [
            {
              title: "Speed is the promise",
              detail: "Every review mentions delivery time.",
              sourceUrl: "https://acme.io/reviews",
            },
          ],
          map: {
            x: { low: "Cheap", high: "Premium" },
            y: { low: "Slow", high: "Fast" },
            players: [
              { name: "Acme", x: 70, y: 90, you: true },
              { name: "Boring Rockets", x: 30, y: 20 },
            ],
          },
          buyers: [
            {
              role: "Seed-stage founder",
              wants: "A launch this quarter",
              worry: "Paying for a delay",
            },
          ],
        },
        profile: {
          pricing: {
            headline: "From 9 dollars a month",
            answer: "Self-serve plans from 9 dollars a month.",
            findings: [
              {
                point: "Plans start at 9.",
                evidence: "fact",
                confidence: "high",
              },
            ],
            openQuestions: ["Do annual plans get a discount?"],
          },
        },
      }),
    );
    // The answer first: the positioning as the headline.
    expect(html).toContain("Rockets for founders who cannot wait");
    expect(html).toContain("Seed-stage founder");
    expect(html).toContain("Tone of voice");
    expect(html).toContain("Launch on Tuesday.");
    expect(html).toContain("Name the rocket");
    expect(html).toContain("linkedin.com/company/acme");
    expect(html).toContain("Missing one? Paste the link");
    expect(html).toContain("Boring Rockets");
    expect(html).toContain("Speed is the promise");
    expect(html).toContain("Cuso has 1 question.");
    // The research waits one click deeper.
    expect(html).toContain("See the research");
    expect(html).not.toContain("From 9 dollars a month");
    expect(html).not.toContain("This is the short version");
    // The accent is the most vivid brand colour.
    expect(html).toContain("--brand:#6349ea");
  });

  it("shows what the business sells and what it costs", () => {
    const html = render(
      brain({
        offers: [
          {
            name: "Rocket Pro",
            what: "A reusable rocket for small payloads",
            price: "From $49,000",
            forWhom: "Founders shipping satellites",
            url: "https://acme.io/pro",
          },
        ],
      }),
    );
    expect(html).toContain("What you sell");
    expect(html).toContain('href="https://acme.io/pro"');
    expect(html).toContain("From $49,000");
    expect(html).toContain("A reusable rocket for small payloads");
    expect(html).toContain("For founders shipping satellites");
  });

  it("leads with the summary and offers research for an older Brand Brain", () => {
    const html = render(brain({}));
    expect(html).toContain("Acme sells rockets to founders.");
    expect(html).not.toContain("ships them fast");
    expect(html).toContain("This is the short version.");
    expect(html).toContain("Look deeper");
    expect(html).not.toContain("What Cuso noticed");
    expect(html).not.toContain("See all");
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
