import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/contacts.service", () => ({
  CONTACT_INCLUDE: {},
  contactCompanyMemberIds: vi.fn(),
  contactDtos: vi.fn(),
}));
vi.mock("@/services/fundraising-research.service", () => ({
  researchStatus: vi.fn(),
}));

import { parsePortfolio, pathStrength } from "./fundraising-paths.service";

const now = new Date("2026-11-25T12:00:00Z");

describe("pathStrength", () => {
  it("ranks a recent, frequent, direct relationship highest", () => {
    const direct = pathStrength(
      {
        kind: "direct",
        touches: 12,
        lastTouchAt: new Date("2026-11-20T00:00:00Z"),
        familiarity: 80,
        role: "Partner",
      },
      now,
    );
    const portfolioFounder = pathStrength(
      {
        kind: "portfolio",
        touches: 3,
        lastTouchAt: new Date("2026-09-01T00:00:00Z"),
        familiarity: 30,
        role: "Co-founder & CEO",
      },
      now,
    );
    const coldFund = pathStrength(
      {
        kind: "fund",
        touches: 0,
        lastTouchAt: null,
        familiarity: null,
        role: "Analyst",
      },
      now,
    );
    expect(direct).toBe(100);
    expect(portfolioFounder).toBe(43);
    expect(coldFund).toBe(10);
    expect(direct).toBeGreaterThan(portfolioFounder);
    expect(portfolioFounder).toBeGreaterThan(coldFund);
  });

  it("lets a high familiarity score stand in for few logged touches", () => {
    expect(
      pathStrength(
        {
          kind: "portfolio",
          touches: 1,
          lastTouchAt: null,
          familiarity: 70,
          role: null,
        },
        now,
      ),
    ).toBe(35);
  });
});

describe("parsePortfolio", () => {
  it("keeps one row per company with a source, and normalizes the rest", () => {
    const rows = parsePortfolio({
      companies: [
        {
          name: "AgentPay",
          website: "agentpay.io",
          round: "Seed",
          date: "2026-03",
          amount_usd: 2500000,
          source_url: "https://fund.com/portfolio",
        },
        { name: "Agent Pay", source_url: "https://news.example.com/agentpay" },
        { name: "No Source", round: "Series A" },
        { name: "Dropped", source_url: "not a url at all" },
        {
          name: "Cardano Infra",
          amount_usd: -1,
          source_url: "https://fund.com/news/cardano-infra",
        },
      ],
    });
    expect(rows).toEqual([
      {
        name: "AgentPay",
        website: "https://agentpay.io/",
        round: "Seed",
        date: "2026-03",
        amountUsd: 2_500_000,
        sourceUrl: "https://fund.com/portfolio",
      },
      {
        name: "Cardano Infra",
        website: null,
        round: null,
        date: null,
        amountUsd: null,
        sourceUrl: "https://fund.com/news/cardano-infra",
      },
    ]);
    expect(parsePortfolio(null)).toEqual([]);
  });
});
