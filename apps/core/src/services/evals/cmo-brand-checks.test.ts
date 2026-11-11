import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import { brandBrainChecks, strategyChecks } from "./cmo-brand-checks";
import { CMO_EVAL_BRANDS } from "./eval-cmo-cases";
import brains from "./fixtures/cmo-brand-brains.json";

const brand = CMO_EVAL_BRANDS[0];

describe("strategyChecks", () => {
  it("fails a plan that breaks a hard rule, which the save now keeps", () => {
    const saved = {
      month: "2026-11",
      summary: `${brand.name} for busy teams.`,
      goals: ["More sign-ups"],
      pillars: [{ name: "Setup", share: 100 }],
      mix: [{ approach: "educational", share: 100, why: "Teach" }],
      channels: [{ channel: "linkedin", cadence: "1 a week" }],
      calendar: [
        {
          id: "a",
          date: "2026-11-02",
          time: "09:00",
          channel: "linkedin",
          format: "text",
          title: "One piece",
          status: "idea",
          approach: "educational",
          pillar: "Setup",
        },
      ],
    };
    const { strategy, checks } = strategyChecks(brand, saved);
    expect(strategy).not.toBeNull();
    const rules = checks.find(
      (check) => check.label === "Keeps the strategy skill's rules",
    );
    expect(rules?.pass).toBe(false);
    expect(rules?.actual).toMatch(/Rule "16 pieces"/);
  });
});

const brain = (brains as Record<string, Record<string, unknown>>)["cal.com"];
const begin = {
  name: "Begin",
  url: "https://begin.is/",
  goal: "More users",
  main: "wallet",
  price: "free",
  profile: "x\\.com/beginwallet",
};

function failed(body: unknown) {
  return brandBrainChecks(begin, body)
    .checks.filter((check) => !check.pass)
    .map((check) => check.label);
}

describe("Brand Brain checks for a brand's price and profile", () => {
  it("passes when the main offer has the published price and the profile is listed", () => {
    expect(
      failed({
        ...brain,
        summary: "Begin is a free Cardano wallet.",
        offers: [{ name: "Begin Wallet", what: "A wallet", price: "Free" }],
        channels: [{ name: "X", url: "https://x.com/BeginWallet" }],
      }),
    ).toEqual([]);
  });

  it('fails a "Not public" price and a missing profile', () => {
    expect(
      failed({
        ...brain,
        summary: "Begin is a Cardano wallet.",
        offers: [
          { name: "Begin Wallet", what: "A wallet", price: "Not public" },
        ],
        channels: [{ name: "YouTube", url: "https://youtube.com/@begin" }],
      }),
    ).toEqual([
      "Prices the main offer as published",
      "Lists its social profile",
    ]);
  });
});
